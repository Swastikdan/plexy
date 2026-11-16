import { useEffect, useState } from "react";
import { Animated, Text, View } from "react-native";
import { RotateCcw, RotateCw } from "@/shared/ui/icons";

/**
 * YouTube-style seek feedback: a circular arrow and the running total on the
 * side that was tapped. The parent keeps the latest value mounted for the
 * duration of the seek burst.
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
      className="absolute items-center"
      style={{
        top: "42%",
        ...(forward ? { right: "12%" } : { left: "12%" }),
        opacity,
        transform: [{ scale }],
      }}
    >
      <View className="h-[86px] w-[86px] items-center justify-center rounded-full border border-white/20 bg-black/55">
        {forward ? (
          <RotateCw size={28} color="#ffffff" strokeWidth={2} />
        ) : (
          <RotateCcw size={28} color="#ffffff" strokeWidth={2} />
        )}
        <Text className="mt-1 text-[18px] font-archivo-bold text-white">
          {forward ? "+" : ""}
          {total}
        </Text>
      </View>
      <Text className="mt-1.5 text-[10px] font-archivo-medium text-white/70">
        seconds
      </Text>
    </Animated.View>
  );
}
