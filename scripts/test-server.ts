// Each suite owns a database and configuration, so tests never touch real libraries.
import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
const root = join(import.meta.dir, "..");
let failed = false;
const testDir = join(root, "apps/server/tests");
const available = (await readdir(testDir))
  .filter((name) => name.endsWith(".test.ts"))
  .sort();
const requested = process.argv.slice(2);
for (const name of requested) {
  if (!available.includes(name)) {
    throw new Error(`Unknown server test "${name}". Pass a filename from apps/server/tests.`);
  }
}
for (const name of requested.length ? requested : available) {
  const data = await mkdtemp(join(tmpdir(), "plexy-test-"));
  try {
    const child = Bun.spawn(
      [
        process.execPath,
        "test",
        join(testDir, name),
        "--timeout",
        "20000",
      ],
      {
        cwd: root,
        env: {
          ...process.env,
          NODE_ENV: "test",
          PLEXY_DATA_DIR: data,
          PLEXY_LOG_DIR: join(data, "logs"),
        },
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
