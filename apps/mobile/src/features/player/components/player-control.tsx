import { triggerHaptic } from "@/shared/lib/haptics";
import React from "react";
import { Pressable } from "react-native";

export function PlayerControl({
  onPress,
  size = 48,
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
      onPress={() => { triggerHaptic("light"); onPress(); }}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      disabled={disabled}
      hitSlop={12}
      className="items-center justify-center rounded-full"
      style={({ pressed }) => ({
        width: Math.max(48, size),
        height: Math.max(48, size),
        backgroundColor: active ? activeBg : bg,
        opacity: disabled ? 0.4 : pressed ? 0.8 : 1,
        transform: [{ scale: pressed ? 0.92 : 1 }],
      })}
    >
      {typeof children === "function" ? children({ focused: false }) : children}
    </Pressable>
  );
}
