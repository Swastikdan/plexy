import React from "react";
import { Pressable } from "react-native";
import { control } from "../../../shared/theme";

export function PlayerControl({
  onPress,
  size = 46,
  bg = "rgba(0,0,0,0.3)",
  children,
  disabled = false,
  active = false,
  activeBg = "#ffffff",
  accessibilityLabel,
}: {
  onPress: () => void;
  size?: number;
  bg?: string;
  children:
    React.ReactNode | ((props: { focused: boolean }) => React.ReactNode);
  disabled?: boolean;
  active?: boolean;
  activeBg?: string;
  focusId?: string;
  accessibilityLabel?: string;
}) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      disabled={disabled}
      hitSlop={12}
      style={({ pressed }) => ({
        width: size,
        height: size,
        borderRadius: control.radius,
        backgroundColor: active ? activeBg : bg,
        justifyContent: "center",
        alignItems: "center",
        opacity: disabled ? 0.4 : pressed ? 0.75 : 1,
      })}
    >
      {typeof children === "function" ? children({ focused: false }) : children}
    </Pressable>
  );
}
