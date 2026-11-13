import { LinearGradient } from "expo-linear-gradient";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useColors, withAlpha } from "@/shared/theme";

export function TopFade() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  return (
    <LinearGradient
      pointerEvents="none"
      colors={[withAlpha(colors.canvas, 0.88), withAlpha(colors.canvas, 0.32), withAlpha(colors.canvas, 0)]}
      locations={[0, 0.35, 1]}
      style={{
        position: "absolute",
        top: 0,
        left: 0,
        right: 0,
        height: insets.top + 96,
        zIndex: 10,
      }}
    />
  );
}
