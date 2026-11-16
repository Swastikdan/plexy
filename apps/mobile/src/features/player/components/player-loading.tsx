import { View } from "react-native";
import { Spinner } from "@/shared/ui/spinner";

/** The player uses only a circular spinner while media is opening or buffering. */
export function PlayerLoading() {
  return (
    <View
      className="absolute inset-0 items-center justify-center"
      pointerEvents="none"
    >
      <Spinner
        size="lg"
        color="#ffffff"
        accessibilityLabel="Loading video"
      />
    </View>
  );
}
