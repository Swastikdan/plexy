import { useTitleActions } from "@/features/catalog/hooks/use-title-actions";
import { usePagerGestureBoundary } from "@/shared/ui/swipe-pager";
import { useEffect, useMemo, useRef } from "react";
import { Pressable, useWindowDimensions, View } from "react-native";
import { useReducedMotion } from "@/shared/hooks/use-reduced-motion";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import Animated from "react-native-reanimated";
import type { ItemCard } from "@/core/library/catalog-api";
import { cn } from "@/shared/lib/cn";
import { control } from "@/shared/theme";
import { Hero } from "@/features/catalog/components/hero";
import { HeroActions } from "@/features/catalog/components/hero-actions";
import type { OpenTitle } from "@/features/catalog/types";
import { useHeroTransition } from "@/features/home/hooks/use-hero-transition";

const ACTION_BOTTOM = 28;

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
  const titleActions = useTitleActions();
  const pagerBoundary = usePagerGestureBoundary();
  const { width } = useWindowDimensions();
  const reduceMotion = useReducedMotion();
  const { activeItem, activeIndex, changing, contentStyle, select, step } =
    useHeroTransition(items);
  const pausedUntil = useRef(0);
  // Advance the featured title while the user is on Home and not touching it.
  useEffect(() => {
    if (!active || reduceMotion || items.length < 2) return;
    const timer = setInterval(() => {
      if (Date.now() < pausedUntil.current) return;
      select((activeIndex + 1) % items.length);
    }, 5000);
    return () => clearInterval(timer);
  }, [active, activeIndex, items.length, reduceMotion, select]);
  const swipe = useMemo(
    () =>
      Gesture.Pan()
        .enabled(items.length > 1)
        .activeOffsetX([-20, 20])
        .failOffsetY([-16, 16])
        .runOnJS(true)
        .onBegin(() => {
          pausedUntil.current = Date.now() + 8000;
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
    <View {...pagerBoundary} className="relative w-full">
      <GestureDetector gesture={swipe}>
        <Pressable accessibilityRole="button" accessibilityLabel={`Open ${activeItem.name}`} onPress={() => open(activeItem.publicId)} onLongPress={() => titleActions(activeItem, () => onPlay(activeItem), Boolean(activeItem.watch?.position && !activeItem.watch?.played))} delayLongPress={1000} className="overflow-hidden">
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
                pausedUntil.current = Date.now() + 8000;
                select(index);
              }}
              className={cn(
                "h-[4px] max-w-[44px] flex-1 rounded-[2px]",
                // Mutually exclusive backgrounds — uniwind resolves
                // conflicting bg-* classes by stylesheet order, not by
                // className order, so a conditional override never wins.
                index === activeIndex ? "bg-foreground" : "bg-foreground/28",
              )}
              hitSlop={{ top: 12, bottom: 12, left: 3, right: 3 }}
              accessibilityRole="button"
              accessibilityLabel={`Show ${item.name}. Slide ${index + 1} of ${items.length}`}
              accessibilityState={{ selected: index === activeIndex }}
            />
          ))}
        </View>
      )}
    </View>
  );
}
