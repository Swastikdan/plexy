import { Tabs,usePathname } from "expo-router";
import React,{ useEffect,useRef,useState } from "react";
import { Animated,Pressable,View } from "react-native";
import {
SafeAreaView,
useSafeAreaInsets,
} from "react-native-safe-area-context";
import { useClient } from "@/core/client/client-provider";
import { LibraryAttention } from "@/features/catalog/components/library-attention";
import { useReducedMotion } from "@/shared/hooks/use-reduced-motion";
import { triggerHaptic } from "@/shared/lib/haptics";
import { useColors } from "@/shared/theme";
import { Home, Library, Search, Settings, type NativeIcon } from "@/shared/ui/icons";
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
// One tab icon: presses dip it toward the finger, selection springs it back.
// Feedback lives on the press itself and animates from the current value, so
// rapid tab-hopping never snaps.
function TabIcon({
  icon: Icon,
  focused,
  filled,
}: {
  icon: NativeIcon;
  focused: boolean;
  filled: boolean;
}) {
  const colors = useColors();
  const reduceMotion = useReducedMotion();
  const scale = useRef(new Animated.Value(1)).current;
  const wasFocused = useRef(focused);
  useEffect(() => {
    if (wasFocused.current === focused) return;
    wasFocused.current = focused;
    if (!focused || reduceMotion) return;
    // Start from a slight press-in so the pop reads as the icon settling up.
    scale.setValue(0.88);
    Animated.spring(scale, {
      toValue: 1,
      bounciness: 7,
      speed: 18,
      useNativeDriver: true, // transform only — runs off the main thread
    }).start();
  }, [focused, reduceMotion, scale]);
  return (
    <Animated.View style={{ transform: [{ scale }] }}>
      <Icon
        size={29}
        color={focused ? colors.ink : colors.quiet}
        strokeWidth={focused ? 2.2 : 1.8}
        fill={filled ? (focused ? colors.ink : colors.quiet) : "none"}
      />
    </Animated.View>
  );
}
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
      className="flex-row bg-background items-center justify-around pt-1 px-3"
      style={{
        paddingBottom: bottomPadding,
        height: 64 + bottomPadding,
      }}
    >
      {tabs.map((tab, index) => {
        const isFocused = state.index === index;
        const route = state.routes[index];
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
            key={tab.name}
            onPress={onPress}
            // Scale toward the finger on touch-down, not opacity — keeps
            // the icon present while answering the touch instantly.
            className="flex-1 min-h-[56px] items-center justify-center active:scale-[0.88] active:opacity-80"
            accessibilityRole="tab"
            accessibilityState={{ selected: isFocused }}
            accessibilityLabel={tab.title}
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
  const colors = useColors();
  const isHome = usePathname() === "/";
  const { runtime } = useClient();
  const [attention, setAttention] = useState(0);
  useEffect(() => {
    const update = () => setAttention(runtime.getAttentionCount());
    update();
    return runtime.subscribe(update);
  }, [runtime]);
  return (
    <SafeAreaView
      edges={isHome ? ["left", "right"] : ["top", "left", "right"]}
      style={{ flex: 1, backgroundColor: colors.canvas }}
    >
      {!isHome && <LibraryAttention />}
      <Tabs
        backBehavior="initialRoute"
        tabBar={(props) => <MobileTabBar {...props} attention={attention} />}
        screenOptions={{
          headerShown: false,
          sceneStyle: { backgroundColor: colors.canvas },
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

