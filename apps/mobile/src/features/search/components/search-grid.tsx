import { StyleSheet,Text,View } from "react-native";
import { useClient } from "../../../core/client/client-provider";
import type { ItemCard } from "../../../core/library/catalog-api";
import { colors,fonts } from "../../../shared/theme";
import { Card } from "../../../shared/ui/media-card";
import { OpenTitle } from "../../catalog/types";

export function SearchGrid({
  title,
  items,
  open,
  focusId,
  focused,
  cardWidth,
  columns,
}: {
  title: string;
  items: ItemCard[];
  open: OpenTitle;
  focusId?: number | null;
  focused: (id: number) => void;
  cardWidth: number;
  columns: number;
}) {
  const { api } = useClient();
  return (
    <View style={styles.searchGridSection}>
      <Text style={styles.rowTitle}>{title}</Text>
      <View style={styles.searchGrid}>
        {items.map((item) => (
          <Card
            key={item.id}
            width={cardWidth}
            item={item}
            api={api}
            onFocus={() => focused(item.id)}
            onPress={() => {
              focused(item.id);
              open(item.publicId);
            }}
          />
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
rowTitle: {
    fontFamily: fonts.bold,
    fontSize: 16,
    color: colors.ink,
    letterSpacing: -0.3,
  },
searchGridSection: {
    gap: 12,
    paddingHorizontal: 20,
  },
searchGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 12,
  }
});
