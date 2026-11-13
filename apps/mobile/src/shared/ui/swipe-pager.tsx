import React, {
  createContext,
  useContext,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
} from "react";
import { PanResponder, ScrollView, View } from "react-native";
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

type PagerHandle = {
  begin: () => void;
  move: (dx: number) => void;
  end: (dx: number, vx: number) => void;
  cancel: () => void;
};

/** Link a tab header to its content, without stealing vertical scrolling or taps. */
export function usePagerDrag() {
  const controller = useRef<PagerHandle>(null);
  const responder = useRef(
    PanResponder.create({
      onMoveShouldSetPanResponderCapture: (_, gesture) =>
        gesture.numberActiveTouches === 1 &&
        Math.abs(gesture.dx) > 16 &&
        Math.abs(gesture.dx) > Math.abs(gesture.dy) * 1.5,
      onPanResponderGrant: () => controller.current?.begin(),
      onPanResponderMove: (_, gesture) => controller.current?.move(gesture.dx),
      onPanResponderRelease: (_, gesture) =>
        controller.current?.end(gesture.dx, gesture.vx),
      onPanResponderTerminate: () => controller.current?.cancel(),
    }),
  ).current;
  return { controller, panHandlers: responder.panHandlers };
}

/** Native paging keeps adjacent pages visible and attached to the finger. */
export function SwipePager({
  pageKeys,
  index,
  onChange,
  renderPage,
  autoHeight = false,
  scrollEnabled = true,
  controller,
}: {
  pageKeys: readonly string[];
  index: number;
  onChange: (index: number) => void;
  renderPage: (index: number) => React.ReactNode;
  autoHeight?: boolean;
  scrollEnabled?: boolean;
  controller?: React.Ref<PagerHandle>;
}) {
  const boundary = usePagerGestureBoundary(scrollEnabled);
  const [childInteracting, setChildInteracting] = useState(false);
  const scroll = useRef<ScrollView>(null);
  const [width, setWidth] = useState(0);
  const [viewportHeight, setViewportHeight] = useState(0);
  const [heights, setHeights] = useState<Record<string, number>>({});
  const reduceMotion = useReducedMotion();
  const previousWidth = useRef(0);
  const offset = useRef(0);
  const dragStart = useRef(0);
  const keys = pageKeys.join("|");
  const boundedIndex = Math.max(0, Math.min(pageKeys.length - 1, index));
  const snap = (next: number) => {
    scroll.current?.scrollTo({ x: next * width, animated: !reduceMotion });
    if (next !== boundedIndex) onChange(next);
  };
  useImperativeHandle(controller, () => ({
    begin: () => {
      dragStart.current = offset.current;
      scroll.current?.scrollTo({ x: offset.current, animated: false });
    },
    move: (dx) =>
      scroll.current?.scrollTo({
        x: Math.max(
          0,
          Math.min((pageKeys.length - 1) * width, dragStart.current - dx),
        ),
        animated: false,
      }),
    end: (dx, vx) => {
      const direction = dx < 0 ? 1 : -1;
      const next =
        Math.abs(dx) > width * 0.25 || Math.abs(vx) > 0.35
          ? boundedIndex + direction
          : boundedIndex;
      snap(Math.max(0, Math.min(pageKeys.length - 1, next)));
    },
    cancel: () => snap(boundedIndex),
  }));
  useEffect(() => {
    if (!width || childInteracting) return;
    scroll.current?.scrollTo({
      x: boundedIndex * width,
      animated: !reduceMotion && previousWidth.current === width,
    });
    previousWidth.current = width;
  }, [boundedIndex, width, keys, reduceMotion, childInteracting]);
  return (
    <PagerLock.Provider value={setChildInteracting}>
      <View
        {...boundary}
        style={
          autoHeight
            ? { height: heights[pageKeys[boundedIndex]!] }
            : { flex: 1 }
        }
        onLayout={(event) => {
          setWidth(event.nativeEvent.layout.width);
          if (!autoHeight) setViewportHeight(event.nativeEvent.layout.height);
        }}
      >
        {width > 0 && (
          <ScrollView
            ref={scroll}
            horizontal
            pagingEnabled
            directionalLockEnabled
            nestedScrollEnabled
            scrollEnabled={scrollEnabled && !childInteracting}
            showsHorizontalScrollIndicator={false}
            bounces={false}
            overScrollMode="never"
            keyboardShouldPersistTaps="handled"
            style={autoHeight ? { flexGrow: 0 } : { flex: 1 }}
            contentContainerStyle={
              autoHeight ? { alignItems: "flex-start" } : { flexGrow: 1 }
            }
            scrollEventThrottle={16}
            onScroll={(event) => {
              offset.current = event.nativeEvent.contentOffset.x;
            }}
            onMomentumScrollEnd={(event) => {
              const next = Math.max(
                0,
                Math.min(
                  pageKeys.length - 1,
                  Math.round(event.nativeEvent.contentOffset.x / width),
                ),
              );
              if (next !== boundedIndex) onChange(next);
            }}
          >
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
                {renderPage(page)}
              </View>
            ))}
          </ScrollView>
        )}
      </View>
    </PagerLock.Provider>
  );
}
