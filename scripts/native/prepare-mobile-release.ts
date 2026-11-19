import { mkdir, readFile, writeFile, rm } from "node:fs/promises";
import { resolve } from "node:path";
import { compareSemver } from "../../apps/mobile/src/features/settings/lib/update-policy";
import { isVersion, MOBILE_POLICY_URL, parseMobileManifest, type MobileUpdateManifest, type UpdateType } from "../../apps/mobile/src/features/settings/lib/mobile-update-manifest";
import { mobileVersionCode, nextMobileVersion } from "./mobile-version";
import { github, listTagRefs, releaseCommit, reserveTag } from "../release-refs";

const projectRoot = resolve(import.meta.dir, "../..");
const repo = "Swastikdan/plexy";
interface Release { tag_name: string; assets?: { name: string }[] }
export interface PreparedMobileRelease {
  version: string; versionCode: number; updateType: UpdateType;
  minimumSupportedVersion: string; message: string; releaseNotes: string;
}
export async function prepareMobileRelease(options: {
  root?: string;
  request?: typeof fetch;
  reserve?: (args: string[]) => Promise<string>;
  env?: Record<string, string | undefined>;
} = {}): Promise<PreparedMobileRelease> {
  const root = options.root || projectRoot;
  const stateDir = resolve(root, ".build/native");
  const request = options.request || fetch;
  const reserve = options.reserve || github;
  const env = options.env || Bun.env;
  await mkdir(stateDir, { recursive: true });
  const lock = resolve(stateDir, "version.lock");
  try { await mkdir(lock); } catch { throw Error("Another mobile build is allocating a version. Remove .build/native/version.lock only if that build has stopped."); }
  try {
    const packageInfo = await Bun.file(resolve(root, "apps/mobile/package.json")).json();
    const config = await Bun.file(resolve(root, "apps/mobile/mobile-release.json")).json();
    const updateType = env.PLEXY_UPDATE_TYPE || config.updateType;
    if (!["optional", "feature", "necessary"].includes(updateType)) throw Error("Invalid mobile update type.");
    const headers: Record<string, string> = { Accept: "application/vnd.github+json" };
    if (env.GH_TOKEN) headers.Authorization = `Bearer ${env.GH_TOKEN}`;
    // Include draft reservations when authenticated, so failed builds never reuse a version.
    const releases: Release[] = [];
    for (let page = 1; page <= 10; page++) {
      let batch: Release[];
      if (!env.GH_TOKEN && !options.request) {
        // gh uses the developer's authenticated session and includes CI drafts.
        batch = JSON.parse(await reserve(["api", `repos/${repo}/releases?per_page=100&page=${page}`]));
      } else {
        const response = await request(`https://api.github.com/repos/${repo}/releases?per_page=100&page=${page}`, { headers, signal: AbortSignal.timeout(15_000) });
        if (!response.ok) throw Error(`Cannot allocate a mobile version (GitHub HTTP ${response.status}).`);
        batch = await response.json();
      }
      releases.push(...batch);
      if (batch.length < 100) break;
      if (page === 10) throw Error("Too many releases to safely allocate a mobile version.");
    }
    let previousPolicy: MobileUpdateManifest | null = null;
    const response = await request(MOBILE_POLICY_URL, { signal: AbortSignal.timeout(15_000), headers: { "Cache-Control": "no-cache" } });
    if (response.ok) previousPolicy = parseMobileManifest(await response.json());
    else if (response.status !== 404) throw Error("Cannot read the existing mandatory update cutoff.");
    let previous = packageInfo.version as string;
    if (previousPolicy && compareSemver(previousPolicy.latestVersion, previous) > 0) previous = previousPolicy.latestVersion;
    for (const release of releases) {
      const version = release.tag_name.match(/^mobile-v(\d+\.\d+\.\d+)$/)?.[1] || (release.assets?.some(asset => /^plexy-mobile-.*\.apk$/i.test(asset.name)) ? release.tag_name.match(/^v?(\d+\.\d+\.\d+)-build\./)?.[1] : undefined);
      if (version && compareSemver(version, previous) > 0) previous = version;
    }
    try {
      const local = (await readFile(resolve(stateDir, "mobile-version"), "utf8")).trim();
      if (isVersion(local) && compareSemver(local, previous) > 0) previous = local;
    } catch { /* No local release reservation yet. */ }
    const sha = env.GITHUB_SHA || await releaseCommit();
    let version = "";
    for (let attempt = 0; attempt < 10; attempt++) {
      for (const tag of await listTagRefs("mobile-build/", reserve)) {
        const reserved = tag.slice("mobile-build/".length);
        if (isVersion(reserved) && compareSemver(reserved, previous) > 0) previous = reserved;
      }
      const candidate = nextMobileVersion(previous, env.PLEXY_VERSION_BUMP, env.PLEXY_MOBILE_VERSION);
      if (await reserveTag(`mobile-build/${candidate}`, sha, reserve)) {
        version = candidate;
        break;
      }
      previous = candidate;
    }
    if (!version) throw Error("Could not reserve a mobile version after 10 concurrent allocations.");
    let minimumSupportedVersion = updateType === "necessary" ? version : config.minimumSupportedVersion || "1.0.0";
    if (previousPolicy && compareSemver(previousPolicy.minimumSupportedVersion, minimumSupportedVersion) > 0) minimumSupportedVersion = previousPolicy.minimumSupportedVersion;
    if (!isVersion(minimumSupportedVersion) || compareSemver(minimumSupportedVersion, version) > 0) throw Error("Invalid minimum supported mobile version.");
    await writeFile(resolve(stateDir, "mobile-version"), `${version}\n`);
    const prepared = { version, versionCode: mobileVersionCode(version), updateType, minimumSupportedVersion, message: String(config.message || "A new version of Plexy is available."), releaseNotes: String(config.releaseNotes || "") } as PreparedMobileRelease;
    await writeFile(resolve(stateDir, "mobile-release.json"), JSON.stringify(prepared, null, 2));
    return prepared;
  } finally { await rm(lock, { recursive: true, force: true }); }
}
