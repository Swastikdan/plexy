import { LinearGradient } from "expo-linear-gradient";
import { useState } from "react";
import { Pressable,StyleSheet,Text,View } from "react-native";
import type { ItemCard,LocalCatalog } from "../../core/library/catalog-api";
import { colors,fonts } from "../theme";
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
      style={({ pressed }) => [
        {
          width: cardWidth,
          gap: 8,
          opacity: pressed ? 0.9 : 1,
          // Press feedback on the compositor: scale only, no layout work.
          transform: [{ scale: pressed ? 0.97 : 1 }],
        },
      ]}
    >
      {/* Image container */}
      <View
        style={[
          styles.cardImageWrap,
          { aspectRatio },
          focus && styles.cardImageFocusedTv,
        ]}
      >
        {/* Poster placeholder */}
        <View style={styles.cardPlaceholder} pointerEvents="none">
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
          style={styles.cardGradient}
          pointerEvents="none"
        />

        {/* Episode badge: E1 and duration chip on top-left (as in reference screenshots) */}
        {isEpisode && (
          <View style={styles.cardChipRow}>
            {item.episodeNumber != null && (
              <View style={styles.cardChip}>
                <Text style={styles.cardChipText}>E{item.episodeNumber}</Text>
              </View>
            )}
            {!!item.runtime && (
              <View style={styles.cardChip}>
                <Text style={styles.cardChipText}>{item.runtime}:00</Text>
              </View>
            )}
          </View>
        )}

        {/* Title overlay at bottom */}
        <View style={styles.cardTitleOverlay} pointerEvents="none">
          <Text numberOfLines={2} style={styles.cardOverlayTitle}>
            {item.parentTitle ? `${item.parentTitle}: ${item.name}` : item.name}
          </Text>
        </View>

        {/* Progress bar */}
        {hasProgress && (
          <View style={styles.progressTrack}>
            <View
              style={[
                styles.progressFill,
                { width: `${item.watch!.percent}%` },
              ]}
            />
          </View>
        )}

        {/* Watched badge */}
        {isWatched && (
          <View style={styles.watchedBadge}>
            <Check size={10} color="#fff" strokeWidth={2.5} />
          </View>
        )}
      </View>

      {/* Below-image meta */}
      <Label
        muted
        numberOfLines={1}
        style={{ fontSize: 11, fontFamily: fonts.medium }}
      >
        {isEpisode
          ? `Episode ${item.episodeNumber || 1}`
          : item.year || (item.kind === "series" ? "Series" : "Movie")}
      </Label>
    </Pressable>
  );
}

const styles = StyleSheet.create({
cardImageWrap: {
    backgroundColor: colors.elevated,
    borderRadius: 8,
    overflow: "hidden",
    justifyContent: "center",
    alignItems: "center",
  },
cardImageFocusedTv: {
    shadowColor: "#000",
    shadowOpacity: 0.5,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 3 },
  },
cardPlaceholder: {
    ...StyleSheet.absoluteFill,
    alignItems: "center",
    justifyContent: "center",
  },
cardGradient: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 0,
    height: "55%",
  },
cardTitleOverlay: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 18,
    paddingHorizontal: 10,
  },
cardOverlayTitle: {
    fontFamily: fonts.bold,
    fontSize: 12,
    color: "#fff",
    lineHeight: 16,
    textShadowColor: "rgba(0,0,0,0.6)",
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 4,
  },
progressTrack: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 0,
    height: 2,
    backgroundColor: "rgba(255,255,255,0.15)",
  },
progressFill: {
    height: 2,
    backgroundColor: colors.brand,
  },
cardChipRow: {
    position: "absolute",
    top: 8,
    left: 8,
    flexDirection: "row",
    gap: 5,
    zIndex: 2,
  },
cardChip: {
    backgroundColor: "rgba(0,0,0,0.65)",
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 6,
    borderWidth: 0.5,
    borderColor: "rgba(255,255,255,0.15)",
  },
cardChipText: {
    color: "#fff",
    fontSize: 10,
    fontFamily: fonts.bold,
  },
watchedBadge: {
    position: "absolute",
    top: 7,
    right: 7,
    width: 20,
    height: 20,
    borderRadius: 10,
    backgroundColor: colors.brand,
    alignItems: "center",
    justifyContent: "center",
  }
});
