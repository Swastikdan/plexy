import { easings } from "@/shared/theme";
import { createPlayerTapController } from "../lib/player-taps";
import { useEffect, useRef, useState } from "react";
import {
  Animated,
  Easing,
  PanResponder,
  type GestureResponderEvent,
} from "react-native";
import {
  clampZoom,
  DOUBLE_TAP_MS,
  pinchZoom,
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
}) {
  const callbacks = useRef({ seekBy, toggleControls, seekSeconds });
  callbacks.current = { seekBy, toggleControls, seekSeconds };
  const [fitMode, setFitMode] = useState<FitMode>("contain");
  const [zoom, setZoom] = useState(1);
  const zoomRef = useRef(zoom);
  zoomRef.current = zoom;
  const gestureBlockedUntil = useRef(0);
  const viewportWidth = useRef(1);
  const enabledRef = useRef(enabled);
  enabledRef.current = enabled;
  const [fitToast, setFitToast] = useState<string | null>(null);
  const toastTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);
  const toastOpacity = useRef(new Animated.Value(0)).current;
  const toastScale = useRef(new Animated.Value(0.95)).current;
  const showFitToast = (label: string) => {
    setFitToast(label);
    if (toastTimeout.current) clearTimeout(toastTimeout.current);
    toastTimeout.current = setTimeout(() => setFitToast(null), 1800);
  };
  const tapController = useRef<ReturnType<typeof createPlayerTapController> | null>(null);
  if (!tapController.current) {
    tapController.current = createPlayerTapController({
      toggleControls: () => callbacks.current.toggleControls(),
      seekBy: (seconds) => {
        callbacks.current.seekBy(seconds);

      },
      seekSeconds: () => callbacks.current.seekSeconds,
      schedule: (callback, delay) => setTimeout(callback, delay),
      cancel: (timer) => clearTimeout(timer as ReturnType<typeof setTimeout>),
    });
  }
  const cancelPendingTap = () => tapController.current?.reset();
  useEffect(() => {
    if (!enabled) cancelPendingTap();
  }, [enabled]);
  useEffect(() => () => cancelPendingTap(), []);
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
  }, [toastVisible, reduceMotion]);
  const applyFit = (mode: FitMode, scale: number) => {
    setFitMode(mode);
    const nextZoom = clampZoom(scale);
    zoomRef.current = nextZoom;
    setZoom(nextZoom);
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
  const [brightness, setBrightness] = useState(1);
  const [volume, setVolume] = useState(1);
  const [adjusting, setAdjusting] = useState<"brightness" | "volume" | null>(
    null,
  );
  const brightnessRef = useRef(brightness);
  brightnessRef.current = brightness;
  const volumeRef = useRef(volume);
  volumeRef.current = volume;
  const hasLoadedRef = useRef(hasLoaded);
  hasLoadedRef.current = hasLoaded;
  const screenRef = useRef({ h: height });
  screenRef.current = { h: height };
  const initialPinchDist = useRef<number | null>(null);
  const initialZoom = useRef(1);
  const gestureMode = useRef<"pinch" | "av" | null>(null);
  const avCandidate = useRef<{ x: number; y: number } | null>(null);
  const avStart = useRef<{
    side: "left" | "right";
    y: number;
    level: number;
  } | null>(null);
  const finishGesture = () => {
    gestureMode.current = null;
    avCandidate.current = null;
    avStart.current = null;
    initialPinchDist.current = null;
    gestureBlockedUntil.current = Date.now() + DOUBLE_TAP_MS;
    setAdjusting(null);
  };
  const videoGestures = useRef(
    PanResponder.create({
      onStartShouldSetPanResponderCapture: (evt) => {
        // Every touch begins a new swipe candidate; never reuse a prior tap.
        const touches = evt.nativeEvent.touches;
        const touch = touches[0];
        avCandidate.current = touch ? { x: touch.pageX, y: touch.pageY } : null;
        return enabledRef.current && touches.length >= 2;
      },
      onMoveShouldSetPanResponder: (evt) => {
        if (!enabledRef.current) return false;
        const touches = evt.nativeEvent.touches;
        if (touches.length >= 2) return true;
        if (touches.length !== 1) return false;
        if (!hasLoadedRef.current) return false;
        const touch = touches[0]!;
        if (!avCandidate.current) {
          avCandidate.current = { x: touch.pageX, y: touch.pageY };
          return false;
        }
        const dx = touch.pageX - avCandidate.current.x;
        const dy = touch.pageY - avCandidate.current.y;
        if (Math.hypot(dx, dy) < 16) return false;
        if (Math.abs(dy) <= Math.abs(dx) * 1.2) {
          avCandidate.current = null;
          return false;
        }
        return true;
      },
      onPanResponderGrant: (evt) => {
        cancelPendingTap();
        gestureBlockedUntil.current = Date.now() + DOUBLE_TAP_MS;
        const touches = evt.nativeEvent.touches;
        if (touches.length >= 2) {
          gestureMode.current = "pinch";
          const t0 = touches[0]!;
          const t1 = touches[1]!;
          const dx = t0.pageX - t1.pageX;
          const dy = t0.pageY - t1.pageY;
          initialPinchDist.current = Math.hypot(dx, dy);
          initialZoom.current = zoomRef.current;
          return;
        }
        const touch = touches[0]!;
        const side =
          evt.nativeEvent.locationX < viewportWidth.current / 2
            ? "left"
            : "right";
        gestureMode.current = "av";
        avStart.current = {
          side,
          y: touch.pageY,
          level: side === "left" ? brightnessRef.current : volumeRef.current,
        };
        setAdjusting(side === "left" ? "brightness" : "volume");
      },
      onPanResponderMove: (evt) => {
        const touches = evt.nativeEvent.touches;
        if (gestureMode.current === "pinch") {
          if (
            touches.length >= 2 &&
            initialPinchDist.current &&
            initialPinchDist.current > 0
          ) {
            const t0 = touches[0]!;
            const t1 = touches[1]!;
            const dx = t0.pageX - t1.pageX;
            const dy = t0.pageY - t1.pageY;
            const currentDist = Math.hypot(dx, dy);
            const newZoom = pinchZoom(
              initialZoom.current,
              initialPinchDist.current,
              currentDist,
            );
            zoomRef.current = newZoom;
            setZoom(newZoom);
            showFitToast(`${Math.round(newZoom * 100)}% zoom`);
          }
          return;
        }
        if (
          gestureMode.current === "av" &&
          avStart.current &&
          touches.length === 1
        ) {
          const dy = avStart.current.y - touches[0]!.pageY;
          const delta = dy / (screenRef.current.h * 0.55);
          if (avStart.current.side === "left") {
            setBrightness(
              Math.min(1, Math.max(0.2, avStart.current.level + delta)),
            );
          } else {
            setVolume(Math.min(1, Math.max(0, avStart.current.level + delta)));
          }
        }
      },
      onPanResponderRelease: finishGesture,
      onPanResponderTerminate: finishGesture,
    }),
  ).current;
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
    zoom,
    applyFit,
    brightness,
    volume,
    adjusting,
    videoGestures,
    viewportWidth,
    onTap,
    fitToast,
    toastOpacity,
    toastScale,
    showFitToast,
  };
}
