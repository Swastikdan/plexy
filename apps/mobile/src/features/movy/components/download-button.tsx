import { useEffect } from "react";
import { Pressable, Text, View } from "react-native";
import Animated, {
  cancelAnimation,
  Easing,
  useAnimatedProps,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withSequence,
  withTiming,
} from "react-native-reanimated";
import Svg, { Circle } from "react-native-svg";
import { useReducedMotion } from "@/shared/hooks/use-reduced-motion";
import { cn } from "@/shared/lib/cn";
import { useColors } from "@/shared/theme";
import { Check, Download, Play, RotateCcw } from "@/shared/ui/icons";
import type { MovyDownloadRecord } from "../lib/types";

import type { DownloadButtonState } from "@/core/downloads/state";
export type { DownloadButtonState };

export function downloadButtonState(
  record: MovyDownloadRecord | undefined,
): DownloadButtonState {
  if (!record) return "idle";
  if (record.status === "completed") return "done";
  if (record.status === "downloading" || record.status === "verifying")
    return "downloading";
  if (record.status === "paused") return "paused";
  if (record.status === "failed") return "failed";
  return "queued";
}

const AnimatedCircle = Animated.createAnimatedComponent(Circle);

/** A ring that fills with progress and slowly turns while the file streams in. */
function ProgressRing({
  size,
  progress,
  spinning,
}: {
  size: number;
  progress: number;
  spinning: boolean;
}) {
  const colors = useColors();
  const reduceMotion = useReducedMotion();
  const stroke = size >= 36 ? 2.5 : 2;
  const radius = (size - stroke) / 2 - 1;
  const circumference = 2 * Math.PI * radius;
  const fill = useSharedValue(progress);
  const turn = useSharedValue(0);
  useEffect(() => {
    fill.set(withTiming(progress, { duration: 320 }));
  }, [fill, progress]);
  useEffect(() => {
    if (!spinning || reduceMotion) {
      cancelAnimation(turn);
      turn.set(0);
      return;
    }
    turn.set(
      withRepeat(withTiming(1, { duration: 1400, easing: Easing.linear }), -1),
    );
    return () => cancelAnimation(turn);
  }, [reduceMotion, spinning, turn]);
  const arc = useAnimatedProps(() => ({
    // Always show a short arc so a 0% download still visibly moves.
    strokeDashoffset:
      circumference * (1 - Math.max(spinning ? 0.08 : 0, fill.get())),
  }));
  const rotation = useAnimatedStyle(() => ({
    transform: [{ rotate: `${turn.get() * 360 - 90}deg` }],
  }));
  return (
    <Animated.View
      pointerEvents="none"
      style={[{ position: "absolute", width: size, height: size }, rotation]}
    >
      <Svg width={size} height={size}>
        <Circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          stroke={colors.line}
          strokeWidth={stroke}
          fill="none"
        />
        <AnimatedCircle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          stroke={colors.ink}
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={`${circumference} ${circumference}`}
          fill="none"
          animatedProps={arc}
        />
      </Svg>
    </Animated.View>
  );
}

/** The download arrow nudges down while waiting in the queue. */
function QueuedArrow({ size }: { size: number }) {
  const colors = useColors();
  const reduceMotion = useReducedMotion();
  const offset = useSharedValue(0);
  useEffect(() => {
    if (reduceMotion) return;
    offset.set(
      withRepeat(
        withSequence(
          withTiming(2.5, { duration: 520, easing: Easing.inOut(Easing.quad) }),
          withTiming(-1, { duration: 520, easing: Easing.inOut(Easing.quad) }),
        ),
        -1,
        true,
      ),
    );
    return () => cancelAnimation(offset);
  }, [offset, reduceMotion]);
  const style = useAnimatedStyle(() => ({
    transform: [{ translateY: offset.get() }],
  }));
  return (
    <Animated.View style={style}>
      <Download size={size} color={colors.muted} />
    </Animated.View>
  );
}

export function DownloadButton({
  state,
  progress = 0,
  onPress,
  size = 40,
  className,
  accessibilityLabel,
  label: visibleLabel,
}: {
  state: DownloadButtonState;
  progress?: number;
  onPress: () => void;
  size?: number;
  className?: string;
  accessibilityLabel?: string;
  /** Optional text next to the glyph, for a wider pill button. */
  label?: string;
}) {
  const colors = useColors();
  const percent = Math.max(0, Math.min(99, Math.round(progress * 100)));
  const iconSize = Math.round(size * 0.45);
  const label =
    accessibilityLabel ??
    (state === "done"
      ? "Downloaded"
      : state === "downloading"
        ? `Downloading ${percent}%`
        : state === "queued"
          ? "Queued for download"
          : state === "paused"
            ? "Paused download"
            : state === "failed"
              ? "Retry download"
              : "Download");
  const glyph = (
    <View
      style={{ width: size, height: size }}
      className="items-center justify-center"
    >
      {state === "downloading" || state === "paused" ? (
        <ProgressRing
          size={size}
          progress={progress}
          spinning={state === "downloading"}
        />
      ) : null}
      {state === "downloading" ? (
        size >= 36 ? (
          <Text className="font-archivo-bold text-[10px] text-foreground">
            {percent}%
          </Text>
        ) : (
          <View
            className="rounded-[2px] bg-foreground"
            style={{ width: size * 0.28, height: size * 0.28 }}
          />
        )
      ) : state === "done" ? (
        <Check size={iconSize} color={colors.ink} strokeWidth={2.6} />
      ) : state === "paused" ? (
        <Play size={iconSize - 2} color={colors.ink} fill={colors.ink} />
      ) : state === "failed" ? (
        <RotateCcw size={iconSize} color={colors.danger} />
      ) : state === "queued" ? (
        <QueuedArrow size={iconSize} />
      ) : (
        <Download size={iconSize} color={colors.ink} />
      )}
    </View>
  );
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled: state === "done" }}
      onPress={(event) => {
        event.stopPropagation();
        onPress();
      }}
      style={visibleLabel ? { height: size } : { width: size, height: size }}
      className={cn(
        "flex-row items-center justify-center rounded-full bg-surface active:opacity-70",
        state === "downloading" || state === "paused"
          ? "border border-transparent"
          : "border border-border",
        state === "done" && "border-foreground/30 bg-foreground/10",
        state === "failed" && "border-danger/40 bg-danger/10",
        visibleLabel && "pr-4",
        className,
      )}
    >
      {glyph}
      {visibleLabel ? (
        <Text className="font-archivo-bold text-[14px] text-foreground">
          {visibleLabel}
        </Text>
      ) : null}
    </Pressable>
  );
}
