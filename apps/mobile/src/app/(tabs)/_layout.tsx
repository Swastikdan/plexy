import { OnboardingScreen } from "@/features/onboarding/onboarding-screen";
import { Tabs } from "expo-router";
import React, { useEffect, useState } from "react";
import { Pressable, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useClient } from "@/core/client/client-provider";
import { triggerHaptic } from "@/shared/lib/haptics";
import { useColors } from "@/shared/theme";
import {
  Home,
  Library,
  Search,
  Settings,
  type NativeIcon,
} from "@/shared/ui/icons";
const tabs: {
  name: string;
  title: string;
  icon: NativeIcon;
}[] = [
  { name: "index", title: "Home", icon: Home },
  { name: "libraries", title: "Libraries", icon: Library },
  { name: "search", title: "Search", icon: Search },
  { name: "settings", title: "Settings", icon: Settings },
];
type TabBarProps = Parameters<
  NonNullable<React.ComponentProps<typeof Tabs>["tabBar"]>
>[0];
// Selection is immediate: frequent tab changes should never wait for motion.
function TabIcon({ icon: Icon, focused, filled }: {
  icon: NativeIcon; focused: boolean; filled: boolean;
}) {
  const colors = useColors();
  return <Icon
    size={29}
    color={focused ? colors.ink : colors.quiet}
    strokeWidth={focused ? 2.2 : 1.8}
    fill={filled ? colors.ink : "none"}
  />;
}
function MobileTabBar({
  state,
  navigation,
  attention,
}: Pick<TabBarProps, "state" | "navigation"> & {
  attention: number;
}) {
  const insets = useSafeAreaInsets();
  const bottomPadding = Math.max(insets.bottom, 10);
  return (
    <View
      className="flex-row bg-background items-center justify-around pt-1 px-3"
      style={{
        paddingBottom: bottomPadding,
        height: 64 + bottomPadding,
      }}
    >
      {state.routes.map((route, index) => {
        const tab = tabs.find((entry) => entry.name === route.name);
        if (!tab) return null;
        const isFocused = state.index === index;
        const onPress = () => {
          // Tab switches are the most frequent deliberate input — a
          // selection tick, not an impact, matches their lightness.
          triggerHaptic("selection");
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
            key={route.key}
            onPress={onPress}
            className="flex-1 min-h-[56px] items-center justify-center active:opacity-80"
            accessibilityRole="tab"
            accessibilityState={{ selected: isFocused }}
            accessibilityLabel={tab.title}
            testID={`tab-${tab.name === "index" ? "home" : tab.name}`}
          >
            <View className="w-12 h-12 items-center justify-center">
              <TabIcon
                icon={tab.icon}
                focused={isFocused}
                filled={isFocused && tab.name === "index"}
              />
              {tab.name === "settings" && attention > 0 && (
                <View className="absolute bottom-0 w-[5px] h-[5px] rounded-[3px] bg-warning" />
              )}
            </View>
          </Pressable>
        );
      })}
    </View>
  );
}
export default function TabLayout() {
  const { runtime, preferences } = useClient();
  const [attention, setAttention] = useState(0);
  useEffect(() => {
    const update = () => setAttention(runtime.getAttentionCount());
    update();
    return runtime.subscribe(update);
  }, [runtime]);
  if (!preferences.onboardingCompleted) return <OnboardingScreen />;
  return (
    <Tabs
      // Android back follows the tab visit history, so Library → Settings →
      // back returns to Library instead of resetting to Home.
      backBehavior="history"
      tabBar={(props) => (
        <MobileTabBar
          state={props.state}
          navigation={props.navigation}
          attention={preferences.mode === "online" ? 0 : attention}
        />
      )}
      screenOptions={{
        headerShown: false,
        animation: "none",
        sceneStyle: { backgroundColor: "transparent" },
        // Keep visited tabs mounted; their lists, scroll positions and network
        // state must survive a tab switch and an Android back press.
        freezeOnBlur: false,
      }}
    >
      {tabs.map((tab) => (
        <Tabs.Screen
          key={tab.name}
          name={tab.name}
          options={{ title: tab.title, popToTopOnBlur: tab.name === "settings" }}
        />
      ))}
    </Tabs>
  );
}
