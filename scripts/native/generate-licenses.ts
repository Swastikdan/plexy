/** Preserve published notices verbatim; never infer a package's license from its name. */
import { existsSync, readFileSync, readdirSync, realpathSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

const root = resolve(import.meta.dir, "../..");
const app = join(root, "apps/mobile");
const output = join(app, "src/features/settings/data/open-source-licenses.json");
const visited = new Set<string>();
const recorded = new Set<string>();
const supplemental = JSON.parse(readFileSync(join(root, "licenses/mobile-supplemental.json"), "utf8"));
const missing: string[] = [];
const patches = JSON.parse(readFileSync(join(root, "package.json"), "utf8")).patchedDependencies || {};
const entries: { name: string; version: string; license: string; url: string; notices: { file: string; text: string }[]; modifications?: string }[] = [];

function locate(name: string, from: string): string | null {
  let current = from;
  while (true) {
    const candidate = join(current, "node_modules", name, "package.json");
    if (existsSync(candidate)) return dirname(realpathSync(candidate));
    const parent = dirname(current);
    if (parent === current) return null;
    current = parent;
  }
}
function visit(directory: string) {
  directory = realpathSync(directory);
  if (visited.has(directory)) return;
  visited.add(directory);
  const pkg = JSON.parse(readFileSync(join(directory, "package.json"), "utf8"));
  const key = `${pkg.name}@${pkg.version}`;
  if (!pkg.name.startsWith("@plexy/") && !recorded.has(key)) {
    recorded.add(key);
    const notices: { file: string; text: string }[] = [];
    function collect(relative = "") {
      for (const file of readdirSync(join(directory, relative), { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
        const path = join(relative, file.name);
        if (file.isFile() && /^(licen[cs]e|copying|notice|copyright|ofl)([._-]|$)/i.test(file.name)) {
          notices.push({ file: path, text: readFileSync(join(directory, path), "utf8") });
        } else if (file.isDirectory() && /^(licenses?|notices?)$/i.test(file.name)) collect(path);
      }
    }
    collect();
    if (!notices.length && supplemental[key]) {
      const extra = supplemental[key];
      notices.push({ file: extra.file, text: extra.text });
    }
    if (!notices.length) missing.push(key);
    const repository = typeof pkg.repository === "string" ? pkg.repository : pkg.repository?.url;
    const candidateUrl = (repository || pkg.homepage || "").replace(/^git\+/, "").replace(/^git:\/\//, "https://").replace(/^ssh:\/\/git@github.com\//, "https://github.com/").replace(/\.git$/, "");
    const url = /^https?:\/\//.test(candidateUrl) ? candidateUrl : `https://www.npmjs.com/package/${pkg.name}`;
    entries.push({ name: pkg.name, version: pkg.version, license: typeof pkg.license === "string" ? pkg.license : pkg.license?.type || "See notices", url, notices,
      ...(patches[key] ? { modifications: `Plexy applies local modifications. The patch is included in the Plexy source repository at ${patches[key]}.` } : {}),
    });
  }
  const optional = pkg.optionalDependencies || {};
  // Include installed peers and transitives conservatively, even if Metro later removes them.
  const names = new Set([...Object.keys(pkg.dependencies || {}), ...Object.keys(optional), ...Object.keys(pkg.peerDependencies || {})]);
  for (const name of [...names].sort()) {
    const dependency = locate(name, directory);
    if (dependency) visit(dependency);
    else if (pkg.dependencies?.[name] && !optional[name]) throw new Error(`Missing dependency ${name} of ${pkg.name}; run bun install first.`);
  }
}
visit(app);
entries.sort((a, b) => `${a.name}@${a.version}`.localeCompare(`${b.name}@${b.version}`));
if (missing.length) throw new Error(`Missing license texts for ${missing.join(", ")}. Add verified upstream copies to licenses/mobile-supplemental.json before building.`);
const result = `${JSON.stringify(entries, null, 2)}\n`;
if (process.argv.includes("--check")) {
  if (!existsSync(output) || readFileSync(output, "utf8") !== result) throw new Error("Mobile notices are stale. Run bun run licenses:mobile and commit the generated notices.");
} else {
  mkdirSync(dirname(output), { recursive: true });
  writeFileSync(output, result);
}
console.log(`Collected ${entries.length} mobile dependency notices (${Buffer.byteLength(result)} bytes).`);
