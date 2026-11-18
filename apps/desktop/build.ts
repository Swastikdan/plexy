import { join } from "node:path";
import { existsSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import { execFileSync } from "node:child_process";

declare const Bun: any;

/**
 * Build the embedded libmpv surface. The module is an N-API bundle compiled
 * with the system toolchain: no node-gyp, no Electron rebuild. libmpv itself is
 * loaded at runtime so the same binary works with a bundled or system engine.
 */
async function buildNative() {
  if (process.platform !== "darwin") {
    console.log("• Skipping the embedded player module (macOS only)");
    return;
  }
  const source = join(__dirname, "native", "mpv-embed", "src", "mpv_embed.mm");
  if (!existsSync(source)) {
    console.log("• Embedded player source is missing; skipping");
    return;
  }
  const outdir = join(__dirname, "dist", "native");
  await mkdir(outdir, { recursive: true });
  console.log("Building the embedded libmpv surface...");
  execFileSync(
    "xcrun",
    [
      "clang++",
      "-std=c++17",
      "-fobjc-arc",
      "-fblocks",
      "-O2",
      "-bundle",
      "-undefined",
      "dynamic_lookup",
      "-DNODE_GYP_MODULE_NAME=mpv_embed",
      "-DGL_SILENCE_DEPRECATION",
      "-Wno-deprecated-declarations",
      "-I",
      join(__dirname, "native", "mpv-embed", "include"),
      "-o",
      join(outdir, "mpv_embed.node"),
      source,
      "-framework",
      "AppKit",
      "-framework",
      "Foundation",
      "-framework",
      "OpenGL",
      "-framework",
      "QuartzCore",
    ],
    { stdio: "inherit" },
  );
  console.log("✓ Embedded player module built: dist/native/mpv_embed.node");
}

async function build() {
  const outdir = join(__dirname, "dist");
  await mkdir(outdir, { recursive: true });

  await buildNative();

  console.log("Building Electron main and preload scripts with Bun...");

  const mainResult = await Bun.build({
    entrypoints: [join(__dirname, "src/main/index.ts")],
    target: "node",
    format: "cjs",
    external: ["electron"],
    naming: "main.cjs",
    outdir,
  });

  if (!mainResult.success) {
    console.error("Main build failed:", mainResult.logs);
    process.exit(1);
  }

  const preloadResult = await Bun.build({
    entrypoints: [join(__dirname, "src/preload/index.ts")],
    target: "node",
    format: "cjs",
    external: ["electron"],
    naming: "preload.cjs",
    outdir,
  });

  if (!preloadResult.success) {
    console.error("Preload build failed:", preloadResult.logs);
    process.exit(1);
  }

  console.log("✓ Electron scripts built successfully: dist/main.cjs, dist/preload.cjs");
}

build().catch((err) => {
  console.error(err);
  process.exit(1);
});
