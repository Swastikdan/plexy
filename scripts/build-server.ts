import { mkdir, copyFile, chmod, readdir, rm } from "node:fs/promises";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { createRequire } from "node:module";
import { execSync } from "node:child_process";

/// Plexy Server (backend only): one compiled binary plus the runtime files it
/// reads from its own folder.
///
/// Unlike `build:executable`, which also assembles and installs a macOS app
/// bundle, this target has no Electron or UI installer side effects. Data lives
/// outside the artifact, in `PLEXY_DATA_DIR`.
const OUT_DIR = "dist/server";

/// Resolve the FFmpeg binary whether dependencies came from Bun, pnpm or npm.
/// Probing and transcoding need it at runtime, so it ships next to the binary.
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
        candidates.push(join(bunStore, entry, "node_modules/node-av/binary/ffmpeg"));
      }
    }
  } catch {
    /* not installed with Bun */
  }

  return candidates.find((candidate) => existsSync(candidate)) ?? null;
}

async function buildServer(): Promise<void> {
  const root = process.cwd();
  const outDir = join(root, OUT_DIR);
  const migrationsOut = join(outDir, "migrations");

  console.log("Plexy Server (backend only)");
  console.log("===========================");

  await rm(outDir, { recursive: true, force: true });
  await mkdir(migrationsOut, { recursive: true });

  console.log("· Copying SQL migrations");
  const migrationsSrc = join(root, "apps/server/src/migrations");
  for (const file of await readdir(migrationsSrc)) {
    if (file.endsWith(".sql")) {
      await copyFile(join(migrationsSrc, file), join(migrationsOut, file));
    }
  }

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

  console.log("· Compiling the standalone binary");
  const binaryOut = join(outDir, "plexy-server");
  execSync(
    `bun build --compile --minify --outfile="${binaryOut}" apps/server/src/main.ts`,
    { stdio: "inherit" },
  );
  await chmod(binaryOut, 0o755);

  console.log("");
  console.log("✓ Plexy Server built: dist/server");
  console.log("  · Run:            ./dist/server/plexy-server");
  console.log("  · Version:        ./dist/server/plexy-server --version");
  console.log("  · Data directory: PLEXY_DATA_DIR (defaults to the app support folder)");
  console.log("  · Requires no Electron install; connect Plexy Client to its address.");
}

buildServer().catch((error) => {
  console.error(`Build failed: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
});
