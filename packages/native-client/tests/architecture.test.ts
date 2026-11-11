import { expect, test } from "bun:test";
import { readdir, readFile } from "node:fs/promises";
import { resolve, join } from "node:path";
const root = resolve(import.meta.dir, "../../..");
async function sources(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  return (await Promise.all(entries.map(entry => entry.isDirectory()
    ? sources(join(directory, entry.name))
    : /\.tsx?$/.test(entry.name) ? [join(directory, entry.name)] : []))).flat();
}
test("shared native logic never depends on app implementations", async () => {
  for (const path of await sources(join(root, "packages/native-client/src"))) {
    const source = await readFile(path, "utf8");
    expect(source, path).not.toMatch(/(?:from\s*|import\s*\()["'][^"']*apps\//);
  }
});
test("mobile and TV own their UI independently", async () => {
  for (const app of ["mobile", "tv"]) {
    for (const path of await sources(join(root, `apps/${app}/src`))) {
      const source = await readFile(path, "utf8");
      expect(source, path).not.toMatch(/(?:from\s*|import\s*\()["'][^"']*(?:native-client\/src\/(?:ui|theme|screens|Catalog|Player)|apps\/(?:mobile|tv)\/src)/);
    }
  }
});
