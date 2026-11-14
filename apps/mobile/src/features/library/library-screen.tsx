import { useReducedMotion } from "@/shared/hooks/use-reduced-motion";
import { SwipePager, usePagerGestureBoundary } from "@/shared/ui/swipe-pager";
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
import { useClient } from "@/core/client/client-provider";
import type { ItemCard } from "@/core/library/catalog-api";
import { useResource } from "@/core/resources/use-resource";
import { triggerHaptic } from "@/shared/lib/haptics";
import { useColors } from "@/shared/theme";
import { cn } from "@/shared/lib/cn";
import { Button } from "@/shared/ui/button";
import { Film } from "@/shared/ui/icons";
import {
  ArrowUpDown,
  Check,
  ChevronDown,
  ChevronRight,
  X,
} from "@/shared/ui/icons";
import { Loading } from "@/shared/ui/loading";
import { Card } from "@/shared/ui/media-card";
import { Notice } from "@/shared/ui/notice";
import { PageHeader } from "@/shared/ui/page-header";
import { PosterImage } from "@/shared/ui/poster-image";
import { TitleBrowser } from "@/features/catalog/components/title-browser";
import { OpenTitle } from "@/features/catalog/types";

export function LibraryScreen({
  kind,
  open,
  defaultSubTab,
}: {
  kind: "movie" | "series" | "anime";
  open: OpenTitle;
  defaultSubTab?: "movie" | "series" | "anime";
}) {
  const tabBoundary = usePagerGestureBoundary();
  const colors = useColors();
  const reduceMotion = useReducedMotion();
  const { api, runtime } = useClient();
  type LibraryTab = "all" | "movie" | "series" | "anime" | "collection";
  const [activeTab, setActiveTab] = useState<LibraryTab>(
    defaultSubTab || "all",
  );
  const [sort, setSort] = useState("added");
  const [unwatched, setUnwatched] = useState(false);
  const [sortOpen, setSortOpen] = useState(false);
  const [collection, setCollection] = useState<{
    id: number;
    name: string;
  } | null>(null);
  const [collectionsTick, updateCollections] = useState(0);
  useEffect(
    () => runtime.subscribe(() => updateCollections((n) => n + 1)),
    [runtime],
  );
  const collections = React.useMemo(
    () => api.collections(),
    [api, collectionsTick],
  );
  // One scan for tab availability instead of three paginated queries that each
  // sort the whole library.
  const counts = React.useMemo(
    () => api.counts(),
    [api, collectionsTick],
  );
  const libraryTabs = React.useMemo(() => {
    const base: LibraryTab[] = ["all"];
    if (counts.movie) base.push("movie");
    if (counts.series) base.push("series");
    if (counts.anime) base.push("anime");
    if (collections.length) base.push("collection");
    return base;
  }, [collections, counts]);
  useEffect(() => {
    if (!libraryTabs.includes(activeTab)) setActiveTab("all");
  }, [libraryTabs, activeTab]);
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
  return (
    <View className="flex-1 gap-0">
      <PageHeader
        title="Libraries"
        right={
          activeTab === "collection" ? undefined : (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`Sort and filter. ${sortLabel}${unwatched ? ", unwatched only" : ""}`}
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
                {sortLabel}
              </Text>
              <ChevronDown size={14} color={colors.muted} strokeWidth={2.2} />
            </Pressable>
          )
        }
      />

      <TitleBrowser
        title={collection?.name ?? null}
        items={collection ? api.collectionItems(collection.id) : []}
        close={() => setCollection(null)}
        open={open}
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
                      : tab === "anime"
                        ? "Anime"
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
                    "min-w-[72px] flex-grow rounded-full items-center justify-center px-3",
                    active && "bg-foreground",
                    !active && "active:opacity-[0.65]",
                  )}
                >
                  <Text
                    className={cn(
                      "text-[14px] tracking-[0.1px]",
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
              key={`${libraryTabs[index]}-${sort}-${unwatched}`}
              tab={libraryTabs[index] as "all" | "movie" | "series" | "anime"}
              sort={sort}
              unwatched={unwatched}
              open={open}
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
            className="bg-overlay rounded-t-[24px] border-t-[0.33px] border-border pt-2 px-3"
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
            {FILTERS.map(([key, label]) => {
              const active = sort === key;
              return (
                <Pressable
                  key={key}
                  accessibilityRole="radio"
                  accessibilityState={{ checked: active }}
                  onPress={() => {
                    triggerHaptic("selection");
                    reset(key, unwatched);
                    setSortOpen(false);
                  }}
                  className={cn(
                    "min-h-[52px] flex-row items-center justify-between px-3.5 rounded-[12px]",
                    active && "bg-foreground",
                    "active:opacity-[0.75]",
                  )}
                >
                  <Text
                    className={cn(
                      "font-archivo-medium text-[15px] text-foreground",
                      active && "font-archivo-bold text-background",
                    )}
                  >
                    {label}
                  </Text>
                  {active && (
                    <Check size={18} color={colors.canvas} strokeWidth={2.6} />
                  )}
                </Pressable>
              );
            })}
            <Pressable
              accessibilityRole="checkbox"
              accessibilityState={{ checked: unwatched }}
              onPress={() => {
                triggerHaptic("selection");
                reset(sort, !unwatched);
              }}
              className={cn(
                "min-h-[52px] flex-row items-center justify-between px-3.5 rounded-[12px]",
                unwatched && "bg-foreground",
                "active:opacity-[0.75]",
              )}
            >
              <Text
                className={cn(
                  "font-archivo-medium text-[15px] text-foreground",
                  unwatched && "font-archivo-bold text-background",
                )}
              >
                Unwatched only
              </Text>
              {unwatched && (
                <Check size={18} color={colors.canvas} strokeWidth={2.6} />
              )}
            </Pressable>
            <View className="h-4" />
          </Pressable>
        </Pressable>
      </Modal>
    </View>
  );
}

function LibraryTitles({
  tab,
  sort,
  unwatched,
  open,
}: {
  tab: "all" | "movie" | "series" | "anime";
  sort: string;
  unwatched: boolean;
  open: OpenTitle;
}) {
  const { api } = useClient();
  const { width } = useWindowDimensions();
  const [extra, setExtra] = useState<ItemCard[]>([]);
  const [more, setMore] = useState(false);
  const [moreError, setMoreError] = useState("");
  const [end, setEnd] = useState(false);
  const data = useResource(
    (signal) => api.items(tab, 0, sort, signal, unwatched),
    [api, tab, sort, unwatched],
  );
  const items = [...(data.value?.items || []), ...extra];
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
        items.length,
        sort,
        undefined,
        unwatched,
      );
      setExtra((prev) => [
        ...prev,
        ...result.items.filter((item) => !items.some((i) => i.id === item.id)),
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
  return data.loading ? (
    <Loading />
  ) : data.error ? (
    <Notice message={data.error} retry={data.retry} />
  ) : (
    <FlatList
      key={`${columns}-${tab}`}
      data={items}
      numColumns={columns}
      keyExtractor={(item) => String(item.id)}
      columnWrapperStyle={{ gap: 12 }}
      contentContainerStyle={{
        gap: 12,
        paddingHorizontal: 20,
        paddingBottom: 24,
        paddingTop: 4,
      }}
      renderItem={({ item, index }) => (
        <Card
          width={cardWidth}
          item={item}
          api={api}
          onPress={() => {
            open(item.publicId);
          }}
        />
      )}
      onScrollToIndexFailed={() => {}}
      ListEmptyComponent={<Notice message={"No titles match this filter."} />}
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
