import React from "react";
import { Stack } from "expo-router";
import { MobileProvider } from "../providers/MobileProvider";
export const unstable_settings = { initialRouteName: "(tabs)" };
export default function RootLayout() {
  return <MobileProvider><Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: "#000" } }}>
    <Stack.Screen name="(tabs)" />
    <Stack.Screen name="item/[id]" />
    <Stack.Screen name="player/[fileId]" options={{ animation: "none", gestureEnabled: false }} />
    <Stack.Screen name="downloads" />
  </Stack></MobileProvider>;
}
