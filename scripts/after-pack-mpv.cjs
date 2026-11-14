/// electron-builder afterPack hook: place the native playback engine next to
/// the bundled FFmpeg inside the app's Resources/bin. Optional by design — an
/// app packaged without mpv keeps the browser player and reports native
/// playback as unavailable.
const fs = require("node:fs");
const path = require("node:path");

exports.default = async function afterPackMpv(context) {
  const projectDir = context.packager.projectDir;
  const source = path.join(projectDir, "dist", "bin", "mpv");
  if (!fs.existsSync(source)) {
    console.warn("[Plexy] Native playback engine missing; packaging without mpv.");
    return;
  }
  const productName = context.packager.appInfo.productFilename;
  const resources = path.join(
    context.appOutDir,
    `${productName}.app`,
    "Contents",
    "Resources",
  );
  const binDir = path.join(resources, "bin");
  fs.mkdirSync(binDir, { recursive: true });
  fs.copyFileSync(source, path.join(binDir, "mpv"));
  fs.chmodSync(path.join(binDir, "mpv"), 0o755);

  const versionFile = `${source}.version`;
  if (fs.existsSync(versionFile)) {
    fs.copyFileSync(versionFile, path.join(binDir, "mpv.version"));
  }

  for (const name of ["lib", "mpv-libs"]) {
    const libs = path.join(projectDir, "dist", "bin", name);
    if (fs.existsSync(libs)) {
      fs.cpSync(libs, path.join(binDir, name), { recursive: true });
    }
  }

  const vulkan = path.join(projectDir, "dist", "bin", "vulkan");
  if (fs.existsSync(vulkan)) {
    fs.cpSync(vulkan, path.join(binDir, "vulkan"), { recursive: true });
  }

  const licenses = path.join(projectDir, "licenses");
  if (fs.existsSync(licenses)) {
    fs.cpSync(licenses, path.join(resources, "licenses"), { recursive: true });
  }

  // Re-sign ad-hoc after copying binaries into the bundle.
  try {
    const { execFileSync } = require("node:child_process");
    const files = [path.join(binDir, "mpv")];
    for (const name of ["lib", "mpv-libs"]) {
      const libs = path.join(binDir, name);
      if (!fs.existsSync(libs)) continue;
      for (const lib of fs.readdirSync(libs)) {
        if (lib.endsWith(".dylib")) files.push(path.join(libs, lib));
      }
    }
    for (const file of files) {
      execFileSync("codesign", ["--force", "--sign", "-", file], { stdio: "ignore" });
    }
  } catch {
    /* signing is best effort for unsigned development builds */
  }
  console.log(`[Plexy] Native playback engine bundled: ${path.join(binDir, "mpv")}`);
};
