import { forwardRef } from "react";
import type { StyleProp, View, ViewStyle } from "react-native";
import { Button as NativeButton } from "heroui-native/button";
import { triggerHaptic } from "@/shared/lib/haptics";
import { cn } from "@/shared/lib/cn";

export const Button = forwardRef<
  View,
  {
    label: string;
    onPress: () => void;
    primary?: boolean;
    selected?: boolean;
    disabled?: boolean;
    compact?: boolean;
    style?: StyleProp<ViewStyle>;
    onFocus?: () => void;
    testID?: string;
  }
>(function Button(
  {
    label,
    onPress,
    primary,
    selected,
    disabled,
    compact,
    style,
    onFocus,
    testID,
  },
  ref,
) {
  const isFilled = primary || selected;
  return (
    <NativeButton
      ref={ref}
      testID={testID}
      variant={isFilled ? "primary" : "secondary"}
      isDisabled={disabled}
      onPress={() => {
        if (!disabled) triggerHaptic("light");
        onPress();
      }}
      onFocus={onFocus}
      accessibilityLabel={label}
      accessibilityState={{ disabled, selected }}
      style={style}
      className={cn(
        "rounded-full",
        compact
          ? "min-h-[36px] px-3.5 py-2 gap-2"
          : "min-h-[52px] px-5 py-3 gap-[9px]",
        !isFilled && "bg-white/10",
        "focus:border-2 focus:border-white",
      )}
    >
      {!compact && (
        <NativeButton.Label className="text-[15px] font-archivo-medium text-white">
          {label}
        </NativeButton.Label>
      )}
    </NativeButton>
  );
});
