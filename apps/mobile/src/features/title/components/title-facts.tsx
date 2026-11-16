import React from "react";
import { Text, View } from "react-native";
import type { ItemCard, TitleDetail } from "@/core/library/catalog-api";
import { useColors, withAlpha } from "@/shared/theme";
import { Globe, Star } from "@/shared/ui/icons";

/** "4K", "HD" or "SD" from an analysed file, for the badge beside the facts. */
export function qualityLabel(detail: TitleDetail | null): string | null {
  const height = detail?.file?.height;
  if (!height) return null;
  return height >= 2160 ? "4K" : height >= 720 ? "HD" : "SD";
}

/**
 * The centered fact line under the hero: an age-rating-style badge followed by
 * year, length and genres. Mirrors the compact Crunchyroll metadata row.
 */
export function TitleFactLine({
  item,
  detail,
  online,
  isOffline,
}: {
  item: ItemCard;
  detail: TitleDetail | null;
  online: boolean;
  isOffline: boolean;
}) {
  const colors = useColors();
  const genres = (
    detail?.metadata?.genres?.length ? detail.metadata.genres : item.genres
  ).slice(0, 3);
  const badge =
    detail?.metadata?.certification || qualityLabel(detail) || null;
  const showOnline = online && !isOffline;
  const seasons = detail?.seasons?.length ?? 0;
  const facts = [
    item.year ? String(item.year) : null,
    item.kind === "series"
      ? seasons > 0
        ? `${seasons} ${seasons === 1 ? "Season" : "Seasons"}`
        : null
      : item.runtime
        ? `${item.runtime} min`
        : null,
    genres.length ? genres.join(", ") : null,
  ].filter((fact): fact is string => Boolean(fact));

  if (!badge && !showOnline && !facts.length) return null;
  return (
    <View className="flex-row flex-wrap items-center justify-center gap-x-2 gap-y-1">
      {showOnline ? (
        <View
          accessibilityLabel="Online title"
          className="items-center justify-center rounded-[4px] border border-foreground/35 px-1.5 py-[2px]"
        >
          <Globe size={12} color={colors.brand} strokeWidth={2} />
        </View>
      ) : null}
      {badge ? (
        <View className="rounded-[4px] border border-foreground/35 px-1.5 py-[2px]">
          <Text className="font-archivo-bold text-[10px] tracking-[0.3px] text-foreground/80">
            {badge}
          </Text>
        </View>
      ) : null}
      {facts.map((fact, index) => (
        <React.Fragment key={fact}>
          {(index > 0 || Boolean(badge) || showOnline) && (
            <Text className="text-[11px] text-muted">•</Text>
          )}
          <Text className="font-archivo-medium text-[12px] text-foreground/75">
            {fact}
          </Text>
        </React.Fragment>
      ))}
    </View>
  );
}

const STAR_SIZE = 21;

/** Five stars showing the score out of five. Filled stars follow the theme ink
 * so they read black in light mode and white in dark mode. */
export function TitleRating({ rating }: { rating: number | null }) {
  const colors = useColors();
  if (rating == null) return null;
  const score = Math.max(0, Math.min(5, rating / 2));
  return (
    <View
      accessibilityRole="image"
      accessibilityLabel={`Average rating ${score.toFixed(1)} out of 5`}
      style={{ width: STAR_SIZE * 5, height: STAR_SIZE }}
    >
      <View className="flex-row">
        {Array.from({ length: 5 }, (_, index) => (
          <Star
            key={index}
            size={STAR_SIZE}
            color={withAlpha(colors.ink, 0.22)}
            fill={withAlpha(colors.ink, 0.22)}
            strokeWidth={1.4}
          />
        ))}
      </View>
      <View
        className="absolute inset-y-0 left-0 overflow-hidden"
        style={{ width: (score / 5) * STAR_SIZE * 5 }}
      >
        <View className="flex-row">
          {Array.from({ length: 5 }, (_, index) => (
            <Star
              key={index}
              size={STAR_SIZE}
              color={colors.ink}
              fill={colors.ink}
              strokeWidth={1.4}
            />
          ))}
        </View>
      </View>
    </View>
  );
}
