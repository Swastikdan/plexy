import type { GitHubRelease,UpdateInfo } from "./app-updater";
export type UpdateTarget = "mobile";
/** Matches both the versioned assets (`Plexy-mobile-1.2.3-build.42.apk`) and
 * the legacy stable names (`plexy-mobile-preview.apk`). */
export function matchesTargetAsset(name: string, target: UpdateTarget) {
  const lower = name.toLowerCase();
  return lower.startsWith(`plexy-${target}-`) && lower.endsWith(".apk");
}
export function parseSemver(v: string): [number, number, number, number] {
  const clean = v.replace(/^v/i, "").trim();
  const [core, pre] = clean.split("-");
  const [major = 0, minor = 0, patch = 0] = (core || "")
    .split(".")
    .map((n) => parseInt(n, 10) || 0);
  let preRank = 1;
  let preNum = 0;
  if (pre && !pre.startsWith("build.")) {
    preRank = 0;
    const match = pre.match(/(\d+)/);
    if (match) preNum = parseInt(match[1], 10) || 0;
  }
  return [major, minor, patch, preRank * 1000 + preNum];
}
export function compareSemver(a: string, b: string): number {
  const [aMaj, aMin, aPat, aPre] = parseSemver(a);
  const [bMaj, bMin, bPat, bPre] = parseSemver(b);
  if (aMaj !== bMaj) return aMaj - bMaj;
  if (aMin !== bMin) return aMin - bMin;
  if (aPat !== bPat) return aPat - bPat;
  return aPre - bPre;
}
export function selectUpdate(
  releases: GitHubRelease[],
  target: UpdateTarget,
  current: number,
  currentVersion?: string,
): UpdateInfo | null {
  const candidates = releases.flatMap((release) => {
    const asset = release.assets?.find((a) =>
      matchesTargetAsset(a.name, target),
    );
    const build = Number(
      release.tag_name.match(/build\.(\d+)(?:$|[^\d])/i)?.[1],
    );
    if (!asset || !Number.isSafeInteger(build)) return [];
    const isNewerBuild = build > current;
    let isNewerVersion = false;
    if (currentVersion) {
      const tagVerMatch = release.tag_name.match(
        /^v?(\d+\.\d+\.\d+(?:-[a-zA-Z0-9.]+)?)/,
      );
      if (tagVerMatch) {
        isNewerVersion = compareSemver(tagVerMatch[1], currentVersion) > 0;
      }
    }
    if (!isNewerBuild && !isNewerVersion) return [];
    return [
      {
        tagName: release.tag_name,
        releaseName: release.name || release.tag_name,
        releaseNotes: release.body || "",
        publishedAt: release.published_at,
        apkUrl: asset.browser_download_url,
        apkName: asset.name,
        apkSize: asset.size,
        buildNumber: build,
      },
    ];
  });
  return (
    candidates.sort((a, b) => (b.buildNumber ?? 0) - (a.buildNumber ?? 0))[0] ||
    null
  );
}
