import { mkdir, rm, copyFile, readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { execSync } from "node:child_process";

export async function generateIcons() {
  if (process.platform !== "darwin") {
    console.log("generateIcons: Skipping sips/iconutil icon generation on non-macOS platform.");
    return;
  }
  const root = process.cwd();
  const svgSource = join(root, "apps/web/public/app-icon.svg");
  const tempDir = "/tmp/.plexy-icon-gen";
  const masterPng = join(tempDir, "master-1024.png");
  const masterFgPng = join(tempDir, "master-fg-1024.png");
  const masterMonoPng = join(tempDir, "master-mono-1024.png");
  const iconsetDir = join(tempDir, "Plexy.iconset");
  const targetIcns = join(tempDir, "icon.icns");

  console.log("Generating Apple macOS & Desktop application icons...");
  await rm(tempDir, { recursive: true, force: true });
  await mkdir(tempDir, { recursive: true });
  await mkdir(iconsetDir, { recursive: true });

  // 1. Render SVG to 1024x1024 master PNG using macOS native sips
  execSync(`sips -s format png "${svgSource}" --out "${masterPng}" >/dev/null 2>&1`);

  if (!existsSync(masterPng)) {
    throw new Error("Failed to render master PNG from SVG with sips");
  }

  // Generate transparent Adaptive Foreground SVG (Plexy Emblem with gradient, scaled inside 72dp safe zone of 108dp canvas)
  const fgSvgPath = join(tempDir, "fg.svg");
  const fgSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024" viewBox="0 0 1024 1024">
  <defs>
    <linearGradient id="plexy-blue" x1="0%" x2="100%" y1="0%" y2="100%">
      <stop offset="0%" stop-color="#6C9FFF" />
      <stop offset="50%" stop-color="#3B7DF9" />
      <stop offset="100%" stop-color="#1F4FCB" />
    </linearGradient>
  </defs>
  <path
    fill="url(#plexy-blue)"
    transform="translate(292 272) scale(1.7)"
    d="M223.517 44.823 161.174 8.85a65.565 65.565 0 0 0-65.792 0l-62.63 35.973C12.642 56.623 0 78.495 0 101.806v72.235c0 23.6 12.641 45.183 32.752 56.982l62.343 36.263a65.565 65.565 0 0 0 65.791 0l62.343-36.263c20.399-11.799 32.752-33.383 32.752-56.982v-72.235c.575-23.311-12.066-45.183-32.464-56.983Zm-95.383 157.422c-35.337 0-64.067-28.78-64.067-64.177 0-35.399 28.73-64.178 64.067-64.178 35.338 0 64.355 28.779 64.355 64.178 0 35.398-28.73 64.177-64.355 64.177Z"
  />
</svg>`;
  await writeFile(fgSvgPath, fgSvg);
  execSync(`sips -s format png "${fgSvgPath}" --out "${masterFgPng}" >/dev/null 2>&1`);

  // Generate transparent Android Monochrome SVG (Pure White emblem silhouette for Monet themed icons)
  const monoSvgPath = join(tempDir, "mono.svg");
  const monoSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024" viewBox="0 0 1024 1024">
  <path
    fill="#ffffff"
    transform="translate(292 272) scale(1.7)"
    d="M223.517 44.823 161.174 8.85a65.565 65.565 0 0 0-65.792 0l-62.63 35.973C12.642 56.623 0 78.495 0 101.806v72.235c0 23.6 12.641 45.183 32.752 56.982l62.343 36.263a65.565 65.565 0 0 0 65.791 0l62.343-36.263c20.399-11.799 32.752-33.383 32.752-56.982v-72.235c.575-23.311-12.066-45.183-32.464-56.983Zm-95.383 157.422c-35.337 0-64.067-28.78-64.067-64.177 0-35.399 28.73-64.178 64.067-64.178 35.338 0 64.355 28.779 64.355 64.178 0 35.398-28.73 64.177-64.355 64.177Z"
  />
</svg>`;
  await writeFile(monoSvgPath, monoSvg);
  execSync(`sips -s format png "${monoSvgPath}" --out "${masterMonoPng}" >/dev/null 2>&1`);

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

  // 5. Generate matching Android Mobile icons from the master icon
  console.log("Generating Android Mobile matching application icons...");
  const androidDensities = [
    { dir: "mipmap-mdpi", size: 48, fgSize: 108 },
    { dir: "mipmap-hdpi", size: 72, fgSize: 162 },
    { dir: "mipmap-xhdpi", size: 96, fgSize: 216 },
    { dir: "mipmap-xxhdpi", size: 144, fgSize: 324 },
    { dir: "mipmap-xxxhdpi", size: 192, fgSize: 432 },
  ];

  // Mobile Android res
  const mobileRes = join(root, "apps/mobile/android/app/src/main/res");
  for (const d of androidDensities) {
    const targetDir = join(mobileRes, d.dir);
    if (existsSync(targetDir)) {
      execSync(`sips -z ${d.size} ${d.size} "${masterPng}" --out "${join(targetDir, "ic_launcher.webp")}" >/dev/null 2>&1`);
      execSync(`sips -z ${d.size} ${d.size} "${masterPng}" --out "${join(targetDir, "ic_launcher_round.webp")}" >/dev/null 2>&1`);
      // Foreground: transparent background with centered gradient emblem
      execSync(`sips -z ${d.fgSize} ${d.fgSize} "${masterFgPng}" --out "${join(targetDir, "ic_launcher_foreground.webp")}" >/dev/null 2>&1`);
      // Monochrome: transparent background with pure white emblem for Monet themed icons
      execSync(`sips -z ${d.fgSize} ${d.fgSize} "${masterMonoPng}" --out "${join(targetDir, "ic_launcher_monochrome.webp")}" >/dev/null 2>&1`);
    }
  }

  // Also sync with web public icons so PWA/fallback uses the unified brand icon
  const pwa512 = join(root, "apps/web/public/icons/pwa-512.png");
  if (existsSync(join(pwa512, ".."))) {
    execSync(`sips -z 512 512 "${masterPng}" --out "${pwa512}" >/dev/null 2>&1`);
  }

  const mobileAssets = join(root, "apps/mobile/assets");
  await mkdir(mobileAssets, { recursive: true });
  // Mobile Expo splash mark: transparent, tightly cropped emblem for a clean
  // lockup on the black splash background (no dark square, no tiny icon).
  const splashIconSvgPath = join(tempDir, "splash-icon.svg");
  const splashIconSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024" viewBox="-16 -7 288 290">
  <defs>
    <linearGradient id="plexy-blue" x1="0%" x2="100%" y1="0%" y2="100%">
      <stop offset="0%" stop-color="#6C9FFF" />
      <stop offset="50%" stop-color="#3B7DF9" />
      <stop offset="100%" stop-color="#1F4FCB" />
    </linearGradient>
  </defs>
  <path
    fill="url(#plexy-blue)"
    d="M223.517 44.823 161.174 8.85a65.565 65.565 0 0 0-65.792 0l-62.63 35.973C12.642 56.623 0 78.495 0 101.806v72.235c0 23.6 12.641 45.183 32.752 56.982l62.343 36.263a65.565 65.565 0 0 0 65.791 0l62.343-36.263c20.399-11.799 32.752-33.383 32.752-56.982v-72.235c.575-23.311-12.066-45.183-32.464-56.983Zm-95.383 157.422c-35.337 0-64.067-28.78-64.067-64.177 0-35.399 28.73-64.178 64.067-64.178 35.338 0 64.355 28.779 64.355 64.178 0 35.398-28.73 64.177-64.355 64.177Z"
  />
</svg>`;
  await writeFile(splashIconSvgPath, splashIconSvg);
  execSync(`sips -s format png "${splashIconSvgPath}" --out "${join(mobileAssets, "splash-icon.png")}" >/dev/null 2>&1`);

  await rm(tempDir, { recursive: true, force: true });
  console.log("✓ Application icons & dark splash screens generated across Mobile");
}

if (import.meta.main) {
  generateIcons().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
