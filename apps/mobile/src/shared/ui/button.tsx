import { forwardRef } from "react";
import type { StyleProp, View, ViewStyle } from "react-native";
import { Button as NativeButton } from "heroui-native/button";
import { triggerHaptic } from "@/shared/lib/haptics";
import { cn } from "@/shared/lib/cn";
import { Icon, IconName } from "./icon";

/**
 * App button built on the HeroUI Native Button so press feedback (scale +
 * highlight), reduce-motion handling and theme tokens come from the library
 * instead of hand-rolled styles. Metrics keep the app's pill shape.
 */
export const Button = forwardRef<
  View,
  {
    label: string;
    icon?: IconName;
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
    icon,
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
        // Every button press is a commit — confirm it with a light tap.
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
      {icon && <Icon name={icon} size={compact ? 18 : 20} color="#fff" />}
      {!compact && (
        <NativeButton.Label className="text-[15px] font-archivo-medium text-white">
          {label}
        </NativeButton.Label>
      )}
    </NativeButton>
  );
});
