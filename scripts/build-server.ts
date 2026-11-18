import { mkdir, copyFile, chmod, rm, cp } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { findFfmpeg } from "./find-ffmpeg";

/// Standalone backend binary with migrations, FFmpeg, and an optional static UI.
/// Data stays outside the artifact in PLEXY_DATA_DIR.
const OUT_DIR = "dist/server";

async function buildServer(): Promise<void> {
  const root = process.cwd();
  const outDir = join(root, OUT_DIR);

  console.log("Plexy Server (with optional browser UI)");
  console.log("===========================");

  const web = join(root, "dist/web");
  if (!existsSync(join(web, "index.html"))) throw new Error("Missing built browser UI");
  await rm(outDir, { recursive: true, force: true });
  await cp(web, join(outDir, "web"), { recursive: true });
  await cp(join(root, "apps/server/src/migrations"), join(outDir, "migrations"), {
    recursive: true,
    filter: (source) => source.endsWith("/migrations") || source.endsWith(".sql"),
  });
  await copyFile(join(root, "apps/server/dist/plexy-server"), join(outDir, "plexy-server"));

  console.log("· Bundling FFmpeg");
  const ffmpegSource = await findFfmpeg(root);
  if (!ffmpegSource) {
    throw new Error(
      "FFmpeg binary missing; install the project dependencies before building the server.",
    );
  }
  const ffmpegOut = join(outDir, "ffmpeg");
  await copyFile(ffmpegSource, ffmpegOut);
  await chmod(ffmpegOut, 0o755);

  console.log("");
  console.log("✓ Plexy Server built: dist/server");
  console.log("  · Run:            ./dist/server/plexy-server");
  console.log("  · Version:        ./dist/server/plexy-server --version");
  console.log(
    "  · Data directory: PLEXY_DATA_DIR (defaults to the app support folder)",
  );
  console.log(
    "  · Open the server address in a browser, or use --no-ui for API only.",
  );
}

buildServer().catch((error) => {
  console.error(
    `Build failed: ${error instanceof Error ? error.message : String(error)}`,
  );
  process.exit(1);
});
