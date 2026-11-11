import { expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  readLocalServerEnabled,
  writeLocalServerEnabled,
} from "../src/main/local-server-preference";
test("local server defaults on and the checkbox preference survives restarts", async () => {
  const directory = await mkdtemp(join(tmpdir(), "plexy-mode-"));
  try {
    expect(readLocalServerEnabled(directory)).toBe(true);
    writeLocalServerEnabled(directory, false);
    expect(readLocalServerEnabled(directory)).toBe(false);
    writeLocalServerEnabled(directory, true);
    expect(readLocalServerEnabled(directory)).toBe(true);
    await writeFile(join(directory, "local-server.json"), "invalid");
    expect(readLocalServerEnabled(directory)).toBe(true);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
