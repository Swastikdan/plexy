import { Pressable,StyleSheet,Text } from "react-native";
import { colors,control,fonts } from "../../../shared/theme";

export function ReportAction({
  label,
  onPress,
  disabled = false,
  subtle = false,
}: {
  label: string;
  onPress: () => void;
  disabled?: boolean;
  subtle?: boolean;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [
        s.action,
        subtle && s.subtle,
        disabled && { opacity: 0.45 },
        pressed && { opacity: 0.7 },
      ]}
    >
      <Text style={[s.actionText, subtle && { color: colors.ink }]}>
        {label}
      </Text>
    </Pressable>
  );
}

const s = StyleSheet.create({
action: {
    minHeight: 44,
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderRadius: control.radius,
    backgroundColor: colors.brand,
    alignItems: "center",
    justifyContent: "center",
  },
subtle: { backgroundColor: colors.elevated },
actionText: { fontSize: 13, fontFamily: fonts.medium, color: colors.ink }
});
