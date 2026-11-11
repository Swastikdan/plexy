import React, { useEffect, useState } from "react";
import { SafeAreaView } from "react-native-safe-area-context";
import { LibraryAttention } from "../../components/LibraryAttention";
import { Tabs } from "expo-router";
import { Icon, type IconName } from "../../components/ui";
import { localRuntime } from "../../lib/local";
const tabs: { name: string; title: string; icon: IconName }[] = [
  { name: "index", title: "Home", icon: "home" },
  { name: "libraries", title: "Libraries", icon: "library" },
  { name: "search", title: "Search", icon: "search" },
  { name: "settings", title: "Settings", icon: "settings" },
];
export default function TabLayout() {
  const [attention, setAttention] = useState(0);
  useEffect(() => {
    const update = () => setAttention(localRuntime.getAttentionCount?.() ?? 0);
    update();
    return localRuntime.subscribe?.(update);
  }, []);
  return <SafeAreaView edges={["top", "left", "right"]} style={{ flex: 1 }}><LibraryAttention /><Tabs backBehavior="initialRoute" screenOptions={{ headerShown: false, sceneStyle: { backgroundColor: "#000" }, tabBarStyle: { backgroundColor: "#000", borderTopColor: "#222" }, tabBarActiveTintColor: "#fff", tabBarInactiveTintColor: "#666" }}>
    {tabs.map(tab => <Tabs.Screen key={tab.name} name={tab.name} options={{ title: tab.title, tabBarBadge: tab.name === "settings" && attention ? attention : undefined, tabBarIcon: ({ color }) => <Icon name={tab.icon} color={String(color)} size={24} /> }} />)}
  </Tabs></SafeAreaView>;
}
