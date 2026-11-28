import { useCollectionAction } from "@/features/collections/use-collection-action";
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
import Animated, { FadeIn, ReduceMotion } from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { SwipePager } from "@/shared/ui/swipe-pager";
import type { ProgressSink } from "@/core/client/progress-queue";
import { useClient } from "@/core/client/client-provider";
import { useServerDownloads } from "@/core/server/server-download-provider";
import { familyAllows } from "@/core/content/audience";
import { hideTitle } from "@/core/content/hidden-titles";
import { onlineUnavailableKey, useOnlineUnavailable } from "@/core/content/online-unavailable";
import { isReleased, releaseLabel } from "@/core/content/release";
import type { ItemCard, LocalCatalog, TitleDetail } from "@/core/library/catalog-api";
import { useResource } from "@/core/resources/use-resource";
import { useOnline } from "@/shared/hooks/use-online";
import { triggerHaptic } from "@/shared/lib/haptics";
import { cn } from "@/shared/lib/cn";
import { easings, motion, useColors, control } from "@/shared/theme";
import {
  AlertCircle,
  ArrowLeft,
  Eye,
  Minus,
  EyeOff,
  Film,
  Globe,
  Info,
  MoreHorizontal,
  Plus,
  Trash2,
  WifiOff,
  X,
} from "@/shared/ui/icons";
import { Button } from "@/shared/ui/button";
import { Notice } from "@/shared/ui/notice";
import { PageState } from "@/shared/ui/page-state";
import {
  CastRowSkeleton,
  EpisodeListSkeleton,
  SeasonPickerSkeleton,
  TitleDetailSkeleton,
} from "@/shared/ui/skeleton";
import { TitleBrowser } from "@/features/catalog/components/title-browser";
import { TopFade } from "@/features/catalog/components/top-fade";
import { playbackAction } from "@/features/catalog/lib/playback-action";
import { applyEpisodeAction, applyTitleAction } from "@/features/catalog/lib/title-actions";
import { useTitleActions } from "@/features/catalog/hooks/use-title-actions";
import {
  isRemotePlayed,
  markRemoteEpisodePlayed,
  markRemoteEpisodesPlayed,
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
import { useMovy } from "@/features/movy/movy-provider";
import { AccountSheet } from "@/features/movy/components/account-sheet";
import {
  QualitySheet,
  type DownloadTarget,
} from "@/features/movy/components/quality-sheet";
import {
  DownloadButton,
  downloadButtonState,
  type DownloadButtonState,
} from "@/features/movy/components/download-button";
import { pickQuality } from "@/features/movy/lib/quality";
import { MovyError } from "@/features/movy/lib/types";
import { lockPlayerLandscape } from "@/features/player/hooks/use-player-orientation";
import { fetchSeason, peekSeason, type RemoteMediaType } from "@/features/remote/lib/tmdb";
import {
  mergeEpisodes,
  mergeSeasons,
  type HybridEpisode,
} from "@/features/remote/lib/hybrid-episodes";
import { CastRow } from "./components/cast-row";
import { HybridEpisodeCard } from "./components/hybrid-episode-card";
import { MoreLikeThis } from "./components/more-like-this";
import { MovieCollection } from "./components/movie-collection";
import { SeasonPicker } from "./components/season-picker";
import { TitleActionBar } from "./components/title-action-bar";
import { TitleFactLine, TitleRating } from "./components/title-facts";
import { TitleHero } from "./components/title-hero";
import { TitleMenuAction } from "./components/title-menu-action";
import { TitleTabs } from "./components/title-tabs";
import { defaultSeasonNumber, playbackSeasonNumber, seasonComplete } from "./lib/default-season";
import { useMediaTitle, type MediaTitleInput } from "./lib/use-media-title";

const CONTENT_ENTER = FadeIn.duration(motion.duration.fast)
  .easing(easings.out)
  .reduceMotion(ReduceMotion.System);

type DetailTab = "episodes" | "more" | "details" | "collection";

/** Floating back control shared by the loading, error and loaded title views. */
function TitleBackButton({ onPress }: { onPress: () => void }) {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel="Go back"
      className="absolute left-4 z-[99] h-10 w-10 items-center justify-center rounded-full border border-foreground/[0.15] bg-overlay/90 active:opacity-70"
      style={{ top: insets.top + 14 }}
      hitSlop={14}
    >
      <ArrowLeft size={22} color={colors.ink} strokeWidth={2} />
    </Pressable>
  );
}

export function TitleScreen({
  input,
  offlineOnly = false,
  autoPlay = false,
  autoSeason = null,
  autoEpisode = null,
  back,
  play,
}: {
  input: MediaTitleInput;
  offlineOnly?: boolean;
  autoPlay?: boolean;
  autoSeason?: number | null;
  autoEpisode?: number | null;
  back: () => void;
  play: (fileId: number) => void;
}) {
  const showDialog = useAppDialog();
  const colors = useColors();
  const titleActions = useTitleActions();
  const addToCollection = useCollectionAction();
  const remoteActions = useRemoteTitleActions();
  const { api, progress, preferences } = useClient();
  const serverDownloads = useServerDownloads();
  const { save, isSaved } = useRemote();
  const movy = useMovy();
  const remoteNavigation = useRemoteNavigation();
  const insets = useSafeAreaInsets();
  const onlineEnabled =
    !offlineOnly && preferences.mode !== "local" && (preferences.source === "remote" || input.source === "remote");
  const media = useMediaTitle(input, api, onlineEnabled);
  const detail = media.detail;
  const item = detail?.item ?? null;
  const alternateSource = item ? api.alternateSource?.(item) ?? null : null;
  const tmdbId = media.tmdbId;
  const remoteMediaType = media.mediaType;
  const remoteDetail = media.remoteDetail;
  // Marked "online playback unavailable": only local or downloaded files play.
  const onlineUnavailable = useOnlineUnavailable();
  const onlineBlocked = onlineUnavailable.isUnavailable(remoteMediaType, tmdbId);
  // Kids & Family mode is enforced before any play route is reachable.
  const maturityRestricted = !familyAllows(
    detail?.metadata?.certification,
    preferences.familyLevel,
    preferences.familyBlockUnrated,
  );
  const remoteUnreleased =
    !media.isOffline &&
    remoteDetail != null &&
    !isReleased(remoteDetail.releaseDate);
  const playbackBlocked = maturityRestricted || remoteUnreleased;
  const playbackBlockedMessage = maturityRestricted
    ? "Kids & Family mode restricts this title. Change the mode in Settings → Kids & family."
    : `This title is not released yet${releaseLabel(remoteDetail?.releaseDate) ? ` · ${releaseLabel(remoteDetail?.releaseDate)}` : ""}. Playback will be available after release.`;
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
  const [episodeSort, setEpisodeSort] = useState<"oldest" | "newest">("oldest");
  const [seasonBusy, setSeasonBusy] = useState(false);
  const [season, setSeason] = useState<number | null>(null);
  const [detailTab, setDetailTab] = useState<DetailTab>("episodes");
  const [descriptionExpanded, setDescriptionExpanded] = useState(false);
  const [descriptionOverflows, setDescriptionOverflows] = useState(false);
  const [actionError, setActionError] = useState("");
  const [downloadTarget, setDownloadTarget] = useState<DownloadTarget | null>(null);
  const [downloadAccountOpen, setDownloadAccountOpen] = useState(false);
  const pendingDownload = useRef<DownloadTarget | null>(null);
  React.useEffect(() => {
    if (!movy.active || !pendingDownload.current) return;
    const target = pendingDownload.current;
    pendingDownload.current = null;
    setDownloadTarget(target);
  }, [movy.active]);
  const [savedBusy, setSavedBusy] = useState(false);
  const [localWatchlistBusy, setLocalWatchlistBusy] = useState(false);
  const [watchlistOverride, setWatchlistOverride] = useState<boolean | null>(
    null,
  );
  const watchlistKey = `${item?.id ?? "none"}:${media.isOffline ? "offline" : "online"}`;
  const [previousWatchlistKey, setPreviousWatchlistKey] =
    useState(watchlistKey);
  if (previousWatchlistKey !== watchlistKey) {
    setPreviousWatchlistKey(watchlistKey);
    setWatchlistOverride(null);
  }
  const [overrideWatched, setOverrideWatched] = useState<boolean | null>(null);
  const watchedBusy = useRef(false);
  const [episodesWatchedOverride, setEpisodesWatchedOverride] = useState<
    Record<number, boolean>
  >({});

  const episodeSnapshot = detail?.episodes;
  const [previousEpisodeSnapshot, setPreviousEpisodeSnapshot] = useState(episodeSnapshot);
  if (previousEpisodeSnapshot !== episodeSnapshot) {
    setPreviousEpisodeSnapshot(episodeSnapshot);
    if (Object.keys(episodesWatchedOverride).length) {
      const saved = new Map(episodeSnapshot?.map((episode) => [episode.id, Boolean(episode.watch?.played)]));
      setEpisodesWatchedOverride(Object.fromEntries(Object.entries(episodesWatchedOverride)
        .filter(([id, played]) => saved.has(Number(id)) && saved.get(Number(id)) !== played)));
    }
  }

  const seasonOptions = useMemo(
    () => mergeSeasons(detail?.seasons ?? [], remoteDetail?.seasons ?? []),
    [detail?.seasons, remoteDetail?.seasons],
  );
  const seasonPickerOptions = useMemo(() => {
    const counts = new Map<number, number>();
    for (const episode of detail?.episodes ?? []) {
      const number = episode.seasonNumber ?? 1;
      counts.set(number, (counts.get(number) ?? 0) + 1);
    }
    for (const season of remoteDetail?.seasons ?? []) {
      counts.set(season.number, season.episodes);
    }
    return seasonOptions.map((option) => ({ ...option, count: counts.get(option.number) }));
  }, [detail?.episodes, remoteDetail?.seasons, seasonOptions]);
  const seasonWatchInfo = React.useMemo(() => {
    void remoteProgress;
    // Episode number -> card, once per season. The old nested find made this
    // O(seasons × episodes²) on a large series and ran before first paint.
    const localBySeason = new Map<number, Map<number, ItemCard>>();
    for (const episode of detail?.episodes ?? []) {
      const seasonNumber = episode.seasonNumber ?? 1;
      let episodes = localBySeason.get(seasonNumber);
      if (!episodes) {
        episodes = new Map();
        localBySeason.set(seasonNumber, episodes);
      }
      episodes.set(episode.episodeNumber ?? 1, episode);
    }
    const remoteCounts = new Map<number, number>();
    for (const remoteSeason of onlineEnabled ? (remoteDetail?.seasons ?? []) : []) {
      remoteCounts.set(remoteSeason.number, remoteSeason.episodes);
    }
    return seasonOptions.map((option) => {
      const localEpisodes = localBySeason.get(option.number);
      const remoteCount = remoteCounts.get(option.number) ?? 0;
      const episodeNumbers = [...new Set([
        ...Array.from({ length: remoteCount }, (_, i) => i + 1),
        ...(localEpisodes?.keys() ?? []),
      ])].sort((a, b) => a - b);
      return {
        number: option.number,
        episodeNumbers,
        totalEpisodes: episodeNumbers.length,
        isEpisodeWatched: (number: number) => {
          const localEpisode = localEpisodes?.get(number);
          if (localEpisode?.fileId) {
            return episodesWatchedOverride[localEpisode.id]
              ?? progress.latest(localEpisode.id)?.played
              ?? Boolean(localEpisode.watch?.played);
          }
          return Boolean(onlineEnabled && remoteMediaType && tmdbId &&
            isRemotePlayed(remoteMediaType, tmdbId, option.number, number));
        },
      };
    });
  }, [detail?.episodes, episodesWatchedOverride, onlineEnabled, progress, remoteDetail?.seasons,
    remoteMediaType, remoteProgress, seasonOptions, tmdbId]);
  const defaultSeason = defaultSeasonNumber(seasonWatchInfo);
  const selectedSeason = season != null && seasonOptions.some((option) => option.number === season)
    ? season
    : defaultSeason ?? detail?.seasons?.[0]?.number ?? null;
  const selectedSeasonRemote = useResource(
    (signal) =>
      onlineEnabled && remoteMediaType === "tv" &&
      tmdbId != null &&
      selectedSeason != null
        ? fetchSeason(tmdbId, selectedSeason, signal)
        : Promise.resolve([]),
    [onlineEnabled, remoteMediaType, selectedSeason, tmdbId],
    "media-season",
    () =>
      onlineEnabled && remoteMediaType === "tv" &&
      tmdbId != null &&
      selectedSeason != null
        ? peekSeason(tmdbId, selectedSeason)
        : null,
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
        remote: selectedSeasonRemote.value ?? [],
        season: selectedSeason ?? 1,
        fallbackArtwork: item?.backdrop || item?.poster || null,
      }),
    [
      item?.backdrop,
      item?.poster,
      localSeasonEpisodes,
      selectedSeasonRemote.value,
      selectedSeason,
    ],
  );
  const sortedSeasonEpisodes = useMemo(
    () => episodeSort === "newest" ? [...mergedSeasonEpisodes].reverse() : mergedSeasonEpisodes,
    [episodeSort, mergedSeasonEpisodes],
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
  const canRecommend =
    onlineEnabled && online && tmdbId != null && remoteMediaType != null;
  const collectionId =
    remoteMediaType === "movie" ? (remoteDetail?.collection?.id ?? null) : null;
  const hasCollection = collectionId != null;
  const hasEpisodesEarly = Boolean(
    item?.kind === "series" ||
      detail?.episodes?.length ||
      seasonOptions.length,
  );
  // Series start on Episodes; only request recommendations when that page is
  // actually shown. Movies default to the recommendations page, so they keep
  // the eager fetch that makes the first tab feel complete.
  const recommendationsEnabled =
    canRecommend && (detailTab === "more" || !hasEpisodesEarly);
  // Cast photos are below the fold on a series page; decode them only when
  // Details is the visible page (or it is the only page).
  const detailsVisible =
    detailTab === "details" || (!hasEpisodesEarly && !canRecommend);
  const recommendations = useRecommendations({
    api,
    mediaType: remoteMediaType,
    tmdbId,
    online: onlineEnabled,
    enabled: recommendationsEnabled,
  });
  const remoteSeriesWatched = useMemo(() => {
    void remoteProgress;
    return remoteMediaType && tmdbId
      ? isRemotePlayed(remoteMediaType, tmdbId)
      : false;
  }, [remoteProgress, remoteMediaType, tmdbId]);
  const remoteTitleWatch =
    remoteMediaType && tmdbId
      ? getRemoteTitleProgress(remoteMediaType, tmdbId)
      : null;
  const episodeWatched = (episode: ItemCard) =>
    episodesWatchedOverride[episode.id] ??
    progress.latest(episode.id)?.played ?? Boolean(episode.watch?.played);
  const selectedWatchInfo = seasonWatchInfo.find((entry) => entry.number === selectedSeason);
  const selectedSeasonWatched = selectedWatchInfo ? seasonComplete(selectedWatchInfo) : false;
  const playbackSeason = playbackSeasonNumber(seasonWatchInfo, selectedSeason);
  const playbackWatchInfo = seasonWatchInfo.find((entry) => entry.number === playbackSeason);
  const playbackEpisodes = playbackSeason === selectedSeason ? mergedSeasonEpisodes : mergeEpisodes({
    local: detail?.episodes?.filter((episode) => (episode.seasonNumber ?? 1) === playbackSeason) ?? [],
    remote: onlineEnabled && tmdbId && playbackSeason != null ? peekSeason(tmdbId, playbackSeason) ?? [] : [],
    season: playbackSeason ?? 1,
    fallbackArtwork: null,
  });
  const nextPlayable = playbackEpisodes.find((episode) => episode.local?.fileId || episode.remote);
  const firstUnwatched = playbackWatchInfo?.episodeNumbers.find((number) => !playbackWatchInfo.isEpisodeWatched(number));
  const targetNumber = firstUnwatched ?? playbackWatchInfo?.episodeNumbers[0] ?? nextPlayable?.number;
  const target = playbackEpisodes.find((episode) => episode.number === targetNumber) ??
    (targetNumber == null ? nextPlayable : undefined);
  const canStreamTarget = onlineEnabled && remoteMediaType === "tv" && tmdbId != null &&
    remoteDetail?.seasons.some((entry) => entry.number === playbackSeason && targetNumber != null && targetNumber <= entry.episodes);
  const streamPlay = target?.local?.fileId
    ? { kind: "local" as const, episode: target.local }
    : target?.remote
      ? { kind: "remote" as const, remote: target.remote }
      : canStreamTarget && playbackSeason != null && targetNumber != null
        ? { kind: "remote" as const, remote: { season: playbackSeason, number: targetNumber } }
        : null;
  const localFallback = playbackEpisodes.find((episode) => episode.local?.fileId)?.local;
  const hybridPlay = !onlineBlocked
    ? streamPlay
    : streamPlay?.kind === "local"
      ? streamPlay
      : localFallback
        ? { kind: "local" as const, episode: localFallback }
        : null;
  // The person index scans the library. Build it after the page has settled,
  // not during the navigation render, so opening a title stays immediate.
  const cast = detail?.cast;
  const personIndex = useRef<{
    api: LocalCatalog;
    cast: NonNullable<TitleDetail["cast"]>;
    map: Map<string, ItemCard[]>;
  } | null>(null);
  React.useEffect(() => {
    if (!cast?.length) return;
    const timer = setTimeout(() => {
      if (
        personIndex.current?.api === api &&
        personIndex.current.cast === cast
      )
        return;
      personIndex.current = { api, cast, map: api.titlesByPerson() };
    }, 400);
    return () => clearTimeout(timer);
  }, [api, cast]);
  const personTitles = (name: string) => {
    if (!cast?.length) return [];
    if (
      personIndex.current?.api !== api ||
      personIndex.current.cast !== cast
    ) {
      personIndex.current = { api, cast, map: api.titlesByPerson() };
    }
    return personIndex.current.map.get(name) ?? [];
  };
  const localSeriesWatched = Boolean(item?.watch?.played);
  const isSeriesWatched =
    overrideWatched ??
    (media.isOffline
      ? localSeriesWatched || (onlineEnabled && remoteSeriesWatched)
      : remoteSeriesWatched);
  const remoteSaved = remoteDetail ? isSaved(remoteDetail) : false;
  const watchlisted =
    watchlistOverride ??
    (media.isOffline ? Boolean(item?.watchlist) : remoteSaved);
  const watchlistBusy = media.isOffline ? localWatchlistBusy : savedBusy;
  const chosenEpisode =
    selectedSeasonRemote.value?.[0]?.number ??
    mergedSeasonEpisodes[0]?.number ??
    null;

  async function watched() {
    if (!item || watchedBusy.current) return;
    watchedBusy.current = true;
    const nextPlayed = !isSeriesWatched;
    setOverrideWatched(nextPlayed);
    const ids = (detail?.episodes ?? []).map((episode) => episode.id);
    setEpisodesWatchedOverride(Object.fromEntries(ids.map((id) => [id, nextPlayed])));
    try {
      const local = media.isOffline ? (ids.length
        ? Promise.all([progress.forgetMany(ids), api.setEpisodesWatched(ids, nextPlayed)])
        : applyTitleAction(api, progress, item.id, nextPlayed ? "finished" : "remove")) : undefined;
      const remote = remoteMediaType && tmdbId && (onlineEnabled || remoteSeriesWatched)
        ? markRemotePlayed(
          remoteMediaType,
          tmdbId,
          nextPlayed,
          remoteDetail?.seasons.map((season) => ({
            season: season.number,
            episodes: Array.from({ length: season.episodes }, (_, index) => index + 1),
          })),
        ) : undefined;
      await Promise.all([local, remote]);
    } catch (error) {
      setOverrideWatched(null);
      setEpisodesWatchedOverride({});
      setActionError(error instanceof Error ? error.message : "Could not update watched state.");
    } finally {
      watchedBusy.current = false;
      media.retry();
    }
  }
  async function markSeasonWatched() {
    if (watchedBusy.current || !selectedWatchInfo) return;
    const seasonNumber = selectedWatchInfo.number;
    const played = !selectedSeasonWatched;
    const ids = localSeasonEpisodes.map((episode) => episode.id);
    const numbers = [...new Set([
      ...selectedWatchInfo.episodeNumbers,
      ...mergedSeasonEpisodes.map((episode) => episode.number),
    ])];
    if (!numbers.length) return;
    watchedBusy.current = true;
    setSeason(seasonNumber);
    setSeasonBusy(true);
    setOverrideWatched(null);
    setActionError("");
    setEpisodesWatchedOverride((previous) => ({
      ...previous,
      ...Object.fromEntries(ids.map((id) => [id, played])),
    }));
    try {
      const local = ids.length ? Promise.all([
        progress.forgetMany(ids),
        api.setEpisodesWatched(ids, played),
      ]) : undefined;
      const remote = onlineEnabled && remoteMediaType === "tv" && tmdbId
        ? markRemoteEpisodesPlayed(remoteMediaType, tmdbId, seasonNumber, numbers, played)
        : undefined;
      await Promise.all([local, remote]);
      triggerHaptic("selection");
    } catch (error) {
      setEpisodesWatchedOverride((previous) => {
        const next = { ...previous };
        for (const id of ids) delete next[id];
        return next;
      });
      setActionError(error instanceof Error ? error.message : "Could not update the season.");
    } finally {
      watchedBusy.current = false;
      setSeasonBusy(false);
      media.retry();
    }
  }
  async function toggleEpisodeWatched(ep: ItemCard) {
    if (watchedBusy.current) return;
    const currentEpPlayed = episodeWatched(ep);
    setOverrideWatched(null);
    const nextPlayed = !currentEpPlayed;
    setEpisodesWatchedOverride((prev) => ({ ...prev, [ep.id]: nextPlayed }));
    try {
      await Promise.all([progress.forgetMany([ep.id]), api.setEpisodesWatched([ep.id], nextPlayed)]);
      media.retry();
    } catch (error) {
      setEpisodesWatchedOverride((previous) => ({ ...previous, [ep.id]: currentEpPlayed }));
      setActionError(error instanceof Error ? error.message : "Could not update episode progress.");
    }
  }
  async function toggleRemoteEpisode(
    seasonNumber: number,
    episodeNumber: number,
    watchedState: boolean,
  ) {
    if (watchedBusy.current || !remoteMediaType || !tmdbId) return;
    setOverrideWatched(null);
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
    if (playbackBlocked) {
      setActionError(playbackBlockedMessage);
      return;
    }
    if (onlineBlocked) {
      setActionError(
        "Online playback is marked unavailable for this title. Download it to watch offline.",
      );
      return;
    }
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
  function downloadRecordFor(
    seasonNumber: number | null,
    episodeNumber: number | null,
  ) {
    if (!remoteMediaType || tmdbId == null) return undefined;
    return movy.findDownload(
      remoteMediaType,
      tmdbId,
      seasonNumber,
      episodeNumber,
    );
  }
  function downloadStateFor(
    seasonNumber: number | null,
    episodeNumber: number | null,
  ): DownloadButtonState {
    return downloadButtonState(
      downloadRecordFor(seasonNumber, episodeNumber),
    );
  }
  function downloadProgressFor(
    seasonNumber: number | null,
    episodeNumber: number | null,
  ) {
    return downloadRecordFor(seasonNumber, episodeNumber)?.progress ?? 0;
  }
  function openDownload(
    seasonNumber: number | null,
    episodeNumber: number | null,
    episodeTitle?: string | null,
  ) {
    if (playbackBlocked) {
      setActionError(playbackBlockedMessage);
      return;
    }
    if (!remoteDetail || !remoteMediaType || tmdbId == null) {
      setActionError(
        "This title is not matched to TMDB, so downloads are unavailable.",
      );
      return;
    }
    const existing = downloadRecordFor(seasonNumber, episodeNumber);
    if (existing?.status === "completed") {
      setActionError("This download is already in your library.");
      return;
    }
    if (existing?.status === "paused") {
      void movy.resume(existing.id);
      return;
    }
    if (
      existing &&
      (existing.status === "queued" ||
        existing.status === "downloading" ||
        existing.status === "verifying")
    ) {
      push("/settings/downloads");
      return;
    }
    // A failed record may hold an expired signed URL. Open the quality sheet
    // so the user can mint a fresh link; the provider replaces the old record.
    const titleName = remoteDetail.title || item?.name || "";
    const isEpisode = remoteMediaType === "tv";
    const display = isEpisode
      ? `${titleName} · S${seasonNumber ?? 1}E${episodeNumber ?? 1}`
      : titleName;
    const target: DownloadTarget = {
      ref: {
        title: titleName,
        mediaType: remoteMediaType,
        year: remoteDetail.year ?? item?.year ?? null,
        tmdbId,
        imdbId: remoteDetail.imdbId ?? null,
        season: isEpisode ? (seasonNumber ?? 1) : null,
        episode: isEpisode ? (episodeNumber ?? 1) : null,
      },
      meta: {
        title: titleName,
        episodeTitle: episodeTitle ?? null,
        display,
        poster: remoteDetail.poster ?? item?.poster ?? null,
      },
    };
    if (!movy.active) {
      movy.clearError();
      pendingDownload.current = target;
      setDownloadAccountOpen(true);
      return;
    }
    setDownloadTarget(target);
  }
  // "Download season": every released online-only episode of the selected
  // season, queued at the preferred quality without a sheet per episode.
  const [seasonQueueing, setSeasonQueueing] = useState(false);
  const seasonDownloadEpisodes =
    !media.isOffline && remoteMediaType === "tv" && remoteDetail && tmdbId != null
      ? mergedSeasonEpisodes.filter(
          (episode) => episode.remote && !episode.local && isReleased(episode.airDate),
        )
      : [];
  const seasonRecords = seasonDownloadEpisodes.map((episode) =>
    downloadRecordFor(episode.seasonNumber, episode.number),
  );
  const seasonStates = seasonRecords.map((record) => downloadButtonState(record));
  const seasonDownloadState: DownloadButtonState = seasonQueueing
    ? "queued"
    : seasonStates.length && seasonStates.every((state) => state === "done")
      ? "done"
      : seasonStates.includes("downloading")
        ? "downloading"
        : seasonStates.includes("queued")
          ? "queued"
          : seasonStates.includes("paused")
            ? "paused"
            : "idle";
  const seasonDownloadProgress = seasonRecords.length
    ? seasonRecords.reduce(
        (sum, record) =>
          sum + (record?.status === "completed" ? 1 : (record?.progress ?? 0)),
        0,
      ) / seasonRecords.length
    : 0;
  async function queueSeasonDownloads(
    episodes: typeof seasonDownloadEpisodes,
  ) {
    if (!remoteDetail || !remoteMediaType || tmdbId == null) return;
    setSeasonQueueing(true);
    setActionError("");
    const titleName = remoteDetail.title || item?.name || "";
    let queued = 0;
    let lastError: unknown = null;
    for (const episode of episodes) {
      const existing = downloadRecordFor(episode.seasonNumber, episode.number);
      if (existing && existing.status !== "failed") continue;
      const ref = {
        title: titleName,
        mediaType: remoteMediaType,
        year: remoteDetail.year ?? item?.year ?? null,
        tmdbId,
        imdbId: remoteDetail.imdbId ?? null,
        season: episode.seasonNumber,
        episode: episode.number,
      };
      try {
        const reply = await movy.loadOptions(ref);
        const choice = pickQuality(reply.options, preferences.movyMaxHeight);
        if (!choice) continue;
        await movy.download(ref, choice.option, {
          title: titleName,
          episodeTitle: episode.title,
          display: `${titleName} · S${episode.seasonNumber}E${episode.number}`,
          poster: remoteDetail.poster ?? item?.poster ?? null,
        });
        queued += 1;
      } catch (cause) {
        lastError = cause;
        // Out of quota or signed out: the rest would fail the same way.
        if (cause instanceof MovyError && (cause.code === "quota" || cause.code === "auth"))
          break;
      }
    }
    setSeasonQueueing(false);
    if (lastError)
      setActionError(
        queued
          ? `Queued ${queued} ${queued === 1 ? "episode" : "episodes"}. ${lastError instanceof Error ? lastError.message : ""}`.trim()
          : lastError instanceof Error
            ? lastError.message
            : "Could not start the season download.",
      );
  }
  function downloadSeason() {
    if (playbackBlocked) {
      setActionError(playbackBlockedMessage);
      return;
    }
    if (seasonQueueing) return;
    if (seasonDownloadState === "downloading" || seasonDownloadState === "queued" || seasonDownloadState === "done") {
      push("/settings/downloads");
      return;
    }
    if (!movy.active) {
      movy.clearError();
      setDownloadAccountOpen(true);
      return;
    }
    const pending = seasonDownloadEpisodes.filter((episode) => {
      const record = downloadRecordFor(episode.seasonNumber, episode.number);
      return !record || record.status === "failed";
    });
    if (!pending.length) {
      setActionError("Every released episode of this season is already downloaded or queued.");
      return;
    }
    showDialog(
      `Download season ${selectedSeason ?? ""}`.trim(),
      `Queue ${pending.length} ${pending.length === 1 ? "episode" : "episodes"} at your maximum download quality. Each episode uses one download from your account quota.`,
      [
        {
          text: `Download ${pending.length} ${pending.length === 1 ? "episode" : "episodes"}`,
          onPress: () => void queueSeasonDownloads(pending),
        },
      ],
    );
  }
  const hasEpisodes = Boolean(
    item?.kind === "series" ||
      detail?.episodes?.length ||
      seasonOptions.length,
  );
  const remoteMoviePlayable =
    !media.isOffline && !onlineBlocked && remoteMediaType === "movie" && tmdbId != null;
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
    : ((hasEpisodes ? remoteTargetWatch : remoteTitleWatch)?.position ?? 0) > 0
      ? "Continue watching"
      : "Start watching";
  const hybridBaseLabel =
    remoteMoviePlayable
      ? remotePlayLabel
      : hybridPlay?.kind === "remote"
        ? remotePlayLabel
        : hybridPlay?.kind === "local"
          ? episodeWatched(hybridPlay.episode)
            ? "Watch again"
            : ((progress.latest(hybridPlay.episode.id)?.position ?? hybridPlay.episode.watch?.position) ?? 0) > 0
              ? "Continue watching" : "Start watching"
          : detailAction.label;
  const nextEpisodeNumber = hasEpisodes
    ? hybridPlay?.kind === "local"
      ? (hybridPlay.episode.episodeNumber ?? null)
      : hybridPlay?.kind === "remote"
        ? hybridPlay.remote.number
        : null
    : null;
  // Name the exact season and episode the play action will open.
  const hybridLabel =
    nextEpisodeNumber != null
      ? `${hybridBaseLabel} ${playbackSeason != null ? `S${playbackSeason}` : ""}E${nextEpisodeNumber}`
      : hybridBaseLabel;
  const hybridDisabled = hasEpisodes
    ? !hybridPlay
    : !getFirstPlayableFileId() && !remoteMoviePlayable;
  function playHybrid() {
    if (playbackBlocked) {
      setActionError(playbackBlockedMessage);
      return;
    }
    if (hybridPlay?.kind === "local") {
      if (hybridPlay.episode.fileId != null)
        play(hybridPlay.episode.fileId);
      return;
    }
    if (hybridPlay?.kind === "remote") {
      playOnlineEpisode(hybridPlay.remote.season, hybridPlay.remote.number);
      return;
    }
    if (remoteMoviePlayable) {
      playOnlineMovie();
      return;
    }
    if (hasEpisodes) return;
    const fileId = getFirstPlayableFileId();
    if (fileId) play(fileId);
  }
  function guardedPlay(fileId: number) {
    if (playbackBlocked) {
      setActionError(playbackBlockedMessage);
      return;
    }
    play(fileId);
  }
  const autoOpened = useRef(false);
  React.useEffect(() => {
    if (!autoPlay || autoOpened.current || !item) return;
    // The blocked state already renders a notice and hides the action bar.
    if (playbackBlocked) return;
    autoOpened.current = true;
    if (onlineBlocked) {
      if (hybridPlay) setTimeout(playHybrid, 0);
      return;
    }
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
  const toggleWatchlist = async () => {
    if (media.isOffline) {
      if (!item || localWatchlistBusy) return;
      const next = !watchlisted;
      setWatchlistOverride(next);
      setLocalWatchlistBusy(true);
      setActionError("");
      try {
        await api.setWatchlist(item.id, next);
      } catch (e) {
        setWatchlistOverride(null);
        setActionError(
          e instanceof Error
            ? e.message
            : "Could not update your watch list.",
        );
      } finally {
        setLocalWatchlistBusy(false);
      }
      return;
    }
    if (remoteDetail) toggleSaved();
  };

  if ((media.loading && !detail) || (detail && onlineEnabled && media.remoteLoading && !remoteDetail)) {
    return (
      <View className="flex-1 bg-background">
        <TopFade />
        <TitleDetailSkeleton series={media.mediaType === "tv"} />
        <TitleBackButton onPress={back} />
      </View>
    );
  }
  if (!detail || !item) {
    const offline = !online && input.source === "remote";
    return (
      <View className="flex-1 bg-background">
        <TitleBackButton onPress={back} />
        <PageState
          icon={offline ? WifiOff : AlertCircle}
          title={offline ? "You're offline" : "Couldn't load this title"}
          message={
            offline
              ? "Connect to the internet to load this title. Downloaded titles still play offline."
              : media.error || "This title could not be loaded."
          }
          onAction={media.retry}
        />
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
        <View className="overflow-hidden rounded-[18px] bg-surface">
          {detailRows.map((row, index) => (
            <View key={row.label} className={cn("flex-row items-start gap-3 px-4 py-3.5",
              index > 0 && "border-t border-border")}>
              <Text className="w-[76px] pt-[2px] font-archivo-medium text-[13px] text-muted">
                {row.label}
              </Text>
              <View className="flex-1 flex-row flex-wrap items-center gap-x-2 gap-y-1.5">
                {row.label === "Rating" ? <TitleRating rating={rating} /> : null}
                <Text className="shrink font-archivo-bold text-[15px] leading-[21px] text-foreground">
                  {row.value}
                </Text>
              </View>
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
          canOpen={() => true}
          loadImages={detailsVisible}
          onSelect={setPersonName}
        />
      )}
    </View>
  );

  const tabOptions: { key: DetailTab; label: string }[] = [
    ...(hasEpisodes
      ? [{ key: "episodes" as const, label: "Episodes" }]
      : []),
    ...(canRecommend
      ? [{ key: "more" as const, label: "More Like This" }]
      : []),
    ...(hasEpisodes || canRecommend || hasCollection
      ? [{ key: "details" as const, label: "Details" }]
      : []),
    ...(hasCollection
      ? [{ key: "collection" as const, label: "Collection" }]
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
  const tabIndex = Math.max(
    0,
    tabOptions.findIndex((tab) => tab.key === activeTab),
  );

  const episodesPage = (
    <View className="gap-[18px]">
      {seasonOptions.length > 0 ? (
        <SeasonPicker
          seasons={seasonPickerOptions}
          busy={seasonBusy}
          watched={selectedSeasonWatched}
          onMarkWatched={() => void markSeasonWatched()}
          value={selectedSeason ?? null}
          onChange={(number) => setSeason(number)}
          sort={episodeSort}
          onSortChange={setEpisodeSort}
        />
      ) : onlineEnabled && media.remoteLoading ? (
        <SeasonPickerSkeleton />
      ) : null}

      {selectedSeasonRemote.error && (
        <Notice message={selectedSeasonRemote.error} retry={selectedSeasonRemote.retry} />
      )}
      {onlineEnabled && remoteMediaType === "tv" && tmdbId != null &&
      selectedSeasonRemote.loading && !selectedSeasonRemote.value && !mergedSeasonEpisodes.length ? (
        <EpisodeListSkeleton count={5} />
      ) : (
        <SeasonEpisodes
          key={`${selectedSeason}:${episodeSort}`}
          api={api}
          episodes={sortedSeasonEpisodes}
          onlineBlocked={onlineBlocked}
          remoteMediaType={remoteMediaType}
          tmdbId={onlineEnabled ? tmdbId : null}
          play={guardedPlay}
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
          onDownload={(seasonNumber, episodeNumber, episodeTitle) =>
            openDownload(seasonNumber, episodeNumber, episodeTitle)
          }
          downloadStateFor={(seasonNumber, episodeNumber) =>
            downloadStateFor(seasonNumber, episodeNumber)
          }
          downloadProgressFor={(seasonNumber, episodeNumber) =>
            downloadProgressFor(seasonNumber, episodeNumber)
          }
        />
      )}
    </View>
  );
  const morePage = (
    <MoreLikeThis
      items={recommendations.items}
      api={api}
      loading={recommendations.loading || !recommendationsEnabled}
      error={recommendations.error}
      retry={recommendations.retry}
      onSelect={openRecommendation}
      onLongPress={longPressRecommendation}
    />
  );
  const collectionPage =
    collectionId != null ? (
      <MovieCollection
        collectionId={collectionId}
        api={api}
        onSelect={(title) => remoteNavigation.open(title)}
        onLongPress={(item, title) =>
          remoteActions(item, {
            play: () => remoteNavigation.play(title),
            onChanged: media.retry,
          })
        }
      />
    ) : null;
  const renderTabPage = (key: DetailTab) => {
    if (key === "episodes") return episodesPage;
    if (key === "more") return morePage;
    if (key === "collection") return collectionPage;
    return detailsPage;
  };
  const singlePage = tabOptions.length <= 1;

  const titleSecondaryActions = (
            <View className="flex-row gap-2">
              {detail.trailer?.provider?.toLowerCase() === "youtube" ? (
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
              ) : null}
              {!media.isOffline &&
              remoteMediaType === "movie" &&
              remoteDetail &&
              tmdbId != null ? (
                <DownloadButton
                  state={downloadStateFor(null, null)}
                  progress={downloadProgressFor(null, null)}
                  size={control.height}
                  onPress={() => openDownload(null, null)}
                />
              ) : null}
              {item?.source === "server" && item.fileId != null ? (
                <DownloadButton
                  state={serverDownloads.stateFor(item.fileId)}
                  progress={serverDownloads.progressFor(item.fileId)}
                  size={control.height}
                  accessibilityLabel="Download from Plexy Server"
                  onPress={() => void serverDownloads.toggle(item)}
                />
              ) : null}
              {seasonDownloadEpisodes.length > 0 ? (
                <DownloadButton
                  state={seasonDownloadState}
                  progress={seasonDownloadProgress}
                  size={control.height}
                  accessibilityLabel={`Download season ${selectedSeason ?? ""}`.trim()}
                  onPress={downloadSeason}
                />
              ) : null}
            </View>
  );
  return (
    <Animated.View entering={CONTENT_ENTER} className="flex-1 bg-background">
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
          {!!serverDownloads.error && <Notice message={serverDownloads.error} />}
          {playbackBlocked && <Notice message={playbackBlockedMessage} />}

          <TitleFactLine
            item={item}
            detail={detail}
            online={onlineEnabled}
            isOffline={media.isOffline}
          />

          {alternateSource && (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={
                alternateSource.source === "server"
                  ? "Open the Plexy Server copy"
                  : "Open the device copy"
              }
              onPress={() =>
                push({
                  pathname: "/item/[id]",
                  params: { id: alternateSource.publicId },
                })
              }
              className="self-center rounded-full border border-border bg-surface px-4 py-2 active:opacity-70"
            >
              <Text className="font-archivo-medium text-[12px] text-foreground">
                {alternateSource.source === "server"
                  ? "Also on Plexy Server · Open server copy"
                  : "Also on this device · Open device copy"}
              </Text>
            </Pressable>
          )}

          <View className="flex-row items-center justify-center gap-3">
            <TitleRating rating={rating} />
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={
                watchlisted
                  ? "Remove from Watch List"
                  : "Add to Watch List"
              }
              accessibilityState={{
                disabled: watchlistBusy,
                selected: watchlisted,
              }}
              disabled={watchlistBusy}
              onPress={() => {
                triggerHaptic("light");
                void toggleWatchlist();
              }}
              className={cn(
                "h-[38px] w-[38px] items-center justify-center rounded-full border active:opacity-70",
                watchlisted
                  ? "border-accent bg-accent"
                  : "border-border bg-surface",
                watchlistBusy && "opacity-40",
              )}
            >
              {watchlisted ? (
                <Minus size={17} color="#fff" strokeWidth={2.4} />
              ) : (
                <Plus size={17} color={colors.ink} strokeWidth={2.4} />
              )}
            </Pressable>
          </View>

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
                className="absolute inset-x-0 top-0 opacity-0"
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
                className="self-center py-1.5 active:opacity-70"
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
        play={guardedPlay}
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
          className="absolute right-5 z-[101] w-[236px] gap-2 rounded-2xl border border-border bg-surface-secondary p-3"
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
            icon={isSeriesWatched ? EyeOff : Eye}
            label={isSeriesWatched ? "Mark unwatched" : "Mark finished"}
            onPress={() => {
              void watched();
              setMenuOpen(false);
            }}
          />
          {!media.isOffline && remoteDetail && (
            <TitleMenuAction
              icon={remoteSaved ? Minus : Plus}
              label={remoteSaved ? "Remove from library" : "Add to library"}
              onPress={() => {
                toggleSaved();
                setMenuOpen(false);
              }}
            />
          )}
          {item && (media.isOffline || remoteSaved) ? (
            <TitleMenuAction icon={Plus} label="Add to collection" onPress={() => {
              setMenuOpen(false);
              addToCollection(item.publicId);
            }} />
          ) : null}
          {onlineEnabled && remoteMediaType && tmdbId != null ? (
            <TitleMenuAction
              icon={Globe}
              label={onlineBlocked ? "Online playback available" : "Online playback unavailable"}
              onPress={() => {
                setMenuOpen(false);
                setActionError("");
                void onlineUnavailable.set(
                  onlineUnavailableKey(remoteMediaType, tmdbId),
                  !onlineBlocked,
                );
              }}
            />
          ) : null}
          {item && (
            <TitleMenuAction
              destructive
              icon={EyeOff}
              label="Remove this title"
              onPress={() => {
                setMenuOpen(false);
                showDialog(
                  "Remove this title?",
                  "It will be hidden from Home, Search and Library. You can restore it later in Settings → Hidden titles.",
                  [
                    {
                      text: "Remove",
                      style: "destructive",
                      onPress: () => {
                        void hideTitle(item)
                          .then(back)
                          .catch((e) => setActionError(String(e)));
                      },
                    },
                  ],
                );
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
              <Eye size={18} color="#fff" strokeWidth={2.6} />
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
      ) : playbackBlocked ? (
        <View
          className="absolute bottom-0 left-0 right-0 border-t border-t-border bg-background px-5 pt-4"
          style={{ paddingBottom: Math.max(insets.bottom, 14) }}
        >
          <View className="flex-row items-center gap-3 rounded-2xl bg-surface px-4 py-3">
            <EyeOff size={20} color={colors.muted} />
            <Text className="flex-1 font-archivo-regular text-[13px] leading-[19px] text-muted">
              {playbackBlockedMessage}
            </Text>
          </View>
        </View>
      ) : onlineBlocked && hybridDisabled ? (
        <View
          className="absolute bottom-0 left-0 right-0 flex-row items-center gap-3 border-t border-t-border bg-background px-5 pt-3"
          style={{ paddingBottom: Math.max(insets.bottom, 14) }}
        >
          <View
            className="flex-1 flex-row items-center gap-3 rounded-full bg-surface px-4"
            style={{ minHeight: control.height }}
          >
            <Globe size={18} color={colors.muted} />
            <Text className="flex-1 font-archivo-medium text-[13px] text-muted" numberOfLines={2}>
              Online playback unavailable
            </Text>
          </View>
          {titleSecondaryActions}
        </View>
      ) : (
        <TitleActionBar
          label={hybridLabel}
          accessibilityLabel={hybridLabel}
          disabled={hybridDisabled}
          onPress={playHybrid}
          secondary={titleSecondaryActions}
        />
      )}

      <AccountSheet
        key={downloadAccountOpen ? "download-account-open" : "download-account-closed"}
        visible={downloadAccountOpen}
        onClose={() => {
          setDownloadAccountOpen(false);
          pendingDownload.current = null;
        }}
      />
      <QualitySheet
        key={
          downloadTarget
            ? `${downloadTarget.ref.mediaType}:${downloadTarget.ref.tmdbId}:${downloadTarget.ref.season ?? 0}:${downloadTarget.ref.episode ?? 0}`
            : "quality-closed"
        }
        visible={Boolean(downloadTarget)}
        target={downloadTarget}
        onClose={() => setDownloadTarget(null)}
        onAccount={() => {
          movy.clearError();
          setDownloadTarget(null);
          setDownloadAccountOpen(true);
        }}
      />
    </Animated.View>
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
  onDownload,
  downloadStateFor,
  downloadProgressFor,
  onlineBlocked = false,
}: {
  onlineBlocked?: boolean;
  episodes: HybridEpisode[];
  api: LocalCatalog;
  play: (fileId: number) => void;
  progress: ProgressSink;
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
  onDownload: (
    season: number,
    episode: number,
    episodeTitle?: string | null,
  ) => void;
  downloadStateFor: (
    season: number,
    episode: number,
  ) => DownloadButtonState;
  downloadProgressFor: (season: number, episode: number) => number;
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
              selecting
                ? !selectable
                : !local?.fileId && (!episode.remote || onlineBlocked)
            }
            onPress={() => {
              if (selecting) {
                if (local) onToggleSelected(local);
                return;
              }
              if (local?.fileId) play(local.fileId);
              else if (episode.remote && !onlineBlocked)
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
            downloadState={
              episode.remote
                ? downloadStateFor(episode.seasonNumber, episode.number)
                : undefined
            }
            downloadProgress={
              episode.remote
                ? downloadProgressFor(episode.seasonNumber, episode.number)
                : 0
            }
            onDownload={
              episode.remote
                ? () =>
                    onDownload(
                      episode.seasonNumber,
                      episode.number,
                      episode.title,
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
