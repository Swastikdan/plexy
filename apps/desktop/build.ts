import { join } from "node:path";
import { mkdir } from "node:fs/promises";

declare const Bun: any;

async function build() {
  const outdir = join(__dirname, "dist");
  await mkdir(outdir, { recursive: true });

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
