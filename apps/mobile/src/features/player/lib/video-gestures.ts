import { Gesture } from "react-native-gesture-handler";
import type { SharedValue } from "react-native-reanimated";
import { scheduleOnRN } from "react-native-worklets";
import { MIN_ZOOM, MAX_ZOOM } from "./player-interactions";

interface GestureOptions {
  enabled: boolean;
  locked: boolean;
  hasLoaded: boolean;
  height: number;
  pinchActive: SharedValue<boolean>;
  panActive: SharedValue<boolean>;
  initialZoom: SharedValue<number>;
  zoomValue: SharedValue<number>;
  leftSide: SharedValue<boolean>;
  viewport: SharedValue<number>;
  startLevel: SharedValue<number>;
  brightnessValue: SharedValue<number>;
  minBrightness: number;
  volumeValue: SharedValue<number>;
  beginGesture: (side: "brightness" | "volume" | null) => void;
  finishGesture: (scale?: number) => void;
}

/** Register native callbacks outside React rendering; updates stay on the UI runtime. */
export function createVideoGestures({ enabled, locked, hasLoaded, height, pinchActive, panActive, initialZoom, zoomValue, leftSide, viewport, startLevel, brightnessValue, volumeValue, minBrightness, beginGesture, finishGesture }: GestureOptions) {
  const pinch = Gesture.Pinch()
    .enabled(enabled && !locked)
    .onStart(() => {
      pinchActive.set(true);
      initialZoom.set(zoomValue.get());
      scheduleOnRN(beginGesture, null);
    })
    .onUpdate(event => {
      zoomValue.set(Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, initialZoom.get() * event.scale)));
    })
    .onFinalize((_event, success) => {
      if (pinchActive.get()) {
        pinchActive.set(false);
        scheduleOnRN(finishGesture, success ? zoomValue.get() : undefined);
      }
    });
  const pan = Gesture.Pan()
    .enabled(enabled && !locked && hasLoaded)
    .maxPointers(1)
    .activeOffsetY([-16, 16])
    .failOffsetX([-16, 16])
    .onStart(event => {
      panActive.set(true);
      leftSide.set(event.x < viewport.get() / 2);
      startLevel.set(leftSide.get() ? brightnessValue.get() : volumeValue.get());
      scheduleOnRN(beginGesture, leftSide.get() ? "brightness" : "volume");
    })
    .onUpdate(event => {
      const level = startLevel.get() - event.translationY / (height * 0.55);
      if (leftSide.get()) brightnessValue.set(Math.min(1, Math.max(minBrightness, level)));
      else volumeValue.set(Math.min(1, Math.max(0, level)));
    })
    .onFinalize(() => {
      if (panActive.get()) {
        panActive.set(false);
        scheduleOnRN(finishGesture);
      }
    });
  return Gesture.Race(pinch, pan);

}
