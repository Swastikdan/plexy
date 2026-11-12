import { LinearGradient } from "expo-linear-gradient";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { colors } from "@/shared/theme";

export function TopFade() {
  const insets = useSafeAreaInsets();
  return (
    <LinearGradient
      pointerEvents="none"
      colors={[colors.canvas, "rgba(0,0,0,0.92)", "rgba(0,0,0,0)"]}
      locations={[0, 0.4, 1]}
      style={{
        position: "absolute",
        top: 0,
        left: 0,
        right: 0,
        height: insets.top + 112,
        zIndex: 10,
      }}
    />
  );
}
