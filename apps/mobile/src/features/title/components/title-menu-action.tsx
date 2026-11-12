import { Pressable,Text } from "react-native";
import { colors,control,fonts } from "../../../shared/theme";
import type { NativeIcon } from "../../../shared/ui/icons";
export function TitleMenuAction({
  label,
  icon: Icon,
  onPress,
  destructive = false,
}: {
  label: string;
  icon: NativeIcon;
  onPress: () => void;
  destructive?: boolean;
}) {
  const color = destructive ? colors.danger : colors.ink;
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      style={({ pressed }) => ({
        flexDirection: "row",
        alignItems: "center",
        gap: 12,
        minHeight: 48,
        paddingHorizontal: 12,
        borderRadius: control.radius,
        backgroundColor: pressed ? colors.hover : "transparent",
      })}
    >
      <Icon size={20} color={color} />
      <Text style={{ color, fontFamily: fonts.medium, fontSize: 15 }}>
        {label}
      </Text>
    </Pressable>
  );
}
