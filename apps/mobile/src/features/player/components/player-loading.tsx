import { useColors } from "@/shared/theme";
import { ActivityIndicator,View } from "react-native";

/** The player uses only a circular spinner while media is opening or buffering. */
export function PlayerLoading() {
  const colors = useColors();
  return (
    <View className="absolute inset-0 items-center justify-center" pointerEvents="none">
      <ActivityIndicator
        size="large"
        color={colors.ink}
        accessibilityLabel="Loading video"
      />
    </View>
  );
}
