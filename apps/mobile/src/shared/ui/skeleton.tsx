import { LinearGradient } from "expo-linear-gradient";
import { Skeleton } from "heroui-native/skeleton";
import React from "react";
import {
  ScrollView,
  StyleSheet,
  useWindowDimensions,
  View,
  type StyleProp,
  type ViewStyle,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { cn } from "@/shared/lib/cn";
import { control, useColors, withAlpha } from "@/shared/theme";

/** A single shimmer block sized like the content it replaces. */
export function SkeletonBlock({
  className,
  style,
}: {
  className?: string;
  style?: StyleProp<ViewStyle>;
}) {
  return <Skeleton className={cn("rounded-lg", className)} style={style} />;
}

/** Poster card placeholder shared by every shelf and grid. */
function PosterCardSkeleton({ width }: { width: number | `${number}%` }) {
  return (
    <View style={{ width }} className="gap-2">
      <SkeletonBlock
        style={{ width: "100%", aspectRatio: 2 / 3, borderRadius: 8 }}
      />
      <SkeletonBlock style={{ width: "55%", height: 11 }} />
    </View>
  );
}

/** One titled row of poster cards, used by Home and Search landings. */
function PosterShelfSkeleton({ count = 3 }: { count?: number }) {
  return (
    <View className="gap-2">
      <SkeletonBlock style={{ marginLeft: 20, width: 132, height: 16 }} />
      <View className="flex-row gap-2.5 overflow-hidden px-5">
        {Array.from({ length: count }, (_, card) => (
          <PosterCardSkeleton key={card} width={150} />
        ))}
      </View>
    </View>
  );
}

/** The collapsible season-picker row on a series title page. */
export function SeasonPickerSkeleton() {
  return (
    <View className="w-full flex-row items-center justify-between">
      <SkeletonBlock style={{ width: 108, height: 20 }} />
    </View>
  );
}

/** Episode rows: artwork plus three text lines. */
export function EpisodeListSkeleton({ count = 4 }: { count?: number }) {
  return (
    <View className="gap-[18px] pt-3">
      {Array.from({ length: count }, (_, index) => (
        <View key={index} className="flex-row gap-[14px] px-2 py-3">
          <SkeletonBlock
            style={{ width: 148, aspectRatio: 16 / 9, borderRadius: 8 }}
          />
          <View className="flex-1 justify-center gap-2">
            <SkeletonBlock style={{ width: "62%", height: 14 }} />
            <SkeletonBlock style={{ width: "94%", height: 12 }} />
            <SkeletonBlock style={{ width: "45%", height: 11 }} />
          </View>
        </View>
      ))}
    </View>
  );
}

/** Cast cards keep the poster ratio so the layout does not jump. */
export function CastRowSkeleton({ count = 4 }: { count?: number }) {
  return (
    <View className="gap-3">
      <SkeletonBlock style={{ width: 126, height: 18 }} />
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={{ gap: 14 }}
      >
        {Array.from({ length: count }, (_, index) => (
          <View key={index} className="w-24 gap-1.5">
            <SkeletonBlock
              style={{ width: "100%", aspectRatio: 2 / 3, borderRadius: 8 }}
            />
            <SkeletonBlock style={{ width: "82%", height: 11 }} />
            <SkeletonBlock style={{ width: "55%", height: 10 }} />
          </View>
        ))}
      </ScrollView>
    </View>
  );
}

/**
 * First paint for the online title hero. Mirrors `TitleHero`: the artwork is
 * edge to edge, the wordmark/logo placeholder is centered over the lower
 * third, and the art fades into the page canvas.
 */
export function TitleHeroSkeleton() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { height } = useWindowDimensions();
  const artworkHeight = Math.round(
    Math.min(Math.max(height * 0.46, 360), 520) + insets.top,
  );
  return (
    <View
      className="w-full overflow-hidden bg-surface"
      style={{ height: artworkHeight }}
    >
      <SkeletonBlock
        style={[StyleSheet.absoluteFill, { borderRadius: 0 }]}
      />
      <LinearGradient
        pointerEvents="none"
        colors={[
          withAlpha(colors.canvas, 0),
          withAlpha(colors.canvas, 0),
          withAlpha(colors.canvas, 0.35),
          colors.canvas,
        ]}
        locations={[0, 0.68, 0.9, 1]}
        style={StyleSheet.absoluteFill}
      />
      <View className="absolute inset-x-5 bottom-7 items-center">
        <SkeletonBlock style={{ width: "58%", height: 52, borderRadius: 8 }} />
      </View>
    </View>
  );
}

/** Full home first paint: hero, then three shelves of poster cards. */
export function HomeSkeleton() {
  const insets = useSafeAreaInsets();
  return (
    <View className="flex-1 bg-background">
      <View
        className="absolute left-5 z-10 flex-row items-center gap-2"
        style={{ top: insets.top + 18 }}
      >
        <SkeletonBlock style={{ width: 28, height: 28, borderRadius: 14 }} />
        <SkeletonBlock style={{ width: 92, height: 26 }} />
      </View>
      <ScrollView
        showsVerticalScrollIndicator={false}
        contentInsetAdjustmentBehavior="never"
      >
        <View
          className="justify-end overflow-hidden"
          style={{ height: 540 + insets.top }}
        >
          <SkeletonBlock
            style={{ position: "absolute", inset: 0, borderRadius: 0 }}
          />
          <View className="gap-3 px-5 pb-8">
            <SkeletonBlock style={{ width: 230, height: 42 }} />
            <SkeletonBlock style={{ width: 170, height: 12 }} />
            <SkeletonBlock
              style={{ width: "100%", height: 52, borderRadius: 26 }}
            />
          </View>
        </View>
        {[0, 1, 2].map((row) => (
          <View key={row} className="mb-5 mt-4">
            <PosterShelfSkeleton />
          </View>
        ))}
      </ScrollView>
    </View>
  );
}

/**
 * Two-up search result rows. Used for the whole results area while both
 * sources load, and appended to existing results while the other source is
 * still resolving — so a fast local match never turns into a spinner.
 */
export function SearchResultRowsSkeleton({
  rows = 2,
  inset = true,
}: {
  rows?: number;
  inset?: boolean;
}) {
  const { width } = useWindowDimensions();
  const cardWidth = Math.floor((width - 40 - 12) / 2);
  return (
    <View className="gap-3.5">
      {Array.from({ length: rows }, (_, row) => (
        <View
          key={row}
          className={cn("flex-row gap-3", inset && "px-5")}
        >
          {[0, 1].map((card) => (
            <PosterCardSkeleton key={card} width={cardWidth} />
          ))}
        </View>
      ))}
    </View>
  );
}

/** Search results: a header line and a two-column poster grid. */
export function SearchResultsSkeleton() {
  return (
    <View className="flex-1 gap-3 px-5 pt-2">
      <SkeletonBlock style={{ width: 142, height: 16 }} />
      <SearchResultRowsSkeleton rows={4} inset={false} />
    </View>
  );
}

/** Search landing page: two horizontal shelves. */
export function SearchHomeSkeleton() {
  return (
    <View className="flex-1 gap-4 pt-2">
      {[0, 1].map((row) => (
        <PosterShelfSkeleton key={row} />
      ))}
    </View>
  );
}

/** Library grid: same columns and card size as LibraryTitles. */
export function LibraryGridSkeleton() {
  const { width } = useWindowDimensions();
  const available = width - 40;
  const columns = Math.max(2, Math.floor(available / 150));
  const cardWidth = Math.floor(available / columns) - 10;
  return (
    <View
      className="flex-1 flex-row flex-wrap px-5 pt-1"
      style={{ gap: 12 }}
    >
      {Array.from({ length: columns * 3 }, (_, index) => (
        <PosterCardSkeleton key={index} width={cardWidth} />
      ))}
    </View>
  );
}

/** The three-column poster grid a movie uses for "More Like This". */
function TitlePosterGridSkeleton() {
  const { width } = useWindowDimensions();
  const columns = 3;
  const gap = 10;
  const cardWidth = Math.max(
    92,
    Math.floor((width - 40 - gap * (columns - 1)) / columns),
  );
  return (
    <View
      className="flex-row flex-wrap pt-1"
      style={{ columnGap: gap, rowGap: 18 }}
    >
      {Array.from({ length: columns * 2 }, (_, index) => (
        <PosterCardSkeleton key={index} width={cardWidth} />
      ))}
    </View>
  );
}

/**
 * First paint for an online title page. It mirrors the real mobile layout:
 * the centered hero wordmark, centered facts / rating / quick action, the tab
 * strip, then the default tab (episodes for a series, the recommendation grid
 * for a movie) and the fixed bottom action bar.
 *
 * Series and movies differ because their default tabs differ. Local titles
 * never use this: their detail reads from the device, so the screen renders
 * the canvas and then the page itself.
 */
export function TitleDetailSkeleton({ series = true }: { series?: boolean }) {
  const insets = useSafeAreaInsets();
  // Same labels as the real strip: Episodes / More Like This / Details for a
  // series, More Like This / Details for a movie.
  const tabWidths = series ? [78, 112, 62] : [112, 62];
  return (
    <View className="flex-1 bg-background">
      <ScrollView
        showsVerticalScrollIndicator={false}
        contentInsetAdjustmentBehavior="never"
        contentContainerStyle={{ paddingBottom: insets.bottom + 116 }}
      >
        <TitleHeroSkeleton />
        <View className="gap-[18px] px-5 pt-5">
          {/* Centered fact line. */}
          <View className="flex-row flex-wrap items-center justify-center gap-x-2 gap-y-1">
            <SkeletonBlock style={{ width: 36, height: 18, borderRadius: 4 }} />
            <SkeletonBlock style={{ width: 40, height: 12 }} />
            <SkeletonBlock style={{ width: 86, height: 12 }} />
          </View>

          {/* Centered rating and primary play pill. */}
          <View className="flex-row items-center justify-center gap-3">
            <SkeletonBlock style={{ width: 105, height: 21 }} />
            <SkeletonBlock
              style={{ width: 104, height: 38, borderRadius: 19 }}
            />
          </View>

          {/* Centered quick action (My List for online titles). */}
          <View className="items-center py-1">
            <View className="min-w-[64px] items-center gap-2 py-1">
              <SkeletonBlock
                style={{ width: 26, height: 26, borderRadius: 13 }}
              />
              <SkeletonBlock style={{ width: 52, height: 13 }} />
            </View>
          </View>

          {/* Synopsis: left aligned, exactly like the real text block. */}
          <View className="gap-2">
            <SkeletonBlock style={{ width: "100%", height: 14 }} />
            <SkeletonBlock style={{ width: "96%", height: 14 }} />
            <SkeletonBlock style={{ width: "90%", height: 14 }} />
            <SkeletonBlock style={{ width: "54%", height: 14 }} />
          </View>

          {/* Underline tab strip. */}
          <View className="mt-1 flex-row gap-6 border-b border-border">
            {tabWidths.map((width, index) => (
              <View
                key={index}
                className={cn(
                  "min-h-11 justify-center border-b-2 pb-2.5 pt-1",
                  index === 0 ? "border-b-accent" : "border-b-transparent",
                )}
                style={{ marginBottom: -1 }}
              >
                <SkeletonBlock style={{ width, height: 15 }} />
              </View>
            ))}
          </View>

          {series ? (
            <View className="gap-[18px]">
              <SeasonPickerSkeleton />
              {/* Episode count. The Select pill only exists for downloaded
                  episodes, so it is not part of the online first paint. */}
              <View className="flex-row items-center justify-between">
                <SkeletonBlock style={{ width: 64, height: 12 }} />
              </View>
              <EpisodeListSkeleton count={4} />
            </View>
          ) : (
            <TitlePosterGridSkeleton />
          )}
        </View>
      </ScrollView>

      {/* Fixed bottom action bar. */}
      <View
        className="absolute bottom-0 left-0 right-0 flex-row gap-3 border-t border-t-border bg-background px-5 pt-3"
        style={{ paddingBottom: Math.max(insets.bottom, 14) }}
      >
        <SkeletonBlock
          style={{
            flex: 1,
            height: control.height,
            borderRadius: control.radius,
          }}
        />
        <SkeletonBlock
          style={{
            width: control.height,
            height: control.height,
            borderRadius: control.radius,
          }}
        />
      </View>
    </View>
  );
}
