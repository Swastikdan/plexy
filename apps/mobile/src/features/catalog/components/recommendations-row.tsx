import React from "react";
import { FlatList, Text, View } from "react-native";
import type { ItemCard, LocalCatalog } from "@/core/library/catalog-api";
import { usePagerGestureBoundary } from "@/shared/ui/swipe-pager";
import { Card } from "@/shared/ui/media-card";

/** TMDB recommendations rendered with the same cards as a library row. */
export function RecommendationsRow({
  items,
  api,
  onSelect,
  title = "Recommended",
}: {
  items: ItemCard[];
  api: LocalCatalog;
  onSelect: (item: ItemCard) => void;
  title?: string;
}) {
  const pagerBoundary = usePagerGestureBoundary();
  if (!items.length) return null;
  return (
    <View className="mb-5 gap-1.5">
      <View className="mb-0.5 flex-row items-center justify-between px-5">
        <Text className="font-archivo-bold text-[16px] tracking-[-0.3px] text-foreground">
          {title}
        </Text>
      </View>
      <FlatList
        {...pagerBoundary}
        horizontal
        data={items}
        getItemLayout={(_, index) => ({
          length: 160,
          offset: 20 + 160 * index,
          index,
        })}
        keyExtractor={(item) => item.publicId}
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={{ paddingHorizontal: 20, gap: 10 }}
        renderItem={({ item }) => (
          <Card
            width={150}
            item={item}
            api={api}
            badge={item.publicId.startsWith("remote:") ? "Online" : null}
            onPress={() => onSelect(item)}
          />
        )}
      />
    </View>
  );
}
