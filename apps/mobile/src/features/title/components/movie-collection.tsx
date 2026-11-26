import React from "react";
import { Text, useWindowDimensions, View } from "react-native";
import { useIsFocused } from "expo-router";
import { useClient } from "@/core/client/client-provider";
import { familyMaxAge } from "@/core/content/audience";
import { useHiddenTitles } from "@/core/content/hidden-titles";
import { isReleased } from "@/core/content/release";
import type { ItemCard, LocalCatalog } from "@/core/library/catalog-api";
import { useResource } from "@/core/resources/use-resource";
import { prefetchImages } from "@/features/remote/lib/prefetch";
import { remoteWatch, useRemoteProgress } from "@/features/remote/lib/remote-progress";
import {
  fetchCollection,
  peekCollection,
  remoteOptionsKey,
  type RemoteCatalogOptions,
  type RemoteTitle,
} from "@/features/remote/lib/tmdb";
import { remotePublicId, toItemCard } from "@/features/remote/lib/view";
import { Card } from "@/shared/ui/media-card";
import { Notice } from "@/shared/ui/notice";
import { SkeletonBlock } from "@/shared/ui/skeleton";

const COLUMNS = 3;
const GAP = 10;
const PAGE_PADDING = 20;

/**
 * Every movie in a TMDB collection. The grid matches "More Like This" and
 * opens each part on the same online title screen.
 */
export function MovieCollection({
  collectionId,
  api,
  onSelect,
  onLongPress,
}: {
  collectionId: number;
  api: LocalCatalog;
  onSelect: (title: RemoteTitle) => void;
  onLongPress?: (item: ItemCard, title: RemoteTitle) => void;
}) {
  const { width } = useWindowDimensions();
  const { preferences } = useClient();
  const { isHidden } = useHiddenTitles();
  const focused = useIsFocused();
  useRemoteProgress(focused);
  const options: RemoteCatalogOptions = {
    maxAge: familyMaxAge(preferences.familyLevel),
    blockUnrated: preferences.familyBlockUnrated,
    region: preferences.familyRegion,
  };
  const optionsKey = remoteOptionsKey(options);
  const data = useResource(
    (signal) => fetchCollection(collectionId, signal, options),
    [collectionId, optionsKey],
    "movie-collection",
    () => peekCollection(collectionId),
  );
  const cardWidth = Math.max(
    92,
    Math.floor(
      (width - PAGE_PADDING * 2 - GAP * (COLUMNS - 1)) / COLUMNS,
    ),
  );
  const collection = React.useMemo(() => {
    const value = data.value;
    if (!value) return null;
    return {
      ...value,
      parts: value.parts.filter(
        (part) =>
          isReleased(part.releaseDate) &&
          !isHidden(remotePublicId(part.mediaType, part.tmdbId)),
      ),
    };
  }, [data.value, isHidden]);

  React.useEffect(() => {
    if (!collection) return;
    prefetchImages(
      collection.parts.slice(0, COLUMNS * 3).map((part) => part.poster),
      COLUMNS * 3,
    );
  }, [collection]);

  if (!collection && data.loading) {
    return (
      <View className="gap-3 pt-1">
        <SkeletonBlock className="w-[168px] h-[18px]" />
        <View className="flex-row flex-wrap gap-2.5">
          {Array.from({ length: COLUMNS * 3 }, (_, index) => (
            <View key={index} style={{ width: cardWidth }} className="gap-2">
              <SkeletonBlock className="w-full aspect-[2/3]" />
              <SkeletonBlock className="w-[55%] h-[11px]" />
            </View>
          ))}
        </View>
      </View>
    );
  }

  if (data.error && !collection) {
    return <Notice message={data.error} retry={data.retry} />;
  }

  if (!collection || !collection.parts.length) {
    return (
      <View className="items-center gap-1.5 px-6 py-10">
        <Text className="text-center font-archivo-bold text-[15px] text-foreground">
          Collection unavailable
        </Text>
        <Text className="text-center font-archivo-regular text-[13px] leading-[19px] text-muted">
          TMDB does not list any other movies for this collection yet.
        </Text>
      </View>
    );
  }

  return (
    <View className="gap-3 pt-1">
      <View className="gap-1">
        <Text className="font-archivo-bold text-[16px] tracking-[-0.3px] text-foreground">
          {collection.name}
        </Text>
        {collection.overview ? (
          <Text
            className="font-archivo-regular text-[13px] leading-[20px] text-muted"
            numberOfLines={3}
          >
            {collection.overview}
          </Text>
        ) : null}
      </View>
      <View className="flex-row flex-wrap gap-x-2.5 gap-y-[18px]">
        {collection.parts.map((title) => {
          const item = toItemCard(
            title,
            undefined,
            remoteWatch(title.mediaType, title.tmdbId),
          );
          return (
            <Card
              key={item.publicId}
              width={cardWidth}
              item={item}
              api={api}
              online
              onPress={() => onSelect(title)}
              onLongPress={
                onLongPress ? () => onLongPress(item, title) : undefined
              }
            />
          );
        })}
      </View>
    </View>
  );
}
