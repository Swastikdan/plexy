import { mkdir, rm } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { execSync } from "node:child_process";

/**
 * Renders the DMG installer background.
 *
 * macOS Finder windows are addressed in points, so the artwork is authored at
 * 1280x800 (2x) and exported twice:
 *   - build/background@2x.png -> 1280x800 (retina)
 *   - build/background.png    -> 640x400  (window size, 1x)
 *
 * electron-builder merges the two into a hi-dpi TIFF automatically and derives
 * the installer window size from background.png.
 */
export async function generateDmgBackground() {
  const root = process.cwd();
  const svgSource = join(root, "build/dmg-background.svg");
  const tempDir = "/tmp/.plexy-dmg-background";
  const masterPng = join(tempDir, "master-1280.png");

  if (!existsSync(svgSource)) {
    throw new Error(`Missing DMG background source: ${svgSource}`);
  }

  console.log("Generating macOS DMG installer background...");
  await rm(tempDir, { recursive: true, force: true });
  await mkdir(tempDir, { recursive: true });
  await mkdir(join(root, "build"), { recursive: true });

  // 1. Render the authored 2x artwork with macOS native rasterizer.
  execSync(`sips -s format png "${svgSource}" --out "${masterPng}" >/dev/null 2>&1`);

  if (!existsSync(masterPng)) {
    throw new Error("Failed to render DMG background from SVG with sips");
  }

  // 2. Retina copy at the authored size.
  execSync(`cp "${masterPng}" "${join(root, "build", "background@2x.png")}"`);

  // 3. Downscale for the 1x window bitmap.
  execSync(
    `sips -z 400 640 "${masterPng}" --out "${join(root, "build", "background.png")}" >/dev/null 2>&1`,
  );

  await rm(tempDir, { recursive: true, force: true });
  console.log("✓ DMG background generated (build/background.png + build/background@2x.png)");
}

if (import.meta.main) {
  generateDmgBackground().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
