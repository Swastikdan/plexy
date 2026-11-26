import { UpdateProvider } from "@/features/updates/update-provider";
import { AppDialogProvider } from "@/shared/ui/app-dialog";
import { Stack } from "expo-router";
import { HeroUINativeProvider } from "heroui-native/provider";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { useReducedMotion } from "@/shared/hooks/use-reduced-motion";
import { useColors } from "@/shared/theme";
import { immersiveTransition, pushTransition } from "@/shared/navigation/transitions";
import "@/global.css";
import { MobileProvider } from "@/core/mobile-provider";
import { RemoteProvider } from "@/features/remote/remote-provider";
export const unstable_settings = { initialRouteName: "(tabs)" };
export default function RootLayout() {
  const colors = useColors();
  const reducedMotion = useReducedMotion();
  return (
    <GestureHandlerRootView className="flex-1">
      <MobileProvider>
        <HeroUINativeProvider>
          <AppDialogProvider>
          <UpdateProvider>
          <RemoteProvider>
          <Stack
            screenOptions={pushTransition(reducedMotion, colors.canvas)}
          >
            <Stack.Screen name="(tabs)" />
            <Stack.Screen name="item/[id]" />
            <Stack.Screen name="remote/[media-type]/[tmdb-id]" />
            <Stack.Screen name="player/[file-id]" options={immersiveTransition} />
            <Stack.Screen
              name="external-player"
              options={{ ...immersiveTransition, contentStyle: { backgroundColor: colors.canvas } }}
            />
            <Stack.Screen name="player/remote" options={immersiveTransition} />
          </Stack>
          </RemoteProvider>
          </UpdateProvider>
          </AppDialogProvider>
        </HeroUINativeProvider>
      </MobileProvider>
    </GestureHandlerRootView>
  );
}
