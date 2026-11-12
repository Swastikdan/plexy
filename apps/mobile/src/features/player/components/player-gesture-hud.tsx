import React, { useEffect,useRef } from "react";
import { Animated,View } from "react-native";
import { Sun,Volume2 } from "@/shared/ui/icons";

function EdgeIndicator({
  level,
  active,
  icon,
  side,
}: {
  level: number;
  active: boolean;
  icon: React.ReactNode;
  side: "left" | "right";
}) {
  const opacity = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    Animated.timing(opacity, {
      toValue: active ? 1 : 0,
      duration: 140,
      useNativeDriver: true,
    }).start();
  }, [active, opacity]);
  return (
    <Animated.View
      pointerEvents="none"
      className="absolute items-center gap-2.5"
      style={{
        opacity,
        left: side === "left" ? 14 : undefined,
        right: side === "right" ? 14 : undefined,
        top: "50%",
        transform: [{ translateY: -106 }],
      }}
    >
      {icon}
      {/* Vertical fill bar: 0 at the bottom, fills upward with the level. */}
      <View className="h-[180px] w-[5px] overflow-hidden rounded-full bg-white/25">
        <View
          className="absolute bottom-0 left-0 right-0 rounded-full bg-white"
          style={{ height: `${Math.round(level * 100)}%` }}
        />
      </View>
    </Animated.View>
  );
}

/**
 * Level indicators for the vertical-drag gestures — swiping up/down on the
 * left half of the video adjusts brightness, the right half adjusts volume.
 * Each bar hugs its screen edge and is only visible while that gesture is
 * in progress.
 */
export function PlayerGestureHud({
  brightness,
  volume,
  adjusting,
}: {
  brightness: number;
  volume: number;
  adjusting: "brightness" | "volume" | null;
}) {
  return (
    <>
      <EdgeIndicator
        level={brightness}
        active={adjusting === "brightness"}
        side="left"
        icon={<Sun size={16} color="#ffffff" />}
      />
      <EdgeIndicator
        level={volume}
        active={adjusting === "volume"}
        side="right"
        icon={<Volume2 size={16} color="#ffffff" />}
      />
    </>
  );
}
