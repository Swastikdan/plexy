import { usePagerGestureBoundary } from "@/shared/ui/swipe-pager";
import { useTitleActions } from "../hooks/use-title-actions";
import { useEffect } from "react";
import { FlatList,Text,View } from "react-native";
import { prefetchImages } from "@/features/remote/lib/prefetch";
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
  onChanged,
  onLongPressItem,
  allowTitleActions = true,
  cardWidth: cardWidthOverride,
  onlineFor,
}: {
  title: string;
  items: ItemCard[];
  open: OpenTitle;
  onPlay?: (item: ItemCard) => void;
  isContinueWatching?: boolean;
  onRowFocus?: () => void;
  onChanged?: () => void;
  /** Override the local title action sheet, e.g. for a remote catalog. */
  onLongPressItem?: (item: ItemCard) => void;
  /** Turn off local-only actions (watched, delete from device). */
  allowTitleActions?: boolean;
  /** Catalog rows can be denser than the library's main cards. */
  cardWidth?: number;
  /** Mark individual cards as online in a mixed local/online row. */
  onlineFor?: (item: ItemCard) => boolean;
}) {
  const pagerBoundary = usePagerGestureBoundary();
  const { api } = useClient();
  const titleActions = useTitleActions();
  useEffect(() => {
    prefetchImages(
      items.slice(0, 6).map((item) => item.poster),
      6,
    );
  }, [items]);
  const cardWidth = isContinueWatching ? 220 : (cardWidthOverride ?? 150);
  const itemWidth = isContinueWatching ? 168 : cardWidth;
  const longPress = (item: ItemCard) => {
    if (onLongPressItem) {
      onLongPressItem(item);
      return;
    }
    if (!allowTitleActions) return;
    titleActions(item, {
      play: () => (onPlay ? onPlay(item) : open(item.publicId)),
      continueWatching: isContinueWatching,
      onChanged,
    });
  };
  const canLongPress = Boolean(onLongPressItem) || allowTitleActions;
  return (
    <View className="mb-5 gap-1.5">
      {/* Section header */}
      <View className="mb-0.5 flex-row items-center justify-between px-5">
        <Text className="font-archivo-bold text-[16px] tracking-[-0.3px] text-foreground">{title}</Text>
      </View>

      <FlatList {...pagerBoundary}
        horizontal
        initialNumToRender={4}
        maxToRenderPerBatch={4}
        windowSize={3}
        data={items}
        getItemLayout={(_, index) => ({
          length: itemWidth + 10,
          offset: 20 + (itemWidth + 10) * index,
          index,
        })}
        keyExtractor={(item) => item.publicId}
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={{ paddingHorizontal: 20, gap: 10 }}
        renderItem={({ item }) =>
          isContinueWatching ? (
            <ContinueWatchingCard
              item={item}
              api={api}
              onLongPress={canLongPress ? () => longPress(item) : undefined}
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
              online={onlineFor?.(item) ?? false}
              onLongPress={canLongPress ? () => longPress(item) : undefined}
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
