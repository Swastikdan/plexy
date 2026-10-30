import { mkdir, rm } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { execSync } from "node:child_process";

/// Rasterise the Plexy Client PWA icons from the source SVGs in
/// `apps/web/public`. sips renders an SVG at its intrinsic 1024px size and each
/// render is then resized to the exact output size, matching the approach in
/// `scripts/generate-icon.ts` (macOS only, like the other icon scripts here).
///
/// Regenerate with `bun run icons:pwa` after editing the source artwork.
const OUTPUTS = [
  { from: "client-icon.svg", name: "pwa-192.png", size: 192 },
  { from: "client-icon.svg", name: "pwa-512.png", size: 512 },
  { from: "client-icon-maskable.svg", name: "pwa-maskable-192.png", size: 192 },
  { from: "client-icon-maskable.svg", name: "pwa-maskable-512.png", size: 512 },
  { from: "client-icon.svg", name: "apple-touch-icon.png", size: 180 },
];

export async function generatePwaIcons(): Promise<void> {
  const publicDir = join(process.cwd(), "apps/web/public");
  const outDir = join(publicDir, "icons");
  await mkdir(outDir, { recursive: true });

  const scratch = join(outDir, ".render.png");
  const rendered = new Set<string>();

  for (const output of OUTPUTS) {
    const source = join(publicDir, output.from);
    if (!existsSync(source)) {
      throw new Error(`Missing icon source: ${source}`);
    }
    if (!rendered.has(source)) {
      execSync(`sips -s format png "${source}" --out "${scratch}" >/dev/null 2>&1`);
      if (!existsSync(scratch)) {
        throw new Error(`Could not rasterise ${source}`);
      }
      rendered.add(source);
    }
    execSync(
      `sips -z ${output.size} ${output.size} "${scratch}" --out "${join(outDir, output.name)}" >/dev/null 2>&1`,
    );
    if (!existsSync(join(outDir, output.name))) {
      throw new Error(`Could not write ${output.name}`);
    }
  }

  await rm(scratch, { force: true });
  console.log(`✓ PWA icons written to apps/web/public/icons (${OUTPUTS.length} files)`);
}

if (import.meta.main) {
  generatePwaIcons().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
