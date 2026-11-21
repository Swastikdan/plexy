import { File } from "expo-file-system";
import * as Crypto from "expo-crypto";
import type { UpdateType } from "./mobile-update-manifest";
import { fetchUpdateJson } from "./update-request";
import { fetchUpdateReleases } from "./update-releases";
import * as Application from "expo-application";
import * as FileSystem from "expo-file-system/legacy";
import * as IntentLauncher from "expo-intent-launcher";
import { isCompleteApk, validateApkDownload } from "./update-package";
import { Platform } from "react-native";
import { decodeVersionCode } from "@/shared/lib/build-version";
import { selectUpdate } from "./update-policy";
export interface GitHubAsset {
  name: string;
  size: number;
  digest?: string | null;
  browser_download_url: string;
}
export interface GitHubRelease {
  id: number;
  tag_name: string;
  name: string;
  body: string;
  published_at: string;
  prerelease: boolean;
  draft?: boolean;
  assets: GitHubAsset[];
}
export interface UpdateInfo {
  version?: string;
  updateType?: UpdateType;
  minimumSupportedVersion?: string;
  sha256?: string;
  tagName: string;
  releaseName: string;
  releaseNotes: string;
  publishedAt: string;
  apkUrl: string;
  mirrorApkUrl?: string;
  apkName: string;
  apkSize: number;
  buildNumber?: number;
}
export interface AppInfo {
  versionName: string;
  versionCode: number;
  buildNumber: number;
}
export async function getInstalledAppInfo(): Promise<AppInfo> {
  const versionName = Application.nativeApplicationVersion;
  const versionCode = Number(Application.nativeBuildVersion);
  if (!versionName || !Number.isSafeInteger(versionCode) || versionCode <= 0)
    throw new Error(
      "Could not read the installed app version. Try restarting the app.",
    );
  return {
    versionName,
    versionCode,
    buildNumber: decodeVersionCode(versionCode),
  };
}
export async function checkForUpdate(
  current?: AppInfo | number,
  signal?: AbortSignal,
): Promise<UpdateInfo | null> {
  const installed = typeof current === "object" ? current : await getInstalledAppInfo();
  const appInfo = typeof current === "number" ? { ...installed, buildNumber: current } : installed;
  const releases = await fetchUpdateReleases(fetch, signal);
  return selectUpdate(releases, "mobile", appInfo.buildNumber, appInfo.versionName);
}
export async function openUnknownAppsSettings(): Promise<void> {
  if (Platform.OS === "android") {
    try {
      await IntentLauncher.startActivityAsync(
        "android.settings.MANAGE_UNKNOWN_APP_SOURCES",
        {
          data: `package:${Application.applicationId || "app.plexy.mobile"}`,
        },
      );
    } catch {
      await IntentLauncher.startActivityAsync(
        "android.settings.SECURITY_SETTINGS",
      );
    }
  }
}
async function itchApkSource(update: UpdateInfo): Promise<string | undefined> {
  if (!update.sha256 || !/^mobile-v\d+\.\d+\.\d+$/.test(update.tagName)) return;
  try {
    const release = `https://github.com/Swastikdan/plexy/releases/download/${update.tagName}`;
    const { data } = await fetchUpdateJson(`${release}/itch-android-arm64.json`, {
      timeoutMs: 4_000, retries: 0,
    });
    const url = new URL((data as { url: string }).url);
    if (url.protocol === "https:" && !url.username && !url.password &&
        url.pathname === `/android-arm64/${update.tagName}` && !url.search && !url.hash) return url.href;
  } catch { /* The mirror is optional. */ }
}

export type InstallationResult = "installed" | "cancelled";
export async function downloadAndInstallUpdate(
  update: UpdateInfo,
  onProgress?: (percent: number) => void,
  onInstallerOpening?: () => void,
): Promise<InstallationResult> {
  if (Platform.OS !== "android")
    throw new Error("In-app updates are only supported on Android devices.");
  if (!FileSystem.cacheDirectory)
    throw new Error("Device storage is unavailable. Restart the app and try again.");
  const filename = `update_${update.tagName}_${update.apkName}`.replace(/[^a-zA-Z0-9._-]/g, "_");
  const localUri = `${FileSystem.cacheDirectory}${filename}`;
  const temporaryUri = `${localUri}.part`;
  const cached = await FileSystem.getInfoAsync(localUri);
  onProgress?.(0);
  const verifyChecksum = async (uri: string) => {
    if (!update.sha256) return;
    const digest = await Crypto.digest(Crypto.CryptoDigestAlgorithm.SHA256, await new File(uri).bytes());
    const actual = Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, "0")).join("");
    if (actual.toLowerCase() !== update.sha256.toLowerCase()) throw Error("Update verification failed.");
  };

  let ready = false;
  if (cached.exists && isCompleteApk(cached.size, update.apkSize)) {
    try {
      await verifyChecksum(localUri);
      ready = true;
    } catch { /* Download a clean copy if a cached file is corrupt. */ }
  }
  if (!ready) {
    await FileSystem.deleteAsync(localUri, { idempotent: true });
    const itch = await itchApkSource(update);
    const sources = [itch, update.sha256 ? update.mirrorApkUrl : undefined, update.apkUrl]
      .filter((url): url is string => Boolean(url));
    for (const url of sources) {
      await FileSystem.deleteAsync(temporaryUri, { idempotent: true });
      onProgress?.(0);
      try {
        const download = FileSystem.createDownloadResumable(
          url,
          temporaryUri,
          { headers: { "User-Agent": "Plexy-App", Accept: "application/octet-stream" } },
          (progress) => {
            const total = progress.totalBytesExpectedToWrite > 0
              ? progress.totalBytesExpectedToWrite : update.apkSize;
            if (total > 0)
              onProgress?.(Math.min(99, Math.max(0, Math.round(progress.totalBytesWritten / total * 100))));
          },
        );
        const result = await download.downloadAsync();
        const file = await FileSystem.getInfoAsync(temporaryUri);
        validateApkDownload(result?.status, file.exists ? file.size : 0, update.apkSize);
        await verifyChecksum(temporaryUri);
        await FileSystem.moveAsync({ from: temporaryUri, to: localUri });
        break;
      } catch (error) {
        await FileSystem.deleteAsync(temporaryUri, { idempotent: true }).catch(() => {});
        if (url === update.apkUrl) throw error;
      }
    }
  }
  onProgress?.(100);
  const contentUri = await FileSystem.getContentUriAsync(localUri);
  onInstallerOpening?.();
  // Expo starts for a result. NEW_TASK would detach the installer and return early.
  const result = await IntentLauncher.startActivityAsync("android.intent.action.VIEW", {
    data: contentUri,
    flags: 1, // FLAG_GRANT_READ_URI_PERMISSION
    type: "application/vnd.android.package-archive",
    extra: { "android.intent.extra.RETURN_RESULT": true },
  });
  if (result.resultCode === IntentLauncher.ResultCode.Success) return "installed";
  if (result.resultCode === IntentLauncher.ResultCode.Canceled) return "cancelled";
  throw new Error("Android could not install the update. Retry, or download the APK from Releases and open it from Files.");
}
