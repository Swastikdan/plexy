// Android releases reserve this prefix; legacy previews used the build directly.
const ANDROID_VERSION_PREFIX = 50000;
export const encodeVersionCode = (buildNumber: number) =>
  ANDROID_VERSION_PREFIX + buildNumber;
export const decodeVersionCode = (versionCode: number) =>
  versionCode >= ANDROID_VERSION_PREFIX
    ? versionCode - ANDROID_VERSION_PREFIX
    : versionCode;
