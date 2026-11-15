import { SwipePager } from "@/shared/ui/swipe-pager";
import { useAppDialog } from "@/shared/ui/app-dialog";
import { useRouter } from "expo-router";
import { Button as NativeButton } from "heroui-native/button";
import React, { useRef, useState } from "react";
import { Linking, Pressable, ScrollView, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import type { ProgressQueue } from "@/core/client/progress-queue";
import { useClient } from "@/core/client/client-provider";
import type { ItemCard, LocalCatalog } from "@/core/library/catalog-api";
import { useResource } from "@/core/resources/use-resource";
import { useOnline } from "@/shared/hooks/use-online";
import { useReducedMotion } from "@/shared/hooks/use-reduced-motion";
import { triggerHaptic } from "@/shared/lib/haptics";
import { cn } from "@/shared/lib/cn";
import { useColors, control } from "@/shared/theme";
import {
  ArrowLeft,
  Check,
  Film,
  Info,
  MoreHorizontal,
  Trash2,
  X,
} from "@/shared/ui/icons";
import { Button } from "@/shared/ui/button";
import { Loading } from "@/shared/ui/loading";
import { Notice } from "@/shared/ui/notice";
import { Hero } from "@/features/catalog/components/hero";
import { TitleBrowser } from "@/features/catalog/components/title-browser";
import { TopFade } from "@/features/catalog/components/top-fade";
import { playbackAction } from "@/features/catalog/lib/playback-action";
import { applyEpisodeAction } from "@/features/catalog/lib/title-actions";
import { useTitleActions } from "@/features/catalog/hooks/use-title-actions";
import { RecommendationsRow } from "@/features/catalog/components/recommendations-row";
import { useRecommendations } from "@/features/remote/lib/use-recommendations";
import { useRemoteNavigation } from "@/features/remote/lib/use-remote-navigation";
import { fetchDetail, fetchSeason } from "@/features/remote/lib/tmdb";
import {
  mergeEpisodes,
  mergeSeasons,
  type HybridEpisode,
} from "@/features/remote/lib/hybrid-episodes";
import { CastRow } from "./components/cast-row";
import { HybridEpisodeCard } from "./components/hybrid-episode-card";
import { SeasonTabs } from "./components/season-tabs";
import { TitleActionBar } from "./components/title-action-bar";
import { TitleMenuAction } from "./components/title-menu-action";
import { TitleTabs } from "./components/title-tabs";

export function TitleScreen({
  id,
  back,
  play,
}: {
  id: string | number;
  back: () => void;
  play: (fileId: number) => void;
}) {
  const showDialog = useAppDialog();
  const colors = useColors();
  const titleActions = useTitleActions();
  const { api, progress, preferences } = useClient();
  const remoteNavigation = useRemoteNavigation();
  const insets = useSafeAreaInsets();
  const data = useResource((signal) => api.detail(id, signal), [api, id]);
  const { push } = useRouter();
  const online = useOnline();
  const detailScroll = useRef<ScrollView>(null);
  const reducedMotion = useReducedMotion();
  const [personName, setPersonName] = useState<string | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [selectingEpisodes, setSelectingEpisodes] = useState(false);
  const [selectedEpisodes, setSelectedEpisodes] = useState<Set<number>>(
    () => new Set(),
  );
  const [season, setSeason] = useState<number | null>(null);
  const [detailTab, setDetailTab] = useState<"episodes" | "details">(
    "episodes",
  );
  const [actionError, setActionError] = useState("");
  const [overrideWatched, setOverrideWatched] = useState<boolean | null>(null);
  const [episodesWatchedOverride, setEpisodesWatchedOverride] = useState<
    Record<number, boolean>
  >({});
  const detail = data.value;
  const item = detail?.item;
  const onlineEnabled = preferences.source === "remote";
  const tmdbId = item?.tmdbId ?? null;
  const remoteMediaType: "movie" | "tv" | null = detail
    ? detail.tmdbType === "tv" || item?.kind === "series"
      ? "tv"
      : "movie"
    : null;
  const remoteDetail = useResource(
    (signal) =>
      onlineEnabled && remoteMediaType === "tv" && tmdbId
        ? fetchDetail("tv", tmdbId, signal)
        : Promise.resolve(null),
    [onlineEnabled, remoteMediaType, tmdbId],
    "hybrid-detail",
  );
  const seasonOptions = React.useMemo(
    () =>
      mergeSeasons(
        detail?.seasons ?? [],
        onlineEnabled ? (remoteDetail.value?.seasons ?? []) : [],
      ),
    [detail?.seasons, onlineEnabled, remoteDetail.value],
  );
  const [previousSeasons, setPreviousSeasons] = useState(seasonOptions);
  if (previousSeasons !== seasonOptions) {
    setPreviousSeasons(seasonOptions);
    if (season != null && seasonOptions.length && !seasonOptions.some(entry => entry.number === season)) setSeason(null);
  }
  const selectedSeason =
    season ??
    detail?.seasons?.[0]?.number ??
    seasonOptions[0]?.number ??
    null;
  const remoteSeason = useResource(
    (signal) =>
      onlineEnabled &&
      remoteMediaType === "tv" &&
      tmdbId &&
      selectedSeason != null
        ? fetchSeason(tmdbId, selectedSeason, signal)
        : Promise.resolve([]),
    [onlineEnabled, remoteMediaType, selectedSeason, tmdbId],
    "hybrid-season",
  );
  const localSeasonEpisodes = React.useMemo(
    () =>
      detail?.episodes?.filter(
        (episode) =>
          !detail.seasons?.length || episode.seasonNumber === selectedSeason,
      ) ?? [],
    [detail, selectedSeason],
  );
  const mergedSeasonEpisodes = React.useMemo(
    () =>
      mergeEpisodes({
        local: localSeasonEpisodes,
        remote: onlineEnabled ? (remoteSeason.value ?? []) : [],
        season: selectedSeason ?? 1,
        fallbackArtwork: item?.backdrop || item?.poster || null,
      }),
    [
      item?.backdrop,
      item?.poster,
      localSeasonEpisodes,
      onlineEnabled,
      remoteSeason.value,
      selectedSeason,
    ],
  );
  const recommendations = useRecommendations({
    api,
    mediaType: remoteMediaType,
    tmdbId,
    online: onlineEnabled,
  });
  const episodeWatched = (episode: ItemCard) =>
    episodesWatchedOverride[episode.id] ??
    (progress.latest(episode.id)?.played || Boolean(episode.watch?.played));
  // Walk the hybrid season in episode order: the first unplayed downloaded
  // episode wins, but a missing download becomes an online play.
  const nextHybridEpisode =
    mergedSeasonEpisodes.find((episode) =>
      episode.local
        ? Boolean(episode.local.fileId) && !episodeWatched(episode.local)
        : Boolean(episode.remote),
    ) ??
    mergedSeasonEpisodes.find(
      (episode) => Boolean(episode.local?.fileId) || Boolean(episode.remote),
    );
  const hybridPlay = nextHybridEpisode?.local
    ? { kind: "local" as const, episode: nextHybridEpisode.local }
    : nextHybridEpisode?.remote
      ? { kind: "remote" as const, remote: nextHybridEpisode.remote }
      : null;
  const titlesByPerson = api.titlesByPerson();
  const personTitles = (name: string) => titlesByPerson.get(name) ?? [];
  const isSeriesWatched = overrideWatched ?? Boolean(item?.watch?.played);
  async function watched() {
    if (!item) return;
    const nextPlayed = !isSeriesWatched;
    setOverrideWatched(nextPlayed);
    const newOverrides: Record<number, boolean> = {};
    if (detail?.episodes) {
      detail.episodes.forEach((ep: ItemCard) => {
        newOverrides[ep.id] = nextPlayed;
      });
      setEpisodesWatchedOverride((prev) => ({ ...prev, ...newOverrides }));
    }
    try {
      await progress.flush(api);
      if (nextPlayed) {
        if (detail?.episodes) {
          for (const ep of detail.episodes) {
            const dur = ep.runtime ? ep.runtime * 60 : 3600;
            await progress.record({
              itemId: ep.id,
              position: dur,
              duration: dur,
              played: true,
              updatedAt: Date.now(),
            });
          }
        }
        await progress.record({
          itemId: item.id,
          position: 100,
          duration: 100,
          played: true,
          updatedAt: Date.now(),
        });
      } else {
        if (detail?.episodes) {
          for (const ep of detail.episodes) {
            await progress.forget(ep.id);
            await api.watched(ep.id, false).catch(() => {});
          }
        }
        await progress.forget(item.id);
        await api.watched(item.id, false).catch(() => {});
      }
      if (nextPlayed) {
        await api.watched(item.id, true);
      }
      data.retry();
    } catch (e) {
      {
        setActionError(
          e instanceof Error ? e.message : "Could not update watched state.",
        );
      }
    }
  }
  async function toggleEpisodeWatched(ep: ItemCard) {
    const currentEpPlayed =
      episodesWatchedOverride[ep.id] ??
      (progress.latest(ep.id)?.played || Boolean(ep.watch?.played));
    const nextPlayed = !currentEpPlayed;
    setEpisodesWatchedOverride((prev) => ({ ...prev, [ep.id]: nextPlayed }));
    try {
      if (nextPlayed) {
        const dur = ep.runtime ? ep.runtime * 60 : 3600;
        await progress.record({
          itemId: ep.id,
          position: dur,
          duration: dur,
          played: true,
          updatedAt: Date.now(),
        });
        await api.watched(ep.id, true);
      } else {
        await progress.forget(ep.id);
        await api.watched(ep.id, false);
      }
      data.retry();
    } catch {}
  }
  function startEpisodeSelection(ep?: any) {
    triggerHaptic("selection");
    setSelectingEpisodes(true);
    setSelectedEpisodes(ep ? new Set([ep.id]) : new Set());
  }
  function endEpisodeSelection() {
    setSelectingEpisodes(false);
    setSelectedEpisodes(new Set());
  }
  function toggleEpisodeSelected(ep: ItemCard) {
    triggerHaptic("selection");
    setSelectedEpisodes((previous) => {
      const next = new Set(previous);
      if (next.has(ep.id)) next.delete(ep.id);
      else next.add(ep.id);
      return next;
    });
  }
  const detailAction = playbackAction(item ?? {}, detail?.episodes ?? []);
  function getFirstPlayableFileId() {
    return detail?.file?.fileId ?? detailAction.fileId;
  }
  const selectedCount = selectedEpisodes.size;
  const allSeasonSelected =
    localSeasonEpisodes.length > 0 &&
    localSeasonEpisodes.every((episode) => selectedEpisodes.has(episode.id));
  function toggleSelectSeason() {
    triggerHaptic("selection");
    setSelectedEpisodes((previous) => {
      const next = new Set(previous);
      if (allSeasonSelected) {
        for (const episode of localSeasonEpisodes) next.delete(episode.id);
      } else {
        for (const episode of localSeasonEpisodes) next.add(episode.id);
      }
      return next;
    });
  }
  async function finishSelectedEpisodes() {
    const ids = [...selectedEpisodes];
    if (!ids.length) return;
    setEpisodesWatchedOverride((previous) => {
      const next = { ...previous };
      for (const id of ids) next[id] = true;
      return next;
    });
    try {
      await applyEpisodeAction(api, progress, ids, "finished");
      data.retry();
      endEpisodeSelection();
    } catch (e) {
      setActionError(
        e instanceof Error ? e.message : "Could not update episode progress.",
      );
    }
  }
  async function deleteEpisodes(ids: number[]) {
    if (!ids.length) return;
    const remaining = (detail?.episodes?.length ?? 0) - ids.length;
    try {
      await applyEpisodeAction(api, progress, ids, "delete");
      endEpisodeSelection();
      if (remaining <= 0) back();
      else data.retry();
    } catch (e) {
      setActionError(
        e instanceof Error ? e.message : "Could not delete episode files.",
      );
      data.retry();
    }
  }
  function deleteSelectedEpisodes() {
    const ids = [...selectedEpisodes];
    if (!ids.length) return;
    showDialog(
      ids.length === 1 ? "Delete episode?" : `Delete ${ids.length} episodes?`,
      ids.length === 1
        ? "This permanently deletes this episode's video file from your device."
        : "This permanently deletes the selected video files from your device.",
      [
        {
          text: ids.length === 1 ? "Delete" : "Delete episodes",
          style: "destructive",
          onPress: () => void deleteEpisodes(ids),
        },
      ],
    );
  }
  function openEpisodeActions(ep: ItemCard, watched: boolean) {
    const clearOverride = () =>
      setEpisodesWatchedOverride((previous) => {
        if (!(ep.id in previous)) return previous;
        const next = { ...previous };
        delete next[ep.id];
        return next;
      });
    titleActions(
      {
        ...ep,
        watch: { position: 0, duration: null, percent: 0, ...ep.watch, played: watched },
      },
      {
        onSelect: () => startEpisodeSelection(ep),
        onChanged: () => {
          clearOverride();
          data.retry();
        },
        onDeleted: () => {
          clearOverride();
          if ((detail?.episodes?.length ?? 0) <= 1) back();
          else data.retry();
        },
      },
    );
  }
  function playOnlineEpisode(seasonNumber: number, episodeNumber: number) {
    if (!tmdbId || remoteMediaType !== "tv") {
      setActionError(
        "This title is not matched to TMDB, so the online source is unavailable.",
      );
      return;
    }
    const titleName = remoteDetail.value?.title || item?.name || "";
    push({
      pathname: "/player/remote",
      params: {
        mediaType: "tv",
        tmdbId: String(tmdbId),
        season: String(seasonNumber),
        episode: String(episodeNumber),
        title: titleName,
        display: `${titleName} · S${seasonNumber}E${episodeNumber}`,
      },
    });
  }
  const hasEpisodes = Boolean(
    item?.kind === "series" || detail?.episodes?.length,
  );
  const hybridLabel = hybridPlay?.kind === "remote" ? "Play" : detailAction.label;
  const hybridDisabled = hasEpisodes ? !hybridPlay : !getFirstPlayableFileId();
  function playHybrid() {
    if (hybridPlay?.kind === "local") {
      if (hybridPlay.episode.fileId != null)
        play(hybridPlay.episode.fileId);
      return;
    }
    if (hybridPlay?.kind === "remote") {
      playOnlineEpisode(hybridPlay.remote.season, hybridPlay.remote.number);
      return;
    }
    if (hasEpisodes) return;
    const fileId = getFirstPlayableFileId();
    if (fileId) play(fileId);
  }  return (
    <View className="flex-1 bg-background">
      <TopFade />
      <Pressable
        onPress={back}
        className="absolute left-4 z-[99] h-10 w-10 items-center justify-center rounded-full border border-foreground/[0.15] bg-overlay/90 active:opacity-60"
        style={{ top: insets.top + 14 }}
        hitSlop={14}
      >
        <ArrowLeft size={22} color={colors.ink} strokeWidth={2} />
      </Pressable>

      <ScrollView
        ref={detailScroll}
        contentInsetAdjustmentBehavior="never"
        contentContainerStyle={[
          { paddingBottom: 48 },
          { paddingBottom: insets.bottom + 110 },
        ]}
        showsVerticalScrollIndicator={false}
      >
        {data.loading && !detail ? (
          <View className="p-8">
            <Loading />
          </View>
        ) : data.error && !detail ? (
          <View className="p-6">
            <Notice message={data.error} retry={data.retry} />
          </View>
        ) : (
          detail &&
          item && (
            <>
              <Hero
                showOverview={false}
                hideActions
                item={item}
                logo={
                  "logo" in detail && (detail as any).logo
                    ? (detail as any).logo
                    : item.logo
                }
                actionLabel={hybridLabel}
                disabled={hybridDisabled}
                onOpen={playHybrid}
              />

              <View className="gap-[18px] px-5 pt-5">
                {!!actionError && <Notice message={actionError} />}
                {hasEpisodes ? (
                  <>
                    <TitleTabs
                      className="mb-1.5 mt-1"
                      value={detailTab}
                      tabs={[
                        { key: "episodes", label: "Episodes" },
                        { key: "details", label: "Cast & Details" },
                      ]}
                      onChange={(key) => {
                        if (key === "details") {
                          if (selectingEpisodes) endEpisodeSelection();
                          setDetailTab("details");
                          return;
                        }
                        setDetailTab("episodes");
                      }}
                    />

                    {detailTab === "episodes" && (
                      <View className="flex-row items-center justify-between">
                        <Text className="font-archivo-medium text-[12px] text-muted">
                          {mergedSeasonEpisodes.length}{" "}
                          {mergedSeasonEpisodes.length === 1
                            ? "episode"
                            : "episodes"}
                        </Text>
                        {!selectingEpisodes && localSeasonEpisodes.length > 0 && (
                          <Pressable
                            accessibilityRole="button"
                            accessibilityLabel="Select episodes"
                            onPress={() => startEpisodeSelection()}
                            hitSlop={8}
                            className="flex-row items-center gap-1.5 rounded-full bg-surface px-3 py-2 active:opacity-70"
                          >
                            <Check
                              size={13}
                              color={colors.brand}
                              strokeWidth={2.4}
                            />
                            <Text className="font-archivo-bold text-[12px] text-accent">
                              Select
                            </Text>
                          </Pressable>
                        )}
                      </View>
                    )}

                    {detailTab === "episodes" && seasonOptions.length > 0 && (
                      <SeasonTabs
                        seasons={seasonOptions}
                        value={selectedSeason ?? null}
                        onChange={(number) => setSeason(number)}
                      />
                    )}

                    <SwipePager
                      autoHeight
                      pageKeys={[
                        ...Array.from(
                          { length: Math.max(1, seasonOptions.length) },
                          (_, index) =>
                            `season-${seasonOptions[index]?.number ?? index}`,
                        ),
                        "details",
                      ]}
                      index={
                        detailTab === "details"
                          ? Math.max(1, seasonOptions.length)
                          : Math.max(
                              0,
                              seasonOptions.findIndex(
                                (entry) => entry.number === selectedSeason,
                              ),
                            )
                      }
                      onChange={(index) => {
                        triggerHaptic("selection");
                        const pageCount = Math.max(1, seasonOptions.length);
                        const nextTab =
                          index < pageCount ? "episodes" : "details";
                        if (nextTab === "details" && selectingEpisodes)
                          endEpisodeSelection();
                        setDetailTab(nextTab);
                        const nextSeason = seasonOptions[index]?.number;
                        if (nextSeason != null) setSeason(nextSeason);
                      }}
                      renderPage={(page) => {
                        const pageCount = Math.max(1, seasonOptions.length);
                        const pageSeason =
                          seasonOptions[page]?.number ?? selectedSeason ?? 1;
                        const pageLocal =
                          detail.episodes?.filter(
                            (episode) =>
                              !detail.seasons?.length ||
                              episode.seasonNumber === pageSeason,
                          ) ?? [];
                        const pageRemote =
                          pageSeason === selectedSeason && onlineEnabled
                            ? (remoteSeason.value ?? [])
                            : [];
                        const pageEpisodes = mergeEpisodes({
                          local: pageLocal,
                          remote: pageRemote,
                          season: pageSeason,
                          fallbackArtwork:
                            item.backdrop || item.poster || null,
                        });
                        return (
                          <View className="gap-[18px]">
                            {page < pageCount ? (
                              <>
                                {remoteSeason.error &&
                                  pageSeason === selectedSeason && (
                                    <Notice
                                      message={remoteSeason.error}
                                      retry={remoteSeason.retry}
                                    />
                                  )}
                                {remoteSeason.loading &&
                                pageSeason === selectedSeason &&
                                pageEpisodes.length === 0 ? (
                                  <Loading />
                                ) : (
                                  <SeasonEpisodes
                                    episodes={pageEpisodes}
                                    api={api}
                                    play={play}
                                    progress={progress}
                                    overrides={episodesWatchedOverride}
                                    onToggleWatched={toggleEpisodeWatched}
                                    selecting={selectingEpisodes}
                                    selectedIds={selectedEpisodes}
                                    onToggleSelected={toggleEpisodeSelected}
                                    onLongPressEpisode={openEpisodeActions}
                                    onPlayRemote={playOnlineEpisode}
                                  />
                                )}
                              </>
                            ) : (
                              <>
                                <Text className="font-archivo-regular text-[14px] leading-[22px] text-foreground/80">
                                  {detail.metadata?.overview ||
                                    item.overview ||
                                    "No synopsis is available."}
                                </Text>
                                {detail.file &&
                                  (detail.file.height ||
                                    detail.file.videoCodec ||
                                    detail.file.hdr) && (
                                    <Text className="self-start rounded-lg bg-accent/20 px-3 py-2 font-archivo-medium text-[12px] tracking-[0.3px] text-accent">
                                      {[
                                        detail.file.height
                                          ? `${detail.file.height >= 2160 ? "4K" : detail.file.height >= 720 ? "HD" : "SD"} · ${detail.file.height}p`
                                          : null,
                                        (
                                          detail.file as any
                                        ).videoCodec?.toUpperCase(),
                                        (detail.file as any).hdr,
                                      ]
                                        .filter(Boolean)
                                        .join(" · ")}
                                    </Text>
                                  )}
                                <CastRow
                                  people={detail.cast ?? []}
                                  api={api}
                                  canOpen={(name) =>
                                    personTitles(name).length > 0
                                  }
                                  onSelect={setPersonName}
                                />
                              </>
                            )}
                          </View>
                        );
                      }}
                    />
                  </>
                ) : (
                  <>
                    <Text className="font-archivo-regular text-[14px] leading-[22px] text-foreground/80">
                      {detail.metadata?.overview ||
                        item.overview ||
                        "No synopsis is available."}
                    </Text>
                    {detail.file &&
                      (detail.file.height ||
                        detail.file.videoCodec ||
                        detail.file.hdr) && (
                        <Text className="self-start rounded-lg bg-accent/20 px-3 py-2 font-archivo-medium text-[12px] tracking-[0.3px] text-accent">
                          {[
                            detail.file.height
                              ? `${detail.file.height >= 2160 ? "4K" : detail.file.height >= 720 ? "HD" : "SD"} · ${detail.file.height}p`
                              : null,
                            (detail.file as any).videoCodec?.toUpperCase(),
                            (detail.file as any).hdr,
                          ]
                            .filter(Boolean)
                            .join(" · ")}
                        </Text>
                      )}
                    <CastRow
                      people={detail.cast ?? []}
                      api={api}
                      canOpen={(name) => personTitles(name).length > 0}
                      onSelect={setPersonName}
                    />
                  </>
                )}
              </View>
            </>
          )
        )}

        {item && (
          <View className="pt-5">
            <RecommendationsRow
              items={recommendations.items}
              api={api}
              onSelect={(recommended) => {
                const remoteTitle = recommendations.remoteByPublicId.get(
                  recommended.publicId,
                );
                if (remoteTitle) {
                  remoteNavigation.open(remoteTitle);
                  return;
                }
                push({
                  pathname: "/item/[id]",
                  params: { id: recommended.publicId },
                });
              }}
            />
          </View>
        )}
      </ScrollView>
      <TitleBrowser
        title={personName}
        items={personName ? personTitles(personName) : []}
        close={() => setPersonName(null)}
        open={(id) =>
          push({ pathname: "/item/[id]", params: { id: String(id) } })
        }
        play={play}
        onChanged={() => data.retry()}
      />
      {item && detail && (
        <>
          <Pressable
            accessibilityLabel="More title actions"
            onPress={() => setMenuOpen(!menuOpen)}
            className="absolute right-5 z-[99] h-10 w-10 items-center justify-center rounded-full border border-foreground/[0.15] bg-overlay/90"
            style={{ top: insets.top + 14 }}
          >
            <MoreHorizontal size={22} color={colors.ink} />
          </Pressable>
          {menuOpen && (
            <Pressable
              accessibilityLabel="Close title actions"
              onPress={() => setMenuOpen(false)}
              className="absolute inset-0 z-[100] bg-black/30"
            />
          )}
          {menuOpen && (
            <View
              className="absolute right-5 z-[101] w-[236px] gap-2 rounded-2xl border border-border bg-surface p-3"
              style={{ top: insets.top + 66 }}
            >
              <TitleMenuAction
                icon={Info}
                label="Details"
                onPress={() => {
                  if (selectingEpisodes) endEpisodeSelection();
                  setDetailTab("details");
                  setMenuOpen(false);
                  detailScroll.current?.scrollTo({
                    y: 540,
                    animated: !reducedMotion,
                  });
                }}
              />
              <TitleMenuAction
                icon={Check}
                label={isSeriesWatched ? "Mark unwatched" : "Mark finished"}
                onPress={() => {
                  void watched();
                  setMenuOpen(false);
                }}
              />
              <TitleMenuAction
                destructive
                icon={Trash2}
                label="Delete from device"
                onPress={() =>
                  showDialog(
                    "Delete title?",
                    "This permanently deletes the video files from your device.",
                    [
                      {
                        text: "Delete",
                        style: "destructive",
                        onPress: () => {
                          void api
                            .deleteItem(item.id)
                            .then(back)
                            .catch((e) => setActionError(String(e)));
                        },
                      },
                    ],
                  )
                }
              />
            </View>
          )}
          {selectingEpisodes ? (
            <View
              className="absolute bottom-0 left-0 right-0 gap-3 border-t border-t-border bg-background px-5 pt-3"
              style={{ paddingBottom: Math.max(insets.bottom, 14) }}
            >
              <View className="flex-row items-center justify-between gap-2">
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="Exit episode selection"
                  onPress={endEpisodeSelection}
                  hitSlop={10}
                  className="h-9 w-9 items-center justify-center rounded-full bg-surface active:opacity-70"
                >
                  <X size={18} color={colors.ink} />
                </Pressable>
                <Text className="flex-1 text-center font-archivo-bold text-[15px] text-foreground">
                  {selectedCount === 0
                    ? "Select episodes"
                    : `${selectedCount} selected`}
                </Text>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={
                    allSeasonSelected
                      ? "Clear season selection"
                      : "Select all episodes in this season"
                  }
                  onPress={toggleSelectSeason}
                  hitSlop={8}
                  className="min-h-[36px] justify-center rounded-full bg-surface px-3 active:opacity-70"
                >
                  <Text className="font-archivo-bold text-[12px] text-accent">
                    {allSeasonSelected ? "Clear" : "Select all"}
                  </Text>
                </Pressable>
              </View>
              <View className="flex-row gap-3">
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="Mark selected episodes finished"
                  accessibilityState={{ disabled: selectedCount === 0 }}
                  disabled={selectedCount === 0}
                  onPress={() => {
                    triggerHaptic("light");
                    void finishSelectedEpisodes();
                  }}
                  className={cn(
                    "min-h-[50px] flex-1 flex-row items-center justify-center gap-2 rounded-full bg-accent px-4",
                    selectedCount === 0 && "opacity-40",
                  )}
                >
                  <Check size={18} color="#fff" strokeWidth={2.6} />
                  <Text className="font-archivo-bold text-[15px] text-white">
                    Mark as finished
                  </Text>
                </Pressable>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="Delete selected episodes"
                  accessibilityState={{ disabled: selectedCount === 0 }}
                  disabled={selectedCount === 0}
                  onPress={() => {
                    triggerHaptic("medium");
                    deleteSelectedEpisodes();
                  }}
                  className={cn(
                    "min-h-[50px] flex-1 flex-row items-center justify-center gap-2 rounded-full bg-danger/15 px-4",
                    selectedCount === 0 && "opacity-40",
                  )}
                >
                  <Trash2 size={18} color={colors.danger} strokeWidth={2.2} />
                  <Text className="font-archivo-bold text-[15px] text-danger">
                    Delete
                  </Text>
                </Pressable>
              </View>
            </View>
          ) : (
            <TitleActionBar
              label={hybridLabel}
              accessibilityLabel={
                hybridPlay?.kind === "remote"
                  ? "Play online"
                  : detailAction.accessibilityLabel
              }
              disabled={hybridDisabled}
              onPress={playHybrid}
              secondary={
                detail.trailer?.provider?.toLowerCase() === "youtube" ? (
                  <NativeButton
                    variant="secondary"
                    size="lg"
                    isIconOnly
                    accessibilityLabel="Watch trailer"
                    className="rounded-full bg-surface"
                    style={{ width: control.height, height: control.height }}
                    isDisabled={!online}
                    onPress={() => {
                      void Linking.openURL(
                        `https://www.youtube.com/watch?v=${encodeURIComponent(detail.trailer!.key)}`,
                      ).catch((e) => setActionError(String(e)));
                    }}
                  >
                    <Film size={22} color={colors.ink} />
                  </NativeButton>
                ) : undefined
              }
            />
          )}
        </>
      )}
    </View>
  );
}

const EPISODE_PAGE_SIZE = 30;

/**
 * A season can hold hundreds of episodes. Render a bounded page instead of
 * mounting every card inside the title screen's ScrollView.
 */
function SeasonEpisodes({
  episodes,
  api,
  play,
  progress,
  overrides,
  onToggleWatched,
  selecting,
  selectedIds,
  onToggleSelected,
  onLongPressEpisode,
  onPlayRemote,
}: {
  episodes: HybridEpisode[];
  api: LocalCatalog;
  play: (fileId: number) => void;
  progress: ProgressQueue;
  overrides: Record<number, boolean>;
  onToggleWatched: (ep: ItemCard) => void;
  selecting: boolean;
  selectedIds: Set<number>;
  onToggleSelected: (ep: ItemCard) => void;
  onLongPressEpisode: (ep: ItemCard, watched: boolean) => void;
  onPlayRemote: (season: number, episode: number) => void;
}) {
  const [limit, setLimit] = useState(EPISODE_PAGE_SIZE);
  const visible = episodes.slice(0, limit);
  return (
    <View className="gap-[18px] pt-3">
      {visible.map((episode) => {
        const local = episode.local;
        const watched = local
          ? (overrides[local.id] ??
            (progress.latest(local.id)?.played ||
              Boolean(local.watch?.played)))
          : false;
        const progressValue =
          local && !watched && local.watch?.position && local.watch?.duration
            ? Math.min(1, local.watch.position / local.watch.duration)
            : null;
        const selectable = Boolean(local);
        return (
          <HybridEpisodeCard
            key={episode.key}
            episode={episode}
            api={api}
            watched={watched}
            progress={progressValue}
            selecting={selecting && selectable}
            selected={local ? selectedIds.has(local.id) : false}
            disabled={
              selecting ? !selectable : !local?.fileId && !episode.remote
            }
            onPress={() => {
              if (selecting) {
                if (local) onToggleSelected(local);
                return;
              }
              if (local?.fileId) play(local.fileId);
              else if (episode.remote)
                onPlayRemote(episode.remote.season, episode.remote.number);
            }}
            onLongPress={() => {
              if (!local) return;
              if (selecting) onToggleSelected(local);
              else onLongPressEpisode(local, watched);
            }}
            onToggleWatched={
              local && !selecting
                ? () => onToggleWatched(local)
                : undefined
            }
          />
        );
      })}
      {episodes.length > limit && (
        <Button
          label={`Show ${Math.min(EPISODE_PAGE_SIZE, episodes.length - limit)} more episodes`}
          onPress={() => setLimit((current) => current + EPISODE_PAGE_SIZE)}
        />
      )}
    </View>
  );
}
