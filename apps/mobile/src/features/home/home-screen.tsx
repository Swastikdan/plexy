import { useRouter } from "expo-router";
import { Button as NativeButton } from "heroui-native/button";
import React, { useRef } from "react";
import { RefreshControl, ScrollView, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useClient } from "@/core/client/client-provider";
import type { ItemCard } from "@/core/library/catalog-api";
import { useResource } from "@/core/resources/use-resource";
import { colors } from "@/shared/theme";
import { Film } from "@/shared/ui/icons";
import { Loading } from "@/shared/ui/loading";
import { Notice } from "@/shared/ui/notice";
import { PageHeader } from "@/shared/ui/page-header";
import { CatalogRow } from "@/features/catalog/components/catalog-row";
import { LibraryAttention } from "@/features/catalog/components/library-attention";
import { TopFade } from "@/features/catalog/components/top-fade";
import { OpenTitle } from "@/features/catalog/types";
import { HeroCarousel } from "./components/hero-carousel";

export function HomeScreen({
  open,
  play,
  focusId,
  focused,
  active,
}: {
  open: OpenTitle;
  play?: (fileId: number) => void;
  focusId?: number | null;
  focused: (id: number) => void;
  active: boolean;
}) {
  const homeRouter = useRouter();
  const { api, progress } = useClient();
  const insets = useSafeAreaInsets();
  const data = useResource((signal) => api.home(signal), [api]);
  const previousActive = useRef(active);
  React.useEffect(() => {
    if (active && !previousActive.current)
      void progress
        .flush(api)
        .catch(() => {})
        .finally(data.retry);
    previousActive.current = active;
  }, [active, api, progress]);
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
  if (data.loading) return <Loading />;
  if (data.error) return <Notice message={data.error} retry={data.retry} />;
  return (
    <View className="flex-1 bg-background">
      <TopFade />
      <PageHeader
        logo
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
          !carouselItems.length && { paddingTop: insets.top + 90 },
        ]}
        showsVerticalScrollIndicator={false}
        removeClippedSubviews={false}
        refreshControl={
          <RefreshControl
            refreshing={data.loading}
            onRefresh={data.retry}
            tintColor="#ffffff"
          />
        }
      >
        {/* Hero Carousel */}
        {carouselItems.length > 0 && (
          <View>
            <HeroCarousel
              items={carouselItems}
              onPlay={handlePlay}
              open={open}
              onHeroFocus={() => {
                if (focusId != null) focused(null as any);
                scrollRef.current?.scrollTo({ y: 0, animated: true });
              }}
            />
          </View>
        )}

        <LibraryAttention />

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
              focused={focused}
            />
          </View>
        )}

        {/* Rest of the rows (full movies and series only) */}
        {otherRows.map((row) => (
          <View key={row.key}>
            <CatalogRow
              key={row.key}
              title={row.title}
              items={row.items}
              open={open}
              focused={focused}
            />
          </View>
        ))}

        {!data.loading && !data.error && !data.value?.rows.length && (
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
                homeRouter.push({
                  pathname: "/settings/folders",
                })
              }
            >
              <NativeButton.Label className="text-white">
                Add media folders
              </NativeButton.Label>
            </NativeButton>
          </View>
        )}
      </ScrollView>
    </View>
  );
}
