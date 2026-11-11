import type { GitHubRelease, UpdateInfo } from "./updater";

export type UpdateTarget = "mobile" | "tv";

/** Matches both the versioned assets (`Plexy-mobile-1.2.3-build.42.apk`) and
 * the legacy stable names (`plexy-mobile-preview.apk`). */
export function matchesTargetAsset(name: string, target: UpdateTarget) {
  const lower = name.toLowerCase();
  return lower.startsWith(`plexy-${target}-`) && lower.endsWith(".apk");
}

/** Only releases with a comparable build and the requested platform asset qualify. */
export function selectUpdate(releases: GitHubRelease[], target: UpdateTarget, current: number): UpdateInfo | null {
  const candidates = releases.flatMap(release => {
    const asset = release.assets?.find(a => matchesTargetAsset(a.name, target));
    const build = Number(release.tag_name.match(/build\.(\d+)(?:$|[^\d])/i)?.[1]);
    if (!asset || !Number.isSafeInteger(build) || build <= current) return [];
    return [{ tagName: release.tag_name, releaseName: release.name || release.tag_name,
      releaseNotes: release.body || "", publishedAt: release.published_at,
      apkUrl: asset.browser_download_url, apkName: asset.name, apkSize: asset.size, buildNumber: build }];
  });
  return candidates.sort((a, b) => b.buildNumber - a.buildNumber)[0] || null;
}
