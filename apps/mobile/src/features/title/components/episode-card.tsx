import { useState } from "react";
import { Image,Pressable,StyleSheet,Text,View } from "react-native";
import type { ItemCard } from "../../../core/library/catalog-api";
import { colors,control,fonts } from "../../../shared/theme";
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
      style={({ pressed }) => [styles.epCard, pressed && { opacity: 0.8 }]}
    >
      {/* Thumbnail with centered play button */}
      <View style={styles.epThumbWrap}>
        {ep.poster ? (
          <Image
            source={api.image(ep.poster)}
            style={styles.epThumb}
            resizeMode="cover"
          />
        ) : (
          <View style={[styles.epThumb, styles.epThumbPlaceholder]} />
        )}

        {/* Center play icon button */}
        <View style={[styles.epPlayOverlay]}>
          <Play size={18} color={"#fff"} fill={"#fff"} />
        </View>

        {/* Duration badge */}
        {duration && (
          <View style={styles.epDuration}>
            <Text style={styles.epDurationText}>{duration}</Text>
          </View>
        )}

        {/* Progress bar on thumbnail */}
        {(progress !== null || watched) && (
          <View style={styles.epProgressBar}>
            <View
              style={[
                styles.epProgressFill,
                watched
                  ? styles.epProgressWatched
                  : { width: `${Math.round(progress! * 100)}%` },
              ]}
            />
          </View>
        )}
      </View>

      {/* Info: Title, 2-line description, and small Episode {number} at the bottom */}
      <View style={styles.epInfo}>
        <View
          style={{
            flexDirection: "row",
            alignItems: "flex-start",
            justifyContent: "space-between",
            gap: 8,
          }}
        >
          <Text style={[styles.epTitle, { flex: 1 }]} numberOfLines={1}>
            {epDisplayTitle}
          </Text>

          {/* Watched state */}
          <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
            {onToggleWatched && (
              <Pressable
                onPress={() => onToggleWatched(ep)}
                hitSlop={10}
                style={({ pressed }) => [
                  styles.epWatchedBtn,
                  watched && styles.epWatchedBtnActive,
                  pressed && { opacity: 0.6 },
                ]}
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

        <Text style={styles.epOverview} numberOfLines={2}>
          {ep.overview || "No description available."}
        </Text>
        {ep.episodeNumber != null && (
          <Text style={styles.epNumberBottom}>
            {`Episode ${ep.episodeNumber}`}
          </Text>
        )}
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
epCard: {
    flexDirection: "row",
    gap: 14,
    paddingVertical: 12,
    paddingHorizontal: 8,
    borderRadius: 10,
  },
epThumbWrap: {
    width: 148,
    aspectRatio: 16 / 9,
    borderRadius: 8,
    overflow: "hidden",
    backgroundColor: colors.surface,
    flexShrink: 0,
  },
epThumb: {
    width: "100%",
    height: "100%",
  },
epThumbPlaceholder: {
    backgroundColor: colors.elevated,
  },
epDuration: {
    position: "absolute",
    top: 6,
    right: 6,
    backgroundColor: "rgba(0,0,0,0.65)",
    borderRadius: 5,
    paddingHorizontal: 6,
    paddingVertical: 2,
  },
epDurationText: {
    fontFamily: fonts.medium,
    fontSize: 10,
    color: "#fff",
  },
epProgressBar: {
    position: "absolute",
    bottom: 0,
    left: 0,
    right: 0,
    height: 3,
    backgroundColor: "rgba(255,255,255,0.18)",
  },
epProgressFill: {
    height: "100%",
    backgroundColor: colors.brand,
    borderRadius: 2,
  },
epProgressWatched: {
    width: "100%",
    backgroundColor: colors.brand,
  },
epInfo: {
    flex: 1,
    gap: 6,
    justifyContent: "center",
  },
epTitle: {
    fontFamily: fonts.bold,
    fontSize: 14,
    color: colors.ink,
  },
epOverview: {
    fontFamily: fonts.regular,
    fontSize: 12,
    color: colors.muted,
    lineHeight: 18,
  },
epPlayOverlay: {
    position: "absolute",
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: "rgba(0,0,0,0.55)",
    borderWidth: 1.5,
    borderColor: "rgba(255,255,255,0.85)",
    alignItems: "center",
    justifyContent: "center",
    paddingLeft: 2,
    top: "50%",
    left: "50%",
    marginTop: -19,
    marginLeft: -19,
  },
epNumberBottom: {
    fontFamily: fonts.medium,
    fontSize: 11,
    color: colors.muted,
    marginTop: 4,
  },
epWatchedBtn: {
    padding: 6,
    borderRadius: control.radius,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.line,
    alignItems: "center",
    justifyContent: "center",
  },
epWatchedBtnActive: {
    backgroundColor: "rgba(34, 197, 94, 0.15)",
    borderColor: "rgba(34, 197, 94, 0.4)",
  }
});
