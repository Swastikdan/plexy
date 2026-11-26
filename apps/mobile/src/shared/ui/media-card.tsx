import { LinearGradient } from "expo-linear-gradient";
import { useState } from "react";
import { Text,View } from "react-native";
import { useClient } from "@/core/client/client-provider";
import type { ItemCard,LocalCatalog } from "@/core/library/catalog-api";
import { rememberTitlePreview } from "@/core/library/title-prefetch";
import { LONG_PRESS_MS } from "@/shared/lib/press";
import { useColors } from "@/shared/theme";
import { Film, Tv, Globe } from "./icons";
import { PosterImage } from "./poster-image";
import { Label } from "./text";
import { Tappable } from "./tappable";

export function Card({
  item,
  api,
  onPress,
  onLongPress,
  preferred,
  onFocus,
  width,
  online = false,
}: {
  item: ItemCard;
  api: LocalCatalog;
  onPress: () => void;
  onLongPress?: () => void;
  preferred?: boolean;
  onFocus?: () => void;
  width?: number;
  /** Online catalog item: shown with the globe badge on the poster. */
  online?: boolean;
}) {
  const colors = useColors();
  const { preferences } = useClient();
  const [focus, setFocus] = useState(false);
  const [failedPoster, setFailedPoster] = useState<string | null>(null);
  const isEpisode = item.kind === "episode";
  const aspectRatio = isEpisode ? 16 / 9 : 2 / 3;
  const cardWidth = width || 150;
  const hasProgress = !!item.watch && !item.watch.played;
  const isWatched = item.watch?.played;
  // Prefer the poster, but a backdrop is still a title card: only fall back to
  // the text treatment when neither artwork is available (or both fail).
  const artwork =
    item.poster && failedPoster !== item.poster
      ? item.poster
      : item.backdrop && failedPoster !== item.backdrop
        ? item.backdrop
        : null;
  const showPoster = Boolean(artwork);
  const showOnline = online && preferences.mode === "hybrid";
  return (
    <Tappable
      feedback="scale"
      accessibilityRole="button"
      accessibilityLabel={`${item.parentTitle ? item.parentTitle + ", " : ""}${item.name}${showOnline ? ", online" : ""}${isWatched ? ", watched" : ""}`}
      onFocus={() => {
        setFocus(true);
        onFocus?.();
      }}
      onBlur={() => setFocus(false)}
      pressRetentionOffset={16}
      onPress={() => {
        rememberTitlePreview(item);
        onPress();
      }}
      onLongPress={onLongPress}
      delayLongPress={LONG_PRESS_MS}
      style={{ width: cardWidth }}
      className="gap-2"
    >
      <View
        style={[
          { aspectRatio },
          focus && {
            // RN-only shadow: kept as a style (TV focus depth).
            shadowColor: "#000",
            shadowOpacity: 0.5,
            shadowRadius: 8,
            shadowOffset: { width: 0, height: 3 },
          },
        ]}
        className="bg-surface-secondary rounded-lg overflow-hidden justify-center items-center"
      >
        {showPoster ? (
          <>
            <View className="absolute inset-0 items-center justify-center" pointerEvents="none">
              {item.kind === "series" ? <Tv size={40} color={colors.quiet} /> : <Film size={40} color={colors.quiet} />}
            </View>
            <PosterImage
              source={api.image(artwork!)}
              onError={() => setFailedPoster(artwork)}
            />
          </>
        ) : (
          <View className="absolute inset-0 items-center justify-center px-3" pointerEvents="none">
            <Text
              numberOfLines={3}
              className="text-center font-archivo-bold text-[15px] leading-5 text-foreground/80"
            >
              {item.parentTitle
                ? `${item.parentTitle}: ${item.name}`
                : item.name}
            </Text>
          </View>
        )}
        <LinearGradient
          colors={["transparent", "rgba(0,0,0,0.85)"]}
          style={{ position: "absolute", left: 0, right: 0, bottom: 0, height: "55%" }}
          pointerEvents="none"
        />
        {showOnline && (
          <View
            accessibilityLabel="Online title"
            className="absolute left-2 top-2 z-[3] h-[22px] w-[22px] items-center justify-center rounded-full bg-accent"
          >
            <Globe size={13} color="#fff" strokeWidth={2.1} />
          </View>
        )}
        {isEpisode && (
          <View className="absolute top-2 left-2 flex-row gap-[5px] z-[2]">
            {item.episodeNumber != null && (
              <View className="bg-black/[0.65] px-1.5 py-0.5 rounded-md border-[0.5px] border-white/[0.15]">
                <Text className="text-white text-[10px] font-archivo-bold">E{item.episodeNumber}</Text>
              </View>
            )}
            {!!item.runtime && (
              <View className="bg-black/[0.65] px-1.5 py-0.5 rounded-md border-[0.5px] border-white/[0.15]">
                <Text className="text-white text-[10px] font-archivo-bold">{item.runtime}:00</Text>
              </View>
            )}
          </View>
        )}
        {showPoster && (
          <View className="absolute left-0 right-0 bottom-[18px] px-2.5" pointerEvents="none">
            <Text
              numberOfLines={1}
              ellipsizeMode="tail"
              className="text-[12px] leading-4 text-white font-archivo-bold"
              style={{
                textShadowColor: "rgba(0,0,0,0.6)",
                textShadowOffset: { width: 0, height: 1 },
                textShadowRadius: 4,
              }}
            >
              {item.parentTitle ? `${item.parentTitle}: ${item.name}` : item.name}
            </Text>
          </View>
        )}
        {hasProgress && (
          <View className="absolute left-0 right-0 bottom-0 h-[2px] bg-white/[0.15]">
            <View
              className="h-[2px] bg-accent"
              style={{ width: `${item.watch!.percent}%` }}
            />
          </View>
        )}
        <View className="absolute right-[7px] top-[7px] z-[3] flex-row items-center gap-1.5">
          {isWatched && (
            <View className="rounded-[4px] bg-accent px-1.5 py-0.5">
              <Text className="font-archivo-bold text-[9px] text-white">Watched</Text>
            </View>
          )}
          <View className="rounded-[4px] border-[0.5px] border-white/[0.2] bg-black/[0.65] px-1.5 py-0.5">
            <Text className="font-archivo-bold text-[9px] tracking-[0.2px] text-white">
              {isEpisode || item.kind === "series" ? "TV" : "Movie"}
            </Text>
          </View>
        </View>
      </View>
      {isEpisode && (
        <View className="flex-row items-center gap-1.5">
          <Label
            muted
            numberOfLines={1}
            className="text-[11px] font-archivo-medium"
          >
            Episode {item.episodeNumber || 1}
          </Label>
        </View>
      )}
    </Tappable>
  );
}
