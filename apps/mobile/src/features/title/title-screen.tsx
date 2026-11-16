import { useAppDialog } from "@/shared/ui/app-dialog";
import { useIsFocused, useRouter } from "expo-router";
import { Button as NativeButton } from "heroui-native/button";
import React, { useMemo, useRef, useState } from "react";
import {
  Linking,
  Pressable,
  ScrollView,
  Text,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { SwipePager } from "@/shared/ui/swipe-pager";
import type { ProgressQueue } from "@/core/client/progress-queue";
import { useClient } from "@/core/client/client-provider";
import type { ItemCard, LocalCatalog, TitleDetail } from "@/core/library/catalog-api";
import { useResource } from "@/core/resources/use-resource";
import { useOnline } from "@/shared/hooks/use-online";
import { triggerHaptic } from "@/shared/lib/haptics";
import { cn } from "@/shared/lib/cn";
import { useColors, control } from "@/shared/theme";
import {
  ArrowLeft,
  Check,
  Film,
  Info,
  MoreHorizontal,
  Play,
  Plus,
  Trash2,
  X,
} from "@/shared/ui/icons";
import { Button } from "@/shared/ui/button";
import { Notice } from "@/shared/ui/notice";
import {
  CastRowSkeleton,
  EpisodeListSkeleton,
  SeasonPickerSkeleton,
  TitleDetailSkeleton,
} from "@/shared/ui/skeleton";
import { TitleBrowser } from "@/features/catalog/components/title-browser";
import { TopFade } from "@/features/catalog/components/top-fade";
import { playbackAction } from "@/features/catalog/lib/playback-action";
import { applyEpisodeAction } from "@/features/catalog/lib/title-actions";
import { useTitleActions } from "@/features/catalog/hooks/use-title-actions";
import {
  isRemotePlayed,
  markRemoteEpisodePlayed,
  markRemotePlayed,
  getRemoteTitleProgress,
  remoteEpisodeWatch,
  useRemoteProgress,
} from "@/features/remote/lib/remote-progress";
import { useRemote } from "@/features/remote/remote-provider";
import { useRemoteTitleActions } from "@/features/remote/hooks/use-remote-title-actions";
import { useRecommendations } from "@/features/remote/lib/use-recommendations";
import { prefetchImages } from "@/features/remote/lib/prefetch";
import { useRemoteNavigation } from "@/features/remote/lib/use-remote-navigation";
import { lockPlayerLandscape } from "@/features/player/hooks/use-player-orientation";
import { fetchSeason, type RemoteEpisode, type RemoteMediaType } from "@/features/remote/lib/tmdb";
import {
  mergeEpisodes,
  mergeSeasons,
  type HybridEpisode,
} from "@/features/remote/lib/hybrid-episodes";
import { CastRow } from "./components/cast-row";
import { HybridEpisodeCard } from "./components/hybrid-episode-card";
import { MoreLikeThis } from "./components/more-like-this";
import { SeasonPicker } from "./components/season-picker";
import { TitleActionBar } from "./components/title-action-bar";
import { TitleFactLine, TitleRating } from "./components/title-facts";
import { TitleHero } from "./components/title-hero";
import { TitleMenuAction } from "./components/title-menu-action";
import {
  TitleQuickActions,
  type QuickAction,
} from "./components/title-quick-actions";
import { TitleTabs } from "./components/title-tabs";
import { useMediaTitle, type MediaTitleInput } from "./lib/use-media-title";

type DetailTab = "episodes" | "more" | "details";

/** Floating back control shared by the loading, error and loaded title views. */
function TitleBackButton({ onPress }: { onPress: () => void }) {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel="Go back"
      className="absolute left-4 z-[99] h-10 w-10 items-center justify-center rounded-full border border-foreground/[0.15] bg-overlay/90 active:opacity-60"
      style={{ top: insets.top + 14 }}
      hitSlop={14}
    >
      <ArrowLeft size={22} color={colors.ink} strokeWidth={2} />
    </Pressable>
  );
}

export function TitleScreen({
  input,
  autoPlay = false,
  autoSeason = null,
  autoEpisode = null,
  back,
  play,
}: {
  input: MediaTitleInput;
  autoPlay?: boolean;
  autoSeason?: number | null;
  autoEpisode?: number | null;
  back: () => void;
  play: (fileId: number) => void;
}) {
  const showDialog = useAppDialog();
  const colors = useColors();
  const titleActions = useTitleActions();
  const remoteActions = useRemoteTitleActions();
  const { api, progress, preferences } = useClient();
  const { save, isSaved } = useRemote();
  const remoteNavigation = useRemoteNavigation();
  const insets = useSafeAreaInsets();
  const onlineEnabled =
    preferences.source === "remote" || input.source === "remote";
  const media = useMediaTitle(input, api, onlineEnabled);
  const detail = media.detail;
  const item = detail?.item ?? null;
  const tmdbId = media.tmdbId;
  const remoteMediaType = media.mediaType;
  const remoteDetail = media.remoteDetail;
  const focused = useIsFocused();
  const remoteProgress = useRemoteProgress(focused);
  const { push } = useRouter();
  const online = useOnline();
  const [personName, setPersonName] = useState<string | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [selectingEpisodes, setSelectingEpisodes] = useState(false);
  const [selectedEpisodes, setSelectedEpisodes] = useState<Set<number>>(
    () => new Set(),
  );
  const [season, setSeason] = useState<number | null>(null);
  const [detailTab, setDetailTab] = useState<DetailTab>("episodes");
  const [descriptionExpanded, setDescriptionExpanded] = useState(false);
  const [descriptionOverflows, setDescriptionOverflows] = useState(false);
  const [actionError, setActionError] = useState("");
  const [savedBusy, setSavedBusy] = useState(false);
  const [overrideWatched, setOverrideWatched] = useState<boolean | null>(null);
  const [episodesWatchedOverride, setEpisodesWatchedOverride] = useState<
    Record<number, boolean>
  >({});

  const seasonOptions = useMemo(
    () =>
      mergeSeasons(
        detail?.seasons ?? [],
        onlineEnabled ? (remoteDetail?.seasons ?? []) : [],
      ),
    [detail?.seasons, onlineEnabled, remoteDetail],
  );
  const [previousSeasons, setPreviousSeasons] = useState(seasonOptions);
  if (previousSeasons !== seasonOptions) {
    setPreviousSeasons(seasonOptions);
    if (
      season != null &&
      seasonOptions.length &&
      !seasonOptions.some((entry) => entry.number === season)
    )
      setSeason(null);
  }
  const selectedSeason =
    season ??
    seasonOptions[0]?.number ??
    detail?.seasons?.[0]?.number ??
    null;
  const selectedSeasonRemote = useResource(
    (signal) =>
      onlineEnabled &&
      remoteMediaType === "tv" &&
      tmdbId != null &&
      selectedSeason != null
        ? fetchSeason(tmdbId, selectedSeason, signal)
        : Promise.resolve([]),
    [onlineEnabled, remoteMediaType, selectedSeason, tmdbId],
    "media-season",
  );
  const localSeasonEpisodes = useMemo(
    () =>
      detail?.episodes?.filter(
        (episode) =>
          !detail.seasons?.length || episode.seasonNumber === selectedSeason,
      ) ?? [],
    [detail, selectedSeason],
  );
  const mergedSeasonEpisodes = useMemo(
    () =>
      mergeEpisodes({
        local: localSeasonEpisodes,
        remote: onlineEnabled ? (selectedSeasonRemote.value ?? []) : [],
        season: selectedSeason ?? 1,
        fallbackArtwork: item?.backdrop || item?.poster || null,
      }),
    [
      item?.backdrop,
      item?.poster,
      localSeasonEpisodes,
      onlineEnabled,
      selectedSeasonRemote.value,
      selectedSeason,
    ],
  );
  React.useEffect(() => {
    if (!remoteDetail) return;
    prefetchImages(
      [remoteDetail.poster, remoteDetail.backdrop, remoteDetail.logo],
      3,
    );
  }, [remoteDetail]);
  React.useEffect(() => {
    prefetchImages(
      (selectedSeasonRemote.value ?? [])
        .slice(0, 10)
        .map((episode) => episode.still),
      10,
    );
  }, [selectedSeasonRemote.value]);
  const recommendations = useRecommendations({
    api,
    mediaType: remoteMediaType,
    tmdbId,
    online: onlineEnabled,
  });
  const remoteSeriesWatched = useMemo(() => {
    void remoteProgress;
    return onlineEnabled && remoteMediaType && tmdbId
      ? isRemotePlayed(remoteMediaType, tmdbId)
      : false;
  }, [onlineEnabled, remoteProgress, remoteMediaType, tmdbId]);
  const remoteTitleWatch =
    onlineEnabled && remoteMediaType && tmdbId
      ? getRemoteTitleProgress(remoteMediaType, tmdbId)
      : null;
  const episodeWatched = (episode: ItemCard) =>
    episodesWatchedOverride[episode.id] ??
    (progress.latest(episode.id)?.played || Boolean(episode.watch?.played));
  const remoteEpisodeWatched = (seasonNumber: number, episodeNumber: number) =>
    onlineEnabled && remoteMediaType && tmdbId
      ? isRemotePlayed(
          remoteMediaType,
          tmdbId,
          seasonNumber,
          episodeNumber,
        )
      : false;
  const nextHybridEpisode =
    mergedSeasonEpisodes.find((episode) =>
      episode.local
        ? Boolean(episode.local.fileId) && !episodeWatched(episode.local)
        : Boolean(episode.remote) &&
          !remoteEpisodeWatched(episode.seasonNumber, episode.number),
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
  const localSeriesWatched = Boolean(item?.watch?.played);
  const isSeriesWatched =
    overrideWatched ??
    (media.isOffline
      ? localSeriesWatched || remoteSeriesWatched
      : remoteSeriesWatched);
  const remoteSaved = remoteDetail ? isSaved(remoteDetail) : false;
  const chosenEpisode =
    selectedSeasonRemote.value?.[0]?.number ??
    mergedSeasonEpisodes[0]?.number ??
    null;

  async function watched() {
    if (!item) return;
    const nextPlayed = !isSeriesWatched;
    setOverrideWatched(nextPlayed);
    const newOverrides: Record<number, boolean> = {};
    if (detail?.episodes) {
      detail.episodes.forEach((ep) => {
        newOverrides[ep.id] = nextPlayed;
      });
      setEpisodesWatchedOverride((prev) => ({ ...prev, ...newOverrides }));
    }
    try {
      if (media.isOffline) {
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
        if (nextPlayed) await api.watched(item.id, true);
      }
      if (onlineEnabled && remoteMediaType && tmdbId) {
        await markRemotePlayed(
          remoteMediaType,
          tmdbId,
          nextPlayed,
          remoteDetail?.seasons.map((season) => ({
            season: season.number,
            episodes: Array.from(
              { length: season.episodes },
              (_, index) => index + 1,
            ),
          })),
        );
      }
      await progress.flushLocal().catch(() => {});
      media.retry();
    } catch (e) {
      setActionError(
        e instanceof Error ? e.message : "Could not update watched state.",
      );
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
      await progress.flushLocal().catch(() => {});
      media.retry();
    } catch {}
  }
  async function toggleRemoteEpisode(
    seasonNumber: number,
    episodeNumber: number,
    watchedState: boolean,
  ) {
    if (!onlineEnabled || !remoteMediaType || !tmdbId) return;
    try {
      await markRemoteEpisodePlayed(
        remoteMediaType,
        tmdbId,
        seasonNumber,
        episodeNumber,
        !watchedState,
      );
      triggerHaptic("selection");
    } catch (e) {
      setActionError(
        e instanceof Error ? e.message : "Could not update episode progress.",
      );
    }
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
      media.retry();
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
      else media.retry();
    } catch (e) {
      setActionError(
        e instanceof Error ? e.message : "Could not delete episode files.",
      );
      media.retry();
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
  function openEpisodeActions(ep: ItemCard, watchedState: boolean) {
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
        watch: {
          position: 0,
          duration: null,
          percent: 0,
          ...ep.watch,
          played: watchedState,
        },
      },
      {
        onSelect: () => startEpisodeSelection(ep),
        onChanged: () => {
          clearOverride();
          media.retry();
        },
        onDeleted: () => {
          clearOverride();
          if ((detail?.episodes?.length ?? 0) <= 1) back();
          else media.retry();
        },
      },
    );
  }
  function openRemoteEpisodeActions(
    seasonNumber: number,
    episodeNumber: number,
    watchedState: boolean,
  ) {
    showDialog(
      `${item?.name ?? "Episode"} · S${seasonNumber}E${episodeNumber}`,
      "Episode actions",
      [
        {
          text: watchedState ? "Mark as unwatched" : "Mark as finished",
          onPress: () =>
            void toggleRemoteEpisode(
              seasonNumber,
              episodeNumber,
              watchedState,
            ),
        },
        {
          text: "Play",
          onPress: () => playOnlineEpisode(seasonNumber, episodeNumber),
        },
      ],
    );
  }
  function openRemotePlayer(
    seasonNumber: number | null,
    episodeNumber: number | null,
    display: string,
  ) {
    if (!tmdbId || !remoteMediaType) {
      setActionError(
        "This title is not matched to TMDB, so the online source is unavailable.",
      );
      return;
    }
    lockPlayerLandscape();
    push({
      pathname: "/player/remote",
      params: {
        mediaType: remoteMediaType,
        tmdbId: String(tmdbId),
        season: seasonNumber != null ? String(seasonNumber) : "",
        episode: episodeNumber != null ? String(episodeNumber) : "",
        title: remoteDetail?.title || item?.name || "",
        display,
      },
    });
  }
  function playOnlineEpisode(seasonNumber: number, episodeNumber: number) {
    const titleName = remoteDetail?.title || item?.name || "";
    openRemotePlayer(
      seasonNumber,
      episodeNumber,
      `${titleName} · S${seasonNumber}E${episodeNumber}`,
    );
  }
  function playOnlineMovie() {
    const titleName = remoteDetail?.title || item?.name || "";
    openRemotePlayer(null, null, titleName);
  }
  const hasEpisodes = Boolean(
    item?.kind === "series" ||
      detail?.episodes?.length ||
      seasonOptions.length,
  );
  const remoteMoviePlayable =
    !media.isOffline && remoteMediaType === "movie" && tmdbId != null;
  const remoteTargetWatch =
    hybridPlay?.kind === "remote" && remoteMediaType && tmdbId
      ? remoteEpisodeWatch(
          remoteMediaType,
          tmdbId,
          hybridPlay.remote.season,
          hybridPlay.remote.number,
        )
      : null;
  const remotePlayLabel = remoteSeriesWatched
    ? "Watch again"
    : (remoteTitleWatch?.position ?? 0) > 0 ||
        (remoteTargetWatch?.position ?? 0) > 0
      ? "Continue watching"
      : "Start watching";
  const hybridBaseLabel =
    !media.isOffline && remoteMediaType === "movie"
      ? remotePlayLabel
      : hybridPlay?.kind === "remote"
        ? media.isOffline
          ? "Play"
          : remotePlayLabel
        : detailAction.label;
  const nextEpisodeNumber = hasEpisodes
    ? hybridPlay?.kind === "local"
      ? (hybridPlay.episode.episodeNumber ?? null)
      : hybridPlay?.kind === "remote"
        ? hybridPlay.remote.number
        : null
    : null;
  // The reference action reads "Start Watching E1": name the exact episode the
  // pill will open so the bar never leaves the target ambiguous.
  const hybridLabel =
    nextEpisodeNumber != null
      ? `${hybridBaseLabel} E${nextEpisodeNumber}`
      : hybridBaseLabel;
  const hybridDisabled = hasEpisodes
    ? !hybridPlay
    : !getFirstPlayableFileId() && !remoteMoviePlayable;
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
    if (!media.isOffline && remoteMediaType === "movie" && tmdbId) {
      playOnlineMovie();
      return;
    }
    if (hasEpisodes) return;
    const fileId = getFirstPlayableFileId();
    if (fileId) play(fileId);
  }
  const autoOpened = useRef(false);
  React.useEffect(() => {
    if (!autoPlay || autoOpened.current || !item) return;
    autoOpened.current = true;
    // Navigate after the detail surface has mounted. This also keeps the
    // auto-play decision out of the render/effect commit path.
    const timer = setTimeout(() => {
      if (media.isOffline) {
        if (hybridPlay) {
          playHybrid();
          return;
        }
        if (remoteMediaType === "tv") {
          playOnlineEpisode(
            autoSeason ?? selectedSeason ?? 1,
            autoEpisode ?? chosenEpisode ?? 1,
          );
          return;
        }
        if (remoteMediaType === "movie") playOnlineMovie();
        return;
      }
      if (remoteMediaType === "tv") {
        playOnlineEpisode(
          autoSeason ?? selectedSeason ?? 1,
          autoEpisode ?? chosenEpisode ?? 1,
        );
        return;
      }
      playOnlineMovie();
    }, 0);
    return () => clearTimeout(timer);
    // The effect intentionally runs once per title; values are read at open.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoPlay, item]);
  const toggleSaved = () => {
    if (!remoteDetail || media.isOffline || savedBusy) return;
    setSavedBusy(true);
    setActionError("");
    void save(remoteDetail)
      .catch(() => setActionError("Could not update your library."))
      .finally(() => setSavedBusy(false));
  };

  if (media.loading && !detail) {
    // Local detail is read from the device and resolves almost immediately,
    // so a skeleton there only flashes. Paint the themed canvas and let the
    // page appear. Online titles wait on TMDB and get a layout-matched
    // skeleton for their type (series vs movie).
    if (media.hasLocalCopy) {
      return <View className="flex-1 bg-background" />;
    }
    return (
      <View className="flex-1 bg-background">
        <TopFade />
        <TitleDetailSkeleton series={media.mediaType === "tv"} />
        <TitleBackButton onPress={back} />
      </View>
    );
  }
  if (!detail || !item) {
    return (
      <View className="flex-1 bg-background">
        <TitleBackButton onPress={back} />
        <View
          className="px-5"
          style={{ paddingTop: insets.top + 72 }}
        >
          <Notice
            kind="error"
            message={media.error || "This title could not be loaded."}
            retry={media.retry}
          />
        </View>
      </View>
    );
  }

  const overview =
    detail.metadata?.overview ||
    item.overview ||
    "No synopsis is available.";
  const runtime = item.runtime ?? detail.metadata?.runtime ?? null;
  const genres = detail.metadata?.genres?.length
    ? detail.metadata.genres
    : item.genres;
  const rating = item.rating ?? detail.metadata?.rating ?? null;
  const audioLanguages = Array.from(
    new Set(
      (detail.file?.audio ?? [])
        .map((track) => track.language)
        .filter(Boolean),
    ),
  );
  const detailRows = [
    item.year ? { label: "Year", value: String(item.year) } : null,
    runtime
      ? {
          label: "Runtime",
          value:
            runtime >= 60
              ? `${Math.floor(runtime / 60)}h ${runtime % 60}m`
              : `${runtime} min`,
        }
      : null,
    hasEpisodes && seasonOptions.length
      ? { label: "Seasons", value: String(seasonOptions.length) }
      : null,
    genres.length ? { label: "Genres", value: genres.join(", ") } : null,
    rating != null
      ? { label: "Rating", value: `${(rating / 2).toFixed(1)} / 5` }
      : null,
    audioLanguages.length
      ? { label: "Audio", value: audioLanguages.join(", ") }
      : null,
  ].filter((row): row is { label: string; value: string } => Boolean(row));
  const fileFacts = detail.file
    ? [
        detail.file.height
          ? `${detail.file.height >= 2160 ? "4K" : detail.file.height >= 720 ? "HD" : "SD"} · ${detail.file.height}p`
          : null,
        detail.file.videoCodec?.toUpperCase() ?? null,
        detail.file.hdr,
      ].filter((fact): fact is string => Boolean(fact))
    : [];

  const detailsPage = (
    <View className="gap-[18px] pt-1">
      {detail.metadata?.tagline ? (
        <Text className="font-archivo-medium text-[15px] italic leading-[22px] text-foreground/70">
          “{detail.metadata.tagline}”
        </Text>
      ) : null}

      {detailRows.length > 0 && (
        <View className="gap-3 rounded-2xl border border-border bg-surface px-4 py-4">
          {detailRows.map((row) => (
            <View
              key={row.label}
              className="flex-row items-start justify-between gap-6"
            >
              <Text className="font-archivo-medium text-[13px] text-muted">
                {row.label}
              </Text>
              <Text className="flex-1 text-right font-archivo-medium text-[13px] leading-[19px] text-foreground">
                {row.value}
              </Text>
            </View>
          ))}
        </View>
      )}

      {fileFacts.length > 0 && (
        <View className="flex-row flex-wrap gap-2">
          {fileFacts.map((fact) => (
            <Text
              key={fact}
              className="rounded-lg bg-accent/15 px-2.5 py-1.5 font-archivo-medium text-[12px] tracking-[0.3px] text-accent"
            >
              {fact}
            </Text>
          ))}
        </View>
      )}

      {media.remoteLoading && !detail.cast.length ? (
        <CastRowSkeleton />
      ) : (
        <CastRow
          people={detail.cast ?? []}
          api={api}
          canOpen={(name) => personTitles(name).length > 0}
          onSelect={setPersonName}
        />
      )}
    </View>
  );

  const canRecommend =
    onlineEnabled && online && tmdbId != null && remoteMediaType != null;
  const tabOptions: { key: DetailTab; label: string }[] = [
    ...(hasEpisodes
      ? [{ key: "episodes" as const, label: "Episodes" }]
      : []),
    ...(canRecommend
      ? [{ key: "more" as const, label: "More Like This" }]
      : []),
    ...(hasEpisodes || canRecommend
      ? [{ key: "details" as const, label: "Details" }]
      : []),
  ];
  const activeTab = tabOptions.some((tab) => tab.key === detailTab)
    ? detailTab
    : (tabOptions[0]?.key ?? "details");

  function changeTab(next: DetailTab) {
    if (next !== "episodes" && selectingEpisodes) endEpisodeSelection();
    setMenuOpen(false);
    setDetailTab(next);
  }

  const quickActions: QuickAction[] = [];
  if (remoteDetail && !media.isOffline) {
    quickActions.push({
      key: "list",
      icon: remoteSaved ? Check : Plus,
      label: "My List",
      accessibilityLabel: remoteSaved
        ? "Remove from My List"
        : "Add to My List",
      onPress: () => {
        triggerHaptic("light");
        toggleSaved();
      },
      disabled: savedBusy,
    });
  } else {
    quickActions.push({
      key: "watched",
      icon: Check,
      label: "Watched",
      accessibilityLabel: isSeriesWatched
        ? "Mark as unwatched"
        : "Mark as watched",
      onPress: () => {
        triggerHaptic("light");
        void watched();
      },
    });
  }

  const openRecommendation = (recommended: ItemCard) => {
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
  };
  const longPressRecommendation = (recommended: ItemCard) => {
    const remoteTitle = recommendations.remoteByPublicId.get(
      recommended.publicId,
    );
    if (remoteTitle) {
      remoteActions(recommended, {
        play: () => remoteNavigation.play(remoteTitle),
        onChanged: recommendations.retry,
      });
      return;
    }
    titleActions(recommended, {
      play: () =>
        push({
          pathname: "/item/[id]",
          params: { id: recommended.publicId },
        }),
      onChanged: recommendations.retry,
    });
  };
  const watchShortLabel = hybridBaseLabel
    .toLowerCase()
    .startsWith("continue")
    ? "Continue"
    : hybridBaseLabel.toLowerCase().startsWith("watch again")
      ? "Watch again"
      : "Watch";
  const tabIndex = Math.max(
    0,
    tabOptions.findIndex((tab) => tab.key === activeTab),
  );

  const episodesPage = (
    <View className="gap-[18px]">
      {seasonOptions.length > 0 ? (
        <SeasonPicker
          seasons={seasonOptions}
          value={selectedSeason ?? null}
          onChange={(number) => setSeason(number)}
        />
      ) : onlineEnabled && media.remoteLoading ? (
        <SeasonPickerSkeleton />
      ) : null}

      <View className="flex-row items-center justify-between">
        <Text className="font-archivo-medium text-[12px] text-muted">
          {mergedSeasonEpisodes.length}{" "}
          {mergedSeasonEpisodes.length === 1 ? "episode" : "episodes"}
        </Text>
        {!selectingEpisodes && localSeasonEpisodes.length > 0 && (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Select episodes"
            onPress={() => startEpisodeSelection()}
            hitSlop={8}
            className="flex-row items-center gap-1.5 rounded-full bg-surface px-3 py-2 active:opacity-70"
          >
            <Check size={13} color={colors.brand} strokeWidth={2.4} />
            <Text className="font-archivo-bold text-[12px] text-accent">
              Select
            </Text>
          </Pressable>
        )}
      </View>

      <SeasonPage
        api={api}
        detail={detail}
        season={selectedSeason ?? 1}
        onlineEnabled={onlineEnabled}
        remoteMediaType={remoteMediaType}
        tmdbId={tmdbId}
        play={play}
        progress={progress}
        overrides={episodesWatchedOverride}
        onToggleWatched={toggleEpisodeWatched}
        selecting={selectingEpisodes}
        selectedIds={selectedEpisodes}
        onToggleSelected={toggleEpisodeSelected}
        onLongPressEpisode={openEpisodeActions}
        onPlayRemote={playOnlineEpisode}
        onToggleRemoteWatched={(
          seasonNumber,
          episodeNumber,
          watchedState,
        ) =>
          void toggleRemoteEpisode(
            seasonNumber,
            episodeNumber,
            watchedState,
          )
        }
        onLongPressRemoteEpisode={openRemoteEpisodeActions}
      />
    </View>
  );
  const morePage = (
    <MoreLikeThis
      items={recommendations.items}
      api={api}
      loading={recommendations.loading}
      error={recommendations.error}
      retry={recommendations.retry}
      onSelect={openRecommendation}
      onLongPress={longPressRecommendation}
    />
  );
  const renderTabPage = (key: DetailTab) => {
    if (key === "episodes") return episodesPage;
    if (key === "more") return morePage;
    return detailsPage;
  };
  const singlePage = tabOptions.length <= 1;

  return (
    <View className="flex-1 bg-background">
      <TopFade />
      <TitleBackButton onPress={back} />

      <ScrollView
        contentInsetAdjustmentBehavior="never"
        contentContainerStyle={{ paddingBottom: insets.bottom + 116 }}
        showsVerticalScrollIndicator={false}
      >
        <TitleHero item={item} logo={detail.logo ?? item.logo} />

        <View className="gap-[18px] px-5 pt-5">
          {!!actionError && <Notice message={actionError} />}

          <TitleFactLine
            item={item}
            detail={detail}
            online={onlineEnabled}
            isOffline={media.isOffline}
          />

          <View className="flex-row items-center justify-center gap-3">
            <TitleRating rating={rating} />
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={hybridLabel}
              accessibilityState={{ disabled: hybridDisabled }}
              disabled={hybridDisabled}
              onPress={() => {
                triggerHaptic("light");
                playHybrid();
              }}
              className={cn(
                "h-[38px] flex-row items-center gap-1.5 rounded-full bg-accent px-4 active:opacity-80",
                hybridDisabled && "opacity-40",
              )}
            >
              <Play size={15} color="#fff" fill="#fff" />
              <Text className="font-archivo-bold text-[13px] text-white">
                {watchShortLabel}
              </Text>
            </Pressable>
          </View>

          <TitleQuickActions actions={quickActions} />

          <View className="gap-2">
            <View>
              <Text
                className="text-center font-archivo-regular text-[14px] leading-[22px] text-foreground/80"
                numberOfLines={descriptionExpanded ? undefined : 4}
              >
                {overview}
              </Text>
              {/* Measure the untruncated text once so the link only appears
                  when the synopsis actually exceeds the four visible lines. */}
              <View
                pointerEvents="none"
                accessible={false}
                importantForAccessibility="no-hide-descendants"
                style={{
                  position: "absolute",
                  left: 0,
                  right: 0,
                  top: 0,
                  opacity: 0,
                }}
              >
                <Text
                  className="text-center font-archivo-regular text-[14px] leading-[22px] text-foreground/80"
                  onTextLayout={(event) =>
                    setDescriptionOverflows(
                      event.nativeEvent.lines.length > 4,
                    )
                  }
                >
                  {overview}
                </Text>
              </View>
            </View>
            {descriptionOverflows && (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={
                  descriptionExpanded ? "Show less" : "Show more details"
                }
                accessibilityState={{ expanded: descriptionExpanded }}
                onPress={() => {
                  triggerHaptic("light");
                  setDescriptionExpanded((current) => !current);
                }}
                hitSlop={8}
                className="self-center py-1.5 active:opacity-65"
              >
                <Text className="font-archivo-bold text-[13px] tracking-[0.1px] text-accent">
                  {descriptionExpanded ? "Less Details" : "More Details"}
                </Text>
              </Pressable>
            )}
          </View>

          {!singlePage && (
            <TitleTabs
              className="mt-1"
              tabs={tabOptions}
              value={activeTab}
              onChange={(key) => changeTab(key as DetailTab)}
            />
          )}

          {singlePage ? (
            renderTabPage(activeTab)
          ) : (
            <SwipePager
              autoHeight
              pageKeys={tabOptions.map((tab) => tab.key)}
              index={tabIndex}
              onChange={(index) => {
                const next = tabOptions[index]?.key;
                if (!next) return;
                triggerHaptic("selection");
                changeTab(next);
              }}
              renderPage={(index) => {
                const key = tabOptions[index]?.key;
                return key ? renderTabPage(key) : null;
              }}
            />
          )}
        </View>
      </ScrollView>

      <TitleBrowser
        title={personName}
        items={personName ? personTitles(personName) : []}
        close={() => setPersonName(null)}
        open={(id) =>
          push({ pathname: "/item/[id]", params: { id: String(id) } })
        }
        play={play}
        onChanged={() => media.retry()}
      />
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
              changeTab("details");
              setMenuOpen(false);
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
          {!media.isOffline && remoteDetail && (
            <TitleMenuAction
              icon={remoteSaved ? Check : Plus}
              label={remoteSaved ? "Remove from library" : "Add to library"}
              onPress={() => {
                toggleSaved();
                setMenuOpen(false);
              }}
            />
          )}
          {media.isOffline && item && (
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
          )}
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
          accessibilityLabel={hybridLabel}
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
    </View>
  );
}

function SeasonPage({
  api,
  detail,
  season,
  onlineEnabled,
  remoteMediaType,
  tmdbId,
  play,
  progress,
  overrides,
  onToggleWatched,
  selecting,
  selectedIds,
  onToggleSelected,
  onLongPressEpisode,
  onPlayRemote,
  onToggleRemoteWatched,
  onLongPressRemoteEpisode,
}: {
  api: LocalCatalog;
  detail: TitleDetail;
  season: number;
  onlineEnabled: boolean;
  remoteMediaType: RemoteMediaType | null;
  tmdbId: number | null;
  play: (fileId: number) => void;
  progress: ProgressQueue;
  overrides: Record<number, boolean>;
  onToggleWatched: (ep: ItemCard) => void;
  selecting: boolean;
  selectedIds: Set<number>;
  onToggleSelected: (ep: ItemCard) => void;
  onLongPressEpisode: (ep: ItemCard, watched: boolean) => void;
  onPlayRemote: (season: number, episode: number) => void;
  onToggleRemoteWatched: (
    season: number,
    episode: number,
    watched: boolean,
  ) => void;
  onLongPressRemoteEpisode: (
    season: number,
    episode: number,
    watched: boolean,
  ) => void;
}) {
  const remoteSeason = useResource(
    (signal) =>
      onlineEnabled && tmdbId != null
        ? fetchSeason(tmdbId, season, signal)
        : Promise.resolve<RemoteEpisode[]>([]),
    [onlineEnabled, tmdbId, season],
    "media-season",
  );
  const localEpisodes =
    detail.episodes?.filter(
      (episode) =>
        !detail.seasons?.length || episode.seasonNumber === season,
    ) ?? [];
  const episodes = mergeEpisodes({
    local: localEpisodes,
    remote: onlineEnabled ? (remoteSeason.value ?? []) : [],
    season,
    fallbackArtwork: detail.item.backdrop || detail.item.poster || null,
  });
  const loading =
    onlineEnabled &&
    remoteSeason.loading &&
    !remoteSeason.value &&
    episodes.length === 0;
  return (
    <View className="gap-[18px]">
      {remoteSeason.error && (
        <Notice message={remoteSeason.error} retry={remoteSeason.retry} />
      )}
      {loading ? (
        <EpisodeListSkeleton count={5} />
      ) : (
        <SeasonEpisodes
          episodes={episodes}
          api={api}
          play={play}
          progress={progress}
          overrides={overrides}
          onToggleWatched={onToggleWatched}
          selecting={selecting}
          selectedIds={selectedIds}
          onToggleSelected={onToggleSelected}
          onLongPressEpisode={onLongPressEpisode}
          onPlayRemote={onPlayRemote}
          remoteMediaType={remoteMediaType}
          tmdbId={tmdbId}
          onToggleRemoteWatched={onToggleRemoteWatched}
          onLongPressRemoteEpisode={onLongPressRemoteEpisode}
        />
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
  remoteMediaType,
  tmdbId,
  onToggleRemoteWatched,
  onLongPressRemoteEpisode,
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
  remoteMediaType: RemoteMediaType | null;
  tmdbId: number | null;
  onToggleRemoteWatched: (
    season: number,
    episode: number,
    watched: boolean,
  ) => void;
  onLongPressRemoteEpisode: (
    season: number,
    episode: number,
    watched: boolean,
  ) => void;
}) {
  const [limit, setLimit] = useState(EPISODE_PAGE_SIZE);
  const visible = episodes.slice(0, limit);
  return (
    <View className="gap-[18px] pt-3">
      {visible.map((episode) => {
        const local = episode.local;
        const localWatched = local
          ? (overrides[local.id] ??
            (progress.latest(local.id)?.played ||
              Boolean(local.watch?.played)))
          : false;
        const remoteWatched =
          !local && remoteMediaType && tmdbId
            ? isRemotePlayed(
                remoteMediaType,
                tmdbId,
                episode.seasonNumber,
                episode.number,
              )
            : false;
        const watched = local ? localWatched : remoteWatched;
        const remoteWatch =
          !local && remoteMediaType && tmdbId
            ? remoteEpisodeWatch(
                remoteMediaType,
                tmdbId,
                episode.seasonNumber,
                episode.number,
              )
            : null;
        const localWatch = local
          ? (progress.latest(local.id) ?? local.watch)
          : null;
        const progressValue = local
          ? localWatch?.position && localWatch?.duration
            ? Math.min(1, localWatch.position / localWatch.duration)
            : null
          : remoteWatch?.duration
            ? Math.min(1, remoteWatch.position / remoteWatch.duration)
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
              if (selecting) {
                if (local) onToggleSelected(local);
                return;
              }
              if (local) onLongPressEpisode(local, localWatched);
              else if (episode.remote)
                onLongPressRemoteEpisode(
                  episode.remote.season,
                  episode.remote.number,
                  remoteWatched,
                );
            }}
            onToggleWatched={
              selecting
                ? undefined
                : local
                  ? () => onToggleWatched(local)
                  : episode.remote
                    ? () =>
                        onToggleRemoteWatched(
                          episode.remote!.season,
                          episode.remote!.number,
                          remoteWatched,
                        )
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
