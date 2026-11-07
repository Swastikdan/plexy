import { beforeAll, expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import { db, q, run, runMigrations } from "../src/db";
import { initConfig } from "../src/config";
import { createUser, loginUser } from "../src/accounts";
import { createDevice } from "../src/auth";
import { buildApp } from "../src/app";
const password = "encoded-blob-password-regression-62491";
beforeAll(async () => {
  await runMigrations();
  await initConfig();
});
async function blobAccount(name: string) {
  const user = await createUser(name, password);
  const row = q<{ password_hash: string }>(
    "SELECT password_hash FROM users WHERE id=?",
  ).get(user.id)!;
  run(
    "UPDATE users SET password_hash=? WHERE id=?",
    new TextEncoder().encode(row.password_hash),
    user.id,
  );
  expect(
    q<{ storage: string }>(
      "SELECT typeof(password_hash) storage FROM users WHERE id=?",
    ).get(user.id)?.storage,
  ).toBe("blob");
  return user;
}
test("legacy encoded BLOB hashes support login and desktop pairing-key creation", async () => {
  const user = await blobAccount("blob-login");
  expect((await loginUser(user.username, password))?.id).toBe(user.id);
  expect(await loginUser(user.username, "wrong-password")).toBeNull();
  const token = createDevice(
    "Existing desktop session",
    null,
    null,
    user.id,
  ).token;
  const app = buildApp({ requireAuth: true });
  const call = (path: string, body: unknown, credential?: string) =>
    app.handle(
      new Request(`http://localhost/api/auth/${path}`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(credential ? { Authorization: `Bearer ${credential}` } : {}),
        },
        body: JSON.stringify(body),
      }),
    );
  expect(
    (await call("login", { username: user.username, password })).status,
  ).toBe(200);
  const response = await call("pairing-code", { password }, token);
  expect(response.status).toBe(200);
  const pairing = await response.json();
  const redeemed = await call("pair", {
    code: pairing.code,
    name: "Android regression device",
  });
  expect(redeemed.status).toBe(200);
  expect((await redeemed.json()).user.id).toBe(user.id);
});
test("storage migration preserves the exact password hash and existing sessions", async () => {
  const user = await blobAccount("blob-migration");
  const token = createDevice("Existing device", null, null, user.id).token;
  const before = q<{ hash: string }>(
    "SELECT hex(password_hash) hash FROM users WHERE id=?",
  ).get(user.id)!.hash;
  const sql = await readFile(
    new URL("../src/migrations/014_password_hash_text.sql", import.meta.url),
    "utf8",
  );
  db.exec(sql);
  db.exec(sql);
  const after = q<{ storage: string; hash: string }>(
    "SELECT typeof(password_hash) storage,hex(password_hash) hash FROM users WHERE id=?",
  ).get(user.id)!;
  expect(after.storage).toBe("text");
  expect(after.hash).toBe(before);
  expect((await loginUser(user.username, password))?.id).toBe(user.id);
  const app = buildApp({ requireAuth: true });
  expect(
    (
      await app.handle(
        new Request("http://localhost/api/auth/me", {
          headers: { Authorization: `Bearer ${token}` },
        }),
      )
    ).status,
  ).toBe(200);
});
test("malformed hashes return an authentication failure instead of HTTP 500", async () => {
  const user = await createUser("damaged-password", password);
  run("UPDATE users SET password_hash=? WHERE id=?", "invalid-hash", user.id);
  const app = buildApp({ requireAuth: true });
  const response = await app.handle(
    new Request("http://localhost/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username: user.username, password }),
    }),
  );
  expect(response.status).toBe(401);
  expect(await response.json()).toEqual({
    error: "Incorrect username or password.",
  });
});
