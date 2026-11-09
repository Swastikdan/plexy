import * as FileSystem from "expo-file-system/legacy";
import * as IntentLauncher from "expo-intent-launcher";
import { NativeModules, Platform } from "react-native";

export interface GitHubAsset {
  name: string;
  size: number;
  browser_download_url: string;
}

export interface GitHubRelease {
  id: number;
  tag_name: string;
  name: string;
  body: string;
  published_at: string;
  prerelease: boolean;
  assets: GitHubAsset[];
}

export interface UpdateInfo {
  tagName: string;
  releaseName: string;
  releaseNotes: string;
  publishedAt: string;
  apkUrl: string;
  apkName: string;
  apkSize: number;
  buildNumber?: number;
}

export interface AppInfo {
  versionName: string;
  versionCode: number;
  buildNumber: number;
}

const GITHUB_REPO = "Swastikdan/plexy";

/**
 * Gets currently installed version and build number from native PackageManager.
 */
export async function getInstalledAppInfo(): Promise<AppInfo> {
  if (Platform.OS === "android") {
    try {
      if (NativeModules.PlexyLanModule?.getAppInfo) {
        const info = await NativeModules.PlexyLanModule.getAppInfo();
        if (info && typeof info.buildNumber === "number") {
          return {
            versionName: String(info.versionName || "1.0.2"),
            versionCode: Number(info.versionCode || 50028),
            buildNumber: Number(info.buildNumber || 28),
          };
        }
      }
    } catch {}
  }
  return { versionName: "1.0.2", versionCode: 50028, buildNumber: 28 };
}

/**
 * Checks GitHub for the latest release containing the target APK that is newer than current build.
 */
export async function checkForUpdate(
  isTv: boolean,
  currentBuild?: number,
): Promise<UpdateInfo | null> {
  const targetApk = isTv ? "plexy-tv-preview.apk" : "plexy-mobile-preview.apk";
  const appInfo = currentBuild ? { buildNumber: currentBuild } : await getInstalledAppInfo();

  const res = await fetch(`https://api.github.com/repos/${GITHUB_REPO}/releases`, {
    headers: {
      Accept: "application/vnd.github.v3+json",
      "User-Agent": "Plexy-App",
    },
  });

  if (!res.ok) {
    throw new Error(`GitHub update check failed (HTTP ${res.status})`);
  }

  const releases: GitHubRelease[] = await res.json();
  if (!Array.isArray(releases) || releases.length === 0) {
    return null;
  }

  // Find the first release that has the required APK asset and is newer
  for (const release of releases) {
    const asset = release.assets?.find((a) => a.name === targetApk);
    if (asset) {
      const match = release.tag_name.match(/build\.(\d+)/i);
      const releaseBuildNumber = match ? parseInt(match[1], 10) : 0;

      // If installed build is already >= release build number, there is no newer update
      if (appInfo.buildNumber && releaseBuildNumber > 0 && releaseBuildNumber <= appInfo.buildNumber) {
        return null;
      }

      return {
        tagName: release.tag_name,
        releaseName: release.name || release.tag_name,
        releaseNotes: release.body || "",
        publishedAt: release.published_at,
        apkUrl: asset.browser_download_url,
        apkName: asset.name,
        apkSize: asset.size,
        buildNumber: releaseBuildNumber,
      };
    }
  }

  return null;
}

/**
 * Opens Android system settings allowing Plexy to install APK updates.
 */
export async function openUnknownAppsSettings(): Promise<void> {
  if (Platform.OS === "android") {
    try {
      await IntentLauncher.startActivityAsync("android.settings.MANAGE_UNKNOWN_APP_SOURCES", {
        data: `package:${Platform.isTV ? "app.plexy.tv" : "app.plexy.mobile"}`,
      });
    } catch {
      await IntentLauncher.startActivityAsync("android.settings.SECURITY_SETTINGS");
    }
  }
}

/**
 * Downloads the APK file to cache and triggers Android package installer.
 */
export async function downloadAndInstallUpdate(
  update: UpdateInfo,
  onProgress?: (percent: number) => void,
): Promise<void> {
  if (Platform.OS !== "android") {
    throw new Error("In-app updates are only supported on Android devices.");
  }

  const sanitizedTag = update.tagName.replace(/[^a-zA-Z0-9.-]/g, "_");
  const localFileName = `update_${sanitizedTag}_${update.apkName}`;
  const localUri = `${FileSystem.cacheDirectory}${localFileName}`;

  // Notify starting
  onProgress?.(1);

  // Check if already downloaded
  const info = await FileSystem.getInfoAsync(localUri);
  if (!info.exists || (info.size && info.size !== update.apkSize)) {
    if (info.exists) {
      await FileSystem.deleteAsync(localUri, { idempotent: true }).catch(() => {});
    }

    // Download with progress callback
    const downloadResumable = FileSystem.createDownloadResumable(
      update.apkUrl,
      localUri,
      {},
      (progress) => {
        const total =
          progress.totalBytesExpectedToWrite > 0
            ? progress.totalBytesExpectedToWrite
            : update.apkSize;
        if (total > 0) {
          const ratio = progress.totalBytesWritten / total;
          onProgress?.(Math.min(99, Math.round(ratio * 100)));
        }
      },
    );

    const result = await downloadResumable.downloadAsync();
    if (!result || !result.uri) {
      throw new Error("Failed to download APK package.");
    }
  }

  onProgress?.(100);

  // Try native module installer first
  if (NativeModules.PlexyLanModule?.installApk) {
    try {
      await NativeModules.PlexyLanModule.installApk(localUri);
      return;
    } catch (err) {
      console.warn("PlexyLanModule.installApk fallback to IntentLauncher:", err);
    }
  }

  // Convert file:// uri to content:// uri using FileProvider
  const contentUri = await FileSystem.getContentUriAsync(localUri);

  // Launch Android package installer intent
  // 1 = FLAG_GRANT_READ_URI_PERMISSION, 268435456 = FLAG_ACTIVITY_NEW_TASK, 67108864 = FLAG_ACTIVITY_CLEAR_TOP
  await IntentLauncher.startActivityAsync("android.intent.action.VIEW", {
    data: contentUri,
    flags: 1 | 268435456 | 67108864,
    type: "application/vnd.android.package-archive",
  });
}
