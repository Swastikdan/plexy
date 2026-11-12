import { useState } from "react";
import { Pressable,StyleSheet,Text,View } from "react-native";
import type { ItemCard } from "../../../core/library/catalog-api";
import { colors,fonts } from "../../../shared/theme";
import { Play } from "../../../shared/ui/icons";
import { PosterImage } from "../../../shared/ui/poster-image";

export function ContinueWatchingCard({
  item,
  api,
  preferred,
  onPress,
  onFocus,
}: {
  item: ItemCard;
  api: any;
  preferred?: boolean;
  onPress: () => void;
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
      onFocus={() => {
        setFocus(true);
        onFocus?.();
      }}
      onBlur={() => setFocus(false)}
      style={({ pressed }) => [styles.cwCard, pressed && { opacity: 0.8 }]}
    >
      {/* 16:9 Thumbnail container */}
      <View style={styles.cwThumbWrap}>
        <PosterImage source={api.image(item.backdrop || item.poster)} />
        {!item.backdrop && !item.poster && (
          <View style={[styles.cwThumb, styles.cwThumbPlaceholder]} />
        )}

        {/* White focus ring when selected */}
        {focus && <View style={styles.cwFocusRing} pointerEvents="none" />}

        {/* Top-left badge: Episode number */}
        {epLabel && (
          <View style={styles.cwBadge}>
            <Text style={styles.cwBadgeText}>{epLabel}</Text>
          </View>
        )}

        {/* Center play icon overlay */}
        <View style={styles.cwPlayCircle}>
          <Play size={16} color="#fff" fill="#fff" />
        </View>

        {/* Linear progress bar at the bottom */}
        {progressRatio > 0 && (
          <View style={styles.cwProgressBar}>
            <View
              style={[
                styles.cwProgressFill,
                { width: `${Math.round(progressRatio * 100)}%` },
              ]}
            />
          </View>
        )}
      </View>

      {/* Info below thumbnail */}
      <View style={styles.cwInfo}>
        <Text style={styles.cwTitle} numberOfLines={1}>
          {title}
        </Text>
        {!!subtitle && (
          <Text style={styles.cwSubtitle} numberOfLines={1}>
            {subtitle}
          </Text>
        )}
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
cwCard: {
    width: 168,
    gap: 6,
  },
cwFocusRing: {
    position: "absolute" as const,
    left: 0,
    right: 0,
    top: 0,
    bottom: 0,
    borderWidth: 2.5,
    borderColor: "#ffffff",
    borderRadius: 8,
    zIndex: 5,
  },
cwThumbWrap: {
    width: "100%",
    aspectRatio: 16 / 9,
    borderRadius: 8,
    overflow: "hidden",
    backgroundColor: colors.surface,
    justifyContent: "center",
    alignItems: "center",
  },
cwThumb: {
    width: "100%",
    height: "100%",
  },
cwThumbPlaceholder: {
    backgroundColor: colors.elevated,
  },
cwBadge: {
    position: "absolute",
    top: 6,
    left: 6,
    backgroundColor: "rgba(0,0,0,0.72)",
    borderRadius: 4,
    paddingHorizontal: 5,
    paddingVertical: 1.5,
  },
cwBadgeText: {
    fontFamily: fonts.bold,
    fontSize: 9.5,
    color: "#fff",
  },
cwPlayCircle: {
    position: "absolute",
    width: 26,
    height: 26,
    borderRadius: 13,
    backgroundColor: "rgba(0,0,0,0.55)",
    borderWidth: 1.5,
    borderColor: "rgba(255,255,255,0.8)",
    alignItems: "center",
    justifyContent: "center",
    paddingLeft: 2,
  },
cwProgressBar: {
    position: "absolute",
    bottom: 0,
    left: 0,
    right: 0,
    height: 2.5,
    backgroundColor: "rgba(255,255,255,0.2)",
  },
cwProgressFill: {
    height: "100%",
    backgroundColor: colors.brand,
  },
cwInfo: {
    gap: 2,
  },
cwTitle: {
    fontFamily: fonts.bold,
    fontSize: 12,
    lineHeight: 15,
    color: colors.ink,
  },
cwSubtitle: {
    fontFamily: fonts.regular,
    fontSize: 10.5,
    color: colors.muted,
  }
});
