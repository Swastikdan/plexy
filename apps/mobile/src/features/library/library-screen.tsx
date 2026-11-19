import { useReducedMotion } from "@/shared/hooks/use-reduced-motion";
import { SwipePager, usePagerGestureBoundary } from "@/shared/ui/swipe-pager";
import { useIsFocused, useRouter } from "expo-router";
import React, { useEffect, useRef, useState } from "react";
import {
  FlatList,
  ScrollView,
  Modal,
  Pressable,
  Text,
  useWindowDimensions,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useClient } from "@/core/client/client-provider";
import { familyAllows } from "@/core/content/audience";
import { useHiddenTitles } from "@/core/content/hidden-titles";
import { isReleased } from "@/core/content/release";
import { matchesLibraryFilters, type LibraryFilters } from "@/core/library/library-filters";
import { useAppDialog } from "@/shared/ui/app-dialog";
import type { ItemCard } from "@/core/library/catalog-api";
import { useResource } from "@/core/resources/use-resource";
import { triggerHaptic } from "@/shared/lib/haptics";
import { useColors } from "@/shared/theme";
import { cn } from "@/shared/lib/cn";
import { Button } from "@/shared/ui/button";
import {
  AlertCircle,
  Film,
  ArrowUpDown,
  ChevronDown,
  ChevronRight,
  X,
} from "@/shared/ui/icons";
import { Notice } from "@/shared/ui/notice";
import { PageState } from "@/shared/ui/page-state";
import { PageHeader } from "@/shared/ui/page-header";
import { LibraryGridSkeleton } from "@/shared/ui/skeleton";
import { Card } from "@/shared/ui/media-card";
import { PosterImage } from "@/shared/ui/poster-image";
import { TitleBrowser } from "@/features/catalog/components/title-browser";
import { usePlayTitle } from "@/features/catalog/hooks/use-play-title";
import { useTitleActions } from "@/features/catalog/hooks/use-title-actions";
import { OpenTitle } from "@/features/catalog/types";
import { useRemote } from "@/features/remote/remote-provider";
import { useRemoteTitleActions, remoteTitleFromCard } from "@/features/remote/hooks/use-remote-title-actions";
import { useRemoteProgress, remoteWatch } from "@/features/remote/lib/remote-progress";
import { useRemoteNavigation } from "@/features/remote/lib/use-remote-navigation";
import { prefetchImages } from "@/features/remote/lib/prefetch";
import { certificationFor, fetchDetail } from "@/features/remote/lib/tmdb";
import { parseRemotePublicId, remotePublicId, toItemCard } from "@/features/remote/lib/view";
import { CheckboxIndicator } from "@/shared/ui/checkbox-indicator";
import { useTitlePrefetch } from "@/features/catalog/hooks/use-title-prefetch";

const genres = [
  "Action", "Action & Adventure", "Adventure", "Animation", "Comedy", "Crime",
  "Documentary", "Drama", "Family", "Fantasy", "History", "Horror", "Kids",
  "Music", "Mystery", "News", "Reality", "Romance", "Sci-Fi & Fantasy",
  "Science Fiction", "Soap", "Talk", "Thriller", "TV Movie", "War",
  "War & Politics", "Western",
];

export function LibraryScreen({
  open,
  play,
}: {
  open: OpenTitle;
  play?: (fileId: number) => void;
}) {
  const showDialog = useAppDialog();
  const tabBoundary = usePagerGestureBoundary();
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const reduceMotion = useReducedMotion();
  const router = useRouter();
  const { api, runtime, preferences } = useClient();
  const { isHidden } = useHiddenTitles();
  const { saved } = useRemote();
  const focused = useIsFocused();
  const remoteProgress = useRemoteProgress(focused);
  const remoteNavigation = useRemoteNavigation();
  const online = preferences.source === "remote";
  type LibraryTab = "all" | "movie" | "series" | "collection";
  const [activeTab, setActiveTab] = useState<LibraryTab>("all");
  const [sort, setSort] = useState("added");
  const [genre, setGenre] = useState<string>();
  const [maxRuntime, setMaxRuntime] = useState<number>();
  const [unwatched, setUnwatched] = useState(false);
  const [offlineOnly, setOfflineOnly] = useState(false);
  const [sortOpen, setSortOpen] = useState(false);
  const [collection, setCollection] = useState<{
    id: number;
    name: string;
  } | null>(null);
  const [, updateCollections] = useState(0);
  useEffect(
    () => runtime.subscribe(() => updateCollections((n) => n + 1)),
    [runtime],
  );
  const collections = api.collections();
  // One scan for tab availability instead of three paginated queries that each
  // sort the whole library.
  const counts = api.counts();
  const localByTmdb = api.titlesByTmdb();
  // Saved online titles join the local grids; a downloaded copy wins and the
  // online duplicate is not shown twice.
  const savedOnline = React.useMemo(() => {
    void remoteProgress;
    if (!online) return [];
    return saved
      .filter((entry) => {
        const publicId = remotePublicId(
          entry.title.mediaType,
          entry.title.tmdbId,
        );
        return (
          !localByTmdb.has(
            `${entry.title.mediaType}:${entry.title.tmdbId}`,
          ) &&
          !isHidden(publicId) &&
          isReleased(entry.title.releaseDate) &&
          familyAllows(
            certificationFor(entry.title, preferences.familyRegion),
            preferences.familyLevel,
            preferences.familyBlockUnrated,
          )
        );
      })
      .map((entry) =>
        toItemCard(
          entry.title,
          undefined,
          remoteWatch(entry.title.mediaType, entry.title.tmdbId),
        ),
      );
  }, [
    isHidden,
    localByTmdb,
    online,
    preferences.familyBlockUnrated,
    preferences.familyLevel,
    preferences.familyRegion,
    remoteProgress,
    saved,
  ]);
  React.useEffect(() => {
    prefetchImages(
      savedOnline.flatMap((item) => [item.poster, item.backdrop]),
      18,
    );
  }, [savedOnline]);
  const libraryEmpty =
    preferences.familyLevel === "off" &&
    counts.movie + counts.series === 0 &&
    savedOnline.length === 0;
  const hybrid = preferences.mode === "hybrid" && online;
  const offlineFilter = hybrid && offlineOnly;
  const remoteMetadata = useResource(async (signal) => {
    if (offlineFilter || (!genre && !maxRuntime)) return null;
    const queue = savedOnline.filter((item) => !unwatched || !item.watch?.played);
    const details = new Map<string, ItemCard>();
    await Promise.all(Array.from({ length: Math.min(4, queue.length) }, async () => {
      while (queue.length && !signal.aborted) {
        const item = queue.shift()!;
        const identity = parseRemotePublicId(item.publicId);
        if (!identity) continue;
        try {
          const detail = await fetchDetail(identity.mediaType, identity.tmdbId, signal);
          details.set(item.publicId, { ...item, genres: detail.genres, runtime: detail.runtime });
        } catch {
          // A saved title can still match with the metadata already on hand.
        }
      }
    }));
    return details;
  }, [savedOnline, offlineFilter, Boolean(genre || maxRuntime), unwatched]);
  const visibleOnline = offlineFilter ? [] : savedOnline
    .filter((item) => !unwatched || !item.watch?.played)
    .map((item) => {
      const detail = remoteMetadata.value?.get(item.publicId);
      return detail ? { ...item, genres: detail.genres, runtime: detail.runtime } : item;
    });
  const savedOnlineFor = (tab: LibraryTab) => {
    if (tab === "all") return visibleOnline;
    if (tab === "movie") {
      return visibleOnline.filter((item) => item.kind !== "series");
    }
    if (tab === "series") {
      return visibleOnline.filter((item) => item.kind === "series");
    }
    return [];
  };
  const openAny: OpenTitle = (id) => {
    const publicId = String(id);
    if (offlineFilter) {
      if (!publicId.startsWith("remote:")) {
        router.push({ pathname: "/item/[id]", params: { id: publicId, offline: "1" } });
      }
      return;
    }
    const entry = saved.find(
      (candidate) =>
        remotePublicId(
          candidate.title.mediaType,
          candidate.title.tmdbId,
        ) === publicId,
    );
    if (entry) {
      remoteNavigation.open(entry.title);
      return;
    }
    if (publicId.startsWith("remote:")) return;
    open(publicId);
  };
  const libraryTabs = React.useMemo(() => {
    // Keep the three browse tabs together even when one side of the library is
    // empty today. A library with only shows still offers Movies (and vice
    // versa) instead of silently collapsing to "All" + "TV Shows".
    const base: LibraryTab[] = ["all", "movie", "series"];
    if (collections.length) base.push("collection");
    return base;
  }, [collections.length]);
  if (!libraryTabs.includes(activeTab)) setActiveTab("all");
  const tabScroll = useRef<ScrollView>(null);
  const tabLayouts = useRef<Record<string, { x: number; width: number }>>({});
  const [tabViewport, setTabViewport] = useState(0);
  useEffect(() => {
    const layout = tabLayouts.current[activeTab];
    if (layout && tabViewport)
      tabScroll.current?.scrollTo({
        x: Math.max(0, layout.x - (tabViewport - layout.width) / 2),
        animated: !reduceMotion,
      });
  }, [activeTab, tabViewport, reduceMotion]);
  const showLibTabs = libraryTabs.length > 1;
  function switchTab(next: LibraryTab, haptic = true) {
    if (next === activeTab) return;
    if (haptic) triggerHaptic("selection");
    setActiveTab(next);
  }
  function reset(nextSort: string, nextUnwatched: boolean) {
    setSort(nextSort);
    setUnwatched(nextUnwatched);
  }
  const FILTERS: [string, string][] = [
    ["added", "Recently added"],
    ["name", "Name"],
    ["year", "Year"],
    ["rating", "Rating"],
  ];
  const sortLabel = FILTERS.find(([key]) => key === sort)?.[1] || "Name";
  const filterCount = [genre, activeTab !== "series" && maxRuntime, unwatched, offlineFilter].filter(Boolean).length;
  return (
    <View className="flex-1 gap-0">
      <PageHeader
        title="Libraries"
        right={
          activeTab === "collection" ? undefined : (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`Sort and filter. ${sortLabel}${unwatched ? ", unwatched only" : ""}${offlineFilter ? ", offline only" : ""}${genre ? `, ${genre}` : ""}${activeTab !== "series" && maxRuntime ? `, up to ${maxRuntime} minutes` : ""}`}
              onPress={() => {
                triggerHaptic("light");
                setSortOpen(true);
              }}
              className={cn(
                "flex-row items-center gap-1.5 h-[38px] px-3 rounded-full border border-foreground/14 bg-surface max-w-[190px]",
                sortOpen && "border-foreground/40 bg-surface-secondary",
                "active:opacity-[0.72]",
              )}
            >
              <ArrowUpDown size={14} color={colors.ink} strokeWidth={2} />
              <Text
                className="font-archivo-medium text-[12.5px] text-foreground shrink"
                numberOfLines={1}
              >
                {filterCount ? `Filters (${filterCount})` : sortLabel}
              </Text>
              <ChevronDown size={14} color={colors.muted} strokeWidth={2.2} />
            </Pressable>
          )
        }
      />

      <View className="flex-row flex-wrap gap-2 px-5 pb-2">
        <Pressable accessibilityRole="button" onPress={() => router.push("/custom-collections")}
          className="rounded-full border border-border px-4 py-2">
          <Text className="font-archivo-medium text-foreground">Custom collections</Text>
        </Pressable>
      {online ? (
        <Pressable
          accessibilityRole="button"
          onPress={() => router.push("/episode-calendar")}
          className="rounded-full border border-border px-4 py-2"
        >
          <Text className="font-archivo-medium text-foreground">Episode calendar</Text>
        </Pressable>
      ) : null}
      </View>
      <TitleBrowser
        title={collection?.name ?? null}
        items={collection ? api.collectionItems(collection.id) : []}
        close={() => setCollection(null)}
        open={open}
        play={play}
      />
      {showLibTabs && (
        <View className="px-5 pb-3">
          <ScrollView
            {...tabBoundary}
            ref={tabScroll}
            horizontal
            showsHorizontalScrollIndicator={false}
            onLayout={(event) => setTabViewport(event.nativeEvent.layout.width)}
            contentContainerStyle={{ flexGrow: 1, padding: 3, gap: 2 }}
            className="h-[46px] rounded-full bg-surface border border-border"
            accessibilityRole="tablist"
          >
            {libraryTabs.map((tab) => {
              const active = activeTab === tab;
              const label =
                tab === "all"
                  ? "All"
                  : tab === "movie"
                    ? "Movies"
                    : tab === "series"
                      ? "TV Shows"
                      : "Collections";
              return (
                <Pressable
                  key={tab}
                  onLayout={(event) => {
                    tabLayouts.current[tab] = event.nativeEvent.layout;
                  }}
                  accessibilityRole="tab"
                  accessibilityState={{ selected: active }}
                  onPress={() => {
                    if (active) return;
                    switchTab(tab);
                  }}
                  className={cn(
                    "flex-1 items-center justify-center rounded-full",
                    libraryTabs.length >= 5 ? "px-1.5" : "px-2",
                    active && "bg-foreground",
                    !active && "active:opacity-[0.65]",
                  )}
                >
                  <Text
                    className={cn(
                      libraryTabs.length >= 5 ? "text-[12px]" : libraryTabs.length === 4 ? "text-[13px]" : "text-[14px]",
                      // Mutually exclusive text styles — uniwind resolves
                      // conflicting text-* classes by stylesheet order, so a
                      // conditional override of text-muted never wins.
                      active
                        ? "font-archivo-bold text-background"
                        : "font-archivo-medium text-muted",
                    )}
                  >
                    {label}
                  </Text>
                </Pressable>
              );
            })}
          </ScrollView>
        </View>
      )}

      <SwipePager
        pageKeys={libraryTabs}
        index={Math.max(0, libraryTabs.indexOf(activeTab))}
        onChange={(index) => switchTab(libraryTabs[index]!)}
        renderPage={(index) =>
          libraryTabs[index] === "collection" ? (
            <FlatList
              data={collections}
              keyExtractor={(c) => String(c.id)}
              contentContainerStyle={{
                gap: 10,
                paddingHorizontal: 20,
                paddingBottom: 24,
                paddingTop: 12,
              }}
              renderItem={({ item }) => (
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={`Open collection ${item.name}`}
                  onPress={() => {
                    triggerHaptic("light");
                    setCollection(item);
                  }}
                  className="flex-row items-center gap-3 rounded-[18px] bg-surface p-3 active:opacity-70"
                >
                  {item.poster ? (
                    <PosterImage
                      source={api.image(item.poster)}
                      style={{ width: 44, height: 64, borderRadius: 8 }}
                    />
                  ) : (
                    <View className="h-[64px] w-[44px] items-center justify-center rounded-[8px] bg-surface-secondary">
                      <Film size={20} color={colors.quiet} />
                    </View>
                  )}
                  <View className="flex-1 gap-0.5">
                    <Text
                      className="font-archivo-bold text-[15px] text-foreground"
                      numberOfLines={1}
                    >
                      {item.name}
                    </Text>
                    <Text className="font-archivo-regular text-[12px] text-muted">
                      {item.count === 1 ? "1 movie" : `${item.count} movies`}
                    </Text>
                  </View>
                  <ChevronRight
                    size={18}
                    color={colors.muted}
                    strokeWidth={2}
                  />
                </Pressable>
              )}
              ListEmptyComponent={
                <Notice message="No collections yet. Identified movie collections appear here." />
              }
            />
          ) : (
            <LibraryTitles
              key={`${libraryTabs[index]}-${sort}-${unwatched}-${genre}-${maxRuntime}`}
              tab={libraryTabs[index] as "all" | "movie" | "series"}
              sort={sort}
              unwatched={unwatched}
              genre={genre}
              maxRuntime={libraryTabs[index] === "series" ? undefined : maxRuntime}
              loadingOnline={remoteMetadata.loading && !offlineFilter}
              open={openAny}
              play={play}
              onlineItems={savedOnlineFor(libraryTabs[index]!)}
              emptyLibrary={libraryEmpty}
              onAddFolder={() => router.push("/settings/folders")}
            />
          )
        }
      />

      <Modal
        visible={sortOpen}
        transparent
        animationType="fade"
        statusBarTranslucent
        onRequestClose={() => setSortOpen(false)}
      >
        <Pressable
          className="flex-1 justify-end bg-black/66"
          onPress={() => setSortOpen(false)}
          accessibilityLabel="Close sort and filter"
        >
          <Pressable
            accessibilityViewIsModal
            className="bg-overlay rounded-t-[24px] border-t-[0.33px] border-border pt-2 px-3"
            style={{ paddingBottom: Math.max(insets.bottom, 12) }}
            onPress={() => {}}
          >
            <View className="w-[40px] h-[4px] rounded-[2px] bg-foreground/22 self-center mb-2.5" />
            <View className="flex-row items-center px-2 pb-3">
              <Text
                accessibilityRole="header"
                className="flex-1 font-archivo-bold text-[22px] text-foreground"
              >
                Sort & filter
              </Text>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Close sort and filter"
                onPress={() => setSortOpen(false)}
                className="h-12 w-12 items-center justify-center rounded-full bg-default"
              >
                <X size={22} color={colors.ink} />
              </Pressable>
            </View>
            <ScrollView style={{ maxHeight: 450 }} keyboardShouldPersistTaps="handled">
            {FILTERS.map(([key, label]) => (
              <FilterRow
                key={key}
                label={label}
                role="radio"
                active={sort === key}
                onPress={() => {
                  triggerHaptic("selection");
                  reset(key, unwatched);
                  setSortOpen(false);
                }}
              />
            ))}
            <FilterRow
              label={genre ? `Genre · ${genre}` : "Genre · Any"}
              role="checkbox"
              active={Boolean(genre)}
              onPress={() => {
                setSortOpen(false);
                showDialog("Genre", "Filter your library by genre.", [
                  { text: "Any genre", onPress: () => setGenre(undefined) },
                  ...genres.map((value) => ({ text: value, onPress: () => setGenre(value) })),
                ]);
              }}
            />
            {activeTab !== "series" ? (
              <FilterRow
                label={maxRuntime ? `Movie runtime · Up to ${maxRuntime} min` : "Movie runtime · Any"}
                role="checkbox"
                active={Boolean(maxRuntime)}
                onPress={() => {
                  setSortOpen(false);
                  showDialog("Movie runtime", "Choose how much time you have.", [
                    { text: "Any runtime", onPress: () => setMaxRuntime(undefined) },
                    ...[60, 90, 120, 150].map((value) => ({
                      text: `Up to ${value} minutes`,
                      onPress: () => setMaxRuntime(value),
                    })),
                  ]);
                }}
              />
            ) : null}
            <FilterRow
              label="Unwatched only"
              role="checkbox"
              active={unwatched}
              onPress={() => {
                triggerHaptic("selection");
                reset(sort, !unwatched);
              }}
            />
            {hybrid && (
              <FilterRow
                label="Offline only"
                role="checkbox"
                active={offlineFilter}
                onPress={() => {
                  triggerHaptic("selection");
                  setOfflineOnly((value) => !value);
                }}
              />
            )}
            {(genre || maxRuntime || unwatched || offlineFilter) ? (
              <Button label="Clear filters" onPress={() => {
                setGenre(undefined);
                setMaxRuntime(undefined);
                setUnwatched(false);
                setOfflineOnly(false);
              }} />
            ) : null}
            </ScrollView>
          </Pressable>
        </Pressable>
      </Modal>
    </View>
  );
}

/**
 * Bottom-sheet choice row. The selected state is a subtle foreground tint
 * rather than an inverted fill: the label keeps `text-foreground`, so it
 * stays readable in both light and dark mode (conditional `text-background`
 * utilities cannot override an always-present text color).
 */
function FilterRow({
  label,
  role,
  active,
  onPress,
}: {
  label: string;
  role: "radio" | "checkbox";
  active: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityRole={role}
      accessibilityState={{ checked: active }}
      onPress={onPress}
      className={cn(
        "min-h-[52px] flex-row items-center justify-between px-3.5 rounded-[12px]",
        active ? "bg-accent/15" : "active:bg-foreground/[0.06]",
      )}
    >
      <Text
        className={cn(
          "font-archivo-medium text-[15px] text-foreground",
          active && "font-archivo-bold",
        )}
      >
        {label}
      </Text>
      {role === "checkbox" ? <CheckboxIndicator checked={active} /> : null}
    </Pressable>
  );
}

function LibraryTitles({
  tab,
  sort,
  unwatched,
  genre,
  maxRuntime,
  loadingOnline,
  open,
  play,
  onlineItems = [],
  emptyLibrary,
  onAddFolder,
}: {
  tab: "all" | "movie" | "series";
  sort: string;
  unwatched: boolean;
  genre?: string;
  maxRuntime?: number;
  loadingOnline: boolean;
  open: OpenTitle;
  play?: (fileId: number) => void;
  onlineItems?: ItemCard[];
  emptyLibrary?: boolean;
  onAddFolder?: () => void;
}) {
  const colors = useColors();
  const { api, preferences } = useClient();
  const prefetch = useTitlePrefetch();
  const titleActions = useTitleActions();
  const remoteActions = useRemoteTitleActions();
  const remoteNavigation = useRemoteNavigation();
  const playTitle = usePlayTitle(play, (item) => open(item.publicId));
  const { width } = useWindowDimensions();
  const [extra, setExtra] = useState<ItemCard[]>([]);
  const [more, setMore] = useState(false);
  const [moreError, setMoreError] = useState("");
  const [end, setEnd] = useState(false);
  const filters: LibraryFilters | undefined = genre || maxRuntime ? { genre, maxRuntime } : undefined;
  const filteredOnlineItems = React.useMemo(
    () => onlineItems.filter((item) => matchesLibraryFilters(item, { genre, maxRuntime })),
    [onlineItems, genre, maxRuntime],
  );
  const data = useResource(
    (signal) => api.items(tab, 0, sort, signal, unwatched, filters),
    [api, tab, sort, unwatched, genre, maxRuntime],
  );
  const localItems = React.useMemo(
    () => [...(data.value?.items ?? []), ...extra],
    [data.value?.items, extra],
  );
  const items = React.useMemo(() => {
    if (!filteredOnlineItems.length) return localItems;
    if (!localItems.length) return filteredOnlineItems;
    const merged: ItemCard[] = [];
    let localIndex = 0;
    let onlineIndex = 0;
    while (localIndex < localItems.length || onlineIndex < filteredOnlineItems.length) {
      for (let step = 0; step < 3 && localIndex < localItems.length; step += 1) {
        merged.push(localItems[localIndex++]!);
      }
      if (onlineIndex < filteredOnlineItems.length)
        merged.push(filteredOnlineItems[onlineIndex++]!);
    }
    return merged;
  }, [localItems, filteredOnlineItems]);
  const available = width - 0 - 40;
  const columns = Math.max(2, Math.floor(available / 150));
  const cardWidth = Math.floor(available / columns) - 10;
  async function loadMore() {
    if (
      more ||
      end ||
      data.loading ||
      !data.value ||
      data.value.items.length < 60
    )
      return;
    setMore(true);
    setMoreError("");
    try {
      const result = await api.items(
        tab,
        localItems.length,
        sort,
        undefined,
        unwatched,
        filters,
      );
      setExtra((prev) => [
        ...prev,
        ...result.items.filter((item) => !localItems.some((i) => i.id === item.id)),
      ]);
      setEnd(result.items.length < 60);
    } catch (e) {
      setMoreError(
        e instanceof Error ? e.message : "Could not load more titles.",
      );
    } finally {
      setMore(false);
    }
  }
  return data.loading || (loadingOnline && !items.length) ? (
    <LibraryGridSkeleton />
  ) : data.error ? (
    <PageState
      icon={AlertCircle}
      title="Couldn't load your library"
      message={data.error}
      onAction={data.retry}
    />
  ) : (
    <FlatList
      key={`${columns}-${tab}`}
      data={items}
      numColumns={columns}
      keyExtractor={(item) => item.publicId}
      initialNumToRender={6}
      maxToRenderPerBatch={6}
      updateCellsBatchingPeriod={40}
      windowSize={5}
      {...prefetch}
      columnWrapperStyle={{ gap: 12 }}
      contentContainerStyle={{
        gap: 12,
        paddingHorizontal: 20,
        paddingBottom: 24,
        paddingTop: 4,
      }}
      renderItem={({ item }) => {
        const isOnline = item.publicId.startsWith("remote:");
        return (
          <Card
            width={cardWidth}
            item={item}
            api={api}
            online={isOnline}
            onPress={() => {
              open(item.publicId);
            }}
            onLongPress={() =>
              isOnline
                ? remoteActions(item, {
                    play: () => {
                      const title = remoteTitleFromCard(item);
                      if (title) remoteNavigation.play(title);
                    },
                    onChanged: data.retry,
                  })
                : titleActions(item, {
                    play: () => playTitle(item),
                    onChanged: data.retry,
                  })
            }
          />
        );
      }}
      onScrollToIndexFailed={() => {}}
      ListEmptyComponent={
        emptyLibrary ? (
          preferences.mode === "online" ? (
            <View className="items-center gap-3 px-6 py-12">
              <View className="h-16 w-16 items-center justify-center rounded-full bg-surface">
                <Film size={28} color={colors.brandLight} />
              </View>
              <Text className="text-center font-archivo-bold text-[22px] leading-[28px] text-foreground">
                No saved titles yet
              </Text>
              <Text className="max-w-[300px] text-center font-archivo-regular text-[14px] leading-[21px] text-muted">
                Save a movie or show from Search and it will appear here.
              </Text>
            </View>
          ) : (
            <View className="items-center gap-3 px-6 py-12">
              <View className="h-16 w-16 items-center justify-center rounded-full bg-surface">
                <Film size={28} color={colors.brandLight} />
              </View>
              <Text className="text-center font-archivo-bold text-[22px] leading-[28px] text-foreground">
                Your library is empty
              </Text>
              <Text className="max-w-[300px] text-center font-archivo-regular text-[14px] leading-[21px] text-muted">
                Add a media folder and Plexy will bring your movies and shows
                together here.
              </Text>
              <Button
                label="Add media folder"
                primary
                onPress={() => onAddFolder?.()}
                style={{ marginTop: 8, minWidth: 170 }}
              />
            </View>
          )
        ) : (
          <Notice message={"No titles match this filter."} />
        )
      }
      ListFooterComponent={
        <View className="gap-3 pt-2">
          {!!moreError && <Notice message={moreError} />}
          {!end && data.value?.items?.length === 60 && (
            <Button
              label={more ? "Loading…" : "Load more"}
              disabled={more}
              onPress={() => void loadMore()}
            />
          )}
        </View>
      }
      onEndReached={() => void loadMore()}
      onEndReachedThreshold={0.4}
    />
  );
}
