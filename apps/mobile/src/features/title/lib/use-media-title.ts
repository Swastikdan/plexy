import { useMemo } from "react";
import type {
  ItemCard,
  LocalCatalog,
  TitleDetail,
} from "@/core/library/catalog-api";
import { useResource } from "@/core/resources/use-resource";
import { fetchDetail, type RemoteDetail, type RemoteMediaType } from "@/features/remote/lib/tmdb";
import { toItemCard } from "@/features/remote/lib/view";

export type MediaTitleInput =
  | { source: "local"; id: string | number }
  | {
      source: "remote";
      mediaType: RemoteMediaType;
      tmdbId: number;
      fallbackName?: string;
    };

export interface MediaTitle {
  /** Normalized detail for either source. Offline-only fields are null online. */
  detail: TitleDetail | null;
  remoteDetail: RemoteDetail | null;
  item: ItemCard | null;
  mediaType: RemoteMediaType | null;
  tmdbId: number | null;
  isOffline: boolean;
  /** A downloaded copy exists, so this page will render the offline view. */
  hasLocalCopy: boolean;
  loading: boolean;
  remoteLoading: boolean;
  error: string | null;
  retry: () => void;
}

function remoteDetailToTitleDetail(
  remote: RemoteDetail,
  fallbackName?: string,
): TitleDetail {
  const card = toItemCard(remote, remote.runtime);
  const item: ItemCard = {
    ...card,
    name:
      card.name === "Untitled" && fallbackName ? fallbackName : card.name,
    logo: remote.logo,
  };
  return {
    item,
    logo: remote.logo,
    metadata: {
      overview: remote.overview || null,
      tagline: remote.tagline,
      runtime: remote.runtime,
      rating: remote.rating,
      certification: null,
      genres: remote.genres,
    },
    cast: remote.cast.map((member, index) => ({
      id: index,
      name: member.name,
      character: member.character,
      photo: member.photo,
    })),
    trailer: remote.trailer,
    seasons: remote.seasons.map((season, index) => ({
      id: index,
      number: season.number,
      name: season.name,
      poster: season.poster,
    })),
    episodes: [],
    file: null,
    tmdbType: remote.mediaType,
    unmatched: false,
    matchReason: null,
  };
}

/**
 * Resolves local and online title inputs into one shape. A downloaded copy
 * always wins, so every screen renders the offline title page when it exists.
 */
export function useMediaTitle(
  input: MediaTitleInput,
  api: LocalCatalog,
  onlineEnabled: boolean,
): MediaTitle {
  const localId = input.source === "local" ? input.id : null;
  const remoteInput = input.source === "remote" ? input : null;
  const fallbackName = remoteInput?.fallbackName;
  const inputMediaType = remoteInput?.mediaType;
  const inputTmdbId = remoteInput?.tmdbId;
  const localMatch = useMemo(() => {
    if (!inputMediaType || inputTmdbId == null) return null;
    return (
      api
        .titlesByTmdb()
        .get(`${inputMediaType}:${inputTmdbId}`) ?? null
    );
  }, [api, inputMediaType, inputTmdbId]);

  const direct = useResource(
    (signal) =>
      localId != null
        ? api.detail(localId, signal)
        : Promise.resolve(null),
    [api, localId],
    "media-title-direct",
  );
  const matched = useResource(
    (signal) =>
      localId == null && localMatch
        ? api.detail(localMatch.publicId, signal)
        : Promise.resolve(null),
    [api, localMatch?.publicId],
    "media-title-match",
  );

  const localDetail = direct.value ?? matched.value ?? null;
  const localMediaType: RemoteMediaType | null = localDetail
    ? localDetail.tmdbType === "tv" || localDetail.item.kind === "series"
      ? "tv"
      : "movie"
    : null;
  const tmdbId = localDetail?.item.tmdbId ?? remoteInput?.tmdbId ?? null;
  const mediaType = localMediaType ?? remoteInput?.mediaType ?? null;
  // Local titles with a TMDB match still fetch remote detail so the season
  // list and episode counts can use the full catalog instead of only what is
  // downloaded on this device. A failure never blocks the local detail.
  const remoteEnabled =
    (onlineEnabled || input.source === "local") &&
    tmdbId != null &&
    mediaType != null;

  const remote = useResource(
    (signal) =>
      remoteEnabled && tmdbId != null && mediaType != null
        ? fetchDetail(mediaType, tmdbId, signal)
        : Promise.resolve(null),
    [remoteEnabled, mediaType, tmdbId],
    "media-title-remote",
  );

  const localPending =
    localId != null
      ? direct.loading && !direct.value
      : Boolean(localMatch) && matched.loading && !matched.value;
  const loading = localDetail
    ? false
    : remoteInput
      ? localPending || (remote.loading && !remote.value && !localMatch)
      : localPending;
  const error = localDetail
    ? null
    : remoteInput
      ? (localMatch ? matched.error : null) ??
        remote.error ??
        (localMatch ? null : direct.error)
      : direct.error ?? matched.error;

  const detail = useMemo(() => {
    if (localDetail) return localDetail;
    return remote.value
      ? remoteDetailToTitleDetail(remote.value, fallbackName)
      : null;
  }, [fallbackName, localDetail, remote.value]);

  return {
    detail,
    remoteDetail: remote.value,
    item: detail?.item ?? null,
    mediaType,
    tmdbId,
    isOffline: Boolean(localDetail),
    hasLocalCopy: localId != null || Boolean(localMatch),
    loading,
    remoteLoading: remote.loading,
    error,
    retry: () => {
      direct.retry();
      matched.retry();
      remote.retry();
    },
  };
}
