import { Switch as NativeSwitch } from "heroui-native/switch";
import { triggerHaptic } from "../lib/haptics";

/**
 * App toggle built on the HeroUI Native Switch so the thumb/track animation,
 * reduce-motion handling and theme colors come from the library.
 */
export function ToggleSwitch({
  value,
  onValueChange,
  disabled,
  accessibilityLabel,
}: {
  value: boolean;
  onValueChange: (value: boolean) => void;
  disabled?: boolean;
  accessibilityLabel?: string;
}) {
  return (
    <NativeSwitch
      isSelected={value}
      isDisabled={disabled}
      accessibilityLabel={accessibilityLabel}
      onSelectedChange={(next) => {
        // The state flip is the commit; a selection tick matches it 1:1.
        triggerHaptic("selection");
        onValueChange(next);
      }}
    />
  );
}
