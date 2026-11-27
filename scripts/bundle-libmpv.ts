/// Bundle libmpv and its non-system dylib closure for embedding.
///
/// The desktop player loads libmpv in-process (see `native/mpv-embed`), so the
/// packaged app must carry a self-contained libmpv. Homebrew builds link their
/// dependencies through absolute `/opt/homebrew/opt/...` paths; this script
/// copies the closure into `dist/bin/mpv-libs` and rewrites every install name
/// to `@loader_path/<name>` so the bundle works on machines without Homebrew.
///
/// Source selection:
///   PLEXY_LIBMPV_SOURCE=/path/to/libmpv.2.dylib
///   /opt/homebrew/opt/mpv/lib/libmpv.2.dylib (or /usr/local)
import { execFileSync } from "node:child_process";
import { chmodSync, copyFileSync, existsSync, mkdirSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";

const SYSTEM_PREFIXES = ["/System/Library/", "/usr/lib/", "/Library/Apple/"];

function isSystemLibrary(path: string): boolean {
  return SYSTEM_PREFIXES.some((prefix) => path.startsWith(prefix));
}

function dependencies(file: string): string[] {
  const output = execFileSync("otool", ["-L", file], { encoding: "utf8" });
  return output
    .split("\n")
    .slice(1)
    .map((line) => line.trim().split(" (")[0] ?? "")
    .filter(Boolean);
}

function rpaths(file: string): string[] {
  const output = execFileSync("otool", ["-l", file], { encoding: "utf8" });
  const lines = output.split("\n");
  const result: string[] = [];
  for (let index = 0; index < lines.length; index++) {
    if (!lines[index].includes("LC_RPATH")) continue;
    const pathLine = lines.slice(index, index + 4).find((line) => line.includes(" path "));
    if (pathLine) {
      const value = pathLine.trim().split(" path ")[1]?.split(" (")[0];
      if (value) result.push(value);
    }
  }
  return result;
}

function resolveDependency(dep: string, owner: string, cache: Map<string, string | null>): string | null {
  if (cache.has(dep)) return cache.get(dep) ?? null;
  const directory = dirname(owner);
  const candidates: string[] = [];
  if (dep.startsWith("@loader_path/")) {
    candidates.push(join(directory, dep.slice("@loader_path/".length)));
  } else if (dep.startsWith("@rpath/")) {
    const tail = dep.slice("@rpath/".length);
    for (const rpath of rpaths(owner)) {
      const base = rpath
        .replace("@loader_path", directory)
        .replace("@executable_path", directory);
      candidates.push(join(base, tail));
    }
    candidates.push(join(directory, tail), join("/opt/homebrew/lib", tail), join("/usr/local/lib", tail));
  } else if (dep.startsWith("/")) {
    candidates.push(dep);
  }
  const found = candidates.find((candidate) => existsSync(candidate)) ?? null;
  cache.set(dep, found);
  return found;
}

export function resolveLibmpvSource(): string | null {
  const candidates = [
    process.env.PLEXY_LIBMPV_SOURCE,
    "/opt/homebrew/opt/mpv/lib/libmpv.2.dylib",
    "/usr/local/opt/mpv/lib/libmpv.2.dylib",
    "/opt/homebrew/lib/libmpv.2.dylib",
    "/usr/local/lib/libmpv.2.dylib",
  ];
  return candidates.find((candidate) => candidate && existsSync(candidate)) ?? null;
}

export async function bundleLibmpv(rootDir: string, outdir = join(rootDir, "dist", "bin", "mpv-libs")): Promise<boolean> {
  if (process.platform !== "darwin") {
    console.log("• Skipping libmpv bundling (macOS only)");
    return true;
  }
  const target = join(outdir, "libmpv.2.dylib");
  if (existsSync(target) && process.env.PLEXY_LIBMPV_REFRESH !== "1") {
    console.log("✓ Reusing bundled libmpv");
    return true;
  }

  const source = resolveLibmpvSource();
  if (!source) {
    console.log(
      "• libmpv not found. Set PLEXY_LIBMPV_SOURCE to a libmpv.2.dylib (or install mpv with Homebrew).",
    );
    return false;
  }

  if (existsSync(outdir)) {
    for (const entry of readdirSync(outdir)) {
      if (entry.endsWith(".dylib") || entry.endsWith(".version")) {
        try {
          execFileSync("rm", ["-f", join(outdir, entry)]);
        } catch {
          /* best effort */
        }
      }
    }
  }
  mkdirSync(outdir, { recursive: true });

  const copied = new Map<string, string>();
  const cache = new Map<string, string | null>();
  const queue = [source];

  while (queue.length > 0) {
    const current = queue.shift()!;
    if (!copied.has(current)) {
      const name = basename(current);
      copied.set(current, name);
      copyFileSync(current, join(outdir, name));
      chmodSync(join(outdir, name), 0o644);
    }
    for (const dep of dependencies(current)) {
      if (isSystemLibrary(dep)) continue;
      const resolved = resolveDependency(dep, current, cache);
      if (!resolved) {
        console.warn(`  ! Could not resolve ${dep} (required by ${basename(current)})`);
        continue;
      }
      if (!copied.has(resolved)) queue.push(resolved);
    }
  }

  for (const [original, name] of copied) {
    const file = join(outdir, name);
    execFileSync("install_name_tool", ["-id", `@loader_path/${name}`, file], { stdio: "ignore" });
    for (const dep of dependencies(file)) {
      if (isSystemLibrary(dep)) continue;
      const resolved = resolveDependency(dep, original, cache);
      const depName = resolved ? copied.get(resolved) : undefined;
      if (depName) {
        execFileSync("install_name_tool", ["-change", dep, `@loader_path/${depName}`, file], { stdio: "ignore" });
      }
    }
  }

  // install_name_tool invalidates each library's signature. macOS kills a
  // process that loads an invalidly signed dylib, so re-sign the bundle.
  const names = new Set(copied.values());
  for (const name of names) {
    try {
      execFileSync("codesign", ["--force", "--sign", "-", join(outdir, name)], { stdio: "ignore" });
    } catch {
      console.warn(`  ! Could not ad-hoc sign ${name}`);
    }
  }

  try {
    const version = execFileSync("mpv", ["--version"], { encoding: "utf8" }).split("\n")[0] ?? "";
    writeFileSync(join(outdir, "libmpv.2.dylib.version"), `${version.replace(/^mpv\s+/, "libmpv ")}\n`);
  } catch {
    /* version is informational */
  }

  let bytes = 0;
  for (const name of names) {
    try {
      bytes += statSync(join(outdir, name)).size;
    } catch {
      /* ignore */
    }
  }
  console.log(
    `✓ Bundled libmpv with ${names.size} libraries (${(bytes / 1024 / 1024).toFixed(1)} MiB) in ${outdir}`,
  );
  return true;
}
