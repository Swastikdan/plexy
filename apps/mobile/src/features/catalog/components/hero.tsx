import { LinearGradient } from "expo-linear-gradient";
import React from "react";
import { Image, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useClient } from "@/core/client/client-provider";
import type { ItemCard } from "@/core/library/catalog-api";
import { useColors, withAlpha } from "@/shared/theme";
import { PosterImage } from "@/shared/ui/poster-image";
import { HeroActions } from "./hero-actions";

export function Hero({
  item,
  logo,
  onOpen,
  actionLabel,
  disabled,
  onDetails,
  onTrailer,
  onToggleWatched,
  isWatched,
  onDelete,
  width,
  preferred,
  onHeroFocus,
  hideActions = false,
  showOverview = true,
  contentBottom,
}: {
  hideActions?: boolean;
  showOverview?: boolean;
  contentBottom?: number;
  item: ItemCard;
  logo?: string | null;
  onOpen: () => void;
  actionLabel?: string;
  disabled?: boolean;
  onDetails?: () => void;
  onTrailer?: () => void;
  onToggleWatched?: () => void;
  isWatched?: boolean;
  onDelete?: () => void;
  width?: number;
  preferred?: boolean;
  onHeroFocus?: () => void;
}) {
  const colors = useColors();
  const { api } = useClient();
  const insets = useSafeAreaInsets();
  // Build metadata line: Year, runtime, rating, episode info, and genres all in the same row
  const metaParts: React.ReactNode[] = [];
  if (item.year) metaParts.push(String(item.year));
  if (item.runtime) metaParts.push(`${item.runtime}m`);
  if (
    (item as any).seasonNumber != null &&
    (item as any).episodeNumber != null
  ) {
    metaParts.push(
      `S${(item as any).seasonNumber} E${(item as any).episodeNumber}`,
    );
  }
  if (item.rating != null) {
    metaParts.push(
      <Text
        key="rating"
        className="font-archivo-bold text-[11px] text-foreground/85"
      >
        ★ {item.rating.toFixed(1)}
      </Text>,
    );
  }
  if (item.genres?.length > 0) {
    metaParts.push(item.genres.slice(0, 3).join(", "));
  }
  return (
    <View
      className="w-full justify-end overflow-hidden"
      style={[{ height: 540 + insets.top }, width ? { width } : null]}
    >
      {item.poster ? (
        <PosterImage
          source={api.image(item.poster)}
          style={StyleSheet.absoluteFill as never}
          resizeMode="cover"
        />
      ) : item.backdrop ? (
        <PosterImage
          source={api.image(item.backdrop)}
          style={StyleSheet.absoluteFill as never}
          resizeMode="cover"
        />
      ) : null}

      {/* Bottom fade to canvas */}
      <LinearGradient
        colors={[withAlpha(colors.canvas, 0), withAlpha(colors.canvas, 0.88), colors.canvas]}
        locations={[0.25, 0.72, 1]}
        style={StyleSheet.absoluteFill}
      />

      {/* Content: Title full width, metadata with genres inline, Play button + Action icons */}
      <View
        className="max-w-full gap-2.5 px-5 pb-[28px]"
        style={contentBottom != null ? { paddingBottom: contentBottom } : null}
      >
        {/* Slide header: non-focusable, unselectable title, logo, metadata and overview */}
        <View className="rounded-[8px] p-[2px]">
          {logo ? (
            <Image
              source={api.image(logo)}
              accessibilityLabel={item.name}
              className="mb-2 h-[70px] w-[240px]"
              resizeMode="contain"
            />
          ) : (
            <Text
              className="font-archivo-black text-[36px] leading-[42px] tracking-[-0.5px] text-foreground"
              numberOfLines={2}
              selectable={false}
            >
              {item.name}
            </Text>
          )}

          {/* Metadata row under title: Year, rating, and genres in the exact same row */}
          {metaParts.length > 0 && (
            <View className="flex-row flex-wrap items-center gap-[5px]">
              {metaParts.map((part, index) => (
                <React.Fragment key={index}>
                  {index > 0 && (
                    <Text className="text-[11px] text-foreground/50">·</Text>
                  )}
                  {typeof part === "string" ? (
                    <Text
                      className="font-archivo-medium text-[11px] text-foreground/75"
                      selectable={false}
                    >
                      {part}
                    </Text>
                  ) : (
                    part
                  )}
                </React.Fragment>
              ))}
            </View>
          )}

          {/* 2-line synopsis / overview */}
          {showOverview && !!item.overview && (
            <Text
              className="mt-1 font-archivo-regular text-[12px] leading-[18px] text-foreground/78"
              numberOfLines={2}
              selectable={false}
            >
              {item.overview}
            </Text>
          )}
        </View>

        {/* CTA row: Big Play button (primary) + Action icon buttons */}
        <HeroActions
          item={item}
          onOpen={onOpen}
          actionLabel={actionLabel}
          disabled={disabled}
          onDetails={onDetails}
          onTrailer={onTrailer}
          onToggleWatched={onToggleWatched}
          isWatched={isWatched}
          onDelete={onDelete}
          onHeroFocus={onHeroFocus}
          hideActions={hideActions}
        />
      </View>
    </View>
  );
}
