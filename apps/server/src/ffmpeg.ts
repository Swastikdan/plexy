/// Locate a usable FFmpeg executable.
///
/// Live remux/transcode and trickplay extraction run in **child processes**, so
/// a codec crash can never take the HTTP server down. We deliberately do not
/// import FFmpeg bindings into the server process. Resolution order:
///
///  1. `PLEXY_FFMPEG` (explicit override for packaged/test installs)
///  2. a sibling `ffmpeg` next to the running executable (packaged app)
///  3. `ffmpeg` on `PATH` (Homebrew, Linux distro package)
///  4. the binary bundled with `node-av` (the documented optional dependency)
///
/// The path is cached: every stream request would otherwise stat a dozen
/// directories. `null` means playback falls back to a clear 503 instead of
/// pretending a conversion is available.
import { existsSync, readdirSync, statSync } from "node:fs";
import { dirname, join } from "node:path";

let cached: string | null | undefined;

function isExecutable(path: string): boolean {
  try {
    const info = statSync(path);
    return info.isFile() && (info.mode & 0o111) !== 0;
  } catch {
    return false;
  }
}

function nodeModulesRoots(): string[] {
  const roots = new Set<string>();
  roots.add(join(process.cwd(), "node_modules"));
  // Walk up from the server source and the executable so dev and packaged
  // layouts both resolve.
  for (const start of [import.meta.dir, dirname(process.argv[1] ?? ""), process.execPath]) {
    let dir = start;
    for (let depth = 0; depth < 8 && dir && dir !== dirname(dir); depth++) {
      roots.add(join(dir, "node_modules"));
      dir = dirname(dir);
    }
  }
  return [...roots];
}

/** Directories created by pnpm/bun that contain an unhoisted node-av install. */
function bundledFfmpegCandidates(): string[] {
  const found: string[] = [];
  for (const root of nodeModulesRoots()) {
    found.push(join(root, "node-av", "binary", "ffmpeg"));
    for (const store of [".pnpm", ".bun"]) {
      const storeDir = join(root, store);
      let entries: string[] = [];
      try { entries = readdirSync(storeDir); } catch { continue; }
      for (const entry of entries) {
        if (!entry.startsWith("node-av@")) continue;
        const suffix = store === ".pnpm" ? ["node_modules", "node-av"] : ["node_modules", "node-av"];
        found.push(join(storeDir, entry, ...suffix, "binary", "ffmpeg"));
      }
    }
  }
  return found;
}

export function resolveFfmpeg(): string | null {
  if (cached !== undefined) return cached;

  const explicit = Bun.env.PLEXY_FFMPEG;
  if (explicit && isExecutable(explicit)) {
    cached = explicit;
    return cached;
  }

  // Electron places bundled runtime tools in Resources/bin. The backend
  // executable lives beside that directory, so node_modules/PATH lookup is
  // not reliable in a GUI-launched packaged app.
  const resourcesDir = Bun.env.PLEXY_RESOURCES_DIR;
  if (resourcesDir) {
    const candidate = join(resourcesDir, "bin", "ffmpeg");
    if (isExecutable(candidate)) {
      cached = candidate;
      return cached;
    }
  }

  for (const dir of new Set([
    dirname(process.execPath),
    process.argv[1] ? dirname(process.argv[1]) : "",
    join(import.meta.dir, "..", "..", "..", "dist"),
  ])) {
    if (!dir) continue;
    const candidate = join(dir, "ffmpeg");
    if (isExecutable(candidate)) {
      cached = candidate;
      return cached;
    }
  }

  const onPath = Bun.which("ffmpeg");
  if (onPath && isExecutable(onPath)) {
    cached = onPath;
    return cached;
  }

  for (const candidate of bundledFfmpegCandidates()) {
    if (isExecutable(candidate)) {
      cached = candidate;
      return cached;
    }
  }

  // Last resort: common package-manager locations not always on PATH when the
  // server is launched from a GUI app bundle.
  for (const candidate of ["/opt/homebrew/bin/ffmpeg", "/usr/local/bin/ffmpeg", "/usr/bin/ffmpeg"]) {
    if (existsSync(candidate) && isExecutable(candidate)) {
      cached = candidate;
      return cached;
    }
  }

  cached = null;
  return null;
}

/** Reset the cache (tests and admin diagnostics). */
export function resetFfmpegCache(): void {
  cached = undefined;
}
