import { useMemo, useState } from "react";
import { Pressable, StyleSheet, useWindowDimensions, View } from "react-native";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import Animated from "react-native-reanimated";
import type { ItemCard } from "../../../core/library/catalog-api";
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
    <View style={styles.carousel}>
      <GestureDetector gesture={swipe}>
        <View style={styles.stage}>
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
      <View style={styles.actions}>
        <HeroActions
          item={activeItem}
          busy={changing}
          onOpen={() => onPlay(activeItem)}
          onDetails={() => open(activeItem.publicId)}
          onHeroFocus={onHeroFocus}
        />
      </View>
      {items.length > 1 && (
        <View style={styles.carouselDots}>
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
              style={({ pressed }) => [
                styles.carouselDot,
                index === activeIndex && styles.carouselDotActive,
                (pressed || focusedDot === index) && styles.carouselDotFocused,
              ]}
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

const styles = StyleSheet.create({
  carousel: { width: "100%", position: "relative" },
  stage: { overflow: "hidden" },
  actions: { position: "absolute", bottom: ACTION_BOTTOM, left: 20, right: 20 },
  carouselDots: {
    position: "absolute",
    bottom: 10,
    left: 20,
    right: 20,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
  },
  carouselDot: {
    flex: 1,
    maxWidth: 44,
    height: 4,
    borderRadius: 2,
    backgroundColor: "rgba(255,255,255,0.28)",
  },
  carouselDotActive: { backgroundColor: "#ffffff" },
  carouselDotFocused: { backgroundColor: "rgba(255,255,255,0.65)" },
});
