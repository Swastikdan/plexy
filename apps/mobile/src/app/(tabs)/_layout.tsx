import { Tabs } from "expo-router";
import React, { useEffect, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import {
  SafeAreaView,
  useSafeAreaInsets,
} from "react-native-safe-area-context";
import { LibraryAttention } from "../../components/LibraryAttention";
import { Icon, type IconName } from "../../components/ui";
import { localRuntime } from "../../lib/local";
import { fonts } from "../../ui/theme";
const tabs: {
  name: string;
  title: string;
  icon: IconName;
}[] = [
  { name: "index", title: "Home", icon: "home" },
  { name: "libraries", title: "Libraries", icon: "library" },
  { name: "search", title: "Search", icon: "search" },
  { name: "settings", title: "Settings", icon: "settings" },
];
type TabBarProps = Parameters<
  NonNullable<React.ComponentProps<typeof Tabs>["tabBar"]>
>[0];
function MobileTabBar({
  state,
  navigation,
  attention,
}: TabBarProps & {
  attention: number;
}) {
  const insets = useSafeAreaInsets();
  const bottomPadding = Math.max(insets.bottom, 10);
  return (
    <View
      style={[
        styles.tabBar,
        {
          paddingBottom: bottomPadding,
          height: 86 + bottomPadding,
        },
      ]}
    >
      {tabs.map((tab, index) => {
        const isFocused = state.index === index;
        const route = state.routes[index];
        const onPress = () => {
          const event = navigation.emit({
            type: "tabPress",
            target: route.key,
            canPreventDefault: true,
          });
          if (!isFocused && !event.defaultPrevented) {
            navigation.navigate(route.name);
          }
        };
        return (
          <Pressable
            key={tab.name}
            onPress={onPress}
            hitSlop={{ top: 16, bottom: 16, left: 12, right: 12 }}
            style={({ pressed }) => [
              styles.tabItem,
              pressed && { opacity: 0.7, transform: [{ scale: 0.94 }] },
            ]}
            accessibilityRole="tab"
            accessibilityState={{ selected: isFocused }}
            accessibilityLabel={tab.title}
          >
            <View
              style={[
                styles.tabIconWrap,
                isFocused && styles.tabIconWrapActive,
              ]}
            >
              <Icon
                name={tab.icon}
                size={24}
                color={isFocused ? "#000000" : "rgba(255, 255, 255, 0.45)"}
              />
              {tab.name === "settings" && attention > 0 && (
                <View style={styles.tabBadgeDot} />
              )}
            </View>
            <Text
              style={[
                styles.tabLabel,
                {
                  color: isFocused ? "#ffffff" : "rgba(255, 255, 255, 0.45)",
                  fontFamily: isFocused ? fonts.bold : fonts.medium,
                },
              ]}
            >
              {tab.title}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}
export default function TabLayout() {
  const [attention, setAttention] = useState(0);
  useEffect(() => {
    const update = () => setAttention(localRuntime.getAttentionCount?.() ?? 0);
    update();
    return localRuntime.subscribe?.(update);
  }, []);
  return (
    <SafeAreaView
      edges={["top", "left", "right"]}
      style={{ flex: 1, backgroundColor: "#000000" }}
    >
      <LibraryAttention />
      <Tabs
        backBehavior="initialRoute"
        tabBar={(props) => <MobileTabBar {...props} attention={attention} />}
        screenOptions={{
          headerShown: false,
          sceneStyle: { backgroundColor: "#000000" },
        }}
      >
        {tabs.map((tab) => (
          <Tabs.Screen
            key={tab.name}
            name={tab.name}
            options={{ title: tab.title }}
          />
        ))}
      </Tabs>
    </SafeAreaView>
  );
}
const styles = StyleSheet.create({
  tabBar: {
    flexDirection: "row",
    backgroundColor: "#000000",
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: "rgba(255, 255, 255, 0.12)",
    alignItems: "center",
    justifyContent: "space-around",
    paddingTop: 10,
    paddingHorizontal: 8,
  },
  tabItem: {
    flex: 1,
    minWidth: 68,
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 4,
    borderRadius: 24,
    overflow: "hidden",
    gap: 4,
  },
  tabIconWrap: {
    minWidth: 68,
    height: 40,
    paddingHorizontal: 16,
    paddingVertical: 6,
    borderRadius: 9999,
    overflow: "hidden",
    alignItems: "center",
    justifyContent: "center",
    position: "relative",
  },
  tabIconWrapActive: {
    backgroundColor: "#ffffff",
    borderRadius: 9999,
    overflow: "hidden",
  },
  tabBadgeDot: {
    position: "absolute",
    top: 4,
    right: 4,
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: "#f59e0b",
    borderWidth: 1.5,
    borderColor: "#000000",
  },
  tabLabel: {
    fontSize: 12,
    letterSpacing: 0.15,
    textAlign: "center",
  },
});
