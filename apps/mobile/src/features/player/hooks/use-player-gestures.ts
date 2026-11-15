import { useEventCallback } from "@/shared/hooks/use-event-callback";
import { easings } from "@/shared/theme";
import { createPlayerTapController } from "../lib/player-taps";
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import {
  Animated,
  type GestureResponderEvent,
} from "react-native";
import { createVideoGestures } from "../lib/video-gestures";
import { useSharedValue, useAnimatedStyle, useAnimatedReaction } from "react-native-reanimated";
import { scheduleOnRN } from "react-native-worklets";
import {
  clampZoom,
  DOUBLE_TAP_MS,
  type PlayerTap,
} from "../lib/player-interactions";
export type FitMode = "contain" | "cover" | "fill";
export function usePlayerGestures({
  hasLoaded,
  height,
  locked,
  reduceMotion,
  seekBy,
  seekSeconds,
  toggleControls,
  controlsVisible,
  enabled,
  onVolumeChange,
}: {
  hasLoaded: boolean;
  height: number;
  locked: boolean;
  reduceMotion: boolean;
  seekBy: (seconds: number) => void;
  seekSeconds: number;
  toggleControls: () => void;
  controlsVisible: boolean;
  enabled: boolean;
  onVolumeChange?: (level: number) => void;
}) {
  const callbacks = useRef({
    seekBy,
    toggleControls,
    seekSeconds,
    onVolumeChange,
  });
  useLayoutEffect(() => { callbacks.current = {
    seekBy,
    toggleControls,
    seekSeconds,
    onVolumeChange,
  }; }, [seekBy, toggleControls, seekSeconds, onVolumeChange]);
  const [fitMode, setFitMode] = useState<FitMode>("contain");
  const zoomValue = useSharedValue(1);
  const brightnessValue = useSharedValue(1);
  const volumeValue = useSharedValue(1);
  const gestureBlockedUntil = useRef(0);
  const viewportWidth = useRef(1);

  const [fitToast, setFitToast] = useState<string | null>(null);
  const toastTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [toastOpacity] = useState(() => new Animated.Value(0));
  const [toastScale] = useState(() => new Animated.Value(0.95));
  const showFitToast = useCallback((label: string) => {
    setFitToast(label);
    if (toastTimeout.current) clearTimeout(toastTimeout.current);
    toastTimeout.current = setTimeout(() => setFitToast(null), 1800);
  }, []);
  const tapController = useRef<ReturnType<typeof createPlayerTapController> | null>(null);
  useEffect(() => { tapController.current = createPlayerTapController({
    toggleControls: () => callbacks.current.toggleControls(),
    seekBy: seconds => callbacks.current.seekBy(seconds),
    seekSeconds: () => callbacks.current.seekSeconds,
    schedule: (callback, delay) => setTimeout(callback, delay),
    cancel: timer => clearTimeout(timer as ReturnType<typeof setTimeout>),
  });
  return () => tapController.current?.reset();
  }, []);
  const cancelPendingTap = useEventCallback(() => tapController.current?.reset());
  useEffect(() => {
    if (!enabled) cancelPendingTap();
  }, [enabled, cancelPendingTap]);
  useEffect(() => () => cancelPendingTap(), [cancelPendingTap]);
  const toastVisible = fitToast != null;
  useEffect(() => {
    if (toastVisible) {
      toastOpacity.stopAnimation();
      toastScale.stopAnimation();
      Animated.parallel([
        Animated.timing(toastOpacity, {
          toValue: 1,
          duration: reduceMotion ? 0 : 160,
          easing: easings.out,
          useNativeDriver: true,
        }),
        Animated.timing(toastScale, {
          toValue: 1,
          duration: reduceMotion ? 0 : 160,
          easing: easings.out,
          useNativeDriver: true,
        }),
      ]).start();
    } else {
      Animated.timing(toastOpacity, {
        toValue: 0,
        duration: reduceMotion ? 0 : 120,
        easing: easings.out,
        useNativeDriver: true,
      }).start();
    }
    return () => { toastOpacity.stopAnimation(); toastScale.stopAnimation(); };
  }, [toastVisible, reduceMotion, toastOpacity, toastScale]);
  const applyFit = (mode: FitMode, scale: number) => {
    setFitMode(mode);
    const nextZoom = clampZoom(scale);
    zoomValue.set(nextZoom);
    showFitToast(
      scale === 1
        ? mode === "contain"
          ? "Best fit"
          : mode === "cover"
            ? "Crop to fill"
            : "Stretch to fill"
        : `${Math.round(scale * 100)}% zoom`,
    );
  };
  const [adjusting, setAdjusting] = useState<"brightness" | "volume" | null>(
    null,
  );
  const pinchActive = useSharedValue(false);
  const panActive = useSharedValue(false);
  const initialZoom = useSharedValue(1);
  const startLevel = useSharedValue(1);
  const leftSide = useSharedValue(true);
  const viewport = useSharedValue(1);
  const beginGesture = useEventCallback((side: "brightness" | "volume" | null) => {
    cancelPendingTap();
    gestureBlockedUntil.current = Infinity;
    setAdjusting(side);
  });
  const finishGesture = useCallback((scale?: number) => {
    gestureBlockedUntil.current = Date.now() + DOUBLE_TAP_MS;
    setAdjusting(null);
    if (scale != null) showFitToast(`${Math.round(scale * 100)}% zoom`);
  }, [showFitToast]);
  const commitVolume = useEventCallback((level: number) => callbacks.current.onVolumeChange?.(level));
  // Bridge only when the integer percentage changes, rather than on every frame.
  useAnimatedReaction(
    () => Math.round(volumeValue.get() * 100),
    (level, previous) => {
      if (previous != null && level !== previous) scheduleOnRN(commitVolume, level / 100);
    },
  );
  const finishNativeGesture = useEventCallback(finishGesture);
  const videoGestures = createVideoGestures({ enabled, locked, hasLoaded, height, pinchActive, panActive, initialZoom, zoomValue, leftSide, viewport, startLevel, brightnessValue, volumeValue, beginGesture, finishGesture: finishNativeGesture });
  const zoomStyle = useAnimatedStyle(() => ({ transform: [{ scale: zoomValue.get() }] }));
  const brightnessStyle = useAnimatedStyle(() => ({ opacity: 0.9 * (1 - brightnessValue.get()) }));
  const setViewportWidth = (width: number) => {
    viewportWidth.current = width;
    viewport.set(width);
  };
  const onTap = (event: GestureResponderEvent) => {
    const now = Date.now();
    if (now < gestureBlockedUntil.current || locked || !enabled) return;
    const tap: PlayerTap = {
      time: now,
      side:
        event.nativeEvent.locationX < viewportWidth.current / 2
          ? "left"
          : "right",
    };
    tapController.current?.tap(tap, controlsVisible);
  };
  useEffect(
    () => () => {
      if (toastTimeout.current) clearTimeout(toastTimeout.current);
    },
    [],
  );
  return {
    fitMode,
    zoomStyle,
    brightnessStyle,
    brightnessValue,
    volumeValue,
    applyFit,
    adjusting,
    videoGestures,
    setViewportWidth,
    onTap,
    fitToast,
    toastOpacity,
    toastScale,
    showFitToast,
  };
}
