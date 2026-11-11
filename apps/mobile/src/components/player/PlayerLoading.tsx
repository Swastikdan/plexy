import { ActivityIndicator, StyleSheet, View } from "react-native";

/** The player uses only a circular spinner while media is opening or buffering. */
export function PlayerLoading() {
  return (
    <View style={styles.overlay} pointerEvents="none">
      <ActivityIndicator
        size="large"
        color="#ffffff"
        accessibilityLabel="Loading video"
      />
    </View>
  );
}
const styles = StyleSheet.create({
  overlay: {
    ...StyleSheet.absoluteFill,
    alignItems: "center",
    justifyContent: "center",
  },
});
