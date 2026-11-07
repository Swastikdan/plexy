import React from "react";
import { TVFocusGuideView, useTVEventHandler } from "react-native";
import { NativeApp, type NativePlatform } from "@plexy/native-client";
function RemoteEvents({ onEvent }: { onEvent: (event: string) => void }) {
  useTVEventHandler((event) => {
    if (event.eventKeyAction === 1) return;
    onEvent(event.eventType);
  });
  return null;
}
const platform: NativePlatform = {
  tv: true,
  RemoteEvents,
  FocusGroup: ({ children, style }) => (
    <TVFocusGuideView autoFocus style={style}>
      {children}
    </TVFocusGuideView>
  ),
};
export default function App() {
  return <NativeApp platform={platform} />;
}
