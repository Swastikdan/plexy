import { useEffect, useState } from "react";
import { Animated, Text } from "react-native";

/**
 * YouTube-style seek feedback: just the running total on the side that was
 * tapped. The parent keeps the latest value mounted for the seek burst.
 */
export function SeekSideOverlay({ seconds }: { seconds: number }) {
  const [opacity] = useState(() => new Animated.Value(0));
  const [scale] = useState(() => new Animated.Value(0.9));
  useEffect(() => {
    Animated.parallel([
      Animated.timing(opacity, {
        toValue: 1,
        duration: 120,
        useNativeDriver: true,
      }),
      Animated.spring(scale, {
        toValue: 1,
        speed: 22,
        bounciness: 5,
        useNativeDriver: true,
      }),
    ]).start();
    return () => {
      opacity.stopAnimation();
      scale.stopAnimation();
    };
  }, [opacity, scale]);
  const forward = seconds > 0;
  const total = Math.round(seconds);
  return (
    <Animated.View
      pointerEvents="none"
      className="absolute"
      style={{
        top: "42%",
        ...(forward ? { right: "12%" } : { left: "12%" }),
        opacity,
        transform: [{ scale }],
      }}
    >
      <Text
        className="font-archivo-black text-[40px] leading-[44px] text-white"
        style={{
          textShadowColor: "rgba(0,0,0,0.65)",
          textShadowOffset: { width: 0, height: 2 },
          textShadowRadius: 10,
        }}
      >
        {Math.abs(total)}
      </Text>
    </Animated.View>
  );
}
