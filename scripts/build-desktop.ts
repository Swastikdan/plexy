import { mkdir, copyFile, chmod, readFile } from "node:fs/promises";
import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { execSync } from "node:child_process";
import { generateIcons } from "./generate-icon";
import { generateDmgBackground } from "./generate-dmg-background";
import { bundleMpv } from "./bundle-mpv";
import { bundleLibmpv } from "./bundle-libmpv";
import { findFfmpeg } from "./find-ffmpeg";

/**
 * dmg-builder mounts the image to author its `.DS_Store`. If a volume with the
 * same name is already mounted, macOS names the new one "Plexy 0.1.0 2" and
 * that suffixed name gets baked into the background alias — the installer then
 * loses (or shows a stale) background on a clean machine. Detach leftovers
 * before packaging so the alias always references the real volume name.
 */
function detachStaleInstallerVolumes(productName: string) {
  const escaped = productName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const matcher = new RegExp(`^${escaped} \\d+\\.\\d+\\.\\d+( \\d+)?$`);

  try {
    for (const name of readdirSync("/Volumes")) {
      if (!matcher.test(name)) continue;
      try {
        execSync(`hdiutil detach "/Volumes/${name}" -force`, {
          stdio: "ignore",
          timeout: 15_000,
        });
        console.log(`✓ Detached stale installer volume: ${name}`);
      } catch {
        /* volume may already be gone */
      }
    }
  } catch {
    /* /Volumes unavailable */
  }
}

async function buildDesktop() {
  const rootDir = process.cwd();
  const distDir = join(rootDir, "dist");
  const distBin = join(distDir, "bin");
  const distMac = join(distDir, "mac");

  console.log("\n========================================================");
  console.log("  Plexy Beta Electron Desktop Build for macOS");
  console.log("========================================================\n");
  const releasePackage = JSON.parse(
    await readFile(join(rootDir, "package.json"), "utf8"),
  ) as { version: string };

  if (!existsSync(join(distDir, "web/index.html"))) {
    throw new Error("Missing built browser UI");
  }
  await mkdir(distBin, { recursive: true });
  await mkdir(distMac, { recursive: true });

  // Keep node-av as the default and rollback path. Set
  // PLEXY_FFMPEG_VARIANT=custom to package the LGPL-only minimal build from
  // scripts/build-minimal-ffmpeg.sh after building it separately.
  const ffmpegVariant = process.env.PLEXY_FFMPEG_VARIANT ?? "node-av";
  const ffmpegSource =
    ffmpegVariant === "custom"
      ? join(distBin, "ffmpeg-custom")
      : ffmpegVariant === "node-av"
        ? await findFfmpeg(rootDir)
        : null;
  if (!ffmpegSource) {
    throw new Error(
      ffmpegVariant === "custom"
        ? "Custom FFmpeg missing; run scripts/build-minimal-ffmpeg.sh first."
        : ffmpegVariant === "node-av"
          ? "FFmpeg binary missing; install the project dependencies before packaging the desktop app."
          : `Unknown PLEXY_FFMPEG_VARIANT: ${ffmpegVariant} (expected node-av or custom).`,
    );
  }
  const ffmpegOut = join(distBin, "ffmpeg");
  await copyFile(ffmpegSource, ffmpegOut);
  await chmod(ffmpegOut, 0o755);
  console.log(`✓ FFmpeg bundled: ${ffmpegOut}`);

  // Required native playback engine (mpv CLI used by the server probes)
  console.log("Bundling native playback engine...");
  if (!await bundleMpv(rootDir)) {
    throw new Error("Desktop requires mpv. Set PLEXY_MPV_PATH or configure scripts/mpv-manifest.json before packaging.");
  }

  if (!await bundleLibmpv(rootDir)) {
    throw new Error("Desktop requires libmpv. Set PLEXY_LIBMPV_SOURCE to a libmpv.2.dylib before packaging.");
  }

  // Generate High-Resolution Apple Application Icon (.icns)
  console.log("\nGenerating High-Resolution Apple Application Icon...");
  await generateIcons();

  // Render the DMG installer window artwork (1x + retina)
  console.log("\nGenerating DMG installer window background...");
  await generateDmgBackground();

  // `--publish never` is required: on CI, electron-builder otherwise tries to
  // publish to GitHub and fails without GH_TOKEN. The release workflow uploads
  // the artifacts itself.
  console.log(
    "\nPackaging macOS Electron Application with electron-builder...",
  );
  detachStaleInstallerVolumes("Plexy Beta");
  execSync(
    `./node_modules/.bin/electron-builder --config apps/desktop/electron-builder.json --mac --publish never -c.extraMetadata.version=${releasePackage.version} -c.afterPack="${join(rootDir, "scripts", "after-pack-mpv.cjs")}"`,
    {
      stdio: "inherit",
      env: { ...process.env, CSC_IDENTITY_AUTO_DISCOVERY: "false" },
    },
  );

  // Verify and refresh app bundle resources
  const appBundle = join(distMac, "mac-arm64", "Plexy Beta.app");
  const appResources = join(appBundle, "Contents", "Resources");
  try {
    await copyFile(
      join(rootDir, "build/icon.icns"),
      join(appResources, "icon.icns"),
    );
    await copyFile(
      join(rootDir, "build/icon.png"),
      join(appResources, "icon.png"),
    );
    execSync(`touch "${appBundle}"`);
  } catch {}

  console.log("\n========================================================");
  console.log("  Plexy Beta macOS Electron Build Complete!");
  console.log(
    `  • macOS DMG Disk    : dist/mac/Plexy Beta-${releasePackage.version}-arm64.dmg`,
  );
  console.log(`  • macOS App Bundle  : dist/mac/mac-arm64/Plexy Beta.app`);
  console.log(
    `  • macOS ZIP Archive : dist/mac/Plexy Beta-${releasePackage.version}-arm64.zip`,
  );
  console.log("========================================================\n");
}

buildDesktop().catch((err) => {
  console.error("Build failed:", err);
  process.exit(1);
});
