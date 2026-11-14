import React, { useEffect, useRef, useState } from "react";
import { Animated, Pressable, Text, View } from "react-native";
import { easings, useColors, timeLabel } from "@/shared/theme";
import { useReducedMotion } from "@/shared/hooks/use-reduced-motion";

interface TimelineBarProps {
  duration: number;
  /** Scrub target while scrubbing, otherwise the current position. */
  value: number;
  buffered: number;
  scrubbing: boolean;
  onScrub: (time: number) => void;
  onCommit: (time: number) => void;
  seekStep: number;
  /** Distance from the bottom edge of the screen. */
  bottom: number;
}

/**
 * Horizontal timeline along the bottom of the landscape player: 0:00 on the
 * left, the played fill (accent) grows rightward, elapsed time at the left
 * end and episode duration (tap for remaining time) at the right end. Built on a plain responder View —
 * a Pressable here swallows the responder props and kills scrubbing.
 */
export function TimelineBar({
  duration,
  value,
  buffered,
  scrubbing,
  onScrub,
  onCommit,
  seekStep,
  bottom,
}: TimelineBarProps) {
  const colors = useColors();
  const reduceMotion = useReducedMotion();
  const emphasis = useRef(new Animated.Value(scrubbing ? 1 : 0)).current;
  useEffect(() => {
    const animation = Animated.timing(emphasis, {
      toValue: scrubbing ? 1 : 0,
      duration: reduceMotion ? 0 : 140,
      easing: easings.out,
      useNativeDriver: true,
    });
    animation.start();
    return () => animation.stop();
  }, [scrubbing, reduceMotion, emphasis]);
  const trackScale = emphasis.interpolate({
    inputRange: [0, 1],
    outputRange: [1, 1.5],
  });
  const thumbScale = emphasis.interpolate({
    inputRange: [0, 1],
    outputRange: [1, 4 / 3],
  });
  const width = useRef(1);
  const target = useRef(value);
  const [remaining, setRemaining] = useState(false);
  // locationX is relative to the track, so no measureInWindow round-trip.
  const atPosition = (x: number) => {
    target.current = timeAt(x);
    return target.current;
  };
  const ratio =
    duration > 0 ? Math.min(1, Math.max(0, value / duration)) : 0;
  const bufferedRatio =
    duration > 0 ? Math.min(1, Math.max(0, buffered / duration)) : 0;
  const timeAt = (x: number) =>
    Math.max(
      0,
      Math.min(
        duration || Number.MAX_SAFE_INTEGER,
        (x / width.current) * duration,
      ),
    );
  return (
    <View
      className="absolute left-6 right-6 flex-row items-center gap-3"
      style={{ bottom }}
      pointerEvents="box-none"
    >
      {/* Elapsed */}
      <Text className="w-[52px] text-[12px] font-archivo-medium text-white/85">
        {timeLabel(value)}
      </Text>
      {/* Track */}
      <View
        accessibilityLabel="Playback position"
        accessibilityRole="adjustable"
        accessibilityValue={{
          min: 0,
          max: duration,
          now: value,
          text: timeLabel(value),
        }}
        accessibilityActions={[{ name: "increment" }, { name: "decrement" }]}
        onAccessibilityAction={(e) =>
          onCommit(
            value +
              (e.nativeEvent.actionName === "increment"
                ? seekStep
                : -seekStep),
          )
        }
        onStartShouldSetResponder={() => true}
        onMoveShouldSetResponder={() => true}
        onResponderTerminationRequest={() => false}
        onResponderTerminate={() => onCommit(target.current)}
        onResponderGrant={(e) => onScrub(atPosition(e.nativeEvent.locationX))}
        onResponderMove={(e) => onScrub(atPosition(e.nativeEvent.locationX))}
        onResponderRelease={(e) => onCommit(atPosition(e.nativeEvent.locationX))}
        onLayout={(e) => {
          width.current = Math.max(1, e.nativeEvent.layout.width);
        }}
        className="flex-1 justify-center"
        style={{ height: 40 }}
      >
        <Animated.View
          pointerEvents="none"
          className="rounded-full bg-white/[0.22] overflow-visible"
          style={{ height: 4, transform: [{ scaleY: trackScale }] }}
        >
          {/* Buffered fill */}
          <View
            pointerEvents="none"
            className="absolute left-0 top-0 bottom-0 rounded-full bg-white/25"
            style={{ width: `${bufferedRatio * 100}%` }}
          />
          {/* Played fill (accent) */}
          <View
            pointerEvents="none"
            className="absolute left-0 top-0 bottom-0 rounded-full"
            style={{
              width: `${ratio * 100}%`,
              backgroundColor: colors.brand,
            }}
          />
        </Animated.View>
        {/* Keep the thumb outside the vertically scaled track so it stays round. */}
        <Animated.View
          pointerEvents="none"
          className="absolute top-1/2 rounded-full"
          style={{
            left: `${ratio * 100}%`,
            width: 18,
            height: 18,
            marginTop: -9,
            marginLeft: -9,
            transform: [{ scale: thumbScale }],
            backgroundColor: colors.brand,
            shadowColor: "#000",
            shadowOpacity: 0.5,
            shadowRadius: 4,
            elevation: 4,
          }}
        />
      </View>
      {/* Remaining */}
      <Pressable onPress={() => setRemaining((v) => !v)} accessibilityRole="button" accessibilityLabel={remaining ? "Show episode duration" : "Show time remaining"} hitSlop={10}>
        <Text className="min-w-[52px] text-right text-[12px] font-archivo-medium text-white/85">
          {remaining ? `-${timeLabel(Math.max(0, duration - value))}` : timeLabel(duration)}
        </Text>
      </Pressable>
    </View>
  );
}
