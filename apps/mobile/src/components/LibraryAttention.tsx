import React, { useEffect, useState } from "react";
import { Pressable, Text, View } from "react-native";
import { useRouter, useSegments } from "expo-router";
import { localRuntime } from "../lib/local";
import { Icon } from "./ui";
export function LibraryAttention() {
  const router = useRouter();
  const segments = useSegments();
  const [attention, setAttention] = useState({ count: 0, fingerprint: "" });
  const [dismissed, setDismissed] = useState<string | null>(null);
  useEffect(() => {
    const update = () => setAttention({ count: localRuntime.getAttentionCount?.() ?? 0, fingerprint: localRuntime.getAttentionFingerprint?.() ?? "" });
    update();
    return localRuntime.subscribe?.(update);
  }, []);
  if (!attention.count || attention.fingerprint === dismissed || segments.includes("settings")) return null;
  return <View style={{ flexDirection: "row", alignItems: "center", gap: 12, padding: 14, backgroundColor: "#30230d" }}>
    <Text style={{ flex: 1, color: "#fef3c7" }}>{attention.count} title{attention.count === 1 ? "" : "s"} need attention</Text>
    <Pressable accessibilityRole="button" onPress={() => router.navigate("/settings")}><Text style={{ color: "#f59e0b" }}>Review</Text></Pressable>
    <Pressable accessibilityRole="button" accessibilityLabel="Dismiss notice" hitSlop={10} onPress={() => setDismissed(attention.fingerprint)}><Icon name="close" color="#fff" size={16} /></Pressable>
  </View>;
}
