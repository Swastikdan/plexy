import { useState } from "react";
import { Image,Pressable,Text,View } from "react-native";
import type { ItemCard } from "../../../core/library/catalog-api";
import { cn } from "../../../shared/lib/cn";
import { colors } from "../../../shared/theme";
import { Check,Play } from "../../../shared/ui/icons";

export function EpisodeCard({
  ep,
  api,
  platform,
  play,
  item,
  onToggleWatched,
}: {
  ep: any;
  api: any;
  platform: any;
  play: (fileId: number) => void;
  item: ItemCard;
  onToggleWatched?: (ep: any) => void;
}) {
  const [, setFocused] = useState(false);
  const watched = Boolean(ep.watch?.played);
  const hasProgress = Boolean(ep.watch?.position && !watched);
  const duration = ep.runtime ? `${ep.runtime}:00` : null;
  const progress =
    hasProgress && ep.watch?.duration
      ? Math.min(1, ep.watch.position / ep.watch.duration)
      : null;
  // Clean redundant S01E01 / Season 1 Episode 1 prefixes
  const rawName = String(ep.name || "").trim();
  const cleanedTitle = rawName
    .replace(
      /^(?:S\d+[\s._-]*E\d+|Season\s*\d+\s*Episode\s*\d+|Episode\s*\d+)\s*[:·._-]?\s*/i,
      "",
    )
    .trim();
  // Show only the episode title; falls back to Episode {number} if name was empty
  const epDisplayTitle =
    cleanedTitle ||
    (ep.episodeNumber != null ? `Episode ${ep.episodeNumber}` : rawName);
  const epItem: ItemCard = {
    ...item,
    id: ep.id,
    name: ep.name || `Episode ${ep.episodeNumber}`,
    poster: ep.poster || item.poster,
    kind: "episode",
    seasonNumber: ep.seasonNumber,
    episodeNumber: ep.episodeNumber,
  };
  (epItem as any).seriesName = item.name;
  return (
    <Pressable
      onPress={() => ep.fileId && play(ep.fileId)}
      disabled={!ep.fileId}
      onFocus={() => setFocused(true)}
      onBlur={() => setFocused(false)}
      className="flex-row gap-[14px] rounded-[10px] px-2 py-3 active:opacity-80"
    >
      {/* Thumbnail with centered play button */}
      <View className="aspect-[16/9] w-[148px] shrink-0 overflow-hidden rounded-lg bg-surface">
        {ep.poster ? (
          <Image
            source={api.image(ep.poster)}
            className="h-full w-full"
            resizeMode="cover"
          />
        ) : (
          <View className="h-full w-full bg-surface-secondary" />
        )}

        {/* Center play icon button */}
        <View className="absolute left-1/2 top-1/2 -ml-[19px] -mt-[19px] h-[38px] w-[38px] items-center justify-center rounded-full border-[1.5px] border-white/[0.85] bg-black/[0.55] pl-[2px]">
          <Play size={18} color={"#fff"} fill={"#fff"} />
        </View>

        {/* Duration badge */}
        {duration && (
          <View className="absolute right-1.5 top-1.5 rounded-[5px] bg-black/[0.65] px-1.5 py-0.5">
            <Text className="font-archivo-medium text-[10px] text-white">
              {duration}
            </Text>
          </View>
        )}

        {/* Progress bar on thumbnail */}
        {(progress !== null || watched) && (
          <View className="absolute bottom-0 left-0 right-0 h-[3px] bg-white/[0.18]">
            <View
              className={cn(
                "h-full rounded-[2px] bg-accent",
                watched && "w-full",
              )}
              style={
                watched
                  ? undefined
                  : { width: `${Math.round(progress! * 100)}%` }
              }
            />
          </View>
        )}
      </View>

      {/* Info: Title, 2-line description, and small Episode {number} at the bottom */}
      <View className="flex-1 justify-center gap-1.5">
        <View className="flex-row items-start justify-between gap-2">
          <Text
            className="flex-1 font-archivo-bold text-[14px] text-foreground"
            numberOfLines={1}
          >
            {epDisplayTitle}
          </Text>

          {/* Watched state */}
          <View className="flex-row items-center gap-1.5">
            {onToggleWatched && (
              <Pressable
                onPress={() => onToggleWatched(ep)}
                hitSlop={10}
                className={cn(
                  "items-center justify-center rounded-full border border-border bg-surface p-1.5 active:opacity-60",
                  watched && "border-[#22c55e]/[0.4] bg-[#22c55e]/[0.15]",
                )}
                accessibilityRole="button"
                accessibilityLabel={
                  watched
                    ? "Mark episode as unwatched"
                    : "Mark episode as watched"
                }
              >
                <Check
                  size={14}
                  color={watched ? "#22c55e" : colors.muted}
                  strokeWidth={watched ? 2.6 : 2}
                />
              </Pressable>
            )}
          </View>
        </View>

        <Text className="font-archivo-regular text-[12px] leading-[18px] text-muted" numberOfLines={2}>
          {ep.overview || "No description available."}
        </Text>
        {ep.episodeNumber != null && (
          <Text className="mt-1 font-archivo-medium text-[11px] text-muted">
            {`Episode ${ep.episodeNumber}`}
          </Text>
        )}
      </View>
    </Pressable>
  );
}
