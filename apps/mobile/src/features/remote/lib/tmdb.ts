/// TMDB catalog for the online source.
///
/// The mobile app already has a TMDB token (bundled via `app.config.ts`), so
/// this talks to TMDB directly — no Plexy server and no proxy in the middle.
/// Responses are cached in memory for ten minutes; refreshes are explicit.

import Constants from "expo-constants";
import * as SecureStore from "expo-secure-store";

const BASE = "https://api.themoviedb.org/3";
const IMAGE = "https://image.tmdb.org/t/p";
const TOKEN_KEY = "plexy.local.tmdb-token";
const CACHE_MS = 10 * 60_000;

export type RemoteMediaType = "movie" | "tv";

export interface RemoteTitle {
  tmdbId: number;
  mediaType: RemoteMediaType;
  title: string;
  year: number | null;
  poster: string | null;
  backdrop: string | null;
  overview: string;
  rating: number | null;
  genres: string[];
  imdbId?: string | null;
}

export interface RemoteSeason {
  number: number;
  name: string;
  episodes: number;
  poster: string | null;
}

export interface RemoteEpisode {
  number: number;
  season: number;
  title: string;
  overview: string;
  still: string | null;
  runtime: number | null;
  airDate: string | null;
}

export interface RemoteDetail extends RemoteTitle {
  tagline: string | null;
  runtime: number | null;
  status: string | null;
  logo: string | null;
  trailer: { provider: string; key: string; name: string } | null;
  seasons: RemoteSeason[];
  cast: { name: string; character: string | null; photo: string | null }[];
}

export class CatalogError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CatalogError";
  }
}

let resolvedToken: string | null = null;

async function token(): Promise<string> {
  if (resolvedToken) return resolvedToken;
  const bundled =
    (Constants.expoConfig?.extra?.tmdbToken as string | undefined) ||
    process.env.EXPO_PUBLIC_TMDB_TOKEN ||
    process.env.EXPO_PUBLIC_TMDB_ACCESS_TOKEN;
  const stored = await SecureStore.getItemAsync(TOKEN_KEY).catch(() => null);
  const value = bundled || stored || "";
  if (!value) throw new CatalogError("This build has no TMDB configuration.");
  resolvedToken = value;
  return value;
}

const cache = new Map<string, { at: number; value: unknown }>();
const detailCache = new Map<string, RemoteDetail>();
const seasonCache = new Map<string, RemoteEpisode[]>();
const detailRequests = new Map<string, Promise<RemoteDetail>>();
const seasonRequests = new Map<string, Promise<RemoteEpisode[]>>();
const DETAIL_LIMIT = 48;
const SEASON_LIMIT = 32;

/** A prefetched detail already mapped to the UI shape, for a synchronous first frame. */
export function peekDetail(mediaType: RemoteMediaType, tmdbId: number) {
  return detailCache.get(`${mediaType}:${tmdbId}`) ?? null;
}

export function peekSeason(tmdbId: number, season: number) {
  return seasonCache.get(`${tmdbId}:${season}`) ?? null;
}

function rememberDetail(mediaType: RemoteMediaType, tmdbId: number, detail: RemoteDetail) {
  const key = `${mediaType}:${tmdbId}`;
  detailCache.delete(key);
  detailCache.set(key, detail);
  if (detailCache.size > DETAIL_LIMIT)
    detailCache.delete(detailCache.keys().next().value!);
}

function rememberSeason(tmdbId: number, season: number, episodes: RemoteEpisode[]) {
  const key = `${tmdbId}:${season}`;
  seasonCache.delete(key);
  seasonCache.set(key, episodes);
  if (seasonCache.size > SEASON_LIMIT)
    seasonCache.delete(seasonCache.keys().next().value!);
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function get<T>(path: string, signal?: AbortSignal, attempts = 2): Promise<T> {
  const cached = cache.get(path);
  if (cached && Date.now() - cached.at < CACHE_MS) return cached.value as T;

  let lastError: unknown = null;
  for (let attempt = 0; attempt <= attempts; attempt += 1) {
    if (attempt > 0) await sleep(300 * 2 ** (attempt - 1));
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 12_000);
    const forward = () => controller.abort();
    signal?.addEventListener("abort", forward, { once: true });
    try {
      const response = await fetch(`${BASE}${path}`, {
        signal: controller.signal,
        headers: {
          accept: "application/json",
          authorization: `Bearer ${await token()}`,
        },
      });
      if (response.status === 404) throw new CatalogError("This title is not available.");
      if (!response.ok) {
        lastError = new CatalogError(`TMDB returned ${response.status}.`);
        if (response.status >= 500 && attempt < attempts) continue;
        throw lastError;
      }
      const body = (await response.json()) as T;
      cache.set(path, { at: Date.now(), value: body });
      if (cache.size > 48) cache.delete(cache.keys().next().value!);
      return body;
    } catch (error) {
      if (signal?.aborted) throw new CatalogError("Cancelled.");
      lastError = error;
      if (attempt >= attempts) break;
    } finally {
      clearTimeout(timer);
      signal?.removeEventListener("abort", forward);
    }
  }
  throw lastError instanceof Error ? lastError : new CatalogError("TMDB is unreachable.");
}

export function clearCatalogCache() {
  cache.clear();
  detailCache.clear();
  seasonCache.clear();
}

// --- mapping -----------------------------------------------------------------

interface TmdbMedia {
  id: number;
  title?: string;
  name?: string;
  original_title?: string;
  original_name?: string;
  release_date?: string;
  first_air_date?: string;
  poster_path?: string | null;
  backdrop_path?: string | null;
  overview?: string;
  vote_average?: number;
  media_type?: string;
  genre_ids?: number[];
  genres?: { id: number; name: string }[];
}

export function posterUrl(path: string | null | undefined, size = "w342") {
  return path ? `${IMAGE}/${size}${path}` : null;
}

function yearOf(date: string | undefined) {
  const year = Number(String(date ?? "").slice(0, 4));
  return Number.isFinite(year) && year > 1800 ? year : null;
}

function toTitle(media: TmdbMedia, fallbackType: RemoteMediaType): RemoteTitle {
  const mediaType: RemoteMediaType =
    media.media_type === "tv" || media.media_type === "movie"
      ? media.media_type
      : fallbackType;
  return {
    tmdbId: media.id,
    mediaType,
    title: media.title || media.name || media.original_title || media.original_name || "Untitled",
    year: yearOf(media.release_date ?? media.first_air_date),
    poster: posterUrl(media.poster_path),
    backdrop: posterUrl(media.backdrop_path, "w1280"),
    overview: media.overview ?? "",
    rating:
      typeof media.vote_average === "number" && media.vote_average > 0
        ? Math.round(media.vote_average * 10) / 10
        : null,
    genres: media.genres?.map((genre) => genre.name) ?? [],
  };
}

// --- rows --------------------------------------------------------------------

export const HOME_ROWS = [
  {
    key: "trending-day",
    title: "Trending today",
    paths: ["/trending/all/day"],
  },
  {
    key: "popular",
    title: "Popular",
    paths: ["/movie/popular", "/tv/popular"],
  },
  {
    key: "top-rated",
    title: "Top rated",
    paths: ["/movie/top_rated", "/tv/top_rated"],
  },
  {
    key: "coming-soon",
    title: "Coming soon",
    paths: ["/movie/upcoming"],
  },
  {
    key: "airing-now",
    title: "Airing now",
    paths: ["/tv/on_the_air"],
  },
] as const;

export interface RemoteHome {
  featured: RemoteTitle | null;
  rows: { key: string; title: string; items: RemoteTitle[] }[];
}

/** Mix two TMDB lists so one shelf shows movies and series evenly. */
function interleave<T>(lists: T[][]): T[] {
  const merged: T[] = [];
  const longest = Math.max(0, ...lists.map((list) => list.length));
  for (let index = 0; index < longest; index += 1) {
    for (const list of lists) {
      const item = list[index];
      if (item != null) merged.push(item);
    }
  }
  return merged;
}

export async function fetchHome(signal?: AbortSignal): Promise<RemoteHome> {
  let failures = 0;
  let lastError: unknown = null;
  const replies = await Promise.all(
    HOME_ROWS.map(async (row) => {
      const lists = await Promise.all(
        row.paths.map(async (path) => {
          const fallbackType: RemoteMediaType = path.startsWith("/tv")
            ? "tv"
            : "movie";
          try {
            const body = await get<{ results?: TmdbMedia[] }>(path, signal);
            return (body.results ?? [])
              .filter((media) => media.media_type !== "person")
              .map((media) => toTitle(media, fallbackType));
          } catch (error) {
            failures += 1;
            lastError = error;
            return [] as RemoteTitle[];
          }
        }),
      );
      return {
        key: row.key,
        title: row.title,
        items: interleave(lists),
      };
    }),
  );
  const trending = replies.find((row) => row.key === "trending-day")?.items ?? [];
  const rows = replies.filter((row) => row.items.length > 0);
  // Every request failed (offline, expired token, TMDB outage). Surface the
  // error so Home can render a real offline/error page instead of an empty
  // "start here" shelf.
  if (!rows.length && failures > 0) {
    throw lastError instanceof Error
      ? lastError
      : new CatalogError("Could not load online titles.");
  }
  return {
    featured: trending.find((item) => item.backdrop) ?? null,
    rows,
  };
}

export async function searchTitles(query: string, signal?: AbortSignal): Promise<RemoteTitle[]> {
  const trimmed = query.trim();
  if (!trimmed) return [];
  const body = await get<{ results?: TmdbMedia[] }>(
    `/search/multi?query=${encodeURIComponent(trimmed)}&include_adult=false`,
    signal,
  );
  return (body.results ?? [])
    .filter((media) => media.media_type === "movie" || media.media_type === "tv")
    .map((media) => toTitle(media, media.media_type === "tv" ? "tv" : "movie"));
}

// --- detail ------------------------------------------------------------------

interface TmdbDetail extends TmdbMedia {
  tagline?: string;
  runtime?: number;
  episode_run_time?: number[];
  status?: string;
  external_ids?: { imdb_id?: string | null };
  seasons?: { season_number: number; name?: string; episode_count?: number; poster_path?: string | null }[];
  credits?: { cast?: { name: string; character?: string; profile_path?: string | null }[] };
  videos?: {
    results?: {
      site?: string;
      key?: string;
      name?: string;
      type?: string;
      official?: boolean;
      iso_639_1?: string;
    }[];
  };
  images?: {
    logos?: {
      file_path?: string | null;
      iso_639_1?: string | null;
      vote_average?: number;
    }[];
  };
}

function pickTrailer(
  videos: TmdbDetail["videos"],
): RemoteDetail["trailer"] {
  const results = (videos?.results ?? []).filter(
    (video) => video.site === "YouTube" && video.key,
  );
  const ranked = [...results].sort((a, b) => {
    const score = (video: NonNullable<typeof results>[number]) =>
      (video.type === "Trailer" ? 4 : video.type === "Teaser" ? 2 : 0) +
      (video.official ? 2 : 0) +
      (video.iso_639_1 === "en" ? 1 : 0);
    return score(b) - score(a);
  });
  const best = ranked[0];
  return best?.key
    ? {
        provider: best.site ?? "YouTube",
        key: best.key,
        name: best.name || "Trailer",
      }
    : null;
}

function pickLogo(images: TmdbDetail["images"]): string | null {
  const logos = (images?.logos ?? []).filter(
    (logo) => logo.file_path && /\.(png|svg|webp)$/i.test(logo.file_path),
  );
  const ranked = [...logos].sort((a, b) => {
    const score = (logo: NonNullable<typeof logos>[number]) =>
      (logo.iso_639_1 === "en" ? 2 : logo.iso_639_1 == null ? 1 : 0) +
      (logo.vote_average ?? 0) / 10;
    return score(b) - score(a);
  });
  return posterUrl(ranked[0]?.file_path, "w500");
}

export async function fetchDetail(
  mediaType: RemoteMediaType,
  tmdbId: number,
  signal?: AbortSignal,
): Promise<RemoteDetail> {
  // A card prefetch can overlap the tap that opens its page. Share the request
  // so the page waits on one round trip instead of starting a second one.
  const requestKey = `${mediaType}:${tmdbId}`;
  const pending = detailRequests.get(requestKey);
  if (pending) return pending;
  const request = (async () => {
    const body = await get<TmdbDetail>(
      `/${mediaType}/${tmdbId}?append_to_response=external_ids,credits,videos,images&include_image_language=en,null`,
      signal,
    );
    const base = toTitle(body, mediaType);
    const detail: RemoteDetail = {
      ...base,
      imdbId: body.external_ids?.imdb_id ?? null,
      tagline: body.tagline?.trim() || null,
      runtime: body.runtime ?? body.episode_run_time?.[0] ?? null,
      status: body.status ?? null,
      logo: pickLogo(body.images),
      trailer: pickTrailer(body.videos),
      seasons: (body.seasons ?? [])
        .filter((season) => season.season_number > 0)
        .map((season) => ({
          number: season.season_number,
          name: season.name ?? `Season ${season.season_number}`,
          episodes: season.episode_count ?? 0,
          poster: posterUrl(season.poster_path),
        })),
      cast: (body.credits?.cast ?? []).slice(0, 12).map((member) => ({
        name: member.name,
        character: member.character ?? null,
        photo: posterUrl(member.profile_path, "w185"),
      })),
    };
    rememberDetail(mediaType, tmdbId, detail);
    return detail;
  })();
  detailRequests.set(requestKey, request);
  request
    .catch(() => {})
    .finally(() => detailRequests.delete(requestKey));
  return request;
}

export async function fetchSeason(
  tmdbId: number,
  season: number,
  signal?: AbortSignal,
): Promise<RemoteEpisode[]> {
  // The title header and the season page both ask for the same season in the
  // same commit. Share that request instead of spending two network round trips.
  const requestKey = `${tmdbId}:${season}`;
  const pending = seasonRequests.get(requestKey);
  if (pending) return pending;
  const request = (async () => {
    const body = await get<{
      episodes?: {
        episode_number: number;
        season_number: number;
        name?: string;
        overview?: string;
        still_path?: string | null;
        runtime?: number | null;
        air_date?: string | null;
      }[];
    }>(`/tv/${tmdbId}/season/${season}`, signal);
    const episodes = (body.episodes ?? []).map((episode) => ({
      number: episode.episode_number,
      season: episode.season_number,
      title: episode.name ?? `Episode ${episode.episode_number}`,
      overview: episode.overview ?? "",
      still: posterUrl(episode.still_path, "w300"),
      runtime: episode.runtime ?? null,
      airDate: episode.air_date ?? null,
    }));
    rememberSeason(tmdbId, season, episodes);
    return episodes;
  })();
  seasonRequests.set(requestKey, request);
  request
    .catch(() => {})
    .finally(() => seasonRequests.delete(requestKey));
  return request;
}

export async function fetchRecommendations(
  mediaType: RemoteMediaType,
  tmdbId: number,
  signal?: AbortSignal,
): Promise<RemoteTitle[]> {
  const body = await get<{ results?: TmdbMedia[] }>(
    `/${mediaType}/${tmdbId}/recommendations`,
    signal,
  );
  const seen = new Set<number>();
  const titles: RemoteTitle[] = [];
  for (const media of body.results ?? []) {
    if (media.media_type === "person") continue;
    const title = toTitle(media, mediaType);
    if (seen.has(title.tmdbId)) continue;
    seen.add(title.tmdbId);
    titles.push(title);
  }
  return titles;
}
