/// Bundle a native mpv engine into the desktop app's resources.
///
/// Native playback is optional: when no engine is available the packaged app
/// keeps the browser player and the native player reports itself unavailable.
/// Supply one of:
///
///   PLEXY_MPV_PATH=/path/to/mpv     copy a local build (development shortcut)
///   PLEXY_MPV_URL + PLEXY_MPV_SHA256
///   scripts/mpv-manifest.json      { version, url, sha256 }
///
/// Downloads are refused without a checksum. Extracted dylibs are copied into
/// `dist/bin/mpv-libs` and rpath-fixed best-effort so the bundled binary runs
/// without Homebrew.
import { chmod, copyFile, mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { existsSync, readdirSync } from "node:fs";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { dirname, join } from "node:path";

interface MpvManifest {
  version?: string;
  url?: string;
  sha256?: string;
}

const ARCHIVE_CANDIDATES = [".zip", ".tar.gz", ".tgz", ".tar.xz", ".tar.bz2"];

export async function bundleMpv(rootDir: string): Promise<boolean> {
  const distBin = join(rootDir, "dist", "bin");
  const target = join(distBin, "mpv");
  const libsDir = join(distBin, "mpv-libs");
  await mkdir(distBin, { recursive: true });

  const local = process.env.PLEXY_MPV_PATH;
  if (local) {
    if (!existsSync(local)) throw new Error(`PLEXY_MPV_PATH does not exist: ${local}`);
    await copyFile(local, target);
    await chmod(target, 0o755);
    await copySiblingLibs(dirname(local), libsDir);
    fixUpRpaths(target, libsDir);
    const version = engineVersion(target) ?? "custom";
    await writeFile(`${target}.version`, `${version}\n`);
    console.log(`✓ Native playback engine bundled from PLEXY_MPV_PATH (${version})`);
    return true;
  }

  if (existsSync(target) && process.env.PLEXY_MPV_REFRESH !== "1") {
    console.log("✓ Reusing bundled native playback engine");
    return true;
  }

  const manifest = await readManifest(rootDir);
  const url = process.env.PLEXY_MPV_URL || manifest?.url || "";
  const sha256 = (process.env.PLEXY_MPV_SHA256 || manifest?.sha256 || "").toLowerCase();
  if (!url || !sha256) {
    console.log(
      "• Native playback engine not configured; packaging without mpv (browser playback only).\n" +
      "  Set PLEXY_MPV_PATH, or pin url+sha256 in scripts/mpv-manifest.json.",
    );
    return false;
  }

  const workDir = join(rootDir, ".build", "mpv");
  await mkdir(workDir, { recursive: true });
  const archive = join(workDir, sha256.slice(0, 16) + archiveSuffix(url));
  if (!existsSync(archive)) {
    console.log(`• Downloading native playback engine: ${url}`);
    const response = await fetch(url, { redirect: "follow" });
    if (!response.ok) throw new Error(`mpv download failed: ${response.status} ${response.statusText}`);
    const bytes = Buffer.from(await response.arrayBuffer());
    const digest = createHash("sha256").update(bytes).digest("hex");
    if (digest !== sha256) {
      throw new Error(`mpv checksum mismatch: expected ${sha256}, got ${digest}`);
    }
    await writeFile(archive, bytes);
  } else {
    const digest = createHash("sha256").update(await readFile(archive)).digest("hex");
    if (digest !== sha256) throw new Error(`Cached mpv archive checksum mismatch (${archive})`);
  }

  const extractDir = join(workDir, `extract-${sha256.slice(0, 16)}`);
  if (!existsSync(extractDir)) {
    await mkdir(extractDir, { recursive: true });
    extractArchive(archive, extractDir);
  }

  const binary = await findMpvBinary(extractDir);
  if (!binary) throw new Error("The mpv archive did not contain an mpv executable");
  await copyFile(binary, target);
  await chmod(target, 0o755);
  await copySiblingLibs(dirname(binary), libsDir);
  fixUpRpaths(target, libsDir);
  const version = manifest?.version || engineVersion(target) || "bundled";
  await writeFile(`${target}.version`, `${version}\n`);
  console.log(`✓ Native playback engine bundled (${version})`);
  return true;
}

async function readManifest(rootDir: string): Promise<MpvManifest | null> {
  try {
    return JSON.parse(await readFile(join(rootDir, "scripts", "mpv-manifest.json"), "utf8")) as MpvManifest;
  } catch {
    return null;
  }
}

function archiveSuffix(url: string): string {
  const lower = url.toLowerCase();
  return ARCHIVE_CANDIDATES.find((suffix) => lower.endsWith(suffix)) ?? ".zip";
}

function extractArchive(archive: string, destination: string): void {
  if (archive.endsWith(".zip")) {
    execFileSync("ditto", ["-x", "-k", archive, destination], { stdio: "inherit" });
    return;
  }
  execFileSync("tar", ["-xf", archive, "-C", destination], { stdio: "inherit" });
}

async function walk(dir: string, depth = 0): Promise<string[]> {
  if (depth > 4) return [];
  const found: string[] = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) found.push(...await walk(full, depth + 1));
    else found.push(full);
  }
  return found;
}

async function findMpvBinary(dir: string): Promise<string | null> {
  const files = await walk(dir);
  return files.find((file) => /(^|\/)mpv$/.test(file)) ?? null;
}

async function copySiblingLibs(fromDir: string, libsDir: string): Promise<void> {
  // Archives either keep dylibs beside the binary or in a lib/ subfolder.
  const candidates = [fromDir, join(fromDir, "lib"), join(fromDir, "..", "lib")];
  let copied = 0;
  const seen = new Set<string>();
  for (const dir of candidates) {
    if (!existsSync(dir)) continue;
    for (const file of await readdir(dir)) {
      if (!file.endsWith(".dylib") || seen.has(file)) continue;
      seen.add(file);
      await mkdir(libsDir, { recursive: true });
      await copyFile(join(dir, file), join(libsDir, file));
      copied++;
    }
  }
  if (copied) console.log(`  Bundled ${copied} mpv libraries`);
}

/** Best-effort rpath rewrite so the engine finds its libraries inside the app. */
function fixUpRpaths(binary: string, libsDir: string): void {
  if (process.platform !== "darwin" || !existsSync(libsDir)) return;
  const run = (command: string, args: string[]) => {
    try {
      execFileSync(command, args, { stdio: "ignore" });
    } catch {
      /* optional tool or already patched */
    }
  };
  run("install_name_tool", ["-add_rpath", "@executable_path/mpv-libs", binary]);
  for (const name of readdirSync(libsDir)) {
    if (!name.endsWith(".dylib")) continue;
    const lib = join(libsDir, name);
    run("install_name_tool", ["-id", `@executable_path/mpv-libs/${name}`, lib]);
    for (const dependency of listDependencies(lib)) {
      if (!dependency.startsWith("/")) continue;
      run("install_name_tool", ["-change", dependency, `@executable_path/mpv-libs/${dependency.split("/").pop()}`, lib]);
    }
  }
  // Ad-hoc signing keeps the modified binary loadable on macOS.
  run("codesign", ["--force", "--sign", "-", binary]);
  for (const lib of readdirSync(libsDir)) {
    if (lib.endsWith(".dylib")) run("codesign", ["--force", "--sign", "-", join(libsDir, lib)]);
  }
}

function listDependencies(file: string): string[] {
  try {
    const output = execFileSync("otool", ["-L", file], { encoding: "utf8" });
    return output
      .split("\n")
      .slice(1)
      .map((line) => line.trim().split(" ")[0] ?? "")
      .filter(Boolean);
  } catch {
    return [];
  }
}

function engineVersion(binary: string): string | null {
  try {
    const output = execFileSync(binary, ["--version"], { encoding: "utf8", timeout: 5_000 });
    const first = output.split("\n")[0]?.trim();
    return first || null;
  } catch {
    return null;
  }
}
