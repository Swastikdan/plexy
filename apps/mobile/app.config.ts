import type { ExpoConfig } from "expo/config";
const receiverAppId = process.env.PLEXY_CAST_RECEIVER_ID || "";
const castReceiverEnabled =
  /^[A-Fa-f0-9]{8}$/.test(receiverAppId) && receiverAppId !== "CC1AD845";
const config: ExpoConfig = {
  name: "Plexy",
  slug: "plexy-mobile",
  version: "1.0.2",
  platforms: ["android"],
  scheme: "plexy-mobile",
  userInterfaceStyle: "dark",
  icon: "../../build/icon.png",
  backgroundColor: "#080808",
  orientation: "default",
  android: {
    package: "app.plexy.mobile",
    versionCode: process.env.GITHUB_RUN_NUMBER ? 1000 + Number(process.env.GITHUB_RUN_NUMBER) : 2000,
    allowBackup: false,
    adaptiveIcon: {
      foregroundImage: "../../build/icon.png",
      backgroundColor: "#080808",
      monochromeImage: "../../build/icon.png",
    },
    blockedPermissions: [
      "android.permission.READ_EXTERNAL_STORAGE",
      "android.permission.WRITE_EXTERNAL_STORAGE",
      "android.permission.SYSTEM_ALERT_WINDOW",
    ],
  },
  extra: { castReceiverEnabled },
  plugins: [
    [
      "react-native-google-cast",
      {
        receiverAppId: castReceiverEnabled ? receiverAppId : "CC1AD845",
        androidPlayServicesCastFrameworkVersion: "22.3.1",
      },
    ],
    [
      "expo-video",
      { supportsPictureInPicture: true, supportsBackgroundPlayback: false },
    ],
    "expo-secure-store",
    "expo-font",
    "../../scripts/native/with-network-security.cjs",
    "../../scripts/native/with-lan-networking.cjs",
    "../../scripts/native/with-shared-build-inputs.cjs",
    "expo-screen-orientation",
  ],
};
export default config;
