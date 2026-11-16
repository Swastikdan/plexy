import React, { useEffect, useRef, useState } from "react";
import { Animated, Pressable, Text, View } from "react-native";
import type { Chapter } from "@plexy/api-client/types";
import { easings, useColors, timeLabel } from "@/shared/theme";
import { triggerHaptic } from "@/shared/lib/haptics";
import { useReducedMotion } from "@/shared/hooks/use-reduced-motion";

const CANCEL_SEEK_SECONDS = 1.5;
const EMPTY_CHAPTERS: Chapter[] = [];

interface TimelineBarProps {
  duration: number;
  /** Scrub target while scrubbing, otherwise the current position. */
  value: number;
  buffered: number;
  scrubbing: boolean;
  chapters?: Chapter[];
  onScrub: (time: number, cancelling: boolean) => void;
  onCommit: (time: number) => void;
  onCancel: () => void;
  seekStep: number;
  /** Distance from the bottom edge of the screen. */
  bottom: number;
}

function chapterIndex(time: number, chapters: Chapter[]) {
  let index = -1;
  for (let i = 0; i < chapters.length; i += 1) {
    if (chapters[i]!.start <= time) index = i;
    else break;
  }
  return index;
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
  chapters,
  onScrub,
  onCommit,
  onCancel,
  seekStep,
  bottom,
}: TimelineBarProps) {
  const colors = useColors();
  const reduceMotion = useReducedMotion();
  const [emphasis] = React.useState(() => new Animated.Value(scrubbing ? 1 : 0));
  const chapterList = chapters ?? EMPTY_CHAPTERS;
  const lastChapter = useRef<number | null>(null);
  const startValue = useRef(0);
  const cancelEligible = useRef(false);
  const cancelling = useRef(false);
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
  useEffect(() => {
    if (!scrubbing || chapterList.length < 2) {
      lastChapter.current = null;
      return;
    }
    const index = chapterIndex(value, chapterList);
    if (lastChapter.current == null) {
      lastChapter.current = index;
      return;
    }
    if (index !== lastChapter.current) {
      lastChapter.current = index;
      triggerHaptic("selection");
    }
  }, [value, scrubbing, chapterList]);
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
  const inCancelZone = (time: number) =>
    cancelEligible.current &&
    Math.abs(time - startValue.current) <= CANCEL_SEEK_SECONDS;
  const scrubTo = (x: number) => {
    const time = atPosition(x);
    if (
      !cancelEligible.current &&
      Math.abs(time - startValue.current) > CANCEL_SEEK_SECONDS
    )
      cancelEligible.current = true;
    const cancel = inCancelZone(time);
    if (cancel !== cancelling.current) {
      cancelling.current = cancel;
      if (cancel) triggerHaptic("selection");
    }
    onScrub(time, cancel);
  };
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
        onResponderGrant={(e) => {
          startValue.current = value;
          cancelEligible.current = false;
          cancelling.current = false;
          scrubTo(e.nativeEvent.locationX);
        }}
        onResponderMove={(e) => scrubTo(e.nativeEvent.locationX)}
        onResponderRelease={() => {
          const cancel = inCancelZone(target.current);
          if (cancel) onCancel();
          else onCommit(target.current);
          cancelEligible.current = false;
          cancelling.current = false;
        }}
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
          {/* Chapter boundaries */}
          {duration > 0 &&
            chapterList
              .filter(
                (chapter) => chapter.start > 0 && chapter.start < duration,
              )
              .map((chapter) => (
                <View
                  key={`chapter-${chapter.start}`}
                  pointerEvents="none"
                  className="absolute top-[-3px] bottom-[-3px] w-px bg-white/55"
                  style={{
                    left: `${Math.min(1, chapter.start / duration) * 100}%`,
                  }}
                />
              ))}
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
