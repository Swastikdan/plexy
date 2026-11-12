import { useMemo, useState } from "react";
import { Pressable, useWindowDimensions, View } from "react-native";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import Animated from "react-native-reanimated";
import type { ItemCard } from "../../../core/library/catalog-api";
import { cn } from "../../../shared/lib/cn";
import { control } from "../../../shared/theme";
import { Hero } from "../../catalog/components/hero";
import { HeroActions } from "../../catalog/components/hero-actions";
import type { OpenTitle } from "../../catalog/types";
import { useHeroTransition } from "../hooks/use-hero-transition";

const ACTION_BOTTOM = 28;

export function HeroCarousel({
  items,
  onPlay,
  open,
  onHeroFocus,
}: {
  items: ItemCard[];
  onPlay: (item: ItemCard) => void;
  open: OpenTitle;
  onHeroFocus?: () => void;
}) {
  const { width } = useWindowDimensions();
  const [focusedDot, setFocusedDot] = useState<number | null>(null);
  const { activeItem, activeIndex, changing, contentStyle, select, step } =
    useHeroTransition(items);
  const swipe = useMemo(
    () =>
      Gesture.Pan()
        .enabled(items.length > 1)
        .activeOffsetX([-20, 20])
        .failOffsetY([-16, 16])
        .runOnJS(true)
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
    <View className="relative w-full">
      <GestureDetector gesture={swipe}>
        <View className="overflow-hidden">
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
        </View>
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
              onPress={() => select(index)}
              onFocus={() => {
                setFocusedDot(index);
                select(index, false);
                onHeroFocus?.();
              }}
              onBlur={() => setFocusedDot(null)}
              className={cn(
                "h-[4px] max-w-[44px] flex-1 rounded-[2px] bg-white/28",
                index === activeIndex && "bg-white",
                focusedDot === index && "bg-white/65",
                "active:bg-white/65",
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
