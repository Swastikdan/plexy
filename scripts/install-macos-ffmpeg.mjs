// Download the exact asset selected by node-av without its unauthenticated
// GitHub API lookup (which can exhaust the shared CI runner's rate limit).
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { pathToFileURL } from "node:url";
import { mkdtempSync, mkdirSync, copyFileSync, chmodSync, renameSync, rmSync, openSync, closeSync } from "node:fs";
import { tmpdir } from "node:os";
import { execFileSync } from "node:child_process";

if (process.platform !== "darwin" || process.arch !== "arm64") {
  throw new Error("The macOS release requires an Apple Silicon runner.");
}
const require = createRequire(import.meta.url);
const packageDir = dirname(dirname(require.resolve("node-av")));
const packagePath = join(packageDir, "package.json");
const { version } = require(packagePath);
const { FFMPEG_VERSION } = await import(pathToFileURL(join(packageDir, "dist/ffmpeg/version.js")));
const binaryDir = join(packageDir, "binary");
const binary = join(binaryDir, "ffmpeg");
try {
  execFileSync(binary, ["-version"], { stdio: "ignore" });
  console.log("Using cached FFmpeg runtime.");
} catch {
  const temporary = mkdtempSync(join(tmpdir(), "plexy-ffmpeg-"));
  const asset = `ffmpeg-v${FFMPEG_VERSION}-macos-arm64-jellyfin.zip`;
  const url = `https://github.com/seydx/node-av/releases/download/v${version}/${asset}`;
  try {
    console.log(`Downloading ${url}`);
    const archive = join(temporary, "ffmpeg.zip");
    execFileSync("curl", ["--fail", "--location", "--retry", "3", "--retry-all-errors", "--connect-timeout", "20", "--max-time", "600", "--output", archive, url], { stdio: "inherit" });
    const entries = execFileSync("unzip", ["-Z1", archive], { encoding: "utf8" }).trim().split("\n");
    const entry = entries.find((name) => name === "ffmpeg" || name.endsWith("/ffmpeg"));
    if (!entry) throw new Error("FFmpeg release archive contains no ffmpeg executable.");
    // Extract only the executable, without trusting archive paths.
    const extracted = join(temporary, "ffmpeg");
    const output = openSync(extracted, "w");
    try {
      execFileSync("unzip", ["-p", archive, entry], { stdio: ["ignore", output, "inherit"] });
    } finally {
      closeSync(output);
    }
    chmodSync(extracted, 0o755);
    execFileSync(extracted, ["-version"], { stdio: "inherit" });
    mkdirSync(binaryDir, { recursive: true });
    copyFileSync(extracted, `${binary}.tmp`);
    chmodSync(`${binary}.tmp`, 0o755);
    renameSync(`${binary}.tmp`, binary);
  } finally {
    rmSync(temporary, { recursive: true, force: true });
  }
}
