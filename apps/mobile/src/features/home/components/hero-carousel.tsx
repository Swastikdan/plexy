import { usePagerGestureBoundary } from "@/shared/ui/swipe-pager";
import { useEffect, useMemo, useState } from "react";
import { AppState, Pressable, useWindowDimensions, View } from "react-native";
import { useReducedMotion } from "@/shared/hooks/use-reduced-motion";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import Animated, { cancelAnimation, Easing, useAnimatedStyle, useSharedValue, withDelay, withTiming, type SharedValue } from "react-native-reanimated";
import type { ItemCard } from "@/core/library/catalog-api";
import { cn } from "@/shared/lib/cn";
import { control } from "@/shared/theme";
import { Hero } from "@/features/catalog/components/hero";
import { HeroActions } from "@/features/catalog/components/hero-actions";
import type { OpenTitle } from "@/features/catalog/types";
import { useHeroTransition } from "@/features/home/hooks/use-hero-transition";

const ACTION_BOTTOM = 28;
const ADVANCE_MS = 5000;

function CarouselDot({ selected, next, progress }: { selected: boolean; next: boolean; progress: SharedValue<number> }) {
  const fillStyle = useAnimatedStyle(() => ({ width: `${progress.get() * 100}%` }));
  return <View className={cn("h-full w-full overflow-hidden rounded-[2px]", selected ? "bg-foreground" : "bg-foreground/28")}>
    {next && !selected && <Animated.View className="absolute bottom-0 left-0 top-0 bg-foreground" style={fillStyle} />}
  </View>;
}

export function HeroCarousel({
  items,
  onPlay,
  open,
  onHeroFocus,
  active = true,
}: {
  items: ItemCard[];
  onPlay: (item: ItemCard) => void;
  open: OpenTitle;
  onHeroFocus?: () => void;
  active?: boolean;
}) {
  const pagerBoundary = usePagerGestureBoundary();
  const { width } = useWindowDimensions();
  const reduceMotion = useReducedMotion();
  const { activeItem, activeIndex, changing, contentStyle, select, step } =
    useHeroTransition(items);
  const [pausedUntil, setPausedUntil] = useState(0);
  const [touching, setTouching] = useState(false);
  const [appActive, setAppActive] = useState(AppState.currentState === "active");
  const progress = useSharedValue(0);
  const itemKeys = items.map(item => item.publicId).join("|");
  useEffect(() => {
    const subscription = AppState.addEventListener("change", state => setAppActive(state === "active"));
    return () => subscription.remove();
  }, []);
  useEffect(() => {
    cancelAnimation(progress);
    progress.set(0);
    if (!active || !appActive || touching || changing || reduceMotion || items.length < 2) return;
    const delay = Math.max(0, pausedUntil - Date.now());
    progress.set(withDelay(delay, withTiming(1, { duration: ADVANCE_MS, easing: Easing.linear })));
    const timer = setTimeout(() => select((activeIndex + 1) % items.length), delay + ADVANCE_MS);
    return () => { clearTimeout(timer); cancelAnimation(progress); };
  }, [active, appActive, touching, changing, activeIndex, itemKeys, items.length, pausedUntil, reduceMotion, select, progress]);
  const swipe = useMemo(
    () =>
      Gesture.Pan()
        .enabled(items.length > 1)
        .activeOffsetX([-20, 20])
        .failOffsetY([-16, 16])
        .runOnJS(true)
        .onBegin(() => {
          setPausedUntil(Date.now() + 8000);
        })
        .onEnd((event) => {
          if (
            Math.abs(event.translationX) < Math.max(48, width * 0.14) &&
            !(
              Math.abs(event.translationX) > 20 &&
              Math.abs(event.velocityX) > 400
            )
          )
            return;
          step(event.translationX < 0 ? 1 : -1);
        }),
    [items.length, step, width],
  );
  if (!activeItem) return null;

  return (
    <View {...pagerBoundary} onTouchStart={() => { pagerBoundary.onTouchStart(); setTouching(true); }}
      onTouchEnd={() => { pagerBoundary.onTouchEnd(); setTouching(false); setPausedUntil(Date.now() + 8000); }}
      onTouchCancel={() => { pagerBoundary.onTouchCancel(); setTouching(false); setPausedUntil(Date.now() + 8000); }}
      className="relative w-full">
      <GestureDetector gesture={swipe}>
        <Pressable accessibilityRole="button" accessibilityLabel={`Open ${activeItem.name}`} onPress={() => open(activeItem.publicId)} className="overflow-hidden">
          <Animated.View style={contentStyle} pointerEvents="none">
            <Hero
              key={activeItem.publicId}
              item={activeItem}
              logo={activeItem.logo}
              hideActions
              contentBottom={ACTION_BOTTOM + control.height + 16}
              onOpen={() => {}}
            />
          </Animated.View>
        </Pressable>
      </GestureDetector>
      <View className="absolute left-5 right-5 bottom-[28px]">
        <HeroActions
          item={activeItem}
          busy={changing}
          onOpen={() => onPlay(activeItem)}
          onDetails={() => open(activeItem.publicId)}
          onHeroFocus={onHeroFocus}
        />
      </View>
      {items.length > 1 && (
        <View className="absolute bottom-[10px] left-5 right-5 flex-row items-center justify-center gap-1.5">
          {items.map((item, index) => (
            <Pressable
              key={item.publicId}
              onPress={() => {
                setPausedUntil(Date.now() + 8000);
                select(index);
              }}
              className="h-[4px] max-w-[44px] flex-1 rounded-[2px]"
              hitSlop={{ top: 12, bottom: 12, left: 3, right: 3 }}
              accessibilityRole="button"
              accessibilityLabel={`Show ${item.name}. Slide ${index + 1} of ${items.length}`}
              accessibilityState={{ selected: index === activeIndex }}
            >
              <CarouselDot selected={index === activeIndex} next={index === (activeIndex + 1) % items.length} progress={progress} />
            </Pressable>
          ))}
        </View>
      )}
    </View>
  );
}
