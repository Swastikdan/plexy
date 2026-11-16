import { useColors } from "@/shared/theme";
import { useReducedMotion } from "@/shared/hooks/use-reduced-motion";
import React, { useEffect } from "react";
import { View, type ViewStyle } from "react-native";
import Animated, {
  cancelAnimation,
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withSequence,
  withTiming,
  type SharedValue,
} from "react-native-reanimated";

const LEAVES = Array.from({ length: 8 }, (_, index) => ({
  angle: index * 45,
  phase: (7 - index) / 8,
}));

const SIZES = { sm: 16, md: 24, lg: 32 } as const;

export type SpinnerSize = keyof typeof SIZES;

/**
 * Eight-leaf activity spinner matching the HeroUI web spinner. It runs on the
 * UI thread, so it keeps moving while lists and network requests are busy.
 */
export function Spinner({
  size = "sm",
  color,
  loading = true,
  style,
  accessibilityLabel = "Loading",
}: {
  size?: SpinnerSize;
  color?: string;
  loading?: boolean;
  style?: ViewStyle;
  accessibilityLabel?: string;
}) {
  const colors = useColors();
  const reduceMotion = useReducedMotion();
  const clock = useSharedValue(0);
  const pixels = SIZES[size];

  useEffect(() => {
    cancelAnimation(clock);
    clock.set(0);
    if (reduceMotion) return;
    clock.set(
      withRepeat(
        withSequence(
          withTiming(1, { duration: 800, easing: Easing.linear }),
          withTiming(0, { duration: 0 }),
        ),
        -1,
        false,
      ),
    );
    return () => cancelAnimation(clock);
  }, [clock, reduceMotion]);

  if (!loading) return null;

  return (
    <View
      accessibilityRole="progressbar"
      accessibilityLabel={accessibilityLabel}
      style={[
        { width: pixels, height: pixels, position: "relative" },
        style,
      ]}
    >
      {LEAVES.map((leaf) => (
        <SpinnerLeaf
          key={leaf.angle}
          angle={leaf.angle}
          phase={leaf.phase}
          clock={clock}
          color={color ?? colors.ink}
          reduceMotion={reduceMotion}
        />
      ))}
    </View>
  );
}

function SpinnerLeaf({
  angle,
  phase,
  clock,
  color,
  reduceMotion,
}: {
  angle: number;
  phase: number;
  clock: SharedValue<number>;
  color: string;
  reduceMotion: boolean;
}) {
  const animatedStyle = useAnimatedStyle(() => {
    if (reduceMotion) return { opacity: 0.65 };
    const progress = clock.get();
    const value = (progress + phase) % 1;
    return { opacity: 1 - value * 0.85 };
  }, [reduceMotion, phase]);

  return (
    <View
      pointerEvents="none"
      style={{
        position: "absolute",
        top: 0,
        left: "43.75%",
        width: "12.5%",
        height: "100%",
        transform: [{ rotate: `${angle}deg` }],
      }}
    >
      <Animated.View
        style={[
          {
            width: "100%",
            height: "30%",
            borderRadius: 999,
            backgroundColor: color,
          },
          animatedStyle,
        ]}
      />
    </View>
  );
}
