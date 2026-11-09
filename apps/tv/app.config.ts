import type { ExpoConfig } from "expo/config";
const config: ExpoConfig = {
  name: "Plexy TV",
  slug: "plexy-tv",
  version: "1.0.2",
  platforms: ["android"],
  scheme: "plexy-tv",
  userInterfaceStyle: "dark",
  icon: "../../build/icon.png",
  backgroundColor: "#080808",
  orientation: "landscape",
  splash: {
    image: "./assets/splashscreen.png",
    resizeMode: "contain",
    backgroundColor: "#080808",
  },
  extra: {
    buildNumber: Number(process.env.GITHUB_RUN_NUMBER || 1),
  },
  android: {
    package: "app.plexy.tv",
    versionCode: 50000 + Number(process.env.GITHUB_RUN_NUMBER || 1),
    allowBackup: false,
    blockedPermissions: [
      "android.permission.READ_EXTERNAL_STORAGE",
      "android.permission.WRITE_EXTERNAL_STORAGE",
      "android.permission.SYSTEM_ALERT_WINDOW",
    ],
  },
  plugins: [
    [
      "expo-video",
      { supportsPictureInPicture: false, supportsBackgroundPlayback: false },
    ],
    "expo-secure-store",
    "expo-font",
    "../../scripts/native/with-network-security.cjs",
    "../../scripts/native/with-lan-networking.cjs",
    "../../scripts/native/with-shared-build-inputs.cjs",
    [
      "@react-native-tvos/config-tv",
      {
        isTV: true,
        androidTVRequired: true,
        androidTVBanner: "./assets/tv-banner.png",
        androidTVIcon: "../../build/icon.png",
      },
    ],
  ],
};
export default config;
