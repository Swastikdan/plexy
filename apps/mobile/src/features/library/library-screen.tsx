import React,{ useEffect,useRef,useState } from "react";
import {
Animated,
FlatList,
Modal,
PanResponder,
Pressable,
ScrollView,
Text,
useWindowDimensions,
View,
} from "react-native";
import { useClient } from "../../core/client/client-provider";
import type { ItemCard } from "../../core/library/catalog-api";
import { localLibrary } from "../../core/library/local-runtime";
import { useResource } from "../../core/resources/use-resource";
import { useReducedMotion } from "../../shared/hooks/use-reduced-motion";
import { triggerHaptic } from "../../shared/lib/haptics";
import { colors,easings } from "../../shared/theme";
import { cn } from "../../shared/lib/cn";
import { Button } from "../../shared/ui/button";
import { ArrowUpDown,Check,ChevronDown } from "../../shared/ui/icons";
import { Loading } from "../../shared/ui/loading";
import { Card } from "../../shared/ui/media-card";
import { Notice } from "../../shared/ui/notice";
import { PageHeader } from "../../shared/ui/page-header";
import { TitleBrowser } from "../catalog/components/title-browser";
import { OpenTitle } from "../catalog/types";

// One pane per library tab: when the tab changes, the incoming content
// slides in from the direction of the switch with a subtle fade. A hard cut
// between lists reads as a glitch; a short directional slide reads as space.
// Transform + opacity only, native driver, so it never costs a frame.
function TabPane({
  paneKey,
  direction,
  reduceMotion,
  children,
}: {
  paneKey: string;
  direction: number;
  reduceMotion: boolean;
  children: React.ReactNode;
}) {
  const translate = useRef(new Animated.Value(0)).current;
  const opacity = useRef(new Animated.Value(1)).current;
  const dirRef = useRef(direction);
  dirRef.current = direction;
  const firstRun = useRef(true);
  useEffect(() => {
    if (firstRun.current) {
      firstRun.current = false;
      return;
    }
    if (reduceMotion) {
      translate.setValue(0);
      opacity.setValue(1);
      return;
    }
    translate.setValue(32 * dirRef.current);
    opacity.setValue(0.4);
    Animated.parallel([
      Animated.timing(translate, {
        toValue: 0,
        duration: 240,
        easing: easings.out,
        useNativeDriver: true,
      }),
      Animated.timing(opacity, {
        toValue: 1,
        duration: 240,
        easing: easings.out,
        useNativeDriver: true,
      }),
    ]).start();
  }, [paneKey, reduceMotion, translate, opacity]);
  return (
    <Animated.View
      className="flex-1"
      style={{
        transform: [{ translateX: translate }],
        opacity,
      }}
    >
      {children}
    </Animated.View>
  );
}

export function LibraryScreen({
  kind,
  open,
  defaultSubTab,
}: {
  kind: "movie" | "series" | "anime";
  open: OpenTitle;
  defaultSubTab?: "movie" | "series" | "anime";
}) {
  const { api, platform } = useClient();
  const { width } = useWindowDimensions();
  type LibraryTab = "movie" | "series" | "anime";
  const [activeTab, setActiveTab] = useState<LibraryTab>(defaultSubTab || kind);
  const [sort, setSort] = useState("added");
  const [unwatched, setUnwatched] = useState(false);
  const [sortOpen, setSortOpen] = useState(false);
  const [collection, setCollection] = useState<{
    id: number;
    name: string;
  } | null>(null);
  const [extra, setExtra] = useState<ItemCard[]>([]);
  const [more, setMore] = useState(false);
  const [moreError, setMoreError] = useState("");
  const [end, setEnd] = useState(false);
  const [, setFocusedId] = useState<number | null>(null);
  const ref = useRef<FlatList<ItemCard>>(null);
  // Probe movies, series, and anime to auto-hide empty tabs and set priority
  const movieProbe = useResource(
    (signal) => api.items("movie", 0, "name", signal),
    [api, defaultSubTab, "movie-probe"],
  );
  const seriesProbe = useResource(
    (signal) => api.items("series", 0, "name", signal),
    [api, defaultSubTab, "series-probe"],
  );
  const animeProbe = useResource(
    (signal) => api.items("anime", 0, "name", signal),
    [api, defaultSubTab, "anime-probe"],
  );
  const hasMovies = (movieProbe.value?.items?.length ?? 0) > 0;
  const hasSeries = (seriesProbe.value?.items?.length ?? 0) > 0;
  const hasAnime = (animeProbe.value?.items?.length ?? 0) > 0;
  const probesDone = movieProbe.value != null && seriesProbe.value != null;
  React.useEffect(() => {
    if (probesDone) {
      // Priority when multiple exist: Movies -> TV Shows -> Anime
      if (hasMovies) {
        if (!hasSeries && !hasAnime && activeTab !== "movie")
          switchTab("movie", false);
      } else if (hasSeries) {
        if (activeTab === "movie" || (activeTab === "anime" && !hasAnime)) {
          switchTab("series", false);
        }
      } else if (hasAnime) {
        if (activeTab === "movie" || activeTab === "series") {
          switchTab("anime", false);
        }
      }
    }
  }, [hasMovies, hasSeries, hasAnime, probesDone, defaultSubTab]);
  const libraryTabs = React.useMemo(() => {
    const base: LibraryTab[] = [];
    if (!probesDone) {
      base.push("movie", "series");
      base.push("anime");
    } else {
      if (hasMovies) base.push("movie");
      if (hasSeries) base.push("series");
      if (hasAnime) base.push("anime");
      if (base.length === 0) base.push("movie", "series");
    }
    return base;
  }, [
    defaultSubTab,
    probesDone,
    hasMovies,
    hasSeries,
    hasAnime,
    platform.local,
  ]);
  const showLibTabs = libraryTabs.length > 1;
  // Direction of the last library switch, so the pane can slide in from the
  // side the user swiped from.
  const [tabDir, setTabDir] = useState(1);
  const reduceMotion = useReducedMotion();
  function switchTab(next: LibraryTab, haptic = true) {
    const prevIndex = libraryTabs.indexOf(activeTab);
    const nextIndex = libraryTabs.indexOf(next);
    setTabDir(nextIndex >= prevIndex ? 1 : -1);
    if (haptic) triggerHaptic("selection");
    setActiveTab(next);
    setExtra([]);
    setEnd(false);
    setMoreError("");
  }
  const swipe = PanResponder.create({
    onMoveShouldSetPanResponder: (_, g) =>
      g.numberActiveTouches === 1 &&
      Math.abs(g.dx) > 24 &&
      Math.abs(g.dx) > Math.abs(g.dy) * 1.5,
    onPanResponderRelease: (_, g) => {
      if (
        Math.abs(g.dx) < 55 &&
        !(Math.abs(g.dx) > 24 && Math.abs(g.vx) > 0.35)
      )
        return;
      const next =
        libraryTabs[libraryTabs.indexOf(activeTab) + (g.dx < 0 ? 1 : -1)];
      if (next) switchTab(next);
    },
  });
  const data = useResource(
    (signal) => api.items(activeTab, 0, sort, signal, unwatched),
    [api, activeTab, sort, unwatched],
  );
  const items = [...(data.value?.items || []), ...extra];
  const available = width - 0 - 40;
  const columns = Math.max(2, Math.floor(available / 150));
  const cardWidth = Math.floor(available / columns) - 10;
  function reset(nextSort: string, nextUnwatched: boolean) {
    setExtra([]);
    setEnd(false);
    setMoreError("");
    setSort(nextSort);
    setUnwatched(nextUnwatched);
  }
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
        activeTab,
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
  const FILTERS: [string, string][] = [
    ["added", "Recently added"],
    ["name", "Name"],
    ["year", "Year"],
    ["rating", "Rating"],
  ];
  const sortLabel = FILTERS.find(([key]) => key === sort)?.[1] || "Name";
  return (
    <View className="flex-1 gap-0" {...swipe.panHandlers}>
      <PageHeader
        title="Libraries"
        right={
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`Sort and filter. ${sortLabel}${unwatched ? ", unwatched only" : ""}`}
            onPress={() => {
              triggerHaptic("light");
              setSortOpen(true);
            }}
            className={cn(
              "flex-row items-center gap-1.5 h-[38px] px-3 rounded-full border border-white/14 bg-surface max-w-[190px]",
              sortOpen && "border-white/40 bg-surface-secondary",
              "active:opacity-[0.72]",
            )}
          >
            <ArrowUpDown size={14} color="#ffffff" strokeWidth={2} />
            <Text
              className="font-archivo-medium text-[12.5px] text-foreground shrink"
              numberOfLines={1}
            >
              {sortLabel}
            </Text>
            <ChevronDown size={14} color={colors.muted} strokeWidth={2.2} />
          </Pressable>
        }
      />

      <TitleBrowser
        title={collection?.name ?? null}
        items={
          collection
            ? localLibrary.state.records
                .filter(
                  (r) =>
                    r.card.kind === "movie" &&
                    r.collection?.id === collection.id,
                )
                .map((r) => r.card)
            : []
        }
        close={() => setCollection(null)}
        open={open}
      />
      {activeTab === "movie" &&
        localLibrary.state.records.some((r) => r.collection) && (
          <View className="pt-3 gap-2.5">
            <Text className="px-5 text-muted font-archivo-medium text-[13px]">
              Collections
            </Text>
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              className="grow-0"
              contentContainerStyle={{ paddingHorizontal: 20, gap: 10 }}
            >
              {[
                ...new Map(
                  localLibrary.state.records
                    .filter((r) => r.collection)
                    .map((r) => [r.collection!.id, r.collection!]),
                ).values(),
              ].map((group) => (
                <Pressable
                  key={group.id}
                  accessibilityRole="button"
                  onPress={() => setCollection(group)}
                  className={cn(
                    "px-4 py-3 rounded-full border border-border bg-surface",
                    "active:bg-surface-hover",
                  )}
                >
                  <Text className="text-foreground font-archivo-medium">
                    {group.name}
                  </Text>
                </Pressable>
              ))}
            </ScrollView>
          </View>
        )}
      {/* Movies | TV Shows | Anime — full-width segmented control with real touch targets */}
      {showLibTabs && (
        <View className="px-5 pb-3">
          <View
            className="flex-row h-[46px] p-[3px] rounded-full bg-surface border border-border"
            accessibilityRole="tablist"
          >
            {libraryTabs.map((tab) => {
              const active = activeTab === tab;
              const label =
                tab === "movie"
                  ? "Movies"
                  : tab === "series"
                    ? "TV Shows"
                    : tab === "anime"
                      ? "Anime"
                      : "Anime";
              return (
                <Pressable
                  key={tab}
                  accessibilityRole="tab"
                  accessibilityState={{ selected: active }}
                  onPress={() => {
                    if (active) return;
                    switchTab(tab);
                  }}
                  className={cn(
                    "flex-1 rounded-full items-center justify-center px-3",
                    active && "bg-white",
                    !active && "active:opacity-[0.65]",
                  )}
                >
                  <Text
                    className={cn(
                      "font-archivo-medium text-[14px] text-muted tracking-[0.1px]",
                      active && "font-archivo-bold text-black",
                    )}
                  >
                    {label}
                  </Text>
                </Pressable>
              );
            })}
          </View>
        </View>
      )}

      <TabPane paneKey={activeTab} direction={tabDir} reduceMotion={reduceMotion}>
        {data.loading ? (
          <Loading />
        ) : data.error ? (
          <Notice message={data.error} retry={data.retry} />
        ) : (
          <FlatList
          ref={ref}
          key={`${columns}-${activeTab}`}
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
              onFocus={() => {
                setFocusedId(item.id);
              }}
              onPress={() => {
                setFocusedId(item.id);
                open(item.publicId);
              }}
            />
          )}
          onScrollToIndexFailed={() => {}}
          ListEmptyComponent={
            <Notice message={"No titles match this filter."} />
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
      </TabPane>

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
            className="bg-[#0b0b0b] rounded-t-[24px] border-t-[0.33px] border-border pt-2 px-3"
            onPress={() => {}}
          >
            <View className="w-[40px] h-[4px] rounded-[2px] bg-white/22 self-center mb-2.5" />
            <Text className="font-archivo-bold text-[18px] text-foreground tracking-[-0.3px] px-2 pb-3">
              Sort & filter
            </Text>
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
                    active && "bg-white",
                    "active:opacity-[0.75]",
                  )}
                >
                  <Text
                    className={cn(
                      "font-archivo-medium text-[15px] text-foreground",
                      active && "font-archivo-bold text-black",
                    )}
                  >
                    {label}
                  </Text>
                  {active && (
                    <Check size={18} color="#000000" strokeWidth={2.6} />
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
                unwatched && "bg-white",
                "active:opacity-[0.75]",
              )}
            >
              <Text
                className={cn(
                  "font-archivo-medium text-[15px] text-foreground",
                  unwatched && "font-archivo-bold text-black",
                )}
              >
                Unwatched only
              </Text>
              {unwatched && (
                <Check size={18} color="#000000" strokeWidth={2.6} />
              )}
            </Pressable>
            <View className="h-4" />
          </Pressable>
        </Pressable>
      </Modal>
    </View>
  );
}
