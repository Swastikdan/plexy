import { mkdir, copyFile, chmod, readdir, rm } from "node:fs/promises";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { createRequire } from "node:module";
import { execSync } from "node:child_process";
import { generateIcons } from "./generate-icon";

/**
 * Resolve the FFmpeg binary regardless of whether dependencies were installed
 * with Bun (`.bun/`), pnpm (`.pnpm/`) or a plain npm-style `node_modules/`.
 */
async function findFfmpeg(rootDir: string): Promise<string | null> {
  const candidates = [
    join(rootDir, "node_modules/node-av/binary/ffmpeg"),
    join(rootDir, "node_modules/.pnpm/node_modules/node-av/binary/ffmpeg"),
  ];

  try {
    const require = createRequire(join(rootDir, "package.json"));
    const packageJson = require.resolve("node-av/package.json");
    candidates.unshift(join(dirname(packageJson), "binary", "ffmpeg"));
  } catch {
    /* fall through to the known layouts */
  }

  try {
    const bunStore = join(rootDir, "node_modules", ".bun");
    for (const entry of await readdir(bunStore)) {
      if (entry.startsWith("node-av@")) {
        candidates.push(
          join(bunStore, entry, "node_modules/node-av/binary/ffmpeg"),
        );
      }
    }
  } catch {
    /* not installed with Bun */
  }

  return candidates.find((candidate) => existsSync(candidate)) ?? null;
}

async function buildDesktop() {
  const rootDir = process.cwd();
  const distDir = join(rootDir, "dist");
  const distBin = join(distDir, "bin");
  const distMigrations = join(distDir, "migrations");
  const distMac = join(distDir, "mac");

  console.log("\n========================================================");
  console.log("  Plexy Electron Desktop Build for macOS");
  console.log("========================================================\n");

  await mkdir(distBin, { recursive: true });
  await mkdir(distMigrations, { recursive: true });
  await mkdir(distMac, { recursive: true });

  // 1. Build Web Frontend
  console.log("1. Building Web UI (Vite + React)...");
  execSync("bun run --filter @plexy/web build", { stdio: "inherit" });
  console.log("✓ Web UI built in dist/web");

  // 2. Copy Migrations
  console.log("\n2. Copying SQL Migrations...");
  const srcMigrations = join(rootDir, "apps/server/src/migrations");
  const migrationFiles = await readdir(srcMigrations);
  for (const file of migrationFiles) {
    if (file.endsWith(".sql")) {
      await copyFile(join(srcMigrations, file), join(distMigrations, file));
    }
  }
  console.log("✓ Migrations copied to dist/migrations");

  // Keep node-av as the default and rollback path. Set
  // PLEXY_FFMPEG_VARIANT=custom to package the LGPL-only minimal build from
  // scripts/build-minimal-ffmpeg.sh after building it separately.
  const ffmpegVariant = process.env.PLEXY_FFMPEG_VARIANT ?? "node-av";
  const ffmpegSource = ffmpegVariant === "custom"
    ? join(distBin, "ffmpeg-custom")
    : ffmpegVariant === "node-av"
      ? await findFfmpeg(rootDir)
      : null;
  if (!ffmpegSource) {
    throw new Error(ffmpegVariant === "custom"
      ? "Custom FFmpeg missing; run scripts/build-minimal-ffmpeg.sh first."
      : ffmpegVariant === "node-av"
        ? "FFmpeg binary missing; install the project dependencies before packaging the desktop app."
        : `Unknown PLEXY_FFMPEG_VARIANT: ${ffmpegVariant} (expected node-av or custom).`);
  }
  const ffmpegOut = join(distBin, "ffmpeg");
  await copyFile(ffmpegSource, ffmpegOut);
  await chmod(ffmpegOut, 0o755);
  console.log(`✓ FFmpeg bundled: ${ffmpegOut}`);

  // 3. Generate High-Resolution Apple Application Icon (.icns)
  console.log("\n3. Generating High-Resolution Apple Application Icon...");
  await generateIcons();

  // 4. Compile Standalone Server Binary
  console.log("\n4. Compiling Standalone Backend Server (Bun native compilation)...");
  const serverOut = join(distBin, "plexy-server");
  execSync(`bun build --compile --minify --outfile="${serverOut}" apps/server/src/main.ts`, { stdio: "inherit" });
  await chmod(serverOut, 0o755);
  console.log(`✓ Standalone server compiled: ${serverOut}`);

  // 5. Build Desktop Electron Main & Preload Scripts
  console.log("\n5. Compiling Electron Main and Preload scripts...");
  execSync("bun apps/desktop/build.ts", { stdio: "inherit" });

  // 6. Package macOS Electron Application
  // `--publish never` is required: on CI, electron-builder otherwise tries to
  // publish to GitHub and fails without GH_TOKEN. The release workflow uploads
  // the artifacts itself.
  console.log("\n6. Packaging macOS Electron Application with electron-builder...");
  execSync(
    "./node_modules/.bin/electron-builder --config apps/desktop/electron-builder.json --mac --publish never",
    {
      stdio: "inherit",
      env: { ...process.env, CSC_IDENTITY_AUTO_DISCOVERY: "false" },
    },
  );

  // 7. Verify and refresh app bundle resources
  const appBundle = join(distMac, "mac-arm64", "Plexy.app");
  const appResources = join(appBundle, "Contents", "Resources");
  try {
    await copyFile(join(rootDir, "build/icon.icns"), join(appResources, "icon.icns"));
    await copyFile(join(rootDir, "build/icon.png"), join(appResources, "icon.png"));
    execSync(`touch "${appBundle}"`);
  } catch {}

  console.log("\n========================================================");
  console.log("  Plexy macOS Electron Build Complete!");
  console.log(`  • macOS DMG Disk    : dist/mac/Plexy-0.1.0-arm64.dmg`);
  console.log(`  • macOS App Bundle  : dist/mac/mac-arm64/Plexy.app`);
  console.log(`  • macOS ZIP Archive : dist/mac/Plexy-0.1.0-arm64.zip`);
  console.log("========================================================\n");
}

buildDesktop().catch((err) => {
  console.error("Build failed:", err);
  process.exit(1);
});
