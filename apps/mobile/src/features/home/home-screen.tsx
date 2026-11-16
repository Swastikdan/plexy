import { useRouter } from "expo-router";
import { Button as NativeButton } from "heroui-native/button";
import React, { useRef } from "react";
import { RefreshControl, Pressable, ScrollView, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useClient } from "@/core/client/client-provider";
import type { ItemCard } from "@/core/library/catalog-api";
import { useResource } from "@/core/resources/use-resource";
import { useColors } from "@/shared/theme";
import { Film, Search } from "@/shared/ui/icons";
import { Notice } from "@/shared/ui/notice";
import { PageHeader } from "@/shared/ui/page-header";
import { HomeSkeleton } from "@/shared/ui/skeleton";
import { CatalogRow } from "@/features/catalog/components/catalog-row";
import { LibraryAttention } from "@/features/catalog/components/library-attention";
import { TopFade } from "@/features/catalog/components/top-fade";
import { useTitleActions } from "@/features/catalog/hooks/use-title-actions";
import { OpenTitle } from "@/features/catalog/types";
import { useRemoteTitleActions } from "@/features/remote/hooks/use-remote-title-actions";
import { parseRemotePublicId } from "@/features/remote/lib/view";
import { HeroCarousel } from "./components/hero-carousel";

export function HomeScreen({
  open,
  play,
  active,
  online,
}: {
  open: OpenTitle;
  play?: (fileId: number) => void;
  active: boolean;
  /** Extra rows from the online catalog when the hybrid mode is on. */
  online?: {
    rows: { key: string; title: string; items: ItemCard[] }[];
    carouselItems: ItemCard[];
    open: OpenTitle;
    play: (item: ItemCard) => void;
    loading: boolean;
    error?: string | null;
    refresh: () => void;
  };
}) {
  const colors = useColors();
  const { push, navigate } = useRouter();
  const { api, progress, preferences } = useClient();
  const remoteActions = useRemoteTitleActions();
  const titleActions = useTitleActions();
  const insets = useSafeAreaInsets();
  const [scrolled, setScrolled] = React.useState(false);
  const data = useResource((signal) => api.home(signal), [api]);
  const previousActive = useRef(active);
  React.useEffect(() => {
    if (active && !previousActive.current)
      void progress
        .flush(api)
        .catch(() => {})
        .finally(data.retry);
    previousActive.current = active;
  }, [active, api, progress, data.retry]);
  // Handler for instant playback
  const handlePlay = React.useCallback(
    (item: ItemCard) => {
      if (item.fileId && play) {
        play(item.fileId);
        return;
      }
      // Fetch detail to get first playable fileId
      void api
        .detail(item.publicId)
        .then((d) => {
          const fid =
            d.file?.fileId ||
            d.episodes?.find((e) => e.fileId && !e.watch?.played)?.fileId ||
            d.episodes?.find((e) => e.fileId)?.fileId;
          if (fid && play) {
            play(fid);
          } else {
            open(item.publicId);
          }
        })
        .catch(() => open(item.publicId));
    },
    [api, play, open],
  );
  // Normalize any item: if it is an episode, convert to full TV series card
  const toFullSeriesOrMovie = React.useCallback((it: ItemCard): ItemCard => {
    if (it.kind === "episode") {
      const seriesId = it.parentId || it.id;
      return {
        ...it,
        id: seriesId,
        publicId: it.parentPublicId || it.publicId,
        name:
          it.parentTitle ||
          it.name
            .replace(
              /^(?:S\d+[\s._-]*E\d+|Season\s*\d+\s*Episode\s*\d+|Episode\s*\d+)\s*[:·._-]?\s*/i,
              "",
            )
            .trim() ||
          it.name,
        kind: "series",
        seasonNumber: null,
        episodeNumber: null,
      };
    }
    return it;
  }, []);
  // Carousel items: up to 5 items (featured + items from rows) — movies and TV series only (NO episodes)
  const carouselItems = React.useMemo(() => {
    const list: ItemCard[] = [];
    const isShowOrMovie = (it: ItemCard) =>
      it.kind === "movie" || it.kind === "series";
    if (data.value?.featured && isShowOrMovie(data.value.featured)) {
      list.push(data.value.featured);
    }
    if (data.value?.rows) {
      for (const row of data.value.rows) {
        if (row.key === "next" || row.key === "continue") continue;
        for (const it of row.items) {
          if (!isShowOrMovie(it)) continue;
          if (!list.some((existing) => existing.id === it.id)) {
            list.push(it);
          }
          if (list.length >= 5) break;
        }
        if (list.length >= 5) break;
      }
    }
    return list;
  }, [data.value]);
  const scrollRef = useRef<ScrollView>(null);
  // Continue watching: only full series or movies with progress, deduplicated
  const continueItems = React.useMemo(() => {
    if (!data.value?.rows) return [];
    const continueRow = data.value.rows.find((r) => r.key === "continue");
    if (!continueRow) return [];
    const seen = new Set<string>();
    const list: ItemCard[] = [];
    for (const it of continueRow.items) {
      if (!it.watch?.position || it.watch?.played) continue;
      const normalized = toFullSeriesOrMovie(it);
      const key = `${normalized.kind}-${normalized.id}`;
      if (seen.has(key)) continue;
      seen.add(key);
      list.push(normalized);
    }
    return list;
  }, [data.value, toFullSeriesOrMovie]);
  // Other rows: filter out "next" (next up episodes) and continue watching, normalize to full titles
  const otherRows = React.useMemo(() => {
    if (!data.value?.rows) return [];
    const continueRowKey = data.value.rows.find(
      (r) => r.key === "continue",
    )?.key;
    return data.value.rows
      .filter((r) => r.key !== "next" && r.key !== continueRowKey)
      .map((r) => {
        const seen = new Set<string>();
        const items: ItemCard[] = [];
        for (const it of r.items) {
          const normalized = toFullSeriesOrMovie(it);
          const key = `${normalized.kind}-${normalized.id}`;
          if (seen.has(key)) continue;
          seen.add(key);
          items.push(normalized);
        }
        return { ...r, items };
      })
      .filter((r) => r.items.length > 0);
  }, [data.value, toFullSeriesOrMovie]);
  // Keep the local shelf whole, then follow it with the online category rows.
  // Movies and shows share a row; each card carries its own kind tag.
  const shelfRows = React.useMemo(
    () => [
      ...otherRows.map((row) => ({ ...row, online: false })),
      ...(online?.rows ?? []).map((row) => ({
        ...row,
        key: `online-${row.key}`,
        online: true,
      })),
    ],
    [online?.rows, otherRows],
  );
  const heroItems = React.useMemo(() => {
    const localItems = carouselItems;
    const onlineItems = online?.carouselItems ?? [];
    if (!localItems.length) return onlineItems;
    if (!onlineItems.length) return localItems;
    const localTmdb = new Set(api.titlesByTmdb().keys());
    const seen = new Set<string>();
    const remoteItems = onlineItems.filter((entry) => {
      if (seen.has(entry.publicId)) return false;
      seen.add(entry.publicId);
      const parsed = parseRemotePublicId(entry.publicId);
      return parsed
        ? !localTmdb.has(`${parsed.mediaType}:${parsed.tmdbId}`)
        : true;
    });
    // Alternate the two catalogs so an existing local library never hides the
    // online featured titles entirely.
    const merged: ItemCard[] = [];
    let localIndex = 0;
    let remoteIndex = 0;
    while (
      merged.length < 5 &&
      (localIndex < localItems.length || remoteIndex < remoteItems.length)
    ) {
      if (localIndex < localItems.length) merged.push(localItems[localIndex++]!);
      if (merged.length >= 5) break;
      if (remoteIndex < remoteItems.length)
        merged.push(remoteItems[remoteIndex++]!);
    }
    return merged;
  }, [api, carouselItems, online?.carouselItems]);
  const heroPlay = React.useCallback(
    (item: ItemCard) => {
      if (item.publicId.startsWith("remote:")) {
        online?.play(item);
        return;
      }
      handlePlay(item);
    },
    [handlePlay, online],
  );
  const heroOpen = React.useCallback(
    (id: string | number) => {
      const publicId = String(id);
      if (publicId.startsWith("remote:")) {
        online?.open(publicId);
        return;
      }
      open(publicId);
    },
    [online, open],
  );
  const heroLongPress = React.useCallback(
    (item: ItemCard) => {
      if (item.publicId.startsWith("remote:")) {
        remoteActions(item, { play: () => online?.play(item) });
        return;
      }
      titleActions(item, {
        play: () => handlePlay(item),
        onChanged: data.retry,
      });
    },
    [data.retry, handlePlay, online, remoteActions, titleActions],
  );
  const hasAnyRows =
    continueItems.length > 0 || shelfRows.length > 0;
  if (
    data.loading ||
    (online?.loading && !continueItems.length && !shelfRows.length)
  )
    return <HomeSkeleton />;
  if (data.error) return <Notice message={data.error} retry={data.retry} />;
  return (
    <View className="flex-1 bg-background">
      <TopFade />
      {scrolled && (
        <View
          pointerEvents="none"
          className="absolute left-0 right-0 top-0 border-b border-border"
          style={{
            height: insets.top + 72,
            backgroundColor: colors.canvas,
            zIndex: 19,
          }}
        />
      )}
      <PageHeader
        logo
        right={
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Search"
            onPress={() => navigate("/search")}
            hitSlop={8}
            className="h-10 w-10 items-center justify-center rounded-full border border-border bg-surface active:opacity-70"
          >
            <Search size={20} color={colors.ink} strokeWidth={2} />
          </Pressable>
        }
        style={[
          {
            position: "absolute",
            top: 0,
            left: 0,
            right: 0,
            zIndex: 20,
            backgroundColor: "transparent",
            elevation: 20,
          },
          { top: insets.top },
        ]}
      />
      <ScrollView
        ref={scrollRef}
        contentInsetAdjustmentBehavior="never"
        contentContainerStyle={[
          { paddingBottom: 28 },
          !heroItems.length && { paddingTop: insets.top + 90 },
        ]}
        showsVerticalScrollIndicator={false}
        removeClippedSubviews={false}
        scrollEventThrottle={16}
        onScroll={(event) => {
          const next = event.nativeEvent.contentOffset.y > 8;
          setScrolled((previous) => (previous === next ? previous : next));
        }}
        refreshControl={
          <RefreshControl
            refreshing={data.loading || Boolean(online?.loading)}
            onRefresh={() => {
              data.retry();
              online?.refresh();
            }}
            tintColor={colors.ink}
          />
        }
      >
        {/* Hero Carousel */}
        {heroItems.length > 0 && (
          <View>
            <HeroCarousel
              items={heroItems}
              onPlay={heroPlay}
              open={heroOpen}
              onLongPress={heroLongPress}
              active={active && !scrolled}
              onHeroFocus={() => {
                scrollRef.current?.scrollTo({ y: 0, animated: true });
              }}
            />
          </View>
        )}

        {preferences.source !== "remote" && <LibraryAttention />}

        {/* Continue watching row with full series or movie cards */}
        {continueItems.length > 0 && (
          <View>
            <CatalogRow
              key="continue-watching"
              title="Continue Watching"
              items={continueItems}
              open={open}
              onPlay={handlePlay}
              isContinueWatching={true}
              onChanged={data.retry}
            />
          </View>
        )}

        {/* The local Movies & Shows shelf, then the online categories. */}
        {shelfRows.map((row) => (
          <View key={row.key}>
            <CatalogRow
              key={row.key}
              title={row.title}
              items={row.items}
              open={heroOpen}
              onPlay={handlePlay}
              onlineFor={(item) => item.publicId.startsWith("remote:")}
              onLongPressItem={(item) => {
                if (item.publicId.startsWith("remote:")) {
                  remoteActions(item, {
                    play: () => online?.play(item),
                    onChanged: online?.refresh,
                  });
                  return;
                }
                titleActions(item, {
                  play: () => handlePlay(item),
                  onChanged: data.retry,
                });
              }}
            />
          </View>
        ))}
        {!!online?.error && shelfRows.length === 0 && !online.loading && (
          <View className="px-5 py-6">
            <Notice message={online.error} retry={online.refresh} />
          </View>
        )}

        {!data.loading && !data.error && !hasAnyRows && (
          <View className="min-h-[320px] justify-center gap-5 px-7 py-12">
            <Film size={36} color={colors.brandLight} />
            <Text className="font-archivo-bold text-[30px] leading-[36px] text-foreground">
              Your next watch starts here.
            </Text>
            <Text className="font-archivo-regular text-[16px] leading-[24px] text-muted">
              Connect a media folder to bring your movies and shows into Plexy.
            </Text>
            <NativeButton
              className="self-start rounded-full bg-accent"
              size="lg"
              onPress={() =>
                push({
                  pathname: "/settings/folders",
                })
              }
            >
              <NativeButton.Label className="text-accent-foreground">
                Add media folders
              </NativeButton.Label>
            </NativeButton>
          </View>
        )}
      </ScrollView>
    </View>
  );
}
