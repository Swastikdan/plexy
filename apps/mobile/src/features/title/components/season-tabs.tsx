import React, { useEffect, useRef, useState } from "react";
import { Pressable, ScrollView, Text, View } from "react-native";
import { useReducedMotion } from "@/shared/hooks/use-reduced-motion";
import { triggerHaptic } from "@/shared/lib/haptics";
import { cn } from "@/shared/lib/cn";
import { usePagerGestureBoundary } from "@/shared/ui/swipe-pager";

/** The underline season strip used by local and online series. */
export function SeasonTabs({
  seasons,
  value,
  onChange,
}: {
  seasons: { number: number; label: string }[];
  value: number | null;
  onChange: (season: number) => void;
}) {
  const strip = useRef<ScrollView>(null);
  const layouts = useRef<Record<number, number>>({});
  const [focus, setFocus] = useState<number | null>(null);
  const reducedMotion = useReducedMotion();
  const pagerBoundary = usePagerGestureBoundary();

  useEffect(() => {
    if (value == null) return;
    strip.current?.scrollTo({
      x: Math.max(0, (layouts.current[value] ?? 0) - 16),
      animated: !reducedMotion,
    });
  }, [value, reducedMotion]);

  if (!seasons.length) return null;
  return (
    <View>
      <ScrollView
        {...pagerBoundary}
        ref={strip}
        horizontal
        accessibilityRole="tablist"
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={{ gap: 28, paddingBottom: 2 }}
      >
        {seasons.map((season) => {
          const active = value === season.number;
          return (
            <Pressable
              key={season.number}
              onLayout={(event) => {
                layouts.current[season.number] = event.nativeEvent.layout.x;
              }}
              accessibilityRole="tab"
              accessibilityLabel={season.label}
              accessibilityState={{ selected: active }}
              onPress={() => {
                triggerHaptic("selection");
                onChange(season.number);
              }}
              onFocus={() => setFocus(season.number)}
              onBlur={() => setFocus(null)}
              className={cn(
                "min-h-12 justify-center border-b-2 py-3 active:opacity-65",
                // Mutually exclusive states: uniwind resolves conflicting
                // border-b-* classes by stylesheet order, not className order.
                active
                  ? "border-b-foreground"
                  : focus === season.number
                    ? "border-b-accent"
                    : "border-b-transparent",
              )}
            >
              <Text
                className={cn(
                  "text-[17px] leading-[22px] font-archivo-medium tracking-[0.1px]",
                  active ? "text-foreground" : "text-muted",
                )}
              >
                {season.label}
              </Text>
            </Pressable>
          );
        })}
      </ScrollView>
    </View>
  );
}
