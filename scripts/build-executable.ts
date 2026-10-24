import { mkdir, copyFile, chmod, readdir, unlink, rm, cp } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { execSync } from "node:child_process";

async function buildExecutable() {
  const distDir = join(process.cwd(), "dist");
  await mkdir(distDir, { recursive: true });

  console.log("1. Bundling backend server with Bun...");
  const buildResult = await Bun.build({
    entrypoints: [join(process.cwd(), "apps/server/src/main.ts")],
    target: "bun",
    minify: false,
    sourcemap: "inline",
  });

  if (!buildResult.success) {
    console.error("Build failed:", buildResult.logs);
    process.exit(1);
  }

  const bundledCode = await buildResult.outputs[0].text();
  const executableContent = `#!/usr/bin/env bun\n${bundledCode}`;
  const executablePath = join(distDir, "plexy");

  try {
    if (existsSync(executablePath)) await unlink(executablePath);
  } catch {
    /* ignore */
  }

  await Bun.write(executablePath, executableContent);
  await chmod(executablePath, 0o755);
  console.log(`✓ Standalone executable created: dist/plexy`);

  // 2. Copy migrations to dist/migrations
  console.log("2. Copying migrations to dist/migrations...");
  const srcMigrations = join(process.cwd(), "apps/server/src/migrations");
  const distMigrations = join(distDir, "migrations");
  await mkdir(distMigrations, { recursive: true });

  const migrationFiles = await readdir(srcMigrations);
  for (const file of migrationFiles) {
    if (file.endsWith(".sql")) {
      await copyFile(join(srcMigrations, file), join(distMigrations, file));
    }
  }
  console.log(`✓ Migrations copied to dist/migrations`);

  // 3. Generate a square AppIcon.icns with enough inset to avoid macOS clipping.
  console.log("3. Generating application icon...");
  const icnsPath = join(distDir, "AppIcon.icns");
  const iconsetDir = join(distDir, ".Plexy.iconset");
  const masterPng = join(distDir, "app-icon.svg.png");

  try {
    const svgSource = join(process.cwd(), "apps/web/public/app-icon.svg");
    if (existsSync(svgSource)) {
      try {
        if (existsSync(masterPng)) await unlink(masterPng);
        execSync(`qlmanage -t -s 1024 -o "${distDir}" "${svgSource}" >/dev/null 2>&1`);
      } catch {}
    }

    if (existsSync(masterPng)) {
      await rm(iconsetDir, { recursive: true, force: true });
      await mkdir(iconsetDir, { recursive: true });
      const sizes = [
        { name: "icon_16x16.png", w: 16, h: 16 },
        { name: "icon_16x16@2x.png", w: 32, h: 32 },
        { name: "icon_32x32.png", w: 32, h: 32 },
        { name: "icon_32x32@2x.png", w: 64, h: 64 },
        { name: "icon_128x128.png", w: 128, h: 128 },
        { name: "icon_128x128@2x.png", w: 256, h: 256 },
        { name: "icon_256x256.png", w: 256, h: 256 },
        { name: "icon_256x256@2x.png", w: 512, h: 512 },
        { name: "icon_512x512.png", w: 512, h: 512 },
        { name: "icon_512x512@2x.png", w: 1024, h: 1024 },
      ];
      for (const s of sizes) {
        execSync(`sips -z ${s.h} ${s.w} "${masterPng}" --out "${join(iconsetDir, s.name)}" >/dev/null 2>&1`);
      }
      try { if (existsSync(icnsPath)) await unlink(icnsPath); } catch {}
      execSync(`iconutil -c icns "${iconsetDir}" -o "${icnsPath}"`);
      console.log(`✓ Application icon ready: dist/AppIcon.icns`);
      await rm(iconsetDir, { recursive: true, force: true });
      await rm(masterPng, { force: true });
    }
  } catch (err) {
    console.warn("Notice: Could not generate .icns icon:", err);
  }

  // 4. Build macOS Application Bundle (dist/Plexy.app)
  console.log("4. Building macOS Application Bundle (dist/Plexy.app)...");
  const appDir = join(distDir, "Plexy.app");
  const contentsDir = join(appDir, "Contents");
  const macosDir = join(contentsDir, "MacOS");
  const resourcesDir = join(contentsDir, "Resources");

  await rm(appDir, { recursive: true, force: true });
  await mkdir(macosDir, { recursive: true });
  await mkdir(resourcesDir, { recursive: true });

  // Info.plist
  const infoPlist = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>CFBundleExecutable</key>
    <string>Plexy</string>
    <key>CFBundleIconFile</key>
    <string>AppIcon</string>
    <key>CFBundleIdentifier</key>
    <string>com.plexy.media</string>
    <key>CFBundleName</key>
    <string>Plexy</string>
    <key>CFBundleDisplayName</key>
    <string>Plexy</string>
    <key>CFBundlePackageType</key>
    <string>APPL</string>
    <key>CFBundleShortVersionString</key>
    <string>0.1.0</string>
    <key>CFBundleVersion</key>
    <string>1</string>
    <key>LSMinimumSystemVersion</key>
    <string>12.0</string>
    <key>NSHighResolutionCapable</key>
    <true/>
</dict>
</plist>`;
  await Bun.write(join(contentsDir, "Info.plist"), infoPlist);
  await Bun.write(join(contentsDir, "PkgInfo"), "APPL????");

  // Runner script (Contents/MacOS/Plexy)
  const runnerScript = `#!/bin/bash
export PATH="/usr/local/bin:/opt/homebrew/bin:$HOME/.bun/bin:$PATH"
export NODE_ENV=production
export PLEXY_DATA_DIR="\${PLEXY_DATA_DIR:-$HOME/Library/Application Support/Plexy}"
export PLEXY_LOG_DIR="\${PLEXY_LOG_DIR:-$HOME/Library/Logs/Plexy}"

BUN_BIN=""
if command -v bun >/dev/null 2>&1; then
  BUN_BIN="$(command -v bun)"
elif [ -x "$HOME/.bun/bin/bun" ]; then
  BUN_BIN="$HOME/.bun/bin/bun"
elif [ -x "/opt/homebrew/bin/bun" ]; then
  BUN_BIN="/opt/homebrew/bin/bun"
elif [ -x "/usr/local/bin/bun" ]; then
  BUN_BIN="/usr/local/bin/bun"
fi

if [ -z "$BUN_BIN" ]; then
  osascript -e 'display alert "Plexy Error" message "Bun runtime is required. Please install Bun from bun.sh."'
  exit 1
fi

CONTENTS="$(cd "$(dirname "$0")/.." && pwd)"
RESOURCES="$CONTENTS/Resources"

# If already running, simply focus browser
if curl -s http://127.0.0.1:8765/api/server/status >/dev/null 2>&1; then
  open "http://localhost:8765"
  exit 0
fi

mkdir -p "$HOME/Library/Logs"
cd "$RESOURCES"
"$BUN_BIN" "$RESOURCES/plexy" > "$HOME/Library/Logs/Plexy.log" 2>&1 &
SERVER_PID=$!

for i in {1..20}; do
  if curl -s http://127.0.0.1:8765/api/server/status >/dev/null 2>&1; then
    break
  fi
  sleep 0.5
done

open "http://localhost:8765"
wait $SERVER_PID
`;
  const runnerPath = join(macosDir, "Plexy");
  await Bun.write(runnerPath, runnerScript);
  await chmod(runnerPath, 0o755);

  // Copy server executable and resources into Resources/
  await copyFile(executablePath, join(resourcesDir, "plexy"));
  await chmod(join(resourcesDir, "plexy"), 0o755);

  if (existsSync(icnsPath)) {
    await copyFile(icnsPath, join(resourcesDir, "AppIcon.icns"));
  }

  // Copy web assets to Resources/web
  const distWeb = join(distDir, "web");
  if (existsSync(distWeb)) {
    await cp(distWeb, join(resourcesDir, "web"), { recursive: true });
  }

  // Copy migrations to Resources/migrations
  await cp(distMigrations, join(resourcesDir, "migrations"), { recursive: true });

  console.log(`✓ macOS Application bundle built: dist/Plexy.app`);

  // 5. Install to /Applications
  console.log("5. Installing Plexy to Applications folder...");
  const appInstallTargets = ["/Applications/Plexy.app", join(process.env.HOME || "", "Applications/Plexy.app")];

  for (const target of appInstallTargets) {
    try {
      await rm(target, { recursive: true, force: true });
      await cp(appDir, target, { recursive: true });
      console.log(`✓ Installed to ${target}`);
      break; // Successfully installed to primary target
    } catch (err) {
      console.warn(`Could not install to ${target} (skipping):`, (err as Error).message);
    }
  }

  console.log("\n========================================================");
  console.log("  Plexy Build Complete!");
  console.log("  • Standalone Executable : ./dist/plexy");
  console.log("  • macOS Application     : dist/Plexy.app");
  console.log("  • Installed Application : /Applications/Plexy.app");
  console.log("  • Built Web & API       : Integrated (serves http://localhost:8765)");
  console.log("========================================================\n");
}

buildExecutable().catch((err) => {
  console.error(err);
  process.exit(1);
});
