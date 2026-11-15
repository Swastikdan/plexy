import { encodeVersionCode } from "../../apps/mobile/src/shared/lib/build-version";
import { compareSemver } from "../../apps/mobile/src/features/settings/lib/update-policy";
import { isVersion } from "../../apps/mobile/src/features/settings/lib/mobile-update-manifest";

export function nextMobileVersion(previous: string, bump: string = "patch", explicit?: string) {
  if (!isVersion(previous)) throw Error("Mobile builds require a stable major.minor.patch version.");
  const [major, minor, patch] = previous.split(".").map(Number) as [number, number, number];
  // Push-triggered Actions runs provide empty strings for manual inputs.
  const increment = bump || "patch";
  const next = explicit || (increment === "major" ? `${major + 1}.0.0` : increment === "minor" ? `${major}.${minor + 1}.0` : increment === "patch" ? `${major}.${minor}.${patch + 1}` : "");
  if (!isVersion(next) || compareSemver(next, previous) <= 0) throw Error("The mobile version must increase.");
  mobileVersionCode(next);
  return next;
}
export function mobileVersionCode(version: string) {
  if (!isVersion(version)) throw Error("Invalid mobile version.");
  const [major, minor, patch] = version.split(".").map(Number) as [number, number, number];
  if (major < 1 || minor > 99 || patch > 99) throw Error("Mobile version components exceed Android version-code ranges. Bump minor or major instead.");
  const code = encodeVersionCode(2000, version);
  if (!Number.isSafeInteger(code) || code > 2_100_000_000) throw Error("Mobile version exceeds the Android version-code limit.");
  return code;
}
