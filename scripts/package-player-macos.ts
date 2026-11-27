import { execFileSync, spawnSync } from "node:child_process";
import { copyFileSync, mkdirSync, mkdtempSync, readdirSync, renameSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";
import { bundleLibmpv } from "./bundle-libmpv";

const root = join(import.meta.dir, "..");
const player = join(root, "apps", "player-gpui");
const output = join(root, "dist", "player-mac");
const appName = "Plexy Beta";
const executableName = "plexy-player";

function capture(command: string, args: string[]): string {
  const result = spawnSync(command, args, { encoding: "utf8", stdio: ["ignore", "pipe", "inherit"], maxBuffer: 16 * 1024 * 1024 });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`${command} failed (${result.signal ?? result.status}).`);
  return result.stdout;
}

function run(command: string, args: string[]) {
  execFileSync(command, args, { stdio: "inherit" });
}

function bundleIcon(staging: string, resources: string) {
  const iconset = join(staging, "AppIcon.iconset");
  mkdirSync(iconset);
  for (const size of [16, 32, 128, 256, 512]) {
    for (const scale of [1, 2]) {
      const pixels = String(size * scale);
      const filename = `icon_${size}x${size}${scale === 2 ? "@2x" : ""}.png`;
      capture("sips", ["-z", pixels, pixels, join(root, "build", "icon.png"), "--out", join(iconset, filename)]);
    }
  }
  run("iconutil", ["-c", "icns", iconset, "-o", join(resources, "AppIcon.icns")]);
}

function verifyRuntime(executable: string, frameworks: string): string {
  const libraryNames = new Set(readdirSync(frameworks).filter((name) => name.endsWith(".dylib")));
  if (!libraryNames.has("libmpv.2.dylib")) throw new Error("The bundle is missing libmpv.2.dylib.");
  let minimum = "11.0";
  for (const file of [executable, ...Array.from(libraryNames, (name) => join(frameworks, name))]) {
    const build = capture("vtool", ["-arch", "arm64", "-show-build", file]);
    const version = build.match(/^\s*(?:minos|version)\s+(\d+(?:\.\d+)+)/m)?.[1];
    if (!version) throw new Error(`Cannot determine the arm64 macOS deployment target of ${basename(file)}.`);
    if (version.localeCompare(minimum, "en", { numeric: true }) > 0) minimum = version;

    const links = capture("otool", ["-arch", "arm64", "-L", file]);
    for (const [, dependency] of links.matchAll(/^\s+(.+) \(compatibility version/gm)) {
      if (/^\/(System\/Library|usr\/lib|Library\/Apple)\//.test(dependency)) continue;
      if (file !== executable && dependency.startsWith("@loader_path/") && libraryNames.has(dependency.slice("@loader_path/".length))) continue;
      throw new Error(`${basename(file)} depends on ${dependency}, which is outside the app bundle.`);
    }
  }
  return minimum;
}

async function main() {
  if (process.platform !== "darwin" || process.arch !== "arm64") {
    throw new Error(`Build ${appName} on Apple Silicon macOS with native Bun and Rust.`);
  }

  const manifest = join(player, "Cargo.toml");
  const { packages }: { packages: { name: string; version: string }[] } = JSON.parse(
    capture("cargo", ["metadata", "--locked", "--no-deps", "--format-version", "1", "--manifest-path", manifest]),
  );
  const version = packages.find(({ name }) => name === executableName)?.version;
  if (!version || !/^\d+\.\d+\.\d+$/.test(version)) throw new Error("Expected a macOS-compatible version in Cargo.toml.");

  const artifacts = capture("cargo", ["build", "--locked", "--release", "--bin", executableName, "--message-format=json-render-diagnostics", "--manifest-path", manifest]);
  const binary = artifacts.trim().split("\n").map((line) => JSON.parse(line)).find(
    (message) => message.reason === "compiler-artifact" && message.target.name === executableName && message.executable,
  )?.executable;
  if (!binary) throw new Error("Cargo did not report a release executable.");

  mkdirSync(output, { recursive: true });
  const staging = mkdtempSync(join(output, ".package-"));
  try {
    const imageRoot = join(staging, "image");
    const app = join(imageRoot, `${appName}.app`);
    const contents = join(app, "Contents");
    const resources = join(contents, "Resources");
    const frameworks = join(contents, "Frameworks");
    const executable = join(contents, "MacOS", executableName);
    mkdirSync(resources, { recursive: true });
    mkdirSync(join(contents, "MacOS"));
    copyFileSync(binary, executable);
    if (!await bundleLibmpv(root, frameworks)) throw new Error("Install mpv with Homebrew or set PLEXY_LIBMPV_SOURCE.");
    // Frameworks is reserved for signed code. The Electron-only version marker is plain text.
    rmSync(join(frameworks, "libmpv.2.dylib.version"), { force: true });
    const minimum = verifyRuntime(executable, frameworks);
    bundleIcon(staging, resources);

    const plist = join(contents, "Info.plist");
    writeFileSync(plist, `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>CFBundleDevelopmentRegion</key><string>en</string>
  <key>CFBundleExecutable</key><string>${executableName}</string>
  <key>CFBundleIconFile</key><string>AppIcon.icns</string>
  <key>CFBundleIdentifier</key><string>com.plexy.beta</string>
  <key>CFBundleDisplayName</key><string>${appName}</string>
  <key>CFBundleName</key><string>${appName}</string>
  <key>CFBundlePackageType</key><string>APPL</string>
  <key>CFBundleShortVersionString</key><string>${version}</string>
  <key>CFBundleVersion</key><string>${version}</string>
  <key>LSMinimumSystemVersion</key><string>${minimum}</string>
</dict>
</plist>
`);
    run("plutil", ["-lint", plist]);
    run("codesign", ["--force", "--sign", "-", app]);
    run("codesign", ["--verify", "--deep", "--strict", app]);

    symlinkSync("/Applications", join(imageRoot, "Applications"));
    const dmgName = `Plexy-Beta-${version}-mac-arm64.dmg`;
    const dmg = join(staging, dmgName);
    run("hdiutil", ["create", "-srcfolder", imageRoot, "-volname", appName, "-format", "UDZO", dmg]);

    const finalApp = join(output, basename(app));
    rmSync(finalApp, { recursive: true, force: true });
    renameSync(app, finalApp);
    renameSync(dmg, join(output, dmgName));
    console.log(`Built ${basename(finalApp)} and ${dmgName} in ${output} (macOS ${minimum}+).`);
  } finally {
    rmSync(staging, { recursive: true, force: true });
  }
}

await main();
