import { Image,Pressable,ScrollView,Text,View } from "react-native";
import type {
LocalCatalog,
TitleDetail,
} from "../../../core/library/catalog-api";
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
  if (!people.length) return null;
  return (
    <View className="gap-3">
      <Text className="font-archivo-bold text-[18px] tracking-[-0.2px] text-foreground">
        Cast & Crew
      </Text>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={{ gap: 14 }}
      >
        {people.map((person: any, i: number) => (
          <Pressable
            disabled={!canOpen(person.name)}
            onPress={() => onSelect(person.name)}
            key={`${person.name}-${i}`}
            className="w-24 gap-1.5"
          >
            {person.photo ? (
              <Image
                source={api.image(person.photo)}
                className="aspect-[2/3] w-full rounded-lg bg-surface"
              />
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
        ))}
      </ScrollView>
    </View>
  );
}
