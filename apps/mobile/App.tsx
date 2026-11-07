import React from "react";
import { View } from "react-native";
import { CastControl } from "./CastControl";
import { NativeApp, type NativePlatform } from "@plexy/native-client";
const platform: NativePlatform = {
  tv: false,
  CastControl,
  RemoteEvents: () => null,
  FocusGroup: ({ children, style }) => <View style={style}>{children}</View>,
};
export default function App() {
  return <NativeApp platform={platform} />;
}
