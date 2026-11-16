import React from "react";
import { Text, useWindowDimensions, View } from "react-native";
import type { ItemCard, LocalCatalog } from "@/core/library/catalog-api";
import { Card } from "@/shared/ui/media-card";
import { Notice } from "@/shared/ui/notice";
import { SkeletonBlock } from "@/shared/ui/skeleton";

const COLUMNS = 3;
const GAP = 10;
const PAGE_PADDING = 20;

/**
 * The "More Like This" tab: a poster grid of recommendations, sized from the
 * viewport so three titles always fit without horizontal scrolling.
 */
export function MoreLikeThis({
  items,
  api,
  loading,
  error,
  retry,
  onSelect,
  onLongPress,
}: {
  items: ItemCard[];
  api: LocalCatalog;
  loading: boolean;
  error?: string | null;
  retry?: () => void;
  onSelect: (item: ItemCard) => void;
  onLongPress?: (item: ItemCard) => void;
}) {
  const { width } = useWindowDimensions();
  const cardWidth = Math.max(
    92,
    Math.floor(
      (width - PAGE_PADDING * 2 - GAP * (COLUMNS - 1)) / COLUMNS,
    ),
  );

  if (loading) {
    return (
      <View className="flex-row flex-wrap pt-1" style={{ gap: GAP }}>
        {Array.from({ length: COLUMNS * 3 }, (_, index) => (
          <View key={index} style={{ width: cardWidth }} className="gap-2">
            <SkeletonBlock
              style={{
                width: "100%",
                aspectRatio: 2 / 3,
                borderRadius: 8,
              }}
            />
            <SkeletonBlock style={{ width: "55%", height: 11 }} />
          </View>
        ))}
      </View>
    );
  }

  if (error) return <Notice message={error} retry={retry} />;

  if (!items.length) {
    return (
      <View className="items-center gap-1.5 px-6 py-10">
        <Text className="text-center font-archivo-bold text-[15px] text-foreground">
          Nothing similar yet
        </Text>
        <Text className="text-center font-archivo-regular text-[13px] leading-[19px] text-muted">
          No similar titles were found for this one yet. Check back after the
          catalog refreshes.
        </Text>
      </View>
    );
  }

  return (
    <View
      className="flex-row flex-wrap pt-1"
      style={{ columnGap: GAP, rowGap: 18 }}
    >
      {items.map((item) => {
        const remote = item.publicId.startsWith("remote:");
        return (
          <Card
            key={item.publicId}
            width={cardWidth}
            item={item}
            api={api}
            online={remote}
            onPress={() => onSelect(item)}
            onLongPress={
              onLongPress ? () => onLongPress(item) : undefined
            }
          />
        );
      })}
    </View>
  );
}
