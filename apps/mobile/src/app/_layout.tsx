import { UpdateProvider } from "@/features/updates/update-provider";
import { AppDialogProvider } from "@/shared/ui/app-dialog";
import { Stack } from "expo-router";
import { HeroUINativeProvider } from "heroui-native/provider";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { useReducedMotion } from "@/shared/hooks/use-reduced-motion";
import { useColors } from "@/shared/theme";
import "../../global.css";
import { MobileProvider } from "@/core/mobile-provider";
import { RemoteProvider } from "@/features/remote/remote-provider";
export const unstable_settings = { initialRouteName: "(tabs)" };
export default function RootLayout() {
  const colors = useColors();
  const reducedMotion = useReducedMotion();
  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <MobileProvider>
        <HeroUINativeProvider>
          <AppDialogProvider>
          <UpdateProvider>
          <RemoteProvider>
          <Stack
            screenOptions={{
              headerShown: false,
              animation: reducedMotion ? "fade" : "default",
              contentStyle: { backgroundColor: colors.canvas },
            }}
          >
            <Stack.Screen name="(tabs)" />
            <Stack.Screen name="item/[id]" />
            <Stack.Screen name="remote/[media-type]/[tmdb-id]" />
            <Stack.Screen
              name="player/[file-id]"
              options={{ animation: "none", gestureEnabled: false, contentStyle: { backgroundColor: "#000" } }}
            />
            <Stack.Screen name="external-player" options={{ animation: "none", gestureEnabled: false, contentStyle: { backgroundColor: "#000" } }} />
            <Stack.Screen
              name="player/remote"
              options={{ animation: "none", gestureEnabled: false, contentStyle: { backgroundColor: "#000" } }}
            />
          </Stack>
          </RemoteProvider>
          </UpdateProvider>
          </AppDialogProvider>
        </HeroUINativeProvider>
      </MobileProvider>
    </GestureHandlerRootView>
  );
}
