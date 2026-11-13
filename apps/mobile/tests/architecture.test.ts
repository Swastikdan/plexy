import { expect,test } from "bun:test";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
const source = resolve(import.meta.dir, "../src/core/library");
test("local catalog adapters have no backend transport or account operations", async () => {
  for (const name of ["catalog-api.ts", "local-api.ts"]) {
    const code = await readFile(resolve(source, name), "utf8");
    expect(code).not.toMatch(
      /\bfetch\s*\(|\b(?:login|logout|pair|normalizeServerUrl)\s*\(/,
    );
  }
  const context = await readFile(
    resolve(source, "../client/client-provider.tsx"),
    "utf8",
  );
  expect(context).not.toMatch(/Session|DownloadManager|new PlexyApi|NetInfo/);
});

async function sourceFiles(directory: string): Promise<string[]> {
  const { readdir } = await import("node:fs/promises");
  const entries = await readdir(directory, { withFileTypes: true });
  const files = await Promise.all(
    entries.map((entry) =>
      entry.isDirectory()
        ? sourceFiles(resolve(directory, entry.name))
        : /\.tsx?$/.test(entry.name)
          ? [resolve(directory, entry.name)]
          : [],
    ),
  );
  return files.flat();
}

const sourceRoot = resolve(import.meta.dir, "../src");
test("core and shared modules do not depend on feature implementations", async () => {
  const ts = await import("typescript");
  for (const folder of ["core", "shared"]) {
    for (const file of await sourceFiles(resolve(sourceRoot, folder))) {
      const code = await readFile(file, "utf8");
      const sourceFile = ts.createSourceFile(
        file,
        code,
        ts.ScriptTarget.Latest,
        true,
      );
      for (const node of sourceFile.statements) {
        if (
          !ts.isImportDeclaration(node) ||
          !ts.isStringLiteral(node.moduleSpecifier)
        )
          continue;
        const name = node.moduleSpecifier.text;
        if (!name.startsWith(".") && !name.startsWith("@/")) continue;
        const { dirname } = await import("node:path");
        expect(
          (name.startsWith("@/")
            ? resolve(sourceRoot, name.slice(2))
            : resolve(dirname(file), name)).startsWith(
            resolve(sourceRoot, "features") + "/",
          ),
        ).toBe(false);
      }
    }
  }
});

test("mobile runtime imports have no circular dependencies", async () => {
  const ts = await import("typescript");
  const { dirname } = await import("node:path");
  const files = await sourceFiles(sourceRoot);
  const known = new Set(files);
  const graph = new Map<string, string[]>();
  for (const file of files) {
    const sourceFile = ts.createSourceFile(
      file,
      await readFile(file, "utf8"),
      ts.ScriptTarget.Latest,
      true,
    );
    const dependencies: string[] = [];
    for (const node of sourceFile.statements) {
      if (
        !ts.isImportDeclaration(node) ||
        !ts.isStringLiteral(node.moduleSpecifier)
      )
        continue;
      const clause = node.importClause;
      if (clause?.isTypeOnly) continue;
      if (
        clause?.namedBindings &&
        ts.isNamedImports(clause.namedBindings) &&
        !clause.name &&
        clause.namedBindings.elements.every((element) => element.isTypeOnly)
      )
        continue;
      const name = node.moduleSpecifier.text;
      if (!name.startsWith(".") && !name.startsWith("@/")) continue;
      const base = name.startsWith("@/")
        ? resolve(sourceRoot, name.slice(2))
        : resolve(dirname(file), name);
      const target = [
        base + ".ts",
        base + ".tsx",
        resolve(base, "index.ts"),
      ].find((candidate) => known.has(candidate));
      if (target) dependencies.push(target);
    }
    graph.set(file, dependencies);
  }
  const complete = new Set<string>();
  function visit(file: string, stack: string[]) {
    if (stack.includes(file))
      throw new Error(
        `Circular import: ${[...stack, file].map((name) => name.replace(sourceRoot + "/", "")).join(" → ")}`,
      );
    if (complete.has(file)) return;
    for (const dependency of graph.get(file) ?? [])
      visit(dependency, [...stack, file]);
    complete.add(file);
  }
  for (const file of files) visit(file, []);
});
