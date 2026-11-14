import { usePagerGestureBoundary } from "@/shared/ui/swipe-pager";
import { useTitleActions } from "../hooks/use-title-actions";
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
  onRowFocus,
}: {
  title: string;
  items: ItemCard[];
  open: OpenTitle;
  onPlay?: (item: ItemCard) => void;
  isContinueWatching?: boolean;
  onRowFocus?: () => void;
}) {
  const pagerBoundary = usePagerGestureBoundary();
  const { api } = useClient();
  const titleActions = useTitleActions();
  const cardWidth = isContinueWatching ? 220 : 150;
  const itemWidth = isContinueWatching ? 168 : cardWidth;
  return (
    <View className="mb-5 gap-1.5">
      {/* Section header */}
      <View className="mb-0.5 flex-row items-center justify-between px-5">
        <Text className="font-archivo-bold text-[16px] tracking-[-0.3px] text-foreground">{title}</Text>
      </View>

      <FlatList {...pagerBoundary}
        horizontal
        data={items}
        getItemLayout={(_, index) => ({
          length: itemWidth + 10,
          offset: 20 + (itemWidth + 10) * index,
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
              onLongPress={() => titleActions(item, () => onPlay ? onPlay(item) : open(item.publicId), isContinueWatching)}
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
              onLongPress={() => titleActions(item, () => onPlay ? onPlay(item) : open(item.publicId), isContinueWatching)}
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
