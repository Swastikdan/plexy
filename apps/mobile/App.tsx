import React from "react";
import { View } from "react-native";
import { localRuntime } from "./local";
import { NativeApp, type NativePlatform } from "@plexy/native-client";
const platform: NativePlatform = {
  tv: false,
  local: localRuntime,
  RemoteEvents: () => null,
  FocusGroup: ({ children, style }) => <View style={style}>{children}</View>,
};
export default function App() {
  return <NativeApp platform={platform} />;
}
