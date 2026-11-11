import { Tabs, usePathname } from "expo-router";
import React, { useEffect, useRef, useState } from "react";
import { Animated, Easing, Pressable, StyleSheet, Text, View } from "react-native";
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
  const tabScales = useRef(tabs.map(() => new Animated.Value(1))).current;
  const tabActiveOpacities = useRef(
    tabs.map((_, i) => new Animated.Value(i === state.index ? 1 : 0)),
  ).current;

  useEffect(() => {
    tabs.forEach((_, i) => {
      Animated.timing(tabActiveOpacities[i], {
        toValue: state.index === i ? 1 : 0,
        duration: 150,
        easing: Easing.bezier(0.23, 1, 0.32, 1),
        useNativeDriver: true,
      }).start();
    });
  }, [state.index]);

  const handlePressIn = (i: number) => {
    Animated.spring(tabScales[i]!, {
      toValue: 0.90,
      useNativeDriver: true,
      damping: 20,
      stiffness: 400,
      mass: 0.8,
    }).start();
  };
  const handlePressOut = (i: number) => {
    Animated.spring(tabScales[i]!, {
      toValue: 1,
      useNativeDriver: true,
      damping: 18,
      stiffness: 350,
      mass: 0.8,
    }).start();
  };
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
            onPressIn={() => handlePressIn(index)}
            onPressOut={() => handlePressOut(index)}
            hitSlop={{ top: 16, bottom: 16, left: 12, right: 12 }}
            style={styles.tabItem}
            accessibilityRole="tab"
            accessibilityState={{ selected: isFocused }}
            accessibilityLabel={tab.title}
          >
            <Animated.View
              style={[
                styles.tabIconWrap,
                { transform: [{ scale: tabScales[index]! }] },
              ]}
            >
              {/* Animated pill background — fades in/out instead of switching */}
              <Animated.View
                style={[
                  styles.tabIconWrapActive,
                  StyleSheet.absoluteFill,
                  { opacity: tabActiveOpacities[index]!, borderRadius: 9999 },
                ]}
              />
              <Icon
                name={tab.icon}
                size={24}
                color={isFocused ? "#000000" : "rgba(255, 255, 255, 0.45)"}
              />
              {tab.name === "settings" && attention > 0 && (
                <View style={styles.tabBadgeDot} />
              )}
            </Animated.View>
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
  const isHome = usePathname() === "/";
  const [attention, setAttention] = useState(0);
  useEffect(() => {
    const update = () => setAttention(localRuntime.getAttentionCount?.() ?? 0);
    update();
    return localRuntime.subscribe?.(update);
  }, []);
  return (
    <SafeAreaView
      edges={isHome ? ["left", "right"] : ["top", "left", "right"]}
      style={{ flex: 1, backgroundColor: "#000000" }}
    >
      {!isHome && <LibraryAttention />}
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
