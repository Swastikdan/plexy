// Each suite owns a database and configuration, so tests never touch real libraries.
import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
const root = join(import.meta.dir, "..");
let failed = false;
for (const name of (await readdir(join(root, "apps/server/tests")))
  .filter((name) => name.endsWith(".test.ts"))
  .sort()) {
  const data = await mkdtemp(join(tmpdir(), "plexy-test-"));
  try {
    const child = Bun.spawn(
      [
        process.execPath,
        "test",
        join(root, "apps/server/tests", name),
        "--timeout",
        "20000",
      ],
      {
        cwd: root,
        env: { ...process.env, NODE_ENV: "test", PLEXY_DATA_DIR: data },
        stdout: "inherit",
        stderr: "inherit",
      },
    );
    if (await child.exited) failed = true;
  } finally {
    await rm(data, { recursive: true, force: true });
  }
}
process.exit(failed ? 1 : 0);
