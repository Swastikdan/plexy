import React, { useState } from "react";
import { useIsFocused, useRouter } from "expo-router";
import {
  FlatList,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  useWindowDimensions,
  View,
} from "react-native";
import { useClient } from "@/core/client/client-provider";
import { usePlayCard } from "@/shared/hooks/use-play-card";
import type { ItemCard } from "@/core/library/catalog-api";
import { useResource } from "@/core/resources/use-resource";
import { useOnline } from "@/shared/hooks/use-online";
import { useEventCallback } from "@/shared/hooks/use-event-callback";
import { useColors } from "@/shared/theme";
import { cn } from "@/shared/lib/cn";
import {
  AlertCircle,
  Search as SearchIcon,
  WifiOff,
  X,
} from "@/shared/ui/icons";
import { Button } from "@/shared/ui/button";
import { Card } from "@/shared/ui/media-card";
import { Notice } from "@/shared/ui/notice";
import { PageHeader } from "@/shared/ui/page-header";
import { PageState } from "@/shared/ui/page-state";
import { Reveal } from "@/shared/ui/reveal";
import {
  LibraryGridSkeleton,
  SearchResultRowsSkeleton,
  SearchResultsSkeleton,
} from "@/shared/ui/skeleton";
import { CatalogRow } from "@/features/catalog/components/catalog-row";
import { useTitleActions } from "@/features/catalog/hooks/use-title-actions";
import { OpenTitle } from "@/features/catalog/types";
import { useRemoteHome } from "@/features/remote/lib/use-remote-home";
import { useRemoteNavigation } from "@/features/remote/lib/use-remote-navigation";
import { useRemoteSearch } from "@/features/remote/lib/use-remote-search";
import { prefetchDetails, prefetchImages } from "@/features/remote/lib/prefetch";
import { prefetchTitleCards } from "@/features/catalog/hooks/use-title-prefetch";
import {
  remoteWatch,
  useRemoteProgress,
} from "@/features/remote/lib/remote-progress";
import {
  remoteTitleFromCard,
  useRemoteTitleActions,
} from "@/features/remote/hooks/use-remote-title-actions";
import { toItemCard } from "@/features/remote/lib/view";
import type { RemoteTitle } from "@/features/remote/lib/tmdb";

type ResultRow =
  | { kind: "header"; key: string; title: string }
  | { kind: "cards"; key: string; items: ItemCard[] }
  | { kind: "pending"; key: string };

function buildResultRows(
  titles: ItemCard[],
  episodes: ItemCard[],
  pending: boolean,
): ResultRow[] {
  const rows: ResultRow[] = [];
  const append = (title: string, items: ItemCard[]) => {
    if (!items.length) return;
    rows.push({ kind: "header", key: `header-${title}`, title });
    for (let index = 0; index < items.length; index += 2) {
      const slice = items.slice(index, index + 2);
      rows.push({
        kind: "cards",
        key: `cards-${title}-${slice.map((item) => item.publicId).join("-")}`,
        items: slice,
      });
    }
  };
  append("Movies & Shows", titles);
  // Online results merge into the title section, so their skeleton belongs
  // there too — above episodes, exactly where the cards will appear.
  if (pending) rows.push({ kind: "pending", key: "pending" });
  append("Episodes", episodes);
  return rows;
}

export function SearchScreen({
  open,
  play,
}: {
  open: OpenTitle;
  play: (fileId: number) => void;
}) {
  const colors = useColors();
  const connected = useOnline();
  const { api, preferences } = useClient();
  const { navigate } = useRouter();
  const titleActions = useTitleActions();
  const { width } = useWindowDimensions();
  const [query, setQuery] = useState("");
  const [debounced, setDebounced] = useState("");
  const [inputFocus, setInputFocus] = useState(false);
  const onlineMode = preferences.source === "remote";
  const remoteNavigation = useRemoteNavigation();
  const remoteActions = useRemoteTitleActions();
  const focused = useIsFocused();
  const remoteProgress = useRemoteProgress(focused);
  const onlineHome = useRemoteHome(onlineMode);
  const onlineResult = useRemoteSearch(debounced, onlineMode);
  React.useEffect(() => {
    const timer = setTimeout(() => setDebounced(query.trim()), 300);
    return () => clearTimeout(timer);
  }, [query]);
  const homeData = useResource(
    (signal) => (!debounced ? api.home(signal) : Promise.resolve(null)),
    [api, debounced],
  );
  const data = useResource(
    (signal) =>
      debounced
        ? api.search(debounced, signal)
        : Promise.resolve({ titles: [], episodes: [] }),
    [api, debounced],
  );
  const handlePlay = usePlayCard(play, open);
  // Responsive grid config for search results and the landing shelves.
  const available = width - 40;
  const cardWidth = Math.floor((available - 12) / 2);
  const gridColumns = Math.max(2, Math.floor(available / 150));
  const gridCardWidth = Math.floor(
    (available - 12 * (gridColumns - 1)) / gridColumns,
  );
  const homeRows = React.useMemo(
    () =>
      (homeData.value?.rows ?? [])
        .map((row) => ({
          ...row,
          items:
            row.key === "continue"
              ? row.items.filter((item) => item.watch?.position && !item.watch?.played)
              : row.items,
        }))
        .filter((row) => row.items.length > 0),
    [homeData.value],
  );
  const continueRow = homeRows.find((row) => row.key === "continue");
  const localTitles = homeRows.find((row) => row.key === "titles")?.items ?? [];
  const onlineTrendingRow =
    onlineHome.rows.find((row) => row.key === "trending-day") ??
    onlineHome.rows[0];
  const onlineTrending = onlineTrendingRow?.items.slice(0, 20) ?? [];
  const localByTmdb = api.titlesByTmdb();
  const onlineCards = React.useMemo(
    () => {
      void remoteProgress;
      return (onlineResult.value ?? [])
        .filter(
          (title) =>
            !localByTmdb.has(`${title.mediaType}:${title.tmdbId}`),
        )
        .map((title) => ({
          title,
          item: toItemCard(
            title,
            undefined,
            remoteWatch(title.mediaType, title.tmdbId),
          ),
        }));
    },
    [localByTmdb, onlineResult.value, remoteProgress],
  );
  const onlineByPublicId = React.useMemo(
    () =>
      new Map<string, RemoteTitle>(
        onlineCards.map((entry) => [entry.item.publicId, entry.title]),
      ),
    [onlineCards],
  );
  React.useEffect(() => {
    prefetchImages(
      onlineCards.flatMap((entry) => [
        entry.item.poster,
        entry.item.backdrop,
      ]),
      24,
    );
    prefetchDetails(
      onlineCards.map((entry) => entry.title),
      6,
    );
  }, [onlineCards]);
  React.useEffect(() => {
    prefetchImages(
      [
        ...(data.value?.titles ?? []),
        ...(data.value?.episodes ?? []),
      ].flatMap((item) => [item.poster, item.backdrop]),
      24,
    );
  }, [data.value]);
  const onlineItems = React.useMemo(
    () => onlineCards.map((entry) => entry.item),
    [onlineCards],
  );
  const searching = Boolean(debounced);
  const localPending = searching && data.loading;
  const onlinePending = searching && onlineMode && onlineResult.loading;
  const pending = localPending || onlinePending;
  const resultRows = React.useMemo(
    () =>
      buildResultRows(
        [...(data.value?.titles ?? []), ...onlineItems],
        data.value?.episodes ?? [],
        pending,
      ),
    [data.value, onlineItems, pending],
  );
  const openItem = React.useCallback(
    (item: ItemCard) => {
      if (item.kind === "episode" && item.fileId != null) play(item.fileId);
      else open(item.publicId);
    },
    [play, open],
  );
  const prefetchRows = useEventCallback(
    ({ viewableItems }: { viewableItems: { item?: ResultRow | null }[] }) => {
      const items: ItemCard[] = [];
      for (const token of viewableItems) {
        if (token.item?.kind === "cards") items.push(...token.item.items);
      }
      if (items.length) prefetchTitleCards(items, api);
    },
  );
  const resultViewability = React.useMemo(
    () => ({ itemVisiblePercentThreshold: 40 }),
    [],
  );
  const renderLandingCard = (item: ItemCard) => {
    const remote = item.publicId.startsWith("remote:");
    return (
      <Card
        key={item.publicId}
        width={gridCardWidth}
        item={item}
        api={api}
        online={remote}
        onPress={() => {
          if (!remote) {
            openItem(item);
            return;
          }
          const remoteTitle = onlineByPublicId.get(item.publicId);
          if (remoteTitle) remoteNavigation.open(remoteTitle);
          else onlineHome.open(item.publicId);
        }}
        onLongPress={() => {
          if (!remote) {
            titleActions(item, {
              play: () => handlePlay(item),
              onChanged: homeData.retry,
            });
            return;
          }
          remoteActions(item, {
            play: () => {
              const remoteTitle = onlineByPublicId.get(item.publicId);
              if (remoteTitle) remoteNavigation.play(remoteTitle);
              else onlineHome.play(item);
            },
            onChanged: onlineHome.data.retry,
          });
        }}
      />
    );
  };

  // Search states are tracked per source. The local catalog usually answers
  // first; the online catalog then streams in behind it. Neither source may
  // take over the screen while the other is still resolving, and a failure in
  // one source must not hide results from the other.
  const localError = searching ? data.error : null;
  const onlineError = searching && onlineMode ? onlineResult.error : null;
  const hasResults = resultRows.some((row) => row.kind !== "pending");
  const homeLoading = homeData.loading || onlineHome.data.loading;
  const localHomeError = homeData.error;
  const onlineHomeError = onlineHome.data.error;
  const homeError = localHomeError || onlineHomeError;

  let content: React.ReactNode;
  let phase = "ready";
  if (!searching) {
    const hasHomeContent = Boolean(
      continueRow || localTitles.length || onlineTrending.length,
    );
    if (!hasHomeContent && homeLoading) {
      content = <LibraryGridSkeleton />;
      phase = "loading";
    } else if (!hasHomeContent && homeError) {
      content = (
        <PageState
          icon={connected ? AlertCircle : WifiOff}
          title={connected ? "Couldn't load search" : "You're offline"}
          message={
            connected
              ? homeError
              : "Connect to the internet to search online. Your local library is still available."
          }
          onAction={() => {
            homeData.retry();
            onlineHome.data.retry();
          }}
        />
      );
    } else {
      content = (
        <ScrollView
          className="flex-1"
          contentContainerStyle={{ paddingBottom: 32, gap: 22 }}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="on-drag"
          showsVerticalScrollIndicator={false}
        >
          {continueRow && (
            <CatalogRow
              title="Continue Watching"
              items={continueRow.items}
              open={open}
              onPlay={handlePlay}
              isContinueWatching
              onChanged={homeData.retry}
            />
          )}

          {localTitles.length > 0 && (
            <View className="gap-3">
              <Text className="px-5 font-archivo-bold text-[18px] tracking-[-0.3px] text-foreground">
                Your library
              </Text>
              <View className="flex-row flex-wrap gap-3 px-5">
                {localTitles.slice(0, 20).map(renderLandingCard)}
              </View>
              {localTitles.length > 20 && (
                <Button
                  compact
                  label="Browse all in Libraries"
                  onPress={() => navigate("/libraries")}
                  className="mx-5 self-start"
                />
              )}
            </View>
          )}

          {onlineTrending.length > 0 && (
            <View className="gap-3">
              <Text className="px-5 font-archivo-bold text-[18px] tracking-[-0.3px] text-foreground">
                {onlineTrendingRow?.title ?? "Trending today"}
              </Text>
              <View className="flex-row flex-wrap gap-3 px-5">
                {onlineTrending.map(renderLandingCard)}
              </View>
            </View>
          )}

          {!!localHomeError && hasHomeContent && (
            <View className="px-5">
              <Notice message={localHomeError} retry={homeData.retry} />
            </View>
          )}
          {!!onlineHomeError && hasHomeContent && (
            <View className="px-5">
              <Notice
                message={onlineHomeError}
                retry={onlineHome.data.retry}
              />
            </View>
          )}
          {onlineMode &&
            !onlineTrending.length &&
            !homeLoading &&
            !onlineHomeError && (
              <Text className="px-5 font-archivo-regular text-[14px] text-muted">
                Nothing is trending right now. Try again in a moment.
              </Text>
            )}
        </ScrollView>
      );
    }
  } else if (hasResults) {
    // Keep the results that are ready and show skeleton rows for the source
    // that is still loading. No spinners: the placeholders match the grid.
    const footer =
      localError || onlineError ? (
        <View className="gap-3">
          {localError && (
            <View className="px-5">
              <Notice message={localError} retry={data.retry} />
            </View>
          )}
          {onlineError && (
            <View className="px-5">
              <Notice message={onlineError} retry={onlineResult.retry} />
            </View>
          )}
        </View>
      ) : null;
    content = (
      <FlatList
        className="flex-1"
        data={resultRows}
        keyExtractor={(row) => row.key}
        onViewableItemsChanged={prefetchRows}
        viewabilityConfig={resultViewability}
        initialNumToRender={6}
        maxToRenderPerBatch={6}
        updateCellsBatchingPeriod={40}
        windowSize={5}
        renderItem={({ item: row }) => {
          if (row.kind === "header") {
            return (
              <Text className="px-5 font-archivo-bold text-[16px] text-foreground tracking-[-0.3px]">
                {row.title}
              </Text>
            );
          }
          if (row.kind === "pending") {
            return <SearchResultRowsSkeleton rows={2} />;
          }
          return (
            <View className="flex-row gap-3 px-5">
              {row.items.map((item) => {
                const remote = item.publicId.startsWith("remote:");
                const remoteTitle = onlineByPublicId.get(item.publicId);
                return (
                  <Card
                    key={item.publicId}
                    width={cardWidth}
                    item={item}
                    api={api}
                    online={remote}
                    onPress={() =>
                      remote
                        ? remoteTitle && remoteNavigation.open(remoteTitle)
                        : openItem(item)
                    }
                    onLongPress={() =>
                      remote
                        ? remoteActions(item, {
                            play: () => {
                              const title =
                                remoteTitle ?? remoteTitleFromCard(item);
                              if (title) remoteNavigation.play(title);
                            },
                            onChanged: onlineResult.retry,
                          })
                        : titleActions(item, {
                            play: () => handlePlay(item),
                            onChanged: data.retry,
                          })
                    }
                  />
                );
              })}
            </View>
          );
        }}
        ListFooterComponent={footer}
        contentContainerStyle={{ paddingBottom: 32, gap: 14 }}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
        showsVerticalScrollIndicator={false}
      />
    );
  } else if (pending) {
    // An empty local match (or an empty online match) is not "no results"
    // until the other source has answered too.
    content = <SearchResultsSkeleton />;
    phase = "loading";
  } else if (localError || onlineError) {
    const offline = !connected && onlineMode;
    content = (
      <PageState
        icon={offline ? WifiOff : AlertCircle}
        title={offline ? "You're offline" : "Couldn't search"}
        message={
          offline
            ? "Connect to the internet to search online. Your local library is still available."
            : (localError ?? onlineError ?? "Could not load results.")
        }
        onAction={() => {
          data.retry();
          onlineResult.retry();
        }}
      />
    );
  } else {
    content = (
      <PageState
        icon={SearchIcon}
        title="No results"
        message={
          preferences.familyLevel !== "off"
            ? `Nothing matched “${debounced}”. Some titles may be hidden by Kids & family mode.`
            : `Nothing matched “${debounced}”. Try a different title or episode.`
        }
      />
    );
  }
  return (
    <View className="flex-1 gap-3.5">
      <PageHeader title="Search" />

      {/* Compact search field with an explicit search affordance */}
      <View
        className={cn(
          "flex-row items-center gap-2.5 mx-5 min-h-[46px] bg-surface rounded-[12px] px-3 border border-border",
          inputFocus && "border-foreground/36 bg-surface-secondary",
        )}
      >
        <SearchIcon
          size={18}
          color={inputFocus ? colors.ink : colors.muted}
          strokeWidth={2.1}
        />
        <TextInput
          testID="search-input"
          className="flex-1 font-archivo-regular text-[15px] text-foreground py-2.5"
          value={query}
          onChangeText={setQuery}
          placeholder={
            onlineMode
              ? "Your library or the online catalog"
              : "Movies, shows and episodes"
          }
          placeholderTextColor={colors.muted}
          returnKeyType="search"
          autoCorrect={false}
          onFocus={() => setInputFocus(true)}
          onBlur={() => setInputFocus(false)}
        />
        {!!query && (
          <Pressable
            onPress={() => setQuery("")}
            accessibilityRole="button"
            accessibilityLabel="Clear search"
            hitSlop={10}
            className={cn(
              "w-6 h-6 rounded-full items-center justify-center bg-foreground/8",
              "active:opacity-70",
            )}
          >
            <X size={15} color={colors.muted} strokeWidth={2.4} />
          </Pressable>
        )}
      </View>

      <Reveal phase={phase}>{content}</Reveal>
    </View>
  );
}
