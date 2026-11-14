import { usePagerGestureBoundary } from "@/shared/ui/swipe-pager";
import { FlatList,Pressable,Text,View } from "react-native";
import type {
LocalCatalog,
TitleDetail,
} from "@/core/library/catalog-api";
import { PosterImage } from "@/shared/ui/poster-image";
export function CastRow({
  people,
  api,
  canOpen,
  onSelect,
}: {
  people: TitleDetail["cast"];
  api: Pick<LocalCatalog, "image">;
  canOpen: (name: string) => boolean;
  onSelect: (name: string) => void;
}) {
  const pagerBoundary = usePagerGestureBoundary();
  if (!people.length) return null;
  return (
    <View className="gap-3">
      <Text className="font-archivo-bold text-[18px] tracking-[-0.2px] text-foreground">
        Cast & Crew
      </Text>
      <FlatList {...pagerBoundary}
        horizontal
        data={people}
        keyExtractor={(person: any, index) => `${person.name}-${index}`}
        getItemLayout={(_, index) => ({
          length: 110,
          offset: 110 * index,
          index,
        })}
        initialNumToRender={8}
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={{ gap: 14 }}
        renderItem={({ item: person }: { item: any }) => (
          <Pressable
            disabled={!canOpen(person.name)}
            onPress={() => onSelect(person.name)}
            className="w-24 gap-1.5"
          >
            {person.photo ? (
              <View className="aspect-[2/3] w-full overflow-hidden rounded-lg bg-surface">
                <PosterImage source={api.image(person.photo)} />
              </View>
            ) : (
              <View className="aspect-[2/3] w-full items-center justify-center rounded-lg bg-surface">
                <Text className="font-archivo-black text-[24px] text-muted">
                  {person.name?.[0]?.toUpperCase()}
                </Text>
              </View>
            )}
            <Text className="font-archivo-bold text-[12px] leading-4 text-foreground" numberOfLines={2}>
              {person.name}
            </Text>
            <Text className="font-archivo-regular text-[11px] text-muted" numberOfLines={1}>
              {person.character}
            </Text>
          </Pressable>
        )}
      />
    </View>
  );
}
