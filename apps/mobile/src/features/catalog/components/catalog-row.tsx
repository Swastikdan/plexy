import { useRef } from "react";
import { FlatList,StyleSheet,Text,View } from "react-native";
import { useClient } from "../../../core/client/client-provider";
import type { ItemCard } from "../../../core/library/catalog-api";
import { colors,fonts } from "../../../shared/theme";
import { Card } from "../../../shared/ui/media-card";
import { OpenTitle } from "../types";
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
    <View style={styles.rowContainer}>
      {/* Section header */}
      <View style={styles.rowHeader}>
        <Text style={styles.rowTitle}>{title}</Text>
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
        contentContainerStyle={styles.rowList}
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

const styles = StyleSheet.create({
rowContainer: {
    marginBottom: 20,
    gap: 6,
  },
rowHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingHorizontal: 20,
    marginBottom: 2,
  },
rowTitle: {
    fontFamily: fonts.bold,
    fontSize: 16,
    color: colors.ink,
    letterSpacing: -0.3,
  },
rowList: {
    paddingHorizontal: 20,
    gap: 10,
  }
});
