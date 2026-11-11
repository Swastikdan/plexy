import { expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
const source = resolve(import.meta.dir, "../src/lib/client");
test("local catalog adapters have no backend transport or account operations", async () => {
  for (const name of ["api.ts", "local-api.ts"]) {
    const code = await readFile(resolve(source, name), "utf8");
    expect(code).not.toMatch(
      /\bfetch\s*\(|\b(?:login|logout|pair|normalizeServerUrl)\s*\(/,
    );
  }
  const context = await readFile(resolve(source, "context.tsx"), "utf8");
  expect(context).not.toMatch(/Session|DownloadManager|new PlexyApi|NetInfo/);
});
