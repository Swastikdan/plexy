/// Android version codes.
///
/// Legacy previews used `50000 + build`. That made ordering depend on whichever
/// counter (local build state vs CI run number) happened to be higher, so a
/// 1.0.7 CI APK could outrank a 1.0.8 local build.
///
/// Codes are now semver-dominant, with the 2000-based build number in the last
/// four digits:
///
///   major * 100_000_000 + minor * 1_000_000 + patch * 10_000 + (build - 2000)
///
/// 1.0.8 build 2054 -> 100_080_054, which is above every legacy 1.0.7 code and
/// below any 1.0.9. Reading old codes still works so in-place update checks do
/// not break for already-installed builds.
const ANDROID_VERSION_PREFIX = 50_000;
const SEMVER_SCHEME_FLOOR = 50_000_000;
const BUILD_FLOOR = 2000;
const BUILD_SPAN = 10_000;

function parseVersion(version: string): [number, number, number] {
  const [core] = version.replace(/^v/i, "").trim().split("-");
  const [major = 0, minor = 0, patch = 0] = (core || "")
    .split(".")
    .map((part) => parseInt(part, 10) || 0);
  return [major, minor, patch];
}

export const encodeVersionCode = (buildNumber: number, version?: string) => {
  // Without a semver the caller is asking for the legacy encoding (tests and
  // old scripts keep working).
  if (!version) return ANDROID_VERSION_PREFIX + buildNumber;
  const [major, minor, patch] = parseVersion(version);
  const build = Math.min(
    BUILD_SPAN - 1,
    Math.max(0, Math.floor(buildNumber) - BUILD_FLOOR),
  );
  return major * 100_000_000 + minor * 1_000_000 + patch * 10_000 + build;
};

export const decodeVersionCode = (versionCode: number) => {
  if (versionCode >= SEMVER_SCHEME_FLOOR) {
    return (versionCode % BUILD_SPAN) + BUILD_FLOOR;
  }
  return versionCode >= ANDROID_VERSION_PREFIX
    ? versionCode - ANDROID_VERSION_PREFIX
    : versionCode;
};
