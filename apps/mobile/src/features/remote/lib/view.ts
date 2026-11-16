import type { ItemCard, Watch } from "@/core/library/catalog-api";
import type { RemoteMediaType, RemoteTitle } from "./tmdb";

/**
 * The local screens render `ItemCard`s. Online titles are mapped into the
 * same shape so both catalogs use the exact same hero, cards and rows instead
 * of maintaining a parallel set of components.
 */
export function remotePublicId(mediaType: RemoteMediaType, tmdbId: number) {
  return `remote:${mediaType}:${tmdbId}`;
}

export function parseRemotePublicId(
  publicId: string,
): { mediaType: RemoteMediaType; tmdbId: number } | null {
  const match = /^remote:(movie|tv):(\d+)$/.exec(publicId);
  if (!match) return null;
  const tmdbId = Number(match[2]);
  if (!Number.isSafeInteger(tmdbId) || tmdbId <= 0) return null;
  return { mediaType: match[1] as RemoteMediaType, tmdbId };
}

export function toItemCard(
  title: RemoteTitle,
  runtime?: number | null,
  watch?: Watch | null,
): ItemCard {
  return {
    // TMDB ids are shared across movies and series; the mapping keeps a
    // stable unique number for card keys inside a mixed row.
    id: title.tmdbId * 2 + (title.mediaType === "tv" ? 1 : 0),
    publicId: remotePublicId(title.mediaType, title.tmdbId),
    kind: title.mediaType === "tv" ? "series" : "movie",
    name: title.title,
    year: title.year,
    seasonNumber: null,
    episodeNumber: null,
    fileId: null,
    parentId: null,
    parentPublicId: null,
    parentTitle: null,
    poster: title.poster,
    backdrop: title.backdrop,
    overview: title.overview || null,
    rating: title.rating,
    runtime: runtime ?? null,
    genres: title.genres,
    tmdbId: title.tmdbId,
    matchStatus: "matched",
    watch: watch ?? null,
  };
}

export function titleIndex(titles: RemoteTitle[]) {
  const map = new Map<string, RemoteTitle>();
  for (const title of titles) {
    map.set(remotePublicId(title.mediaType, title.tmdbId), title);
  }
  return map;
}
