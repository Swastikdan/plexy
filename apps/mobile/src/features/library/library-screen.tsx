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
  Folder,
  ArrowUpDown,
  Calendar,
  Check,
  ChevronRight,
  Filter,
  Plus,
  X,
} from "@/shared/ui/icons";
import { Notice } from "@/shared/ui/notice";
import { PageState } from "@/shared/ui/page-state";
import { PageHeader } from "@/shared/ui/page-header";
import { LibraryGridSkeleton } from "@/shared/ui/skeleton";
import { Reveal } from "@/shared/ui/reveal";
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
import { Tappable } from "@/shared/ui/tappable";
import { ToggleSwitch } from "@/shared/ui/toggle-switch";
import { useTitlePrefetch } from "@/features/catalog/hooks/use-title-prefetch";
import { useCollections } from "@/features/collections/collections-store";

const genres = [
  "Action", "Action & Adventure", "Adventure", "Animation", "Comedy", "Crime",
  "Documentary", "Drama", "Family", "Fantasy", "History", "Horror", "Kids",
  "Music", "Mystery", "News", "Reality", "Romance", "Sci-Fi & Fantasy",
  "Science Fiction", "Soap", "Talk", "Thriller", "TV Movie", "War",
  "War & Politics", "Western",
];

type CollectionRow =
  | {
      key: string;
      kind: "automatic";
      id: number;
      name: string;
      count: number;
      poster: string | null;
      items: ItemCard[];
    }
  | {
      key: string;
      kind: "custom";
      id: string;
      name: string;
      count: number;
      poster: string | null;
      titleIds: string[];
    };

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
  const online = preferences.source === "online";
  type LibraryTab = "all" | "movie" | "series" | "collection";
  const [activeTab, setActiveTab] = useState<LibraryTab>("all");
  const [sort, setSort] = useState("added");
  const [genre, setGenre] = useState<string>();
  const [maxRuntime, setMaxRuntime] = useState<number>();
  const [unwatched, setUnwatched] = useState(false);
  const [offlineOnly, setOfflineOnly] = useState(false);
  const [sheet, setSheet] = useState<"sort" | "filter" | null>(null);
  const [collection, setCollection] = useState<{
    name: string;
    items: ItemCard[];
  } | null>(null);
  const [, updateCollections] = useState(0);
  useEffect(
    () => runtime.subscribe(() => updateCollections((n) => n + 1)),
    [runtime],
  );
  const automaticCollections = api.collections();
  const customCollections = useCollections();
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
  // Automatic collections merge the local TMDB metadata with the saved online
  // catalog. Local collections only include titles on this device; online
  // collections include the saved titles in the group.
  const automaticCollectionRows = React.useMemo<CollectionRow[]>(() => {
    const groups = new Map<
      number,
      { name: string; poster: string | null; items: ItemCard[] }
    >();
    for (const entry of automaticCollections) {
      groups.set(entry.id, {
        name: entry.name,
        poster: entry.poster,
        items: api.collectionItems(entry.id),
      });
    }
    if (online) {
      const savedCards = new Map(savedOnline.map((item) => [item.publicId, item]));
      for (const entry of saved) {
        if (entry.title.mediaType !== "movie" || !entry.title.collection) continue;
        const card = savedCards.get(
          remotePublicId(entry.title.mediaType, entry.title.tmdbId),
        );
        if (!card) continue;
        const group = groups.get(entry.title.collection.id) ?? {
          name: entry.title.collection.name,
          poster: null,
          items: [],
        };
        if (!group.items.some((item) => item.publicId === card.publicId)) {
          group.items.push(card);
        }
        group.poster ||= card.poster;
        groups.set(entry.title.collection.id, group);
      }
    }
    return [...groups.entries()]
      .map(([id, group]) => ({
        key: `automatic-${id}`,
        kind: "automatic" as const,
        id,
        name: group.name,
        count: group.items.length,
        poster: group.poster,
        items: group.items,
      }))
      .sort((left, right) => left.name.localeCompare(right.name));
  }, [api, automaticCollections, online, saved, savedOnline]);
  const collectionRows = React.useMemo<CollectionRow[]>(
    () => [
      ...automaticCollectionRows,
      ...customCollections.map((entry) => ({
        key: `custom-${entry.id}`,
        kind: "custom" as const,
        id: entry.id,
        name: entry.name,
        count: entry.titleIds.length,
        poster: null,
        titleIds: entry.titleIds,
      })),
    ],
    [automaticCollectionRows, customCollections],
  );
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
  // Collections are part of the library rather than a separate destination.
  // Keeping the tab available even when the list is empty gives the page a
  // place to explain automatic TMDB groups and to create the first custom one.
  const libraryTabs = React.useMemo<LibraryTab[]>(
    () => ["all", "movie", "series", "collection"],
    [],
  );
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
          // Fixed height so switching to Collections (no sort/filter) never
          // changes the header height.
          <View className="h-[38px] flex-row items-center gap-2">
            {online ? (
              <Tappable
                accessibilityRole="button"
                accessibilityLabel="Episode calendar"
                onPress={() => router.push("/episode-calendar")}
                className="h-[38px] w-[38px] items-center justify-center rounded-full border border-foreground/14 bg-surface"
              >
                <Calendar size={17} color={colors.ink} strokeWidth={1.9} />
              </Tappable>
            ) : null}
            {activeTab !== "collection" ? (
              <View className="h-[38px] flex-row items-center rounded-full border border-foreground/14 bg-surface">
                <Tappable
                  accessibilityRole="button"
                  accessibilityLabel={`Sort by ${sortLabel}`}
                  onPress={() => {
                    triggerHaptic("light");
                    setSheet("sort");
                  }}
                  className="h-full flex-row items-center gap-1.5 pl-3 pr-2.5"
                >
                  <ArrowUpDown size={14} color={colors.ink} strokeWidth={2} />
                  <Text
                    className="font-archivo-medium text-[12.5px] text-foreground"
                    numberOfLines={1}
                  >
                    {({ added: "Recent", name: "Name", year: "Year", rating: "Rating" } as Record<string, string>)[sort] ?? "Name"}
                  </Text>
                </Tappable>
                <View className="h-[18px] w-px bg-foreground/14" />
                <Tappable
                  accessibilityRole="button"
                  accessibilityLabel={filterCount ? `Filters, ${filterCount} active` : "Filters"}
                  onPress={() => {
                    triggerHaptic("light");
                    setSheet("filter");
                  }}
                  className="h-full flex-row items-center gap-1.5 pl-2.5 pr-3"
                >
                  <Filter size={15} color={colors.ink} strokeWidth={2} />
                  {filterCount ? (
                    <View className="h-[18px] min-w-[18px] items-center justify-center rounded-full bg-foreground px-1">
                      <Text className="font-archivo-bold text-[11px] text-background">{filterCount}</Text>
                    </View>
                  ) : null}
                </Tappable>
              </View>
            ) : null}
          </View>
        }
      />

      <TitleBrowser
        title={collection?.name ?? null}
        items={collection?.items ?? []}
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
                    !active && "active:opacity-70",
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
              data={collectionRows}
              keyExtractor={(entry) => entry.key}
              contentContainerStyle={{
                flexGrow: 1,
                gap: 10,
                paddingHorizontal: 20,
                paddingBottom: 24,
                paddingTop: 12,
              }}
              renderItem={({ item }) => (
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={`Open ${item.kind === "automatic" ? "automatic" : "custom"} collection ${item.name}`}
                  onPress={() => {
                    triggerHaptic("light");
                    if (item.kind === "automatic") {
                      setCollection({ name: item.name, items: item.items });
                    } else {
                      router.push({
                        pathname: "/custom-collections",
                        params: { id: item.id },
                      });
                    }
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
                      {item.kind === "automatic" ? (
                        <Film size={20} color={colors.quiet} />
                      ) : (
                        <Folder size={20} color={colors.quiet} />
                      )}
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
                      {item.kind === "automatic"
                        ? item.count === 1
                          ? "1 movie · Automatic"
                          : `${item.count} movies · Automatic`
                        : item.count === 1
                          ? "1 title · Custom"
                          : `${item.count} titles · Custom`}
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
                <View className="flex-1 items-center justify-center gap-3 px-6 pb-16">
                  <View className="h-16 w-16 items-center justify-center rounded-full bg-surface">
                    <Folder size={28} color={colors.brandLight} />
                  </View>
                  <Text className="text-center font-archivo-bold text-[22px] leading-[28px] text-foreground">
                    No collections yet
                  </Text>
                  <Text className="max-w-[300px] text-center font-archivo-regular text-[14px] leading-[21px] text-muted">
                    Franchise collections appear here automatically from TMDB.
                    Create your own to group titles for a mood or a movie night.
                  </Text>
                  <Button
                    primary
                    label="Create collection"
                    onPress={() =>
                      router.push({
                        pathname: "/custom-collections",
                        params: { create: "1" },
                      })
                    }
                    className="mt-2 min-w-[170px]"
                  />
                </View>
              }
              ListFooterComponent={
                collectionRows.length > 0 ? (
                  <Pressable
                    accessibilityRole="button"
                    onPress={() =>
                      router.push({
                        pathname: "/custom-collections",
                        params: { create: "1" },
                      })
                    }
                    className="mt-2 flex-row items-center justify-center gap-2 rounded-[18px] border border-border px-4 py-3 active:opacity-70"
                  >
                    <Plus size={16} color={colors.ink} strokeWidth={2} />
                    <Text className="font-archivo-medium text-[14px] text-foreground">
                      New collection
                    </Text>
                  </Pressable>
                ) : null
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
        visible={sheet !== null}
        transparent
        animationType="fade"
        statusBarTranslucent
        onRequestClose={() => setSheet(null)}
      >
        <Pressable
          className="flex-1 justify-end bg-black/66"
          onPress={() => setSheet(null)}
          accessibilityLabel="Close"
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
                {sheet === "sort" ? "Sort by" : "Filter"}
              </Text>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Close"
                onPress={() => setSheet(null)}
                className="h-12 w-12 items-center justify-center rounded-full bg-default"
              >
                <X size={22} color={colors.ink} />
              </Pressable>
            </View>
            <ScrollView className="max-h-[450px]" keyboardShouldPersistTaps="handled">
            {sheet === "sort" ? FILTERS.map(([key, label]) => (
              <SheetRow
                key={key}
                label={label}
                role="radio"
                active={sort === key}
                onPress={() => {
                  triggerHaptic("selection");
                  reset(key, unwatched);
                  setSheet(null);
                }}
              />
            )) : (
              <>
                <SheetRow
                  label="Genre"
                  value={genre ?? "Any"}
                  onPress={() => {
                    setSheet(null);
                    showDialog("Genre", "Filter your library by genre.", [
                      { text: "Any genre", onPress: () => setGenre(undefined) },
                      ...genres.map((value) => ({ text: value, onPress: () => setGenre(value) })),
                    ]);
                  }}
                />
                {activeTab !== "series" ? (
                  <SheetRow
                    label="Movie runtime"
                    value={maxRuntime ? `Up to ${maxRuntime} min` : "Any"}
                    onPress={() => {
                      setSheet(null);
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
                <SheetRow
                  label="Unwatched only"
                  role="switch"
                  active={unwatched}
                  onPress={() => reset(sort, !unwatched)}
                />
                {hybrid && (
                  <SheetRow
                    label="Offline only"
                    role="switch"
                    active={offlineFilter}
                    onPress={() => setOfflineOnly((value) => !value)}
                  />
                )}
                {(genre || maxRuntime || unwatched || offlineFilter) ? (
                  <Button className="mt-2" label="Clear filters" onPress={() => {
                    setGenre(undefined);
                    setMaxRuntime(undefined);
                    setUnwatched(false);
                    setOfflineOnly(false);
                  }} />
                ) : null}
              </>
            )}
            </ScrollView>
          </Pressable>
        </Pressable>
      </Modal>
    </View>
  );
}

/**
 * Bottom-sheet row. Selection is shown by a check mark or switch, not a
 * tinted fill, so the sheet stays neutral in light and dark mode.
 */
function SheetRow({
  label,
  value,
  role = "button",
  active = false,
  onPress,
}: {
  label: string;
  value?: string;
  role?: "radio" | "switch" | "button";
  active?: boolean;
  onPress: () => void;
}) {
  const colors = useColors();
  return (
    <Tappable
      feedback="highlight"
      accessibilityRole={role}
      accessibilityState={role === "button" ? undefined : { checked: active }}
      onPress={onPress}
      className="min-h-[52px] flex-row items-center justify-between gap-3 rounded-[12px] px-3.5"
    >
      <Text className="font-archivo-medium text-[15px] text-foreground">{label}</Text>
      {role === "radio" ? (
        active ? <Check size={20} color={colors.ink} strokeWidth={2.2} /> : null
      ) : role === "switch" ? (
        <ToggleSwitch value={active} onValueChange={onPress} accessibilityLabel={label} />
      ) : (
        <View className="flex-row items-center gap-1">
          <Text className="font-archivo-regular text-[14px] text-muted" numberOfLines={1}>{value}</Text>
          <ChevronRight size={16} color={colors.muted} strokeWidth={2} />
        </View>
      )}
    </Tappable>
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
  const loadingGrid = data.loading || (loadingOnline && !items.length);
  return (
    <Reveal phase={loadingGrid ? "loading" : data.error ? "state" : "ready"}>
      {loadingGrid ? (
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
          flexGrow: 1,
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
              <View className="flex-1 items-center justify-center gap-3 px-6 pb-16">
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
              <View className="flex-1 items-center justify-center gap-3 px-6 pb-16">
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
                  className="mt-2 min-w-[170px]"
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
      )}
    </Reveal>
  );
}
