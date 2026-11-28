/// "See all" for an online Home shelf: an endless, virtualized poster grid.
import { useLocalSearchParams } from "expo-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ActivityIndicator, FlatList, useWindowDimensions, View } from "react-native";
import { useClient } from "@/core/client/client-provider";
import { familyMaxAge } from "@/core/content/audience";
import { useHiddenTitles } from "@/core/content/hidden-titles";
import { useColors } from "@/shared/theme";
import { Card } from "@/shared/ui/media-card";
import { Notice } from "@/shared/ui/notice";
import { PageState } from "@/shared/ui/page-state";
import { Reveal } from "@/shared/ui/reveal";
import { Screen } from "@/shared/ui/screen";
import { LibraryGridSkeleton } from "@/shared/ui/skeleton";
import { prefetchTitleCards } from "@/features/catalog/hooks/use-title-prefetch";
import { prefetchImages } from "./lib/prefetch";
import { remoteWatch } from "./lib/remote-progress";
import {
  fetchHomeRowPage,
  homeRowDefinition,
  type RemoteCatalogOptions,
  type RemoteTitle,
} from "./lib/tmdb";
import { useRemoteNavigation } from "./lib/use-remote-navigation";
import { remotePublicId, toItemCard } from "./lib/view";

const COLUMNS = 3;
const GAP = 10;
const PADDING = 20;

export function OnlineListScreen() {
  const { key } = useLocalSearchParams<{ key: string }>();
  const { preferences } = useClient();
  const [revision, setRevision] = useState(0);
  // Remounting on a retry or family change starts the list from page one.
  return (
    <OnlineList
      key={`${key}:${revision}:${preferences.familyLevel}:${preferences.familyBlockUnrated}:${preferences.familyRegion}`}
      listKey={key ?? ""}
      reload={() => setRevision((value) => value + 1)}
    />
  );
}

function OnlineList({ listKey: key, reload }: { listKey: string; reload: () => void }) {
  const { width } = useWindowDimensions();
  const colors = useColors();
  const { api, preferences } = useClient();
  const { isHidden } = useHiddenTitles();
  const navigation = useRemoteNavigation();
  const options = useMemo<RemoteCatalogOptions>(
    () => ({
      maxAge: familyMaxAge(preferences.familyLevel),
      blockUnrated: preferences.familyBlockUnrated,
      region: preferences.familyRegion,
    }),
    [preferences.familyBlockUnrated, preferences.familyLevel, preferences.familyRegion],
  );
  const title = homeRowDefinition(key ?? "", options)?.title ?? "Online";
  const [titles, setTitles] = useState<RemoteTitle[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const page = useRef(0);
  const hasMore = useRef(true);
  const busy = useRef(false);
  const seen = useRef(new Set<string>());
  const controller = useRef<AbortController | null>(null);

  const loadMore = useCallback(() => {
    if (busy.current || !hasMore.current || !key) return;
    busy.current = true;
    setLoading(true);
    const signal = controller.current?.signal;
    const next = page.current + 1;
    void fetchHomeRowPage(key, next, options, signal)
      .then((reply) => {
        if (signal?.aborted) return;
        page.current = next;
        hasMore.current = reply.hasMore;
        const fresh = reply.items.filter((entry) => {
          const id = `${entry.mediaType}:${entry.tmdbId}`;
          if (seen.current.has(id)) return false;
          seen.current.add(id);
          return true;
        });
        setTitles((current) => [...current, ...fresh]);
        setError(null);
        prefetchImages(fresh.map((entry) => entry.poster), 12);
      })
      .catch((reason) => {
        if (signal?.aborted) return;
        setError(reason instanceof Error ? reason.message : "Could not load titles.");
      })
      .finally(() => {
        busy.current = false;
        if (!signal?.aborted) setLoading(false);
      });
  }, [key, options]);

  useEffect(() => {
    const current = new AbortController();
    controller.current = current;
    loadMore();
    return () => current.abort();
  }, [loadMore]);

  const items = useMemo(
    () =>
      titles
        .filter((entry) => !isHidden(remotePublicId(entry.mediaType, entry.tmdbId)))
        .map((entry) => ({
          title: entry,
          card: toItemCard(entry, undefined, remoteWatch(entry.mediaType, entry.tmdbId)),
        })),
    [isHidden, titles],
  );
  const cardWidth = Math.floor((width - PADDING * 2 - GAP * (COLUMNS - 1)) / COLUMNS);
  const first = loading && items.length === 0;

  return (
    <Screen title={title}>
      <Reveal phase={first ? "loading" : error && !items.length ? "state" : "ready"}>
        {first ? (
          <LibraryGridSkeleton />
        ) : error && !items.length ? (
          <PageState
            title="Couldn’t load this list"
            message={error}
            onAction={reload}
          />
        ) : (
          <FlatList
            data={items}
            keyExtractor={(entry) => entry.card.publicId}
            numColumns={COLUMNS}
            contentContainerStyle={{ padding: PADDING, gap: 14 }}
            columnWrapperStyle={{ gap: GAP }}
            // Only a few screens of posters stay mounted, so memory stays flat
            // however far the list is scrolled.
            initialNumToRender={12}
            maxToRenderPerBatch={9}
            windowSize={5}
            removeClippedSubviews
            onEndReachedThreshold={1.5}
            onEndReached={loadMore}
            onViewableItemsChanged={({ viewableItems }) =>
              prefetchTitleCards(
                viewableItems.map((token) => (token.item as (typeof items)[number]).card),
                api,
              )
            }
            renderItem={({ item }) => (
              <Card
                item={item.card}
                api={api}
                width={cardWidth}
                online
                onPress={() => navigation.open(item.title)}
              />
            )}
            ListFooterComponent={
              error ? (
                <Notice message={error} retry={loadMore} />
              ) : loading ? (
                <View className="items-center py-6">
                  <ActivityIndicator color={colors.muted} />
                </View>
              ) : null
            }
          />
        )}
      </Reveal>
    </Screen>
  );
}
