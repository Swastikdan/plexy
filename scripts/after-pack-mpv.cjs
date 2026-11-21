/// electron-builder afterPack hook: place the in-process native playback engine
/// next to the bundled FFmpeg inside the app's Resources/bin. Optional by
/// design — an app packaged without libmpv keeps the browser player and
/// reports native playback as unavailable.
///
/// Only the libmpv closure is packaged: `native-player.ts` loads
/// `mpv-libs/libmpv.2.dylib` inside the Electron main process. The standalone
/// mpv CLI and its separate `lib/` closure (~103 MB) were never executed by
/// the desktop app or the server and are not copied.
const fs = require("node:fs");
const path = require("node:path");

exports.default = async function afterPackMpv(context) {
  const projectDir = context.packager.projectDir;
  const source = path.join(projectDir, "dist", "bin", "mpv-libs");
  if (!fs.existsSync(path.join(source, "libmpv.2.dylib"))) {
    console.warn("[Plexy] libmpv is missing; packaging without native playback.");
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

  const libsDir = path.join(binDir, "mpv-libs");
  fs.cpSync(source, libsDir, { recursive: true });

  // The Vulkan ICD directory is kept beside the libraries. The embedded player
  // renders through OpenGL, but libmpv links libvulkan.1, so the loader stays
  // part of the closure either way.
  const vulkan = path.join(projectDir, "dist", "bin", "vulkan");
  if (fs.existsSync(vulkan)) {
    fs.cpSync(vulkan, path.join(binDir, "vulkan"), { recursive: true });
  }

  const licenses = path.join(projectDir, "licenses");
  if (fs.existsSync(licenses)) {
    fs.cpSync(licenses, path.join(resources, "licenses"), { recursive: true });
  }

  // Strip local symbols from the packaged dylibs (measured 5.7 MB / 8.8% of
  // the closure) and re-sign ad-hoc afterwards. install_name_tool already
  // rewrote the load paths in `bundle-libmpv.ts`.
  try {
    const { execFileSync } = require("node:child_process");
    const addon = path.join(resources, "native", "mpv_embed.node");
    const files = [];
    if (fs.existsSync(addon)) files.push(addon);
    for (const lib of fs.readdirSync(libsDir)) {
      if (lib.endsWith(".dylib")) files.push(path.join(libsDir, lib));
    }
    for (const file of files) {
      try {
        execFileSync("strip", ["-x", "-S", file], { stdio: "ignore" });
      } catch {
        /* already stripped or not a Mach-O file */
      }
    }
    for (const file of files) {
      execFileSync("codesign", ["--force", "--sign", "-", file], { stdio: "ignore" });
    }
  } catch {
    /* signing is best effort for unsigned development builds */
  }
  console.log(
    `[Plexy] Native playback engine bundled: ${path.join(libsDir, "libmpv.2.dylib")}`,
  );
};
