import type { ExpoConfig } from "expo/config";
import { encodeVersionCode } from "./src/shared/lib/build-version.ts";
import packageInfo from "./package.json";
const rawBuild = Number(
  process.env.PLEXY_BUILD_NUMBER || process.env.GITHUB_RUN_NUMBER || 1,
);
const buildNumber = rawBuild < 2000 ? 2000 + rawBuild : rawBuild;
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
  version: packageInfo.version,
  platforms: ["android"],
  experiments: { reactCompiler: true },
  scheme: "plexy-mobile",
  userInterfaceStyle: "automatic",
  icon: "../../build/icon.png",
  backgroundColor: "#f5f5f5",
  orientation: "default",
  android: {
    package: "app.plexy.mobile",
    versionCode: encodeVersionCode(buildNumber),
    allowBackup: false,
    permissions: ["android.permission.REQUEST_INSTALL_PACKAGES"],
    adaptiveIcon: {
      foregroundImage: "../../build/icon.png",
      backgroundColor: "#f5f5f5",
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
    buildNumber,
  },
  plugins: [
    "expo-router",
    "../../scripts/native/with-shared-build-inputs.cjs",
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
