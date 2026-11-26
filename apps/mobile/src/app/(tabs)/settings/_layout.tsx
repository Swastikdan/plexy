import { Stack } from "expo-router";
import { useReducedMotion } from "@/shared/hooks/use-reduced-motion";
import { pushTransition } from "@/shared/navigation/transitions";
import { useColors } from "@/shared/theme";
import { SafeAreaView } from "@/shared/ui/safe-area-view";

export const unstable_settings = { initialRouteName: "index" };
export default function SettingsLayout() {
  const colors = useColors();
  const reducedMotion = useReducedMotion();
  return (
    <SafeAreaView
      edges={["top", "left", "right"]}
      className="flex-1 bg-background"
    >
      {/* Same push as the root stack, so a settings page and a title page
          enter the same way. */}
      <Stack screenOptions={pushTransition(reducedMotion, colors.canvas)} />
    </SafeAreaView>
  );
}
