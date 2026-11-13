import { ActivityIndicator,View } from "react-native";

/** The player uses only a circular spinner while media is opening or buffering. */
export function PlayerLoading() {
  return (
    <View className="absolute inset-0 items-center justify-center" pointerEvents="none">
      <ActivityIndicator
        size="large"
        color="#fff"
        accessibilityLabel="Loading video"
      />
    </View>
  );
}
