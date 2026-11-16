import Animated, { useReducedMotion } from "react-native-reanimated";
import { LinearGradient } from "expo-linear-gradient";
import { useState } from "react";
import { Pressable,Text,View } from "react-native";
import type { ItemCard,LocalCatalog } from "@/core/library/catalog-api";
import { useColors } from "@/shared/theme";
import { Film, Tv , Check, Globe } from "./icons";
import { PosterImage } from "./poster-image";
import { Label } from "./text";

const AnimatedPressable = Animated.createAnimatedComponent(Pressable);

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
  const reducedMotion = useReducedMotion();
  const [pressed, setPressed] = useState(false);
  const [focus, setFocus] = useState(false);
  const [failedPoster, setFailedPoster] = useState<string | null>(null);
  const isEpisode = item.kind === "episode";
  const aspectRatio = isEpisode ? 16 / 9 : 2 / 3;
  const cardWidth = width || 150;
  const hasProgress = !!item.watch && !item.watch.played;
  const isWatched = item.watch?.played;
  const showPoster = Boolean(item.poster) && failedPoster !== item.poster;
  return (
    <AnimatedPressable
      accessibilityRole="button"
      accessibilityLabel={`${item.parentTitle ? item.parentTitle + ", " : ""}${item.name}${online ? ", online" : ""}${isWatched ? ", watched" : ""}`}
      onFocus={() => {
        setFocus(true);
        onFocus?.();
      }}
      onBlur={() => setFocus(false)}
      onPressIn={() => setPressed(true)}
      onPressOut={() => setPressed(false)}
      pressRetentionOffset={16}
      onPress={onPress}
      onLongPress={onLongPress}
      delayLongPress={1000}
      style={{
        width: cardWidth,
        transform: [{ scale: pressed && !reducedMotion ? 0.97 : 1 }],
        transitionProperty: "transform",
        transitionDuration: reducedMotion ? 0 : 120,
        transitionTimingFunction: "cubic-bezier(0.23, 1, 0.32, 1)",
      }}
      className="gap-2 active:opacity-90"
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
              source={api.image(item.poster)}
              onError={() => setFailedPoster(item.poster)}
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
        {online && (
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
            <View className="h-5 w-5 items-center justify-center rounded-full bg-accent">
              <Check size={10} color="#fff" strokeWidth={2.5} />
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
    </AnimatedPressable>
  );
}
