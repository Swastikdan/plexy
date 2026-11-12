import React,{ useEffect,useRef,useState } from "react";
import {
Animated,
FlatList,
Modal,
PanResponder,
Pressable,
ScrollView,
StyleSheet,
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
import { colors,control,easings,fonts } from "../../shared/theme";
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
      style={{
        flex: 1,
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
    <View style={styles.libraryRoot} {...swipe.panHandlers}>
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
            style={({ pressed }) => [
              styles.sortButton,
              sortOpen && styles.sortButtonOpen,
              pressed && { opacity: 0.72 },
            ]}
          >
            <ArrowUpDown size={14} color="#ffffff" strokeWidth={2} />
            <Text style={styles.sortButtonText} numberOfLines={1}>
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
          <View style={{ paddingTop: 12, gap: 10 }}>
            <Text
              style={{
                paddingHorizontal: 20,
                color: colors.muted,
                fontFamily: fonts.medium,
                fontSize: 13,
              }}
            >
              Collections
            </Text>
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              style={{ flexGrow: 0 }}
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
                  style={({ pressed }) => ({
                    paddingHorizontal: 16,
                    paddingVertical: 12,
                    borderRadius: control.radius,
                    backgroundColor: pressed ? colors.hover : colors.surface,
                    borderWidth: 1,
                    borderColor: colors.line,
                  })}
                >
                  <Text style={{ color: colors.ink, fontFamily: fonts.medium }}>
                    {group.name}
                  </Text>
                </Pressable>
              ))}
            </ScrollView>
          </View>
        )}
      {/* Movies | TV Shows | Anime — full-width segmented control with real touch targets */}
      {showLibTabs && (
        <View style={styles.libSegmentWrap}>
          <View style={styles.libSegment} accessibilityRole="tablist">
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
                  style={({ pressed }) => [
                    styles.libSegmentItem,
                    active && styles.libSegmentItemActive,
                    pressed && !active && { opacity: 0.65 },
                  ]}
                >
                  <Text
                    style={[
                      styles.libSegmentText,
                      active && styles.libSegmentTextActive,
                    ]}
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
          contentContainerStyle={styles.libGrid}
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
            <View style={{ gap: 12, paddingTop: 8 }}>
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
          style={styles.sortBackdrop}
          onPress={() => setSortOpen(false)}
          accessibilityLabel="Close sort and filter"
        >
          <Pressable style={styles.sortSheet} onPress={() => {}}>
            <View style={styles.sortHandle} />
            <Text style={styles.sortTitle}>Sort & filter</Text>
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
                  style={({ pressed }) => [
                    styles.sortRow,
                    active && styles.sortRowActive,
                    pressed && { opacity: 0.75 },
                  ]}
                >
                  <Text
                    style={[
                      styles.sortRowText,
                      active && styles.sortRowTextActive,
                    ]}
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
              style={({ pressed }) => [
                styles.sortRow,
                unwatched && styles.sortRowActive,
                pressed && { opacity: 0.75 },
              ]}
            >
              <Text
                style={[
                  styles.sortRowText,
                  unwatched && styles.sortRowTextActive,
                ]}
              >
                Unwatched only
              </Text>
              {unwatched && (
                <Check size={18} color="#000000" strokeWidth={2.6} />
              )}
            </Pressable>
            <View style={{ height: 16 }} />
          </Pressable>
        </Pressable>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
libraryRoot: {
    flex: 1,
    gap: 0,
  },
sortButton: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    height: 38,
    paddingHorizontal: 12,
    borderRadius: control.radius,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.14)",
    backgroundColor: colors.surface,
    maxWidth: 190,
  },
sortButtonOpen: {
    borderColor: "rgba(255,255,255,0.4)",
    backgroundColor: colors.elevated,
  },
sortButtonText: {
    fontFamily: fonts.medium,
    fontSize: 12.5,
    color: colors.ink,
    flexShrink: 1,
  },
libSegmentWrap: {
    paddingHorizontal: 20,
    paddingBottom: 12,
  },
libSegment: {
    flexDirection: "row",
    height: 46,
    padding: 3,
    borderRadius: control.radius,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.line,
  },
libSegmentItem: {
    flex: 1,
    borderRadius: control.radius,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 12,
  },
libSegmentItemActive: {
    backgroundColor: "#ffffff",
  },
libSegmentText: {
    fontFamily: fonts.medium,
    fontSize: 14,
    color: colors.muted,
    letterSpacing: 0.1,
  },
libSegmentTextActive: {
    fontFamily: fonts.bold,
    color: "#000000",
  },
sortBackdrop: {
    flex: 1,
    justifyContent: "flex-end",
    backgroundColor: "rgba(0,0,0,0.66)",
  },
sortSheet: {
    backgroundColor: "#0b0b0b",
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderColor: "rgba(255,255,255,0.14)",
    paddingTop: 8,
    paddingHorizontal: 12,
  },
sortHandle: {
    width: 40,
    height: 4,
    borderRadius: 2,
    backgroundColor: "rgba(255,255,255,0.22)",
    alignSelf: "center",
    marginBottom: 10,
  },
sortTitle: {
    fontFamily: fonts.bold,
    fontSize: 18,
    color: colors.ink,
    letterSpacing: -0.3,
    paddingHorizontal: 8,
    paddingBottom: 12,
  },
sortRow: {
    minHeight: 52,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 14,
    borderRadius: 12,
  },
sortRowActive: {
    backgroundColor: "#ffffff",
  },
sortRowText: {
    fontFamily: fonts.medium,
    fontSize: 15,
    color: colors.ink,
  },
sortRowTextActive: {
    fontFamily: fonts.bold,
    color: "#000000",
  },
libGrid: {
    gap: 12,
    paddingHorizontal: 20,
    paddingBottom: 24,
    paddingTop: 4,
  }
});
