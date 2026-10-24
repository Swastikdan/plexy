import { mkdir, rm, copyFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { execSync } from "node:child_process";

export async function generateIcons() {
  const root = process.cwd();
  const svgSource = join(root, "apps/web/public/app-icon.svg");
  const tempDir = "/tmp/.plexy-icon-gen";
  const masterPng = join(tempDir, "master-1024.png");
  const iconsetDir = join(tempDir, "Plexy.iconset");
  const targetIcns = join(tempDir, "icon.icns");

  console.log("Generating Apple macOS application icon...");
  await rm(tempDir, { recursive: true, force: true });
  await mkdir(tempDir, { recursive: true });
  await mkdir(iconsetDir, { recursive: true });

  // 1. Render SVG to 1024x1024 master PNG using macOS native sips
  execSync(`sips -s format png "${svgSource}" --out "${masterPng}" >/dev/null 2>&1`);

  if (!existsSync(masterPng)) {
    throw new Error("Failed to render master PNG from SVG with sips");
  }

  // 2. Generate all Apple-standard icon sizes
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
    const outPath = join(iconsetDir, s.name);
    execSync(`sips -z ${s.h} ${s.w} "${masterPng}" --out "${outPath}" >/dev/null 2>&1`);
  }

  // 3. Compile iconset to ICNS using iconutil
  execSync(`iconutil -c icns "${iconsetDir}" -o "${targetIcns}"`);

  // 4. Distribute icon to standard locations
  const destinations = [
    join(root, "build", "icon.icns"),
    join(root, "apps/desktop/build", "icon.icns"),
    join(root, "dist", "AppIcon.icns"),
    join(root, "apps/desktop/resources", "icon.icns"),
  ];

  for (const dest of destinations) {
    await mkdir(join(dest, ".."), { recursive: true });
    await copyFile(targetIcns, dest);
  }

  // Also distribute 1024x1024 Retina PNG for dock / window icon
  const pngRetina = join(iconsetDir, "icon_512x512@2x.png");
  const pngDestinations = [
    join(root, "build", "icon.png"),
    join(root, "apps/desktop/build", "icon.png"),
    join(root, "apps/desktop/resources", "icon.png"),
  ];
  for (const dest of pngDestinations) {
    await mkdir(join(dest, ".."), { recursive: true });
    await copyFile(pngRetina, dest);
  }

  await rm(tempDir, { recursive: true, force: true });
  console.log("✓ macOS application icon generated and distributed across build/icon.icns, apps/desktop, and dist/AppIcon.icns");
}

if (import.meta.main) {
  generateIcons().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
