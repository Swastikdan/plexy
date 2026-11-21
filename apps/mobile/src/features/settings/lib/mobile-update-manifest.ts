import { encodeVersionCode } from "@/shared/lib/build-version";
import { compareSemver } from "./update-policy";
import type { UpdateInfo } from "./app-updater";
import { fetchUpdateJson } from "./update-request";

export type UpdateType = "optional" | "feature" | "necessary";
export const MOBILE_POLICY_URL = "https://github.com/Swastikdan/plexy/releases/download/mobile-latest/mobile-update.json";
const configuredOrigin = process.env.EXPO_PUBLIC_PLEXY_UPDATE_ORIGIN;
function mirrorOrigin(origin = configuredOrigin) {
  if (!origin) return undefined;
  try {
    const url = new URL(origin);
    if (url.protocol === "https:" && !url.username && !url.password && url.href === url.origin + "/") return url.origin;
  } catch { /* An invalid mirror setting should not block GitHub updates. */ }
}

export async function fetchMobilePolicy(signal?: AbortSignal, request: typeof fetch = fetch, origin = configuredOrigin) {
  try {
    const response = await fetchUpdateJson(MOBILE_POLICY_URL, { signal, request, timeoutMs: 8_000 });
    return response.status === 404 ? null : parseMobileManifest(response.data);
  } catch (error) {
    const mirror = mirrorOrigin(origin);
    if (!mirror || signal?.aborted) throw error;
    const response = await fetchUpdateJson(`${mirror}/android/mobile-update.json`, {
      signal, request, timeoutMs: 4_000, retries: 0,
    });
    return response.status === 404 ? null : parseMobileManifest(response.data);
  }
}

export interface MobileUpdateManifest {
  schemaVersion: 1;
  platform: "android";
  channel: "stable";
  latestVersion: string;
  versionCode: number;
  updateType: UpdateType;
  minimumSupportedVersion: string;
  title: string;
  message: string;
  releaseNotes: string;
  publishedAt: string;
  apkUrl: string;
  apkName: string;
  apkSize: number;
  sha256: string;
}
export const isVersion = (value: unknown): value is string => typeof value === "string" && /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(value);
export function parseMobileManifest(value: unknown): MobileUpdateManifest {
  if (!value || typeof value !== "object") throw Error("Invalid mobile update policy.");
  const data = value as MobileUpdateManifest;
  if (data.schemaVersion !== 1 || data.platform !== "android" || data.channel !== "stable" ||
      !isVersion(data.latestVersion) || !isVersion(data.minimumSupportedVersion) ||
      compareSemver(data.minimumSupportedVersion, data.latestVersion) > 0 ||
      !["optional", "feature", "necessary"].includes(data.updateType) ||
      !Number.isSafeInteger(data.versionCode) || data.versionCode <= 0 ||
      data.versionCode !== encodeVersionCode(2000, data.latestVersion) ||
      !Number.isFinite(Date.parse(data.publishedAt)) ||
      !Number.isSafeInteger(data.apkSize) || data.apkSize <= 0 ||
      typeof data.sha256 !== "string" || !/^[a-f0-9]{64}$/i.test(data.sha256) ||
      ![data.title, data.message, data.releaseNotes, data.publishedAt, data.apkName, data.apkUrl].every(v => typeof v === "string"))
    throw Error("Invalid mobile update policy.");
  const url = new URL(data.apkUrl);
  if (url.origin !== "https://github.com" || url.search || url.hash ||
      url.pathname !== `/Swastikdan/plexy/releases/download/mobile-v${data.latestVersion}/${data.apkName}` ||
      data.apkName !== `Plexy-mobile-v${data.latestVersion}-Android.apk`)
    throw Error("The mobile update asset is not trusted.");
  return data;
}
export function manifestUpdate(policy: MobileUpdateManifest, version: string, versionCode: number): UpdateInfo | null {
  if (compareSemver(policy.latestVersion, version) <= 0 || policy.versionCode <= versionCode) return null;
  const mirror = mirrorOrigin();
  return {
    mirrorApkUrl: mirror ? `${mirror}/android/${encodeURIComponent(policy.apkName)}` : undefined,
    tagName: `mobile-v${policy.latestVersion}`, releaseName: policy.title,
    releaseNotes: policy.releaseNotes || policy.message, publishedAt: policy.publishedAt,
    apkUrl: policy.apkUrl, apkName: policy.apkName, apkSize: policy.apkSize,
    version: policy.latestVersion, updateType: policy.updateType,
    minimumSupportedVersion: policy.minimumSupportedVersion, sha256: policy.sha256,
  };
}
export function isUpdateRequired(policy: Pick<MobileUpdateManifest, "minimumSupportedVersion">, installedVersion: string) {
  return compareSemver(installedVersion, policy.minimumSupportedVersion) < 0;
}
/** A later optional release cannot lower a previously known support cutoff. */
export function mergeMobilePolicy(previous: MobileUpdateManifest | null, incoming: MobileUpdateManifest): MobileUpdateManifest {
  if (!previous) return incoming;
  const latest = compareSemver(incoming.latestVersion, previous.latestVersion) >= 0 ? incoming : previous;
  const minimumSupportedVersion = compareSemver(incoming.minimumSupportedVersion, previous.minimumSupportedVersion) > 0
    ? incoming.minimumSupportedVersion : previous.minimumSupportedVersion;
  return { ...latest, minimumSupportedVersion };
}
