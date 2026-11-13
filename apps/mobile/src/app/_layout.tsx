import { Stack } from "expo-router";
import { HeroUINativeProvider } from "heroui-native/provider";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { useColors } from "@/shared/theme";
import "../../global.css";
import { MobileProvider } from "@/core/mobile-provider";
export const unstable_settings = { initialRouteName: "(tabs)" };
export default function RootLayout() {
  const colors = useColors();
  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <MobileProvider>
        <HeroUINativeProvider>
          <Stack
            screenOptions={{
              headerShown: false,
              contentStyle: { backgroundColor: colors.canvas },
            }}
          >
            <Stack.Screen name="(tabs)" />
            <Stack.Screen name="item/[id]" />
            <Stack.Screen
              name="player/[file-id]"
              options={{ animation: "none", gestureEnabled: false }}
            />
          </Stack>
        </HeroUINativeProvider>
      </MobileProvider>
    </GestureHandlerRootView>
  );
}
