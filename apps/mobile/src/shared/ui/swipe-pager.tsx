import React, {
  createContext,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { View } from "react-native";
import { useEventCallback } from "@/shared/hooks/use-event-callback";
import { pagerTarget } from "@/shared/lib/pager-target";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import Animated, { cancelAnimation, useAnimatedStyle, useSharedValue, withSpring } from "react-native-reanimated";
import { scheduleOnRN } from "react-native-worklets";
import { useReducedMotion } from "@/shared/hooks/use-reduced-motion";

const PagerLock = createContext<(locked: boolean) => void>(() => {});

/** Horizontal controls own their gesture; they must not also swipe an ancestor tab. */
export function usePagerGestureBoundary(enabled = true) {
  const setParentLocked = useContext(PagerLock);
  const held = useRef(false);
  const release = () => {
    if (held.current) {
      held.current = false;
      setParentLocked(false);
    }
  };
  useEffect(
    () => () => {
      if (held.current) setParentLocked(false);
    },
    [setParentLocked],
  );
  return {
    onTouchStart: () => {
      if (enabled) {
        held.current = true;
        setParentLocked(true);
      }
    },
    onTouchEnd: release,
    onTouchCancel: release,
  };
}

/** UI-thread paging keeps adjacent pages attached to the finger, even while JS is busy. */
export function SwipePager({
  pageKeys,
  index,
  onChange,
  renderPage,
  autoHeight = false,
  scrollEnabled = true,
}: {
  pageKeys: readonly string[];
  index: number;
  onChange: (index: number) => void;
  renderPage: (index: number) => React.ReactNode;
  autoHeight?: boolean;
  scrollEnabled?: boolean;
}) {
  const boundary = usePagerGestureBoundary(scrollEnabled);
  const notifyChange = useEventCallback(onChange);
  const [childInteracting, setChildInteracting] = useState(false);
  const [width, setWidth] = useState(0);
  const [viewportHeight, setViewportHeight] = useState(0);
  const [heights, setHeights] = useState<Record<string, number>>({});
  const [lastHeight, setLastHeight] = useState<number | undefined>(undefined);
  const reduceMotion = useReducedMotion();
  const previousWidth = useRef(0);
  const translation = useSharedValue(0);
  const dragStart = useSharedValue(0);
  const targetIndex = useSharedValue(index);
  const keys = pageKeys.join("|");
  const boundedIndex = Math.max(0, Math.min(pageKeys.length - 1, index));
  // Mount the active page first; warm neighbours when JS is idle. Keep visited pages
  // alive. Without this the pager (used for tabs, library kinds, seasons and
  // detail tabs) renders every page — and every list inside it — at once.
  const [visited, setVisited] = useState<ReadonlySet<string>>(
    () => new Set([pageKeys[boundedIndex]!]),
  );
  const activeKey = pageKeys[boundedIndex]!;
  if (!visited.has(activeKey)) setVisited(new Set([...visited, activeKey]));
  const prepareNeighbours = useEventCallback(() => {
    setVisited(previous => {
      const neighbours = pageKeys.slice(Math.max(0, boundedIndex - 1), boundedIndex + 2);
      return neighbours.every(key => previous.has(key))
        ? previous : new Set([...previous, ...neighbours]);
    });
  });
  useEffect(() => {
    const idle = requestIdleCallback(prepareNeighbours);
    return () => cancelIdleCallback(idle);
  }, [boundedIndex, keys, prepareNeighbours]);
  useLayoutEffect(() => {
    if (!width) return;
    if (previousWidth.current !== width || reduceMotion) {
      cancelAnimation(translation);
      translation.set(-boundedIndex * width);
    } else if (targetIndex.get() !== boundedIndex) {
      // Taps switch peers immediately; only a finger-driven swipe springs.
      cancelAnimation(translation);
      translation.set(-boundedIndex * width);
    }
    targetIndex.set(boundedIndex);
    previousWidth.current = width;
  }, [boundedIndex, width, keys, reduceMotion, translation, targetIndex]);
  // A UI-thread gesture cannot wait for JS to mount the page under the finger.
  // Keep tap navigation available while the idle callback prepares neighbours.
  const neighboursReady = pageKeys
    .slice(Math.max(0, boundedIndex - 1), boundedIndex + 2)
    .every(key => visited.has(key));
  const pan = useMemo(() => Gesture.Pan()
    .enabled(scrollEnabled && neighboursReady && !childInteracting && width > 0)
    .activeOffsetX([-16, 16])
    .failOffsetY([-16, 16])
    .onStart(() => {
      cancelAnimation(translation);
      dragStart.set(translation.get());
    })
    .onUpdate((event) => {
      const next = dragStart.get() + event.translationX;
      const edge = Math.max(-(pageKeys.length - 1) * width, Math.min(0, next));
      const overshoot = next - edge;
      const resistance = (overshoot * width * 0.55) / (width + 0.55 * Math.abs(overshoot));
      translation.set(edge + resistance);
    })
    .onEnd((event) => {
      const next = pagerTarget(
        dragStart.get(), event.translationX, event.velocityX, width, pageKeys.length,
      );
      targetIndex.set(next);
      translation.set(reduceMotion ? -next * width : withSpring(-next * width, {
        duration: 400, dampingRatio: 0.8, velocity: event.velocityX, overshootClamping: true,
      }));
      if (next !== boundedIndex) scheduleOnRN(notifyChange, next);
    })
    .onFinalize((_event, success) => {
      if (!success) {
        translation.set(reduceMotion ? -targetIndex.get() * width : withSpring(-targetIndex.get() * width, {
          duration: 400, dampingRatio: 1, overshootClamping: true,
        }));
      }
    }), [scrollEnabled, neighboursReady, childInteracting, width, pageKeys.length, boundedIndex, notifyChange, reduceMotion, translation, dragStart, targetIndex]);
  const trackStyle = useAnimatedStyle(() => ({ transform: [{ translateX: translation.get() }] }));
  // Lazy pages have no measured height until they mount. Keep the previous
  // height during that frame instead of collapsing the pager to zero.
  const activeHeight = autoHeight ? heights[pageKeys[boundedIndex]!] : undefined;
  if (activeHeight != null && activeHeight !== lastHeight) setLastHeight(activeHeight);
  return (
    <PagerLock.Provider value={setChildInteracting}>
      <View
        {...boundary}
        style={
          autoHeight
            ? { height: activeHeight ?? lastHeight, overflow: "hidden" }
            : { flex: 1, overflow: "hidden" }
        }
        onLayout={(event) => {
          setWidth(event.nativeEvent.layout.width);
          if (!autoHeight) setViewportHeight(event.nativeEvent.layout.height);
        }}
      >
        {width > 0 && (
          <GestureDetector gesture={pan}>
            <Animated.View style={[{ flexDirection: "row", width: width * pageKeys.length, alignItems: "flex-start" }, trackStyle]}>
              {pageKeys.map((key, page) => (
                <View
                  key={key}
                  style={{
                    width,
                    ...(autoHeight ? {} : { height: viewportHeight }),
                  }}
                  accessibilityElementsHidden={page !== boundedIndex}
                  importantForAccessibility={
                    page === boundedIndex ? "auto" : "no-hide-descendants"
                  }
                  onLayout={
                    autoHeight
                      ? (event) => {
                          const height = event.nativeEvent.layout.height;
                          setHeights((previous) =>
                            previous[key] === height
                              ? previous
                              : { ...previous, [key]: height },
                          );
                        }
                      : undefined
                  }
                >
                  {visited.has(key) || page === boundedIndex
                    ? renderPage(page)
                    : null}
                </View>
              ))}
            </Animated.View>
          </GestureDetector>
        )}
      </View>
    </PagerLock.Provider>
  );
}
