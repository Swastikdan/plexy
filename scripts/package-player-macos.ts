import { execFileSync, spawnSync } from "node:child_process";
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  renameSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { basename, join } from "node:path";
import { bundleLibmpv } from "./bundle-libmpv";

const root = join(import.meta.dir, "..");
const player = join(root, "apps", "player-gpui");
const output = join(root, "dist", "player-mac");
const executableName = "plexy-player";

type VariantName = "beta" | "plexy";
interface Variant {
  appName: string;
  bundleId: string;
  version: string;
  icon: string;
  dmgPrefix: string;
}

function variantName(): VariantName {
  const args = process.argv.slice(2);
  const index = args.indexOf("--variant");
  const value = index >= 0 ? args[index + 1] : "beta";
  if (value === "beta") return "beta";
  if (value === "plexy" || value === "unified") return "plexy";
  throw new Error("Use --variant beta or --variant plexy.");
}

function capture(command: string, args: string[], cwd?: string): string {
  const result = spawnSync(command, args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "inherit"], maxBuffer: 16 * 1024 * 1024 });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`${command} failed (${result.signal ?? result.status}).`);
  return result.stdout;
}

function run(command: string, args: string[]) {
  execFileSync(command, args, { stdio: "inherit" });
}

function bundleIcon(staging: string, resources: string, source: string) {
  const iconset = join(staging, "AppIcon.iconset");
  mkdirSync(iconset);
  for (const size of [16, 32, 128, 256, 512]) {
    for (const scale of [1, 2]) {
      const pixels = String(size * scale);
      const filename = `icon_${size}x${size}${scale === 2 ? "@2x" : ""}.png`;
      capture("sips", ["-z", pixels, pixels, source, "--out", join(iconset, filename)]);
    }
  }
  run("iconutil", ["-c", "icns", iconset, "-o", join(resources, "AppIcon.icns")]);
}

/** Render the branded installer background and merge it into a retina TIFF. */
function dmgBackground(staging: string): string {
  const source = join(root, "build", "player-dmg-background.svg");
  const retina = join(staging, "dmg-background@2x.png");
  const standard = join(staging, "dmg-background.png");
  const tiff = join(staging, "dmg-background.tiff");
  capture("sips", ["-s", "format", "png", source, "--out", retina]);
  capture("sips", ["-z", "400", "640", retina, "--out", standard]);
  capture("tiffutil", ["-cathidpicheck", standard, retina, "-out", tiff]);
  return tiff;
}

/** Detach a stale installer volume so Finder never bakes a " 2" suffix into .DS_Store. */
function detachStalePlayerVolumes(appName: string) {
  const pattern = new RegExp(`^${appName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}( \\d+)?$`);
  try {
    for (const name of readdirSync("/Volumes")) {
      if (!pattern.test(name)) continue;
      try {
        execFileSync("hdiutil", ["detach", `/Volumes/${name}`, "-force"], { stdio: "ignore", timeout: 15_000 });
      } catch {
        /* already gone */
      }
    }
  } catch {
    /* /Volumes unavailable */
  }
}

function attachWritable(dmg: string): string {
  const info = capture("hdiutil", ["attach", "-readwrite", "-noverify", "-noautoopen", "-plist", dmg]);
  const match = info.match(/<key>mount-point<\/key>\s*<string>([^<]+)<\/string>/);
  if (!match) throw new Error("hdiutil attach did not report a mount point.");
  return match[1].replaceAll("&amp;", "&");
}

/** Author the Finder window, icon positions and background, then compress. */
function styledDmg(imageRoot: string, staging: string, dmg: string, appName: string, tag: string) {
  const background = join(imageRoot, ".background");
  mkdirSync(background);
  copyFileSync(dmgBackground(staging), join(background, "background.tiff"));
  detachStalePlayerVolumes(appName);
  const rw = join(staging, `${tag}-rw.dmg`);
  run("hdiutil", ["create", "-srcfolder", imageRoot, "-volname", appName, "-fs", "HFS+", "-format", "UDRW", "-ov", rw]);
  const mount = attachWritable(rw);
  try {
    const script = `
with timeout of 120 seconds
  tell application "Finder"
    tell disk "${appName}"
      open
      set current view of container window to icon view
      set toolbar visible of container window to false
      set statusbar visible of container window to false
      set the bounds of container window to {400, 36, 1040, 436}
      set viewOptions to the icon view options of container window
      set arrangement of viewOptions to not arranged
      set icon size of viewOptions to 96
      set text size of viewOptions to 13
      set background picture of viewOptions to file ".background:background.tiff"
      set position of item "${appName}.app" of container window to {162, 188}
      set position of item "Applications" of container window to {470, 188}
      update without registering applications
      delay 2
      close
    end tell
  end tell
end timeout
`;
    run("osascript", ["-e", script]);
    // Finder normalizes the volume root while writing .DS_Store; restore the
    // custom icon afterwards so it survives the detach/convert.
    copyFileSync(join(imageRoot, `${appName}.app`, "Contents", "Resources", "AppIcon.icns"), join(mount, ".VolumeIcon.icns"));
    run("SetFile", ["-a", "C", mount]);
  } finally {
    try {
      execFileSync("hdiutil", ["detach", mount, "-force"], { stdio: "ignore", timeout: 30_000 });
    } catch {
      /* already detached */
    }
  }

  rmSync(dmg, { force: true });
  run("hdiutil", ["convert", rw, "-format", "UDZO", "-imagekey", "zlib-level=9", "-o", dmg]);
  rmSync(rw, { force: true });
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
    throw new Error("Build the Mac app on Apple Silicon macOS with native Bun and Rust.");
  }

  const manifest = join(player, "Cargo.toml");
  const { packages }: { packages: { name: string; version: string }[] } = JSON.parse(
    // Run cargo from the player folder so its rust-toolchain.toml applies.
    capture("cargo", ["metadata", "--locked", "--no-deps", "--format-version", "1", "--manifest-path", manifest], player),
  );
  const cargoVersion = packages.find(({ name }) => name === executableName)?.version;
  if (!cargoVersion || !/^\d+\.\d+\.\d+$/.test(cargoVersion))
    throw new Error("Expected a macOS-compatible version in Cargo.toml.");

  const variant = variantName();
  const versionOverride = process.env.PLEXY_APP_VERSION?.trim();
  if (versionOverride && !/^\d+\.\d+\.\d+$/.test(versionOverride))
    throw new Error("PLEXY_APP_VERSION must look like 1.2.3.");
  const config: Variant =
    variant === "beta"
      ? {
          appName: "Plexy Beta",
          bundleId: "com.plexy.beta",
          version: cargoVersion,
          icon: join(root, "build", "icon.png"),
          dmgPrefix: "Plexy-Beta",
        }
      : {
          appName: "Plexy",
          bundleId: "com.plexy.desktop",
          version: versionOverride ?? "1.1.0",
          icon: join(root, "build", "icon.png"),
          dmgPrefix: "Plexy",
        };

  const artifacts = capture("cargo", ["build", "--locked", "--release", "--bin", executableName, "--message-format=json-render-diagnostics", "--manifest-path", manifest], player);
  const binary = artifacts.trim().split("\n").map((line) => JSON.parse(line)).find(
    (message) => message.reason === "compiler-artifact" && message.target.name === executableName && message.executable,
  )?.executable;
  if (!binary) throw new Error("Cargo did not report a release executable.");

  mkdirSync(output, { recursive: true });
  const staging = mkdtempSync(join(output, ".package-"));
  try {
    const imageRoot = join(staging, "image");
    const app = join(imageRoot, `${config.appName}.app`);
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
    bundleIcon(staging, resources, config.icon);

    const plist = join(contents, "Info.plist");
    writeFileSync(plist, `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>CFBundleDevelopmentRegion</key><string>en</string>
  <key>CFBundleExecutable</key><string>${executableName}</string>
  <key>CFBundleIconFile</key><string>AppIcon.icns</string>
  <key>CFBundleIdentifier</key><string>${config.bundleId}</string>
  <key>CFBundleDisplayName</key><string>${config.appName}</string>
  <key>CFBundleName</key><string>${config.appName}</string>
  <key>CFBundlePackageType</key><string>APPL</string>
  <key>CFBundleShortVersionString</key><string>${config.version}</string>
  <key>CFBundleVersion</key><string>${config.version}</string>
  <key>LSMinimumSystemVersion</key><string>${minimum}</string>
  <key>LSEnvironment</key>
  <dict>
    <key>PLEXY_APP_VARIANT</key><string>${variant}</string>
  </dict>
</dict>
</plist>
`);
    run("plutil", ["-lint", plist]);
    run("codesign", ["--force", "--sign", "-", app]);
    run("codesign", ["--verify", "--deep", "--strict", app]);

    symlinkSync("/Applications", join(imageRoot, "Applications"));
    const dmgName = `${config.dmgPrefix}-${config.version}-mac-arm64.dmg`;
    const dmg = join(staging, dmgName);
    styledDmg(imageRoot, staging, dmg, config.appName, config.dmgPrefix);

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
