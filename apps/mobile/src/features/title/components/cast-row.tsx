import {
Image,
Pressable,
ScrollView,
StyleSheet,
Text,
View,
} from "react-native";
import type {
LocalCatalog,
TitleDetail,
} from "../../../core/library/catalog-api";
import { colors,fonts } from "../../../shared/theme";
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
    <View style={{ gap: 12 }}>
      <Text style={styles.detailSectionLabel}>Cast & Crew</Text>
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
            style={styles.castCard}
          >
            {person.photo ? (
              <Image
                source={api.image(person.photo)}
                style={styles.castPhoto}
              />
            ) : (
              <View style={[styles.castPhoto, styles.castPhotoPlaceholder]}>
                <Text style={styles.castInitial}>
                  {person.name?.[0]?.toUpperCase()}
                </Text>
              </View>
            )}
            <Text style={styles.castName} numberOfLines={2}>
              {person.name}
            </Text>
            <Text style={styles.castCharacter} numberOfLines={1}>
              {person.character}
            </Text>
          </Pressable>
        ))}
      </ScrollView>
    </View>
  );
}
const styles = StyleSheet.create({
detailSectionLabel: {
    fontFamily: fonts.bold,
    fontSize: 18,
    color: colors.ink,
    letterSpacing: -0.2,
  },
castCard: {
    width: 96,
    gap: 6,
  },
castPhoto: {
    width: "100%",
    aspectRatio: 2 / 3,
    borderRadius: 8,
    backgroundColor: colors.surface,
  },
castPhotoPlaceholder: {
    justifyContent: "center",
    alignItems: "center",
  },
castInitial: {
    fontFamily: fonts.black,
    fontSize: 24,
    color: colors.muted,
  },
castName: {
    fontFamily: fonts.bold,
    fontSize: 12,
    color: colors.ink,
    lineHeight: 16,
  },
castCharacter: {
    fontFamily: fonts.regular,
    fontSize: 11,
    color: colors.muted,
  }
});
