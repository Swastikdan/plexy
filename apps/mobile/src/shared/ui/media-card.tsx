import { LinearGradient } from "expo-linear-gradient";
import { useState } from "react";
import { Pressable,Text,View } from "react-native";
import type { ItemCard,LocalCatalog } from "../../core/library/catalog-api";
import { colors } from "../theme";
import { Icon } from "./icon";
import { Check } from "./icons";
import { PosterImage } from "./poster-image";
import { Label } from "./text";

export function Card({
  item,
  api,
  onPress,
  preferred,
  onFocus,
  width,
}: {
  item: ItemCard;
  api: LocalCatalog;
  onPress: () => void;
  preferred?: boolean;
  onFocus?: () => void;
  width?: number;
}) {
  const [focus, setFocus] = useState(false);
  const isEpisode = item.kind === "episode";
  const aspectRatio = isEpisode ? 16 / 9 : 2 / 3;
  const cardWidth = width || 150;
  const hasProgress = !!item.watch && !item.watch.played;
  const isWatched = item.watch?.played;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${item.parentTitle ? item.parentTitle + ", " : ""}${item.name}${isWatched ? ", watched" : ""}`}
      onFocus={() => {
        setFocus(true);
        onFocus?.();
      }}
      onBlur={() => setFocus(false)}
      onPress={onPress}
      style={{ width: cardWidth }}
      className="gap-2 active:opacity-90 active:scale-[0.97]"
    >
      {/* Image container */}
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
        {/* Poster placeholder */}
        <View className="absolute inset-0 items-center justify-center" pointerEvents="none">
          <Icon
            name={item.kind === "series" ? "tv" : "film"}
            size={40}
            color={colors.quiet}
          />
        </View>
        {/* Poster / thumbnail */}
        <PosterImage source={api.image(item.poster)} />
        {/* White focus ring when selected */}

        {/* Bottom gradient overlay */}
        <LinearGradient
          colors={["transparent", "rgba(0,0,0,0.85)"]}
          style={{ position: "absolute", left: 0, right: 0, bottom: 0, height: "55%" }}
          pointerEvents="none"
        />

        {/* Episode badge: E1 and duration chip on top-left (as in reference screenshots) */}
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

        {/* Title overlay at bottom */}
        <View className="absolute left-0 right-0 bottom-[18px] px-2.5" pointerEvents="none">
          <Text
            numberOfLines={2}
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

        {/* Progress bar */}
        {hasProgress && (
          <View className="absolute left-0 right-0 bottom-0 h-[2px] bg-white/[0.15]">
            <View
              className="h-[2px] bg-accent"
              style={{ width: `${item.watch!.percent}%` }}
            />
          </View>
        )}

        {/* Watched badge */}
        {isWatched && (
          <View className="absolute top-[7px] right-[7px] w-5 h-5 rounded-full bg-accent items-center justify-center">
            <Check size={10} color="#fff" strokeWidth={2.5} />
          </View>
        )}
      </View>

      {/* Below-image meta */}
      <Label
        muted
        numberOfLines={1}
        className="text-[11px] font-archivo-medium"
      >
        {isEpisode
          ? `Episode ${item.episodeNumber || 1}`
          : item.year || (item.kind === "series" ? "Series" : "Movie")}
      </Label>
    </Pressable>
  );
}
