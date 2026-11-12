import { StyleSheet,View } from "react-native";
import { colors } from "../theme";
import { Button } from "./button";
import { Label } from "./text";

export function Notice({
  message,
  retry,
  kind = "info",
}: {
  message: string;
  retry?: () => void;
  kind?: "info" | "error";
}) {
  return (
    <View accessibilityLiveRegion="polite" style={styles.notice}>
      <Label style={{ color: kind === "error" ? colors.danger : colors.ink }}>
        {message}
      </Label>
      {retry && <Button label="Retry" onPress={retry} />}
    </View>
  );
}

const styles = StyleSheet.create({
notice: {
    padding: 16,
    backgroundColor: colors.elevated,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.08)",
    gap: 14,
    marginVertical: 12,
  }
});
