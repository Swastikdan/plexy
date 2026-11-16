import { fetchUpdateJson } from "./update-request";
import type { GitHubRelease } from "./app-updater";

const RELEASES_URL = "https://api.github.com/repos/Swastikdan/plexy/releases";

/** Releases may contain only desktop/server assets, so inspect multiple pages. */
export async function fetchUpdateReleases(request: typeof fetch = fetch, signal?: AbortSignal): Promise<GitHubRelease[]> {
  const releases: GitHubRelease[] = [];
  // Bound the entire legacy scan as well as each page, including standalone callers.
  const controller = new AbortController();
  const cancel = () => controller.abort();
  signal?.addEventListener("abort", cancel, { once: true });
  if (signal?.aborted) cancel();
  const deadline = setTimeout(cancel, 30_000);
  try {
    for (let page = 1; page <= 10; page++) {
      const response = await fetchUpdateJson(`${RELEASES_URL}?per_page=100&page=${page}`, {
        request, signal: controller.signal,
        headers: {
          Accept: "application/vnd.github+json",
          "User-Agent": "Plexy-App",
          "Cache-Control": "no-cache",
        },
      });
      if (response.status === 404) throw new Error(`GitHub update check failed (HTTP ${response.status})`);
      const batch = response.data as GitHubRelease[];
      if (!Array.isArray(batch)) throw new Error("GitHub returned an invalid release list. Please retry.");
      releases.push(...batch);
      if (!batch.length || !/rel="next"/.test(response.link || "")) break;
    }
    return releases;
  } catch (error) {
    if (controller.signal.aborted && !signal?.aborted) throw new Error("Update check timed out. Please retry.");
    throw error;
  } finally { clearTimeout(deadline); signal?.removeEventListener("abort", cancel); }
}
