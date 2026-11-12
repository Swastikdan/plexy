import { forwardRef,useState } from "react";
import {
Pressable,
StyleSheet,
View,
type StyleProp,
type ViewStyle,
} from "react-native";
import { triggerHaptic } from "../lib/haptics";
import { colors,control,fonts } from "../theme";
import { Icon,IconName } from "./icon";
import { Label } from "./text";

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
    preferred?: boolean;
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
    preferred,
    style,
    onFocus,
    testID,
  },
  ref,
) {
  const [focused, setFocused] = useState(false);
  const isFilled = primary || selected;
  return (
    <Pressable
      ref={ref}
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled, selected }}
      disabled={disabled}
      onPress={() => {
        // Every button press is a commit — confirm it with a light tap.
        if (!disabled) triggerHaptic("light");
        onPress();
      }}
      onFocus={() => {
        setFocused(true);
        onFocus?.();
      }}
      onBlur={() => setFocused(false)}
      style={({ pressed }) => [
        styles.button,
        isFilled ? styles.buttonPrimary : styles.buttonSecondary,
        compact && styles.buttonCompact,
        focused && styles.buttonFocused,
        pressed && { opacity: 0.85, transform: [{ scale: 0.97 }] },
        disabled && { opacity: 0.4 },
        style,
      ]}
    >
      {icon && <Icon name={icon} size={compact ? 18 : 20} color="#fff" />}
      {!compact && (
        <Label
          style={{
            color: "#fff",
            fontFamily: fonts.medium,
            fontSize: 15,
          }}
        >
          {label}
        </Label>
      )}
    </Pressable>
  );
});

const styles = StyleSheet.create({
button: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 9,
    paddingVertical: 12,
    paddingHorizontal: 20,
    borderRadius: control.radius,
    minHeight: control.height,
  },
buttonPrimary: {
    backgroundColor: colors.brand,
    borderRadius: control.radius,
  },
buttonSecondary: {
    backgroundColor: "rgba(255,255,255,0.1)",
    borderRadius: control.radius,
  },
buttonCompact: {
    paddingVertical: 8,
    paddingHorizontal: 14,
    minHeight: 36,
  },
buttonFocused: {
    borderWidth: 2,
    borderColor: "#fff",
  }
});
