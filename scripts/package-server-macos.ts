import { execFileSync, spawnSync } from "node:child_process";
import {
  chmodSync,
  copyFileSync,
  cpSync,
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

const root = join(import.meta.dir, "..");
const output = join(root, "dist", "server-mac");
const appName = "Plexy Server";
const executableName = "plexy-server-app";
const bundleId = "com.plexy.server";
const version = "1.0.0";

function capture(command: string, args: string[], cwd?: string): string {
  const result = spawnSync(command, args, {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "inherit"],
    maxBuffer: 16 * 1024 * 1024,
  });
  if (result.error) throw result.error;
  if (result.status !== 0)
    throw new Error(`${command} failed (${result.signal ?? result.status}).`);
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
function detachStaleVolumes(volumeName: string) {
  const pattern = new RegExp(
    `^${volumeName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}( \\d+)?$`,
  );
  try {
    for (const name of readdirSync("/Volumes")) {
      if (!pattern.test(name)) continue;
      try {
        execFileSync("hdiutil", ["detach", `/Volumes/${name}`, "-force"], {
          stdio: "ignore",
          timeout: 15_000,
        });
      } catch {
        /* already gone */
      }
    }
  } catch {
    /* /Volumes unavailable */
  }
}

function attachWritable(dmg: string): string {
  const info = capture("hdiutil", [
    "attach",
    "-readwrite",
    "-noverify",
    "-noautoopen",
    "-plist",
    dmg,
  ]);
  const match = info.match(/<key>mount-point<\/key>\s*<string>([^<]+)<\/string>/);
  if (!match) throw new Error("hdiutil attach did not report a mount point.");
  return match[1].replaceAll("&amp;", "&");
}

/** Author the Finder window, icon positions and background, then compress. */
function styledDmg(imageRoot: string, staging: string, dmg: string) {
  const background = join(imageRoot, ".background");
  mkdirSync(background);
  copyFileSync(dmgBackground(staging), join(background, "background.tiff"));
  detachStaleVolumes(appName);
  const rw = join(staging, "Plexy-Server-rw.dmg");
  run("hdiutil", [
    "create",
    "-srcfolder",
    imageRoot,
    "-volname",
    appName,
    "-fs",
    "HFS+",
    "-format",
    "UDRW",
    "-ov",
    rw,
  ]);
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
    copyFileSync(
      join(imageRoot, `${appName}.app`, "Contents", "Resources", "AppIcon.icns"),
      join(mount, ".VolumeIcon.icns"),
    );
    run("SetFile", ["-a", "C", mount]);
  } finally {
    try {
      execFileSync("hdiutil", ["detach", mount, "-force"], {
        stdio: "ignore",
        timeout: 30_000,
      });
    } catch {
      /* already detached */
    }
  }

  rmSync(dmg, { force: true });
  run("hdiutil", [
    "convert",
    rw,
    "-format",
    "UDZO",
    "-imagekey",
    "zlib-level=9",
    "-o",
    dmg,
  ]);
  rmSync(rw, { force: true });
}

function bundleServer(resources: string) {
  const server = join(resources, "server");
  const source = join(root, "dist", "server");
  const binary = join(source, "plexy-server");
  const ffmpeg = join(source, "ffmpeg");
  const web = join(source, "web");
  if (!existsSync(binary) || !existsSync(ffmpeg) || !existsSync(web))
    throw new Error("Build the server bundle first: bun run build:server");
  mkdirSync(server, { recursive: true });
  copyFileSync(binary, join(server, "plexy-server"));
  copyFileSync(ffmpeg, join(server, "ffmpeg"));
  chmodSync(join(server, "plexy-server"), 0o755);
  chmodSync(join(server, "ffmpeg"), 0o755);
  cpSync(join(root, "apps", "server", "src", "migrations"), join(server, "migrations"), {
    recursive: true,
    filter: (path) => path.endsWith("migrations") || path.endsWith(".sql"),
  });
  cpSync(web, join(server, "web"), { recursive: true });
}

async function main() {
  if (process.platform !== "darwin" || process.arch !== "arm64") {
    throw new Error(`Build ${appName} on Apple Silicon macOS with Xcode and Bun.`);
  }
  if (!process.env.DEVELOPER_DIR && !existsSync("/usr/bin/swiftc"))
    throw new Error("Install Xcode command line tools to compile the menu bar app.");

  mkdirSync(output, { recursive: true });
  const staging = mkdtempSync(join(output, ".package-"));
  try {
    const imageRoot = join(staging, "image");
    const app = join(imageRoot, `${appName}.app`);
    const contents = join(app, "Contents");
    const resources = join(contents, "Resources");
    const executable = join(contents, "MacOS", executableName);
    mkdirSync(resources, { recursive: true });
    mkdirSync(join(contents, "MacOS"));
    copyFileSync(
      join(root, "apps", "server-macos", "Resources", "status-icon.png"),
      join(resources, "status-icon.png"),
    );
    copyFileSync(
      join(root, "apps", "server-macos", "Resources", "status-icon@2x.png"),
      join(resources, "status-icon@2x.png"),
    );
    bundleIcon(staging, resources);
    bundleServer(resources);

    run("swiftc", [
      "-O",
      "-swift-version",
      "5",
      "-target",
      "arm64-apple-macos13.0",
      "-framework",
      "AppKit",
      "-framework",
      "ServiceManagement",
      join(root, "apps", "server-macos", "Sources", "main.swift"),
      "-o",
      executable,
    ]);

    const plist = join(contents, "Info.plist");
    writeFileSync(plist, `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>CFBundleDevelopmentRegion</key><string>en</string>
  <key>CFBundleExecutable</key><string>${executableName}</string>
  <key>CFBundleIconFile</key><string>AppIcon.icns</string>
  <key>CFBundleIdentifier</key><string>${bundleId}</string>
  <key>CFBundleDisplayName</key><string>${appName}</string>
  <key>CFBundleName</key><string>${appName}</string>
  <key>CFBundlePackageType</key><string>APPL</string>
  <key>CFBundleShortVersionString</key><string>${version}</string>
  <key>CFBundleVersion</key><string>${version}</string>
  <key>LSMinimumSystemVersion</key><string>13.0</string>
  <key>LSUIElement</key><true/>
  <key>NSHighResolutionCapable</key><true/>
</dict>
</plist>
`);
    run("plutil", ["-lint", plist]);
    run("codesign", ["--force", "--sign", "-", app]);
    run("codesign", ["--verify", "--deep", "--strict", app]);

    symlinkSync("/Applications", join(imageRoot, "Applications"));
    const dmgName = `Plexy-Server-${version}-mac-arm64.dmg`;
    const dmg = join(staging, dmgName);
    styledDmg(imageRoot, staging, dmg);

    const finalApp = join(output, basename(app));
    rmSync(finalApp, { recursive: true, force: true });
    renameSync(app, finalApp);
    renameSync(dmg, join(output, dmgName));
    console.log(`Built ${basename(finalApp)} and ${dmgName} in ${output}.`);
  } finally {
    rmSync(staging, { recursive: true, force: true });
  }
}

await main();
