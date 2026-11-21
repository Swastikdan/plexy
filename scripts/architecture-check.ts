/// Architecture guard: one-way dependencies across the Plexy monorepo.
///
/// Rules (docs/MONOREPO.md):
///   apps/*     -> packages/*        only
///   packages/* -> packages/*        only, acyclic
///   no app imports another app, no package imports an app.
///
/// Checks both declared workspace dependencies and source import specifiers,
/// so a stray relative path is caught as well as a package.json edge.
///
///   bun scripts/architecture-check.ts        # exit 1 on a violation
///   bun scripts/architecture-check.ts --json # machine-readable
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { basename, dirname, join, relative, resolve } from "node:path";

const root = resolve(import.meta.dir, "..");
const json = process.argv.includes("--json");
const workspaces = ["apps", "packages"] as const;
const apps = readdirSync(join(root, "apps")).filter((name) =>
  existsSync(join(root, "apps", name, "package.json")),
);
const packages = readdirSync(join(root, "packages")).filter((name) =>
  existsSync(join(root, "packages", name, "package.json")),
);

const appPackages = new Set(apps.map((name) => `@plexy/${name}`));
const workspacePackages = new Set(
  packages.map((name) => JSON.parse(readFileSync(join(root, "packages", name, "package.json"), "utf8")).name),
);

interface Violation {
  file: string;
  rule: string;
  detail: string;
}

const violations: Violation[] = [];

function packageJson(dir: string): { name?: string; dependencies?: Record<string, string>; devDependencies?: Record<string, string> } {
  return JSON.parse(readFileSync(join(dir, "package.json"), "utf8"));
}

function sourceFiles(dir: string): string[] {
  if (!existsSync(dir)) return [];
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === "node_modules" || entry.name === "android" || entry.name === "dist") continue;
    const full = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...sourceFiles(full));
    else if (/\.(?:ts|tsx|mts|cts|js|mjs|cjs)$/.test(entry.name)) out.push(full);
  }
  return out;
}

function importsOf(file: string): string[] {
  const code = readFileSync(file, "utf8");
  const found: string[] = [];
  const patterns = [
    /(?:^|[^.\w])import\s+(?:type\s+)?(?:[^'"\n]*?\s+from\s+)?["']([^"']+)["']/g,
    /(?:^|[^.\w])export\s+(?:type\s+)?[^'"\n]*?\s+from\s+["']([^"']+)["']/g,
    /(?:^|[^.\w])(?:require|import)\s*\(\s*["']([^"']+)["']\s*\)/g,
    /(?:^|[^.\w])import\s*\(\s*["']([^"']+)["']\s*\)/g,
  ];
  for (const pattern of patterns) {
    for (const match of code.matchAll(pattern)) found.push(match[1]);
  }
  return found;
}

function checkSource(scope: "app" | "package", name: string) {
  const dir = join(root, scope === "app" ? "apps" : "packages", name);
  for (const file of sourceFiles(join(dir, "src"))) {
    const rel = relative(root, file);
    for (const specifier of importsOf(file)) {
      if (specifier.startsWith(".")) {
        const target = resolve(dirname(file), specifier);
        if (scope === "package" && target.includes(`${join(root, "apps")}/`)) {
          violations.push({ file: rel, rule: "package -> app", detail: specifier });
        }
        if (scope === "app") {
          const otherApp = apps.find(
            (other) => other !== name && target.startsWith(join(root, "apps", other) + "/"),
          );
          if (otherApp) {
            violations.push({ file: rel, rule: "app -> app", detail: `${specifier} (${otherApp})` });
          }
        }
        continue;
      }
      const appMatch = [...appPackages].find(
        (pkg) => specifier === pkg || specifier.startsWith(pkg + "/"),
      );
      if (!appMatch) continue;
      const target = appMatch.slice("@plexy/".length);
      if (scope === "package") {
        violations.push({ file: rel, rule: "package -> app", detail: specifier });
      } else if (target !== name) {
        violations.push({ file: rel, rule: "app -> app", detail: specifier });
      }
    }
  }
}

// Shared packages must stay platform-neutral: they run in the browser, Metro,
// and Bun at once, so no Node built-ins and no Bun globals in their source.
for (const name of packages) {
  if (name === "tsconfig") continue;
  for (const file of sourceFiles(join(root, "packages", name, "src"))) {
    const code = readFileSync(file, "utf8");
    const rel = relative(root, file);
    if (/\bfrom\s+["']node:|\brequire\s*\(\s*["']node:|\bBun\./.test(code)) {
      violations.push({ file: rel, rule: "package is platform-neutral", detail: "node:/Bun usage" });
    }
  }
}

// The browser app talks to Electron only through the typed bridge contract.
for (const file of sourceFiles(join(root, "apps", "web", "src"))) {
  if (/\bfrom\s+["']electron["']/.test(readFileSync(file, "utf8"))) {
    violations.push({
      file: relative(root, file),
      rule: "web uses desktop-bridge",
      detail: "direct electron import",
    });
  }
}

// Declared edges: apps must not depend on apps; packages must not depend on apps.
for (const name of apps) {
  const pkg = packageJson(join(root, "apps", name));
  for (const dep of Object.keys({ ...pkg.dependencies, ...pkg.devDependencies })) {
    if (appPackages.has(dep)) {
      violations.push({ file: `apps/${name}/package.json`, rule: "app -> app", detail: dep });
    }
  }
  checkSource("app", name);
}
for (const name of packages) {
  const pkg = packageJson(join(root, "packages", name));
  for (const dep of Object.keys({ ...pkg.dependencies, ...pkg.devDependencies })) {
    if (appPackages.has(dep)) {
      violations.push({ file: `packages/${name}/package.json`, rule: "package -> app", detail: dep });
    }
  }
  checkSource("package", name);
}

// packages/api-client is the leaf: it must not depend on another workspace package.
{
  const pkg = packageJson(join(root, "packages", "api-client"));
  for (const dep of Object.keys({ ...pkg.dependencies, ...pkg.devDependencies })) {
    if (workspacePackages.has(dep) && dep !== "@plexy/tsconfig") {
      violations.push({ file: "packages/api-client/package.json", rule: "leaf package", detail: dep });
    }
  }
}

// Package graph must stay acyclic.
{
  const graph = new Map<string, string[]>();
  for (const name of packages) {
    const pkg = packageJson(join(root, "packages", name));
    graph.set(
      pkg.name!,
      Object.keys({ ...pkg.dependencies, ...pkg.devDependencies }).filter((dep) => workspacePackages.has(dep)),
    );
  }
  const state = new Map<string, "visiting" | "done">();
  const visit = (node: string, trail: string[]) => {
    if (state.get(node) === "visiting") {
      violations.push({
        file: "packages/*",
        rule: "package cycle",
        detail: [...trail, node].join(" -> "),
      });
      return;
    }
    if (state.get(node) === "done") return;
    state.set(node, "visiting");
    for (const dep of graph.get(node) ?? []) visit(dep, [...trail, node]);
    state.set(node, "done");
  };
  for (const name of graph.keys()) visit(name, []);
}

const report = { ok: violations.length === 0, violations };
if (json) {
  console.log(JSON.stringify(report, null, 2));
} else if (violations.length) {
  console.log(`Architecture violations (${violations.length}):`);
  for (const violation of violations) {
    console.log(`  ✗ ${violation.file}: ${violation.rule} — ${violation.detail}`);
  }
} else {
  console.log(
    `Architecture ok: ${apps.length} apps, ${packages.length} packages, one-way dependencies, no app-to-app edges, no package cycles.`,
  );
}
process.exit(violations.length ? 1 : 0);
