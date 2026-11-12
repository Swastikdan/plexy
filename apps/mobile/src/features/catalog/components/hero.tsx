import { LinearGradient } from "expo-linear-gradient";
import React from "react";
import { Image, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useClient } from "../../../core/client/client-provider";
import type { ItemCard } from "../../../core/library/catalog-api";
import { colors, control, fonts } from "../../../shared/theme";
import { PosterImage } from "../../../shared/ui/poster-image";
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
  contentBottom,
}: {
  hideActions?: boolean;
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
      <Text key="rating" style={styles.heroMetaRating}>
        ★ {item.rating.toFixed(1)}
      </Text>,
    );
  }
  if (item.genres?.length > 0) {
    metaParts.push(item.genres.slice(0, 3).join(", "));
  }
  return (
    <View
      style={[
        styles.heroContainer,
        { height: 540 + insets.top },
        width ? { width } : null,
      ]}
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

      {/* Top tint for transparent header and logo readability */}
      <LinearGradient
        colors={[colors.canvas, "rgba(0,0,0,0.85)", "rgba(0,0,0,0)"]}
        style={[StyleSheet.absoluteFill, { height: insets.top + 112 }]}
        locations={[0, 0.5, 1]}
      />

      {/* Bottom fade to canvas */}
      <LinearGradient
        colors={["transparent", "rgba(0,0,0,0.72)", colors.canvas]}
        locations={[0.25, 0.72, 1]}
        style={StyleSheet.absoluteFill}
      />

      {/* Content: Title full width, metadata with genres inline, Play button + Action icons */}
      <View
        style={[
          styles.heroContent,
          contentBottom != null && { paddingBottom: contentBottom },
        ]}
      >
        {/* Slide header: non-focusable, unselectable title, logo, metadata and overview */}
        <View style={styles.heroSlideHeader}>
          {logo ? (
            <Image
              source={api.image(logo)}
              accessibilityLabel={item.name}
              style={[styles.heroLogo]}
              resizeMode="contain"
            />
          ) : (
            <Text
              style={[styles.heroTitle]}
              numberOfLines={2}
              selectable={false}
            >
              {item.name}
            </Text>
          )}

          {/* Metadata row under title: Year, rating, and genres in the exact same row */}
          {metaParts.length > 0 && (
            <View style={styles.heroMetaRow}>
              {metaParts.map((part, index) => (
                <React.Fragment key={index}>
                  {index > 0 && <Text style={styles.heroMetaDot}>·</Text>}
                  {typeof part === "string" ? (
                    <Text style={styles.heroMetaText} selectable={false}>
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
          {!!item.overview && (
            <Text
              style={styles.heroOverview}
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

const styles = StyleSheet.create({
  heroContainer: {
    width: "100%",
    justifyContent: "flex-end",
    overflow: "hidden",
  },
  heroContent: {
    paddingHorizontal: 20,
    paddingBottom: 28,
    gap: 10,
    maxWidth: "100%",
  },
  heroTitle: {
    fontFamily: fonts.black,
    fontSize: 36,
    color: "#fff",
    lineHeight: 42,
    letterSpacing: -0.5,
  },
  heroMetaRow: {
    flexDirection: "row",
    alignItems: "center",
    flexWrap: "wrap",
    gap: 5,
  },
  heroMetaText: {
    fontFamily: fonts.medium,
    fontSize: 11,
    color: "rgba(255,255,255,0.75)",
  },
  heroMetaDot: {
    color: "rgba(255,255,255,0.5)",
    fontSize: 11,
  },
  heroLogo: {
    width: 240,
    height: 70,
    marginBottom: 8,
  },
  heroOverview: {
    fontFamily: fonts.regular,
    fontSize: 12,
    lineHeight: 18,
    color: "rgba(255,255,255,0.78)",
    marginTop: 4,
  },
  heroSlideHeader: {
    borderRadius: 8,
    padding: 2,
  },
  heroMetaRating: {
    fontFamily: fonts.bold,
    fontSize: 11,
    color: "rgba(255,255,255,0.85)",
  },
});
