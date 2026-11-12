import { useEffect,useRef } from "react";
import { Animated,Pressable } from "react-native";
import { useReducedMotion } from "../hooks/use-reduced-motion";
import { triggerHaptic } from "../lib/haptics";

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
  const reduceMotion = useReducedMotion();
  const anim = useRef(new Animated.Value(value ? 1 : 0)).current;
  useEffect(() => {
    if (reduceMotion) {
      anim.setValue(value ? 1 : 0);
      return;
    }
    // Spring, not timing: the thumb overshoots a touch so the switch feels
    // physical, and re-targets from the current value when toggled mid-flight.
    Animated.spring(anim, {
      toValue: value ? 1 : 0,
      bounciness: 7,
      speed: 20,
      useNativeDriver: false,
    }).start();
  }, [value, anim, reduceMotion]);
  const translateX = anim.interpolate({
    inputRange: [0, 1],
    outputRange: [2, 20],
  });
  const backgroundColor = anim.interpolate({
    inputRange: [0, 1],
    outputRange: ["rgba(255, 255, 255, 0.16)", "#ffffff"],
  });
  const thumbColor = anim.interpolate({
    inputRange: [0, 1],
    outputRange: ["#a1a1aa", "#000000"],
  });
  return (
    <Pressable
      accessibilityRole="switch"
      accessibilityState={{ checked: value, disabled }}
      accessibilityLabel={accessibilityLabel}
      disabled={disabled}
      onPress={() => {
        // The state flip is the commit; a selection tick matches it 1:1.
        if (!disabled) triggerHaptic("selection");
        onValueChange(!value);
      }}
      style={({ pressed }) => [
        {
          opacity: disabled ? 0.4 : pressed ? 0.8 : 1,
        },
      ]}
    >
      <Animated.View
        style={{
          width: 44,
          height: 26,
          borderRadius: 13,
          backgroundColor,
          justifyContent: "center",
          borderWidth: 1,
          borderColor: value
            ? "rgba(255, 255, 255, 0.8)"
            : "rgba(255, 255, 255, 0.12)",
        }}
      >
        <Animated.View
          style={{
            width: 20,
            height: 20,
            borderRadius: 10,
            backgroundColor: thumbColor,
            transform: [{ translateX }],
            shadowColor: "#000",
            shadowOffset: { width: 0, height: 1 },
            shadowOpacity: 0.3,
            shadowRadius: 2,
            elevation: 2,
          }}
        />
      </Animated.View>
    </Pressable>
  );
}
