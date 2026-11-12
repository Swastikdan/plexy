import {
FlatList,
Modal,
Pressable,
Text,
View,
useWindowDimensions,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useClient } from "@/core/client/client-provider";
import type { ItemCard } from "@/core/library/catalog-api";
import { useReducedMotion } from "@/shared/hooks/use-reduced-motion";
import { colors } from "@/shared/theme";
import { ArrowLeft } from "@/shared/ui/icons";
import { Card } from "@/shared/ui/media-card";

export function TitleBrowser({
  title,
  items,
  close,
  open,
}: {
  title: string | null;
  items: ItemCard[];
  close: () => void;
  open: (id: string | number) => void;
}) {
  const { api } = useClient();
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const reducedMotion = useReducedMotion();
  const columns = Math.max(2, Math.floor((width - 40) / 150));
  const cardWidth = (width - 40 - (columns - 1) * 12) / columns;
  return (
    <Modal
      visible={title !== null}
      onRequestClose={close}
      animationType={reducedMotion ? "none" : "fade"}
    >
      <View className="flex-1 bg-background" style={{ paddingTop: insets.top }}>
        <View className="flex-row items-center gap-3 px-5 py-3">
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Back to library"
            onPress={close}
            hitSlop={8}
            className="h-[44px] w-[44px] justify-center active:opacity-60"
          >
            <ArrowLeft size={24} color={colors.ink} />
          </Pressable>
          <View className="flex-1">
            <Text
              accessibilityRole="header"
              className="font-archivo-bold text-[24px] leading-[30px] text-foreground"
            >
              {title}
            </Text>
            <Text className="mt-1 font-archivo-regular text-muted">
              {items.length} {items.length === 1 ? "title" : "titles"} in your
              library
            </Text>
          </View>
        </View>
        <FlatList
          key={columns}
          data={items}
          numColumns={columns}
          keyExtractor={(item) => String(item.id)}
          columnWrapperStyle={{ gap: 12 }}
          contentContainerStyle={{
            padding: 20,
            paddingBottom: insets.bottom + 24,
            gap: 20,
          }}
          renderItem={({ item }) => (
            <Card
              width={cardWidth}
              item={item}
              api={api}
              onPress={() => {
                close();
                open(item.publicId);
              }}
            />
          )}
        />
      </View>
    </Modal>
  );
}
