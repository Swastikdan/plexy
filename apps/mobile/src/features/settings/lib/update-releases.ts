import type { GitHubRelease } from "./app-updater";

const RELEASES_URL = "https://api.github.com/repos/Swastikdan/plexy/releases";

/** Releases may contain only desktop/server assets, so inspect multiple pages. */
export async function fetchUpdateReleases(request: typeof fetch = fetch): Promise<GitHubRelease[]> {
  const releases: GitHubRelease[] = [];
  for (let page = 1; page <= 10; page++) {
    const response = await request(`${RELEASES_URL}?per_page=100&page=${page}`, {
      headers: {
        Accept: "application/vnd.github+json",
        "User-Agent": "Plexy-App",
        "Cache-Control": "no-cache",
      },
    });
    if (!response.ok) throw new Error(`GitHub update check failed (HTTP ${response.status})`);
    const batch: GitHubRelease[] = await response.json();
    if (!Array.isArray(batch)) throw new Error("GitHub returned an invalid release list. Please retry.");
    releases.push(...batch);
    if (!batch.length || !/rel="next"/.test(response.headers.get("link") || "")) break;
  }
  return releases;
}
