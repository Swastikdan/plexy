/// Bundle a native mpv engine into the desktop app's resources.
///
/// Native playback is required for desktop releases. Supply one of:
///
///   PLEXY_MPV_PATH=/path/to/mpv     copy a local build (development shortcut)
///   PLEXY_MPV_URL + PLEXY_MPV_SHA256
///   scripts/mpv-manifest.json      { version, url, sha256 }
///
/// Downloads are refused without a checksum. The engine is copied to
/// `dist/bin/mpv` with its dylibs in `dist/bin/lib`; official macOS builds are
/// app bundles, so their `lib/` and Vulkan ICD files are preserved too.
import { chmod, copyFile, cp, mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { existsSync, readdirSync } from "node:fs";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { basename, dirname, join } from "node:path";

interface MpvManifest {
  version?: string;
  url?: string;
  sha256?: string;
}

const ARCHIVE_CANDIDATES = [".zip", ".tar.gz", ".tgz", ".tar.xz", ".tar.bz2"];

export async function bundleMpv(rootDir: string): Promise<boolean> {
  const distBin = join(rootDir, "dist", "bin");
  const target = join(distBin, "mpv");
  await mkdir(distBin, { recursive: true });

  const local = process.env.PLEXY_MPV_PATH;
  if (local) {
    if (!existsSync(local)) throw new Error(`PLEXY_MPV_PATH does not exist: ${local}`);
    const copied = await installEngine(local, distBin);
    const version = engineVersion(target) ?? "custom";
    await writeFile(`${target}.version`, `${version}\n`);
    console.log(`✓ Native playback engine bundled from PLEXY_MPV_PATH (${version}, ${copied} libraries)`);
    return true;
  }

  const hasLibraries = existsSync(join(distBin, "lib")) || existsSync(join(distBin, "mpv-libs"));
  if (existsSync(target) && hasLibraries && process.env.PLEXY_MPV_REFRESH !== "1") {
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
    const bytes = await download(url);
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
    await extractArchive(archive, extractDir);
  }

  const binary = await findMpvBinary(extractDir);
  if (!binary) throw new Error("The mpv archive did not contain an mpv executable");
  const copied = await installEngine(binary, distBin);
  const version = manifest?.version || engineVersion(target) || "bundled";
  await writeFile(`${target}.version`, `${version}\n`);
  console.log(`✓ Native playback engine bundled (${version}, ${copied} libraries)`);
  return true;
}

async function readManifest(rootDir: string): Promise<MpvManifest | null> {
  try {
    return JSON.parse(await readFile(join(rootDir, "scripts", "mpv-manifest.json"), "utf8")) as MpvManifest;
  } catch {
    return null;
  }
}

async function download(url: string): Promise<Buffer> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const response = await fetch(url, { redirect: "follow" });
      if (!response.ok) throw new Error(`mpv download failed: ${response.status} ${response.statusText}`);
      return Buffer.from(await response.arrayBuffer());
    } catch (error) {
      lastError = error;
      if (attempt < 3) {
        console.warn(`  Download attempt ${attempt} failed; retrying…`);
        await new Promise((resolve) => setTimeout(resolve, attempt * 1_000));
      }
    }
  }
  throw lastError instanceof Error ? lastError : new Error("mpv download failed");
}

function archiveSuffix(url: string): string {
  const lower = url.toLowerCase();
  return ARCHIVE_CANDIDATES.find((suffix) => lower.endsWith(suffix)) ?? ".zip";
}

async function extractArchive(archive: string, destination: string, depth = 0): Promise<void> {
  if (depth > 2) return;
  if (archive.endsWith(".zip")) {
    execFileSync("ditto", ["-x", "-k", archive, destination], { stdio: "inherit" });
  } else {
    execFileSync("tar", ["-xf", archive, "-C", destination], { stdio: "inherit" });
  }

  // The official macOS release wraps the app in `mpv.tar.gz` inside a zip.
  // Extract nested archives one level so the engine is discoverable.
  for (const entry of await readdir(destination, { withFileTypes: true })) {
    if (!entry.isFile() || !ARCHIVE_CANDIDATES.some((suffix) => entry.name.toLowerCase().endsWith(suffix))) {
      continue;
    }
    const nested = join(destination, `.nested-${entry.name}`);
    await mkdir(nested, { recursive: true });
    await extractArchive(join(destination, entry.name), nested, depth + 1);
  }
}

async function walk(dir: string, depth = 0): Promise<string[]> {
  if (depth > 8) return [];
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

/** `/…/mpv.app/Contents/MacOS/mpv` → `/…/mpv.app`; flat binaries return null. */
function appBundleRoot(binary: string): string | null {
  const marker = "/Contents/MacOS/";
  const index = binary.lastIndexOf(marker);
  return index > 0 ? binary.slice(0, index) : null;
}

async function installEngine(binary: string, distBin: string): Promise<number> {
  const target = join(distBin, "mpv");
  const libsDir = join(distBin, "lib");
  await rm(libsDir, { recursive: true, force: true });
  await rm(join(distBin, "vulkan"), { recursive: true, force: true });
  await mkdir(libsDir, { recursive: true });

  await copyFile(binary, target);
  await chmod(target, 0o755);

  const bundleRoot = appBundleRoot(binary);
  let copied = 0;
  if (bundleRoot) {
    const macosDir = join(bundleRoot, "Contents", "MacOS");
    copied += await copyDylibs(join(macosDir, "lib"), libsDir);
    copied += await copyDylibs(join(bundleRoot, "Contents", "Frameworks"), libsDir);
    const vulkan = join(bundleRoot, "Contents", "Resources", "vulkan");
    if (existsSync(vulkan)) {
      const destination = join(distBin, "vulkan");
      await cp(vulkan, destination, { recursive: true, force: true });
      await rewriteVulkanIcd(destination);
    }
  } else {
    copied += await copySiblingDylibs(dirname(binary), libsDir);
  }

  copied += await fixUpRpaths(target, libsDir);
  return copied;
}

async function copySiblingDylibs(fromDir: string, libsDir: string): Promise<number> {
  // Archives either keep dylibs beside the binary or in a lib/ subfolder.
  const candidates = [join(fromDir, "lib"), fromDir, join(fromDir, "..", "lib")];
  let copied = 0;
  const seen = new Set<string>();
  for (const dir of candidates) {
    if (!existsSync(dir)) continue;
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      if (!entry.isFile() || !entry.name.endsWith(".dylib") || seen.has(entry.name)) continue;
      seen.add(entry.name);
      await copyFile(join(dir, entry.name), join(libsDir, entry.name));
      copied++;
    }
  }
  return copied;
}

async function copyDylibs(fromDir: string, libsDir: string): Promise<number> {
  if (!existsSync(fromDir)) return 0;
  let copied = 0;
  for (const entry of await readdir(fromDir, { withFileTypes: true })) {
    if (!entry.isFile() || !entry.name.endsWith(".dylib")) continue;
    await copyFile(join(fromDir, entry.name), join(libsDir, entry.name));
    copied++;
  }
  return copied;
}

/** The official app bundle stores a relative MoltenVK ICD path. */
async function rewriteVulkanIcd(vulkanDir: string): Promise<void> {
  const icdDir = join(vulkanDir, "icd.d");
  if (!existsSync(icdDir)) return;
  for (const name of await readdir(icdDir)) {
    if (!name.endsWith(".json")) continue;
    const file = join(icdDir, name);
    try {
      const json = JSON.parse(await readFile(file, "utf8")) as {
        ICD?: { library_path?: string };
      };
      const lib = json.ICD?.library_path ? basename(json.ICD.library_path) : null;
      if (!json.ICD || !lib) continue;
      json.ICD.library_path = `../../lib/${lib}`;
      await writeFile(file, `${JSON.stringify(json, null, 4)}\n`);
    } catch {
      /* leave malformed or vendor-specific entries untouched */
    }
  }
}

/** Copy absolute dependencies and rewrite them to `@executable_path/lib`. */
async function fixUpRpaths(binary: string, libsDir: string): Promise<number> {
  if (process.platform !== "darwin" || !existsSync(libsDir)) return 0;
  let copied = 0;
  const run = (command: string, args: string[]) => {
    try {
      execFileSync(command, args, { stdio: "ignore" });
    } catch {
      /* optional tool or already patched */
    }
  };
  run("install_name_tool", ["-add_rpath", "@executable_path/lib", binary]);

  const queue = [binary];
  const seen = new Set<string>();
  while (queue.length > 0) {
    const file = queue.shift()!;
    if (seen.has(file)) continue;
    seen.add(file);
    if (file !== binary) {
      run("install_name_tool", ["-id", `@executable_path/lib/${basename(file)}`, file]);
    }
    for (const dependency of listDependencies(file)) {
      if (
        dependency.startsWith("@executable_path/") ||
        dependency.startsWith("@rpath/") ||
        dependency.startsWith("@loader_path/")
      ) {
        continue;
      }
      if (!dependency.startsWith("/") || isSystemDependency(dependency)) continue;
      const name = basename(dependency);
      const destination = join(libsDir, name);
      if (!existsSync(destination)) {
        try {
          await copyFile(dependency, destination);
          await chmod(destination, 0o755);
          copied++;
        } catch {
          continue;
        }
      }
      run("install_name_tool", ["-change", dependency, `@executable_path/lib/${name}`, file]);
      queue.push(destination);
    }
  }

  // Ad-hoc signing keeps the modified binaries loadable on macOS.
  run("codesign", ["--force", "--sign", "-", binary]);
  for (const name of readdirSync(libsDir)) {
    if (name.endsWith(".dylib")) {
      run("codesign", ["--force", "--sign", "-", join(libsDir, name)]);
    }
  }
  return copied;
}

function isSystemDependency(file: string): boolean {
  return file.startsWith("/usr/lib/") || file.startsWith("/System/") || file.startsWith("/Library/Apple/");
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
