import type { ExpoConfig } from "expo/config";
import { encodeVersionCode } from "./src/shared/lib/build-version.ts";
import packageInfo from "./package.json";
const version = process.env.PLEXY_MOBILE_VERSION || packageInfo.version;
const projectId = process.env.PLEXY_EXPO_PROJECT_ID;
const runtimeVersion = process.env.PLEXY_ANDROID_RUNTIME;
const updateChannel = process.env.PLEXY_EXPO_UPDATE_CHANNEL || "production";
const tmdbToken =
  process.env.EXPO_PUBLIC_TMDB_TOKEN ||
  process.env.TMDB_TOKEN ||
  process.env.TMDB_ACCESS_TOKEN ||
  process.env.VITE_PUBLIC_TMDB_ACCESS_TOKEN ||
  "";
if (process.env.EAS_BUILD === "true" && !tmdbToken.trim()) {
  throw new Error(
    "EAS builds require TMDB_TOKEN or EXPO_PUBLIC_TMDB_TOKEN in their build environment.",
  );
}
const config: ExpoConfig = {
  name: "Plexy",
  slug: "plexy-mobile",
  version,
  platforms: ["android"],
  experiments: { reactCompiler: true },
  scheme: "plexy-mobile",
  userInterfaceStyle: "automatic",
  icon: "../../build/icon.png",
  backgroundColor: "#f5f5f5",
  orientation: "default",
  ...(projectId ? {
    runtimeVersion,
    updates: {
      url: `https://u.expo.dev/${projectId}`,
      requestHeaders: { "expo-channel-name": updateChannel },
      checkAutomatically: "NEVER" as const,
    },
  } : { updates: { enabled: false } }),
  android: {
    package: "app.plexy.mobile",
    versionCode: encodeVersionCode(2000, version),
    allowBackup: false,
    permissions: ["android.permission.REQUEST_INSTALL_PACKAGES"],
    adaptiveIcon: {
      foregroundImage: "../../build/icon.png",
      backgroundColor: "#080808",
      monochromeImage: "./assets/adaptive-monochrome.png",
    },
    blockedPermissions: [
      "android.permission.READ_EXTERNAL_STORAGE",
      "android.permission.WRITE_EXTERNAL_STORAGE",
      "android.permission.SYSTEM_ALERT_WINDOW",
    ],
  },
  extra: {
    tmdbToken,
    ...(projectId ? { eas: { projectId } } : {}),
  },
  plugins: [
    "expo-router",
    "../../scripts/native/with-shared-build-inputs.cjs",
    "../../scripts/native/with-open-source-licenses.cjs",
    "../../scripts/native/with-gradle-jvmargs.cjs",
    "expo-sqlite",
    [
      "expo-splash-screen",
      {
        image: "./assets/splash-icon.png",
        backgroundColor: "#f5f5f5",
        dark: { backgroundColor: "#060607" },
        imageWidth: 132,
      },
    ],
    [
      "expo-video",
      { supportsPictureInPicture: true, supportsBackgroundPlayback: false },
    ],
    "expo-secure-store",
    "expo-font",
    "expo-screen-orientation",
  ],
};
export default config;
