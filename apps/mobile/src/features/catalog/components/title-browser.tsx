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
import { useColors } from "@/shared/theme";
import { ChevronLeft } from "@/shared/ui/icons";
import { Card } from "@/shared/ui/media-card";
import { Notice } from "@/shared/ui/notice";
import { useTitlePrefetch } from "@/features/catalog/hooks/use-title-prefetch";
import { usePlayTitle } from "../hooks/use-play-title";
import { useTitleActions } from "../hooks/use-title-actions";

export function TitleBrowser({
  title,
  items,
  close,
  open,
  play,
  onChanged,
}: {
  title: string | null;
  items: ItemCard[];
  close: () => void;
  open: (id: string | number) => void;
  play?: (fileId: number) => void;
  onChanged?: () => void;
}) {
  const colors = useColors();
  const { api } = useClient();
  const prefetch = useTitlePrefetch();
  const titleActions = useTitleActions();
  const playTitle = usePlayTitle(play, (item) => {
    close();
    open(item.publicId);
  });
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
            className="h-[30px] w-[44px] items-center justify-center self-start active:opacity-60"
          >
            <ChevronLeft size={24} color={colors.ink} />
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
          initialNumToRender={6}
          maxToRenderPerBatch={6}
          updateCellsBatchingPeriod={40}
          windowSize={5}
          {...prefetch}
          columnWrapperStyle={{ gap: 12 }}
          contentContainerStyle={{
            padding: 20,
            paddingBottom: insets.bottom + 24,
            gap: 20,
          }}
          ListEmptyComponent={
            <Notice message="No titles to show here." />
          }
          renderItem={({ item }) => (
            <Card
              width={cardWidth}
              item={item}
              api={api}
              onPress={() => {
                close();
                open(item.publicId);
              }}
              onLongPress={() =>
                titleActions(item, {
                  play: () => playTitle(item),
                  onChanged,
                })
              }
            />
          )}
        />
      </View>
    </Modal>
  );
}
