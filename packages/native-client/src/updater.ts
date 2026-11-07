import * as FileSystem from "expo-file-system/legacy";
import * as IntentLauncher from "expo-intent-launcher";
import { Platform } from "react-native";

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
}

const GITHUB_REPO = "Swastikdan/plexy";

/**
 * Checks GitHub for the latest release containing the target APK.
 */
export async function checkForUpdate(isTv: boolean): Promise<UpdateInfo | null> {
  const targetApk = isTv ? "plexy-tv-preview.apk" : "plexy-mobile-preview.apk";

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

  // Find the first release that has the required APK asset
  for (const release of releases) {
    const asset = release.assets?.find((a) => a.name === targetApk);
    if (asset) {
      return {
        tagName: release.tag_name,
        releaseName: release.name || release.tag_name,
        releaseNotes: release.body || "",
        publishedAt: release.published_at,
        apkUrl: asset.browser_download_url,
        apkName: asset.name,
        apkSize: asset.size,
      };
    }
  }

  return null;
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

  // Check if already downloaded
  const info = await FileSystem.getInfoAsync(localUri);
  if (!info.exists || (info.size && info.size !== update.apkSize)) {
    // Download with progress callback
    const downloadResumable = FileSystem.createDownloadResumable(
      update.apkUrl,
      localUri,
      {},
      (progress) => {
        if (progress.totalBytesExpectedToWrite > 0) {
          const ratio = progress.totalBytesWritten / progress.totalBytesExpectedToWrite;
          onProgress?.(Math.min(100, Math.round(ratio * 100)));
        }
      },
    );

    const result = await downloadResumable.downloadAsync();
    if (!result || !result.uri) {
      throw new Error("Failed to download APK package.");
    }
  } else {
    onProgress?.(100);
  }

  // Convert file:// uri to content:// uri using FileProvider
  const contentUri = await FileSystem.getContentUriAsync(localUri);

  // Launch Android package installer intent
  // 1 = FLAG_GRANT_READ_URI_PERMISSION, 268435456 (0x10000000) = FLAG_ACTIVITY_NEW_TASK
  await IntentLauncher.startActivityAsync("android.intent.action.VIEW", {
    data: contentUri,
    flags: 1 | 268435456,
    type: "application/vnd.android.package-archive",
  });
}
