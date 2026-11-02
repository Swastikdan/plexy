import { app, dialog } from "electron";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";

const RELEASE_API = "https://api.github.com/repos/Swastikdan/plexy/releases?per_page=100";
const PRODUCT_NAME = "Plexy Beta";
// GitHub normalizes spaces to dots in uploaded release asset names, while
// SHA256SUMS retains the original local filename.
const RELEASE_ASSET_PRODUCT_NAME = PRODUCT_NAME.replace(/\s+/g, ".");
const APP_BUNDLE_NAME = `${PRODUCT_NAME}.app`;
const MAX_DOWNLOAD_BYTES = 2_000_000_000;

type ReleaseAsset = { name?: string; browser_download_url?: string; size?: number; digest?: string | null };
type Release = { tag_name?: string; html_url?: string; assets?: ReleaseAsset[] };

export interface UpdateStatus {
  supported: boolean;
  currentVersion: string;
  currentTag: string;
  latestVersion?: string;
  latestTag?: string;
  updateAvailable: boolean;
  currentIsNewer: boolean;
  canInstall: boolean;
  requiresAdministrator: boolean;
  error?: string;
}

export type UpdateProgress = {
  phase: "downloading" | "verifying" | "waiting-for-approval" | "installing";
  downloadedBytes: number;
  totalBytes: number | null;
};

function versionFromTag(tag: string): string | null {
  const match = tag.match(/^v?(\d+\.\d+\.\d+(?:-beta\.\d+)?)(?:-build\.\d+)?$/);
  return match?.[1] ?? null;
}

function compareReleaseTags(left: string, right: string): number {
  const parse = (tag: string) => {
    const version = versionFromTag(tag);
    const match = version?.match(/^(\d+)\.(\d+)\.(\d+)(?:-beta\.(\d+))?$/);
    const build = tag.match(/-build\.(\d+)$/);
    return match ? { parts: match.slice(1, 4).map(Number), beta: match[4] === undefined ? null : Number(match[4]), build: Number(build?.[1] ?? 0) } : null;
  };
  const a = parse(left);
  const b = parse(right);
  if (!a || !b) return left.localeCompare(right, undefined, { numeric: true });
  for (let index = 0; index < 3; index++) {
    const difference = a.parts[index]! - b.parts[index]!;
    if (difference) return difference;
  }
  if (a.beta === null && b.beta !== null) return 1;
  if (a.beta !== null && b.beta === null) return -1;
  if (a.beta !== null && b.beta !== null && a.beta !== b.beta) return a.beta - b.beta;
  return a.build - b.build;
}

async function latestRelease(): Promise<Release> {
  const response = await fetch(RELEASE_API, { headers: { "User-Agent": "Plexy-Desktop-Updater", Accept: "application/vnd.github+json" } });
  if (!response.ok) throw new Error(`GitHub returned ${response.status}`);
  const releases = await response.json() as Release[];
  const eligible = releases.filter((release) => release.tag_name && versionFromTag(release.tag_name));
  const release = eligible.sort((a, b) => compareReleaseTags(b.tag_name!, a.tag_name!))[0];
  if (!release) throw new Error("No compatible Plexy release was found.");
  return release;
}

function updateAssetName(version: string): string {
  return `${RELEASE_ASSET_PRODUCT_NAME}-${version}-arm64.zip`;
}

function checksumAssetName(version: string): string {
  return `${PRODUCT_NAME}-${version}-arm64.zip`;
}

async function installedTag(): Promise<string> {
  const appVersion = app.getVersion();
  try {
    const state = JSON.parse(await readFile(path.join(app.getPath("userData"), "update-state.json"), "utf8")) as { tag?: unknown };
    // The marker survives a manual reinstall. Ignore it when the newly
    // installed bundle has a newer version, but retain build tags when the
    // package version itself has not changed (for example 1.0.0-build.6).
    if (typeof state.tag === "string" && versionFromTag(state.tag) && compareReleaseTags(state.tag, appVersion) >= 0) {
      return state.tag;
    }
  } catch { /* Older/manual installs have no update marker. */ }
  return appVersion;
}

function installedAppPath(): string {
  return app.getPath("exe").replace(/\/Contents\/MacOS\/[^/]+$/, "");
}

function installedInSystemApplications(): boolean {
  const target = installedAppPath();
  return target.startsWith("/Applications/") || target === "/Applications/Plexy.app";
}

export async function getUpdateStatus(): Promise<UpdateStatus> {
  const supported = app.isPackaged && process.platform === "darwin" && process.arch === "arm64";
  const currentTag = await installedTag();
  const status: UpdateStatus = {
    supported,
    currentVersion: app.getVersion(),
    currentTag,
    updateAvailable: false,
    currentIsNewer: false,
    canInstall: false,
    requiresAdministrator: installedInSystemApplications(),
  };
  if (!supported) return status;
  try {
    const release = await latestRelease();
    const tag = release.tag_name ?? "";
    const version = versionFromTag(tag);
    if (!version) throw new Error("The latest release has an unsupported version tag.");
    const assets = release.assets ?? [];
    const zip = assets.find((asset) => asset.name === updateAssetName(version));
    const sums = assets.find((asset) => asset.name === "SHA256SUMS");
    const comparison = compareReleaseTags(tag, currentTag);
    return {
      ...status,
      latestVersion: version,
      latestTag: tag,
      updateAvailable: comparison > 0,
      currentIsNewer: comparison < 0,
      canInstall: Boolean(zip?.browser_download_url && (sums?.browser_download_url || /^sha256:[a-f0-9]{64}$/i.test(zip.digest ?? ""))),
    };
  } catch (error) {
    return { ...status, error: error instanceof Error ? error.message : String(error) };
  }
}

async function fetchBytes(
  url: string,
  maxBytes: number,
  onProgress?: (downloadedBytes: number, totalBytes: number | null) => void,
  expectedTotalBytes?: number,
): Promise<Buffer> {
  const response = await fetch(url, { headers: { "User-Agent": "Plexy-Desktop-Updater", Accept: "application/octet-stream" } });
  if (!response.ok) throw new Error(`Download failed (${response.status})`);
  const length = Number(response.headers.get("content-length") ?? 0);
  if (length > maxBytes) throw new Error("The update file is too large.");
  if (!response.body) throw new Error("The update download returned no data.");

  const totalBytes = length || expectedTotalBytes || null;
  const reader = response.body.getReader();
  const chunks: Buffer[] = [];
  let downloadedBytes = 0;
  let lastReportedAt = 0;
  onProgress?.(0, totalBytes);
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      downloadedBytes += value.byteLength;
      if (downloadedBytes > maxBytes) throw new Error("The update file is too large.");
      chunks.push(Buffer.from(value));
      const now = Date.now();
      if (now - lastReportedAt >= 100 || (totalBytes !== null && downloadedBytes >= totalBytes)) {
        onProgress?.(downloadedBytes, totalBytes);
        lastReportedAt = now;
      }
    }
  } finally {
    reader.releaseLock();
  }
  onProgress?.(downloadedBytes, totalBytes);
  return Buffer.concat(chunks, downloadedBytes);
}

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

function run(command: string, args: string[]): Promise<{ code: number | null; stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk) => { stdout = (stdout + chunk).slice(-100_000); });
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk) => { stderr = (stderr + chunk).slice(-2000); });
    child.once("error", reject);
    child.once("close", (code) => resolve({ code, stdout, stderr }));
  });
}

export async function checkForUpdates(onProgress?: (progress: UpdateProgress) => void): Promise<void> {
  if (!app.isPackaged || process.platform !== "darwin" || process.arch !== "arm64") {
    await dialog.showMessageBox({ type: "info", title: "Plexy Updates", message: "Updates are available for packaged Apple Silicon builds." });
    return;
  }

  try {
    const release = await latestRelease();
    const tag = release.tag_name ?? "";
    const version = versionFromTag(release.tag_name ?? "");
    if (!version) throw new Error("The latest release has an unsupported version tag.");
    const installed = await installedTag();
    if (compareReleaseTags(tag, installed) <= 0) {
      const currentIsNewer = compareReleaseTags(installed, tag) > 0;
      await dialog.showMessageBox({
        type: "info",
        title: currentIsNewer ? "Plexy is newer than the latest release" : "Plexy is up to date",
        message: currentIsNewer
          ? `You’re running Plexy ${app.getVersion()}, which is newer than the latest published release (${version}).`
          : `You’re running Plexy ${app.getVersion()}.`,
      });
      return;
    }
    const assets = release.assets ?? [];
    const zip = assets.find((asset) => asset.name === updateAssetName(version));
    const sums = assets.find((asset) => asset.name === "SHA256SUMS");
    if (!zip?.browser_download_url) throw new Error("This release is missing its update ZIP.");
    if (!sums?.browser_download_url && !/^sha256:[a-f0-9]{64}$/i.test(zip.digest ?? "")) {
      throw new Error("This release is missing its update checksum.");
    }

    const tempDir = await mkdtemp(path.join(os.tmpdir(), "plexy-update-"));
    let handedOffToInstaller = false;
    try {
      const archive = await fetchBytes(
        zip.browser_download_url,
        MAX_DOWNLOAD_BYTES,
        (downloadedBytes, totalBytes) => onProgress?.({ phase: "downloading", downloadedBytes, totalBytes }),
        zip.size,
      );
      onProgress?.({ phase: "verifying", downloadedBytes: archive.length, totalBytes: archive.length });
      const checksumFile = sums?.browser_download_url ? await fetchBytes(sums.browser_download_url, 100_000) : null;
      const expected = checksumFile
        ? checksumFile.toString("utf8").split(/\r?\n/).find((line) => line.trim().endsWith(`  ${checksumAssetName(version)}`))?.split(/\s+/)[0]
        : zip.digest?.replace(/^sha256:/i, "");
      const actual = createHash("sha256").update(archive).digest("hex");
      if (!expected || !/^[a-f0-9]{64}$/i.test(expected) || actual !== expected.toLowerCase()) throw new Error("The downloaded update failed its SHA-256 check.");
      onProgress?.({ phase: "waiting-for-approval", downloadedBytes: archive.length, totalBytes: archive.length });
      const archivePath = path.join(tempDir, zip.name!);
      await writeFile(archivePath, archive, { mode: 0o600 });

      const listing = await run("/usr/bin/unzip", ["-Z1", archivePath]);
      if (listing.code !== 0 || !listing.stdout.trim()) throw new Error("The update archive could not be read.");
      // The helper independently extracts into a fresh directory; reject paths that
      // could write outside the single expected app bundle.
      const entries = listing.stdout.split(/\r?\n/).filter(Boolean);
      if (!entries.length || entries.some((entry) => entry.startsWith("/") || entry.split("/").some((part) => part === "..") || !entry.startsWith(`${APP_BUNDLE_NAME}/`))) {
        throw new Error("The update archive contains unexpected files.");
      }
      const target = installedAppPath();
      if (!target.endsWith("/Plexy.app") && !target.endsWith(`/${APP_BUNDLE_NAME}`)) throw new Error("Could not determine the installed Plexy application path.");
      const installScript = path.join(tempDir, "install-update.sh");
      const versionMarker = path.join(app.getPath("userData"), "update-state.json");
      await writeFile(installScript, [
        "#!/bin/bash", "set -euo pipefail",
        `ARCHIVE=${shellQuote(archivePath)}`,
        `TARGET=${shellQuote(target)}`,
        `STAGE=${shellQuote(path.join(tempDir, "extract"))}`,
        `BACKUP=${shellQuote(path.join(tempDir, "Plexy.previous.app"))}`,
        `VERSION_MARKER=${shellQuote(versionMarker)}`,
        `RELEASE_TAG=${shellQuote(tag)}`,
        `PARENT_PID=${shellQuote(String(process.pid))}`,
        "mkdir -p \"$STAGE\"",
        "ditto -x -k \"$ARCHIVE\" \"$STAGE\"",
        `SOURCE="$STAGE/${APP_BUNDLE_NAME}"`,
        "test -d \"$SOURCE/Contents/MacOS\"",
        "test -f \"$SOURCE/Contents/Info.plist\"",
        "case \"$(/usr/libexec/PlistBuddy -c 'Print :CFBundleIdentifier' \"$SOURCE/Contents/Info.plist\")\" in com.plexy.desktop) ;; *) exit 21 ;; esac",
        "for _ in $(seq 1 60); do kill -0 \"$PARENT_PID\" 2>/dev/null || break; sleep 1; done",
        "mv \"$TARGET\" \"$BACKUP\"",
        "if ditto \"$SOURCE\" \"$TARGET\"; then rm -rf \"$BACKUP\"; else mv \"$BACKUP\" \"$TARGET\"; exit 22; fi",
        "mkdir -p \"$(dirname \"$VERSION_MARKER\")\"",
        "printf '{\"tag\":\"%s\"}\\n' \"$RELEASE_TAG\" > \"$VERSION_MARKER\"",
        "chown \"$(stat -f %u \"$(dirname \"$VERSION_MARKER\")\"):$(stat -f %g \"$(dirname \"$VERSION_MARKER\")\")\" \"$VERSION_MARKER\"",
        "open \"$TARGET\"",
        "rm -rf \"$(dirname \"$ARCHIVE\")\"",
      ].join("\n"), { mode: 0o700 });

      const answer = await dialog.showMessageBox({
        type: "question", title: "Install Plexy update?",
        message: `Plexy ${version} is ready to install.`,
        detail: installedInSystemApplications()
          ? "Plexy will quit and reopen after replacing the app. macOS will ask for administrator approval because Plexy is installed in the shared Applications folder. Your password is not stored; your library and settings will be kept."
          : "Plexy will quit and reopen after replacing the app. Your library and settings are stored separately and will be kept.",
        buttons: ["Install and Relaunch", "Later"], defaultId: 0, cancelId: 1,
      });
      if (answer.response !== 0) return;

      onProgress?.({ phase: "installing", downloadedBytes: archive.length, totalBytes: archive.length });

      if (target.startsWith("/Applications/") || target === "/Applications/Plexy.app") {
        const appleScript = `do shell script ${JSON.stringify(`/bin/bash ${shellQuote(installScript)}`)} with administrator privileges`;
        const child = spawn("/usr/bin/osascript", ["-e", appleScript], { detached: true, stdio: "ignore" });
        child.unref();
        handedOffToInstaller = true;
        app.quit();
      } else {
        const child = spawn("/bin/bash", [installScript], { detached: true, stdio: "ignore" });
        child.unref();
        handedOffToInstaller = true;
        app.quit();
      }
    } finally {
      if (!handedOffToInstaller) await rm(tempDir, { recursive: true, force: true });
    }
  } catch (error) {
    await dialog.showMessageBox({ type: "error", title: "Plexy update failed", message: error instanceof Error ? error.message : String(error) });
  }
}
