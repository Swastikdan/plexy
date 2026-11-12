import { Text,View } from "react-native";
import { useClient } from "../../../core/client/client-provider";
import type { ItemCard } from "../../../core/library/catalog-api";
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
    <View className="gap-3 px-5">
      <Text className="font-archivo-bold text-[16px] text-foreground tracking-[-0.3px]">
        {title}
      </Text>
      <View className="flex-row flex-wrap gap-3">
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
