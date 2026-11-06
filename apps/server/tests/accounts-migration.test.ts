import { expect, test } from "bun:test";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { db, q, run, runMigrations } from "../src/db";
import { createUser, setupState } from "../src/accounts";
import { peekToken } from "../src/auth";

test("existing libraries and progress migrate; old account-free devices cannot authenticate", async () => {
  const dir = join(import.meta.dir, "../src/migrations");
  for (const file of (await readdir(dir))
    .filter((file) => /^\d+.*\.sql$/.test(file) && file < "013")
    .sort()) {
    db.exec(await readFile(join(dir, file), "utf8"));
    run("INSERT OR IGNORE INTO schema_migrations(file) VALUES(?)", file);
  }
  run(
    "INSERT INTO libraries(id,name,type) VALUES(1,'Existing library','movies')",
  );
  run(
    "INSERT INTO items(id,library_id,kind,name,sort_title) VALUES(1,1,'movie','Existing movie','existing movie')",
  );
  run(
    "INSERT INTO watch_state(item_id,position_seconds,duration_seconds,played) VALUES(1,40,100,0)",
  );
  const raw = "old-unscoped-device-credential";
  run(
    "INSERT INTO auth_devices(name,token_hash) VALUES('Legacy device',?)",
    new Bun.CryptoHasher("sha256").update(raw).digest("hex"),
  );
  await runMigrations();
  expect(peekToken(raw)).toBeNull();
  expect(setupState().setupComplete).toBe(false);
  const owner = await createUser(
    "migration-owner",
    "migration-owner-password",
    "admin",
    true,
  );
  expect(
    q<{ position_seconds: number }>(
      "SELECT position_seconds FROM watch_state WHERE user_id=? AND item_id=1",
    ).get(owner.id)?.position_seconds,
  ).toBe(40);
  expect(q("SELECT id FROM libraries WHERE id=1").get()).toBeDefined();
  await runMigrations();
  expect(
    q<{ count: number }>(
      "SELECT COUNT(*) count FROM watch_state WHERE user_id=?",
    ).get(owner.id)?.count,
  ).toBe(1);
});
