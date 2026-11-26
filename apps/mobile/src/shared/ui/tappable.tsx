import React, { useState } from "react";
import {
  Pressable,
  type PressableProps,
  type StyleProp,
  type ViewStyle,
} from "react-native";
import Animated, { cubicBezier, useReducedMotion } from "react-native-reanimated";
import { triggerHaptic } from "@/shared/lib/haptics";
import { cn } from "@/shared/lib/cn";
import { motion } from "@/shared/theme";

const AnimatedPressable = Animated.createAnimatedComponent(Pressable);
const EASE_OUT = cubicBezier(...motion.easeOut);

/**
 * How a surface answers a touch. Pick by what the surface is, not by taste:
 * - scale: artwork cards and tiles — a 0.97 press-in that springs back.
 * - highlight: full-width list rows — the row background tints.
 * - opacity: icons, text links and small controls.
 * - none: the child draws its own pressed state.
 */
export type PressFeedback = "scale" | "highlight" | "opacity" | "none";

const FEEDBACK_CLASS: Record<PressFeedback, string> = {
  scale: "active:opacity-90",
  highlight: "active:bg-surface-hover",
  opacity: "active:opacity-70",
  none: "",
};

export type TappableProps = Omit<PressableProps, "style" | "children"> & {
  feedback?: PressFeedback;
  /** Haptic tick on press. Reserve it for deliberate actions, not every row. */
  haptic?: "light" | "medium" | "selection";
  className?: string;
  style?: StyleProp<ViewStyle>;
  children?: React.ReactNode;
};

/** The one pressable primitive, so every tap in the app feels the same. */
export function Tappable({
  feedback = "opacity",
  haptic,
  className,
  style,
  onPress,
  onPressIn,
  onPressOut,
  disabled,
  children,
  ...props
}: TappableProps) {
  const reducedMotion = useReducedMotion();
  const [pressed, setPressed] = useState(false);
  const scales = feedback === "scale" && !reducedMotion;
  return (
    <AnimatedPressable
      disabled={disabled}
      onPressIn={(event) => {
        if (scales) setPressed(true);
        onPressIn?.(event);
      }}
      onPressOut={(event) => {
        if (scales) setPressed(false);
        onPressOut?.(event);
      }}
      onPress={(event) => {
        if (haptic && !disabled) triggerHaptic(haptic);
        onPress?.(event);
      }}
      style={[
        scales && {
          transform: [{ scale: pressed ? 0.97 : 1 }],
          transitionProperty: "transform",
          transitionDuration: motion.duration.fast,
          transitionTimingFunction: EASE_OUT,
        },
        style,
      ]}
      className={cn(FEEDBACK_CLASS[feedback], className)}
      {...props}
    >
      {children}
    </AnimatedPressable>
  );
}
