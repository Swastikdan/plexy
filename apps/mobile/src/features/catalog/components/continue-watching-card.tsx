import { useState } from "react";
import { Pressable,Text,View } from "react-native";
import type { ItemCard } from "@/core/library/catalog-api";
import { Play } from "@/shared/ui/icons";
import { PosterImage } from "@/shared/ui/poster-image";

export function ContinueWatchingCard({
  item,
  api,
  preferred,
  onPress,
  onLongPress,
  onFocus,
}: {
  item: ItemCard;
  api: any;
  preferred?: boolean;
  onPress: () => void;
  onLongPress?: () => void;
  onFocus?: () => void;
}) {
  const position = item.watch?.position || 0;
  const duration =
    item.watch?.duration || (item.runtime ? item.runtime * 60 : 0);
  const progressRatio =
    duration > 0 ? Math.min(1, Math.max(0, position / duration)) : 0;
  const isSeries = item.kind === "series";
  const epNumber = isSeries
    ? null
    : ((item as any).episodeNumber ?? item.episodeNumber);
  const epLabel = epNumber != null ? `E${epNumber}` : null;
  const rawName = String(item.name || "").trim();
  const cleanedName = rawName
    .replace(
      /^(?:S\d+[\s._-]*E\d+|Season\s*\d+\s*Episode\s*\d+|Episode\s*\d+)\s*[:·._-]?\s*/i,
      "",
    )
    .trim();
  const [focus, setFocus] = useState(false);
  const title = item.parentTitle || cleanedName || rawName;
  let subtitle = isSeries
    ? "TV Series"
    : epNumber != null
      ? `Episode ${epNumber}${cleanedName && item.parentTitle ? ` · ${cleanedName}` : ""}`
      : item.year
        ? `${item.year}`
        : "Resume playing";
  // Never repeat the title as its own subtitle
  if (subtitle === title) {
    subtitle = isSeries ? "TV Series" : "";
  }
  return (
    <Pressable
      onPress={onPress}
      onLongPress={onLongPress}
      delayLongPress={1000}
      onFocus={() => {
        setFocus(true);
        onFocus?.();
      }}
      onBlur={() => setFocus(false)}
      className="w-[168px] gap-1.5 active:opacity-80"
    >
      {/* 16:9 Thumbnail container */}
      <View
        className="w-full items-center justify-center overflow-hidden rounded-[8px] bg-surface"
        style={{ aspectRatio: 16 / 9 }}
      >
        <PosterImage source={api.image(item.backdrop || item.poster)} />
        {!item.backdrop && !item.poster && (
          <View className="h-full w-full bg-surface-secondary" />
        )}

        {/* White focus ring when selected */}
        {focus && (
          <View
            className="absolute inset-0 z-[5] rounded-[8px] border-[2.5px] border-white"
            pointerEvents="none"
          />
        )}

        {/* Top-left badge: Episode number */}
        {epLabel && (
          <View className="absolute left-[6px] top-[6px] rounded-[4px] bg-black/72 px-[5px] py-[1.5px]">
            <Text className="font-archivo-bold text-[9.5px] text-white">{epLabel}</Text>
          </View>
        )}

        {/* Center play icon overlay: solid white chip, black filled icon —
         * no outline ring, the icon is the content. */}
        <View className="absolute left-1/2 top-1/2 -ml-[19px] -mt-[19px] h-[38px] w-[38px] items-center justify-center rounded-[19px] bg-white">
          <Play size={20} color="#000" fill="#000" />
        </View>

        {/* Linear progress bar at the bottom */}
        {progressRatio > 0 && (
          <View className="absolute bottom-0 left-0 right-0 h-[2.5px] bg-white/20">
            <View
              className="h-full bg-accent"
              style={{ width: `${Math.round(progressRatio * 100)}%` }}
            />
          </View>
        )}
      </View>

      {/* Info below thumbnail */}
      <View className="gap-0.5">
        <Text
          className="font-archivo-bold text-[12px] leading-[15px] text-foreground"
          numberOfLines={1}
        >
          {title}
        </Text>
        {!!subtitle && (
          <Text
            className="font-archivo-regular text-[10.5px] text-muted"
            numberOfLines={1}
          >
            {subtitle}
          </Text>
        )}
      </View>
    </Pressable>
  );
}
