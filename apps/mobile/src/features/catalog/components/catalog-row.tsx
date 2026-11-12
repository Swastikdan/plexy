import { useRef } from "react";
import { FlatList,Text,View } from "react-native";
import { useClient } from "@/core/client/client-provider";
import type { ItemCard } from "@/core/library/catalog-api";
import { Card } from "@/shared/ui/media-card";
import { OpenTitle } from "@/features/catalog/types";
import { ContinueWatchingCard } from "./continue-watching-card";

export function CatalogRow({
  title,
  items,
  open,
  onPlay,
  isContinueWatching = false,
  focusId,
  focused,
  onRowFocus,
}: {
  title: string;
  items: ItemCard[];
  open: OpenTitle;
  onPlay?: (item: ItemCard) => void;
  isContinueWatching?: boolean;
  focusId?: number | null;
  focused: (id: number) => void;
  onRowFocus?: () => void;
}) {
  const { api } = useClient();
  const ref = useRef<FlatList<ItemCard>>(null);
  const cardWidth = isContinueWatching ? 220 : 150;
  return (
    <View className="mb-5 gap-1.5">
      {/* Section header */}
      <View className="mb-0.5 flex-row items-center justify-between px-5">
        <Text className="font-archivo-bold text-[16px] tracking-[-0.3px] text-foreground">{title}</Text>
      </View>

      <FlatList
        ref={ref}
        horizontal
        data={items}
        getItemLayout={(_, index) => ({
          length: cardWidth + 12,
          offset: 16 + (cardWidth + 12) * index,
          index,
        })}
        keyExtractor={(item) => String(item.id)}
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={{ paddingHorizontal: 20, gap: 10 }}
        renderItem={({ item, index }) =>
          isContinueWatching ? (
            <ContinueWatchingCard
              item={item}
              api={api}
              onFocus={() => {
                onRowFocus?.();
              }}
              onPress={() => {
                if (onPlay) {
                  onPlay(item);
                } else {
                  open(item.publicId);
                }
              }}
            />
          ) : (
            <Card
              width={cardWidth}
              item={item}
              api={api}
              onFocus={() => {
                onRowFocus?.();
              }}
              onPress={() => {
                open(item.publicId);
              }}
            />
          )
        }
      />
    </View>
  );
}
