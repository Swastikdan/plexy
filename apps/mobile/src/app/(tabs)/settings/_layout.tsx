import { Stack } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";
import { useColors } from "@/shared/theme";

export const unstable_settings = { initialRouteName: "index" };
export default function SettingsLayout() {
  const colors = useColors();
  return (
    <SafeAreaView
      edges={["top", "left", "right"]}
      style={{ flex: 1, backgroundColor: colors.canvas }}
    >
      <Stack screenOptions={{ headerShown: false }} />
    </SafeAreaView>
  );
}
