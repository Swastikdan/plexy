import { Button as NativeButton } from "heroui-native/button";
import React from "react";
import { View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { control } from "@/shared/theme";
import { Play } from "@/shared/ui/icons";

/**
 * The fixed bottom action bar used by a title screen: one primary pill with
 * the play glyph and label, plus an optional secondary icon control.
 * Local and online titles share it so their actions never drift apart.
 */
export function TitleActionBar({
  label,
  accessibilityLabel,
  disabled,
  onPress,
  secondary,
}: {
  label: string;
  accessibilityLabel?: string;
  disabled?: boolean;
  onPress: () => void;
  secondary?: React.ReactNode;
}) {
  const insets = useSafeAreaInsets();
  return (
    <View
      className="absolute bottom-0 left-0 right-0 flex-row gap-3 border-t border-t-border bg-background px-5 pt-3"
      style={{ paddingBottom: Math.max(insets.bottom, 14) }}
    >
      <NativeButton
        className="flex-1 justify-center rounded-full bg-accent px-5"
        style={{ height: control.height, minHeight: control.height }}
        size="lg"
        accessibilityLabel={accessibilityLabel ?? label}
        isDisabled={disabled}
        onPress={onPress}
      >
        <Play size={22} color="#fff" fill="#fff" />
        <View style={{ alignItems: "center", flexShrink: 1 }}>
          <NativeButton.Label className="text-white">{label}</NativeButton.Label>
        </View>
      </NativeButton>
      {secondary}
    </View>
  );
}
