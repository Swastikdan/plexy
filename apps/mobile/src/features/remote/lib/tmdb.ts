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
  { key: "trending-day", title: "Trending today", path: "/trending/all/day" },
  { key: "movies-popular", title: "Popular movies", path: "/movie/popular" },
  { key: "tv-popular", title: "Popular series", path: "/tv/popular" },
  { key: "movies-top", title: "Top rated movies", path: "/movie/top_rated" },
  { key: "tv-top", title: "Top rated series", path: "/tv/top_rated" },
  { key: "movies-upcoming", title: "Coming soon", path: "/movie/upcoming" },
  { key: "tv-airing", title: "Airing now", path: "/tv/on_the_air" },
] as const;

export interface RemoteHome {
  featured: RemoteTitle | null;
  rows: { key: string; title: string; items: RemoteTitle[] }[];
}

export async function fetchHome(signal?: AbortSignal): Promise<RemoteHome> {
  const replies = await Promise.all(
    HOME_ROWS.map(async (row) => {
      const fallbackType: RemoteMediaType = row.path.startsWith("/tv") ? "tv" : "movie";
      try {
        const body = await get<{ results?: TmdbMedia[] }>(row.path, signal);
        return {
          key: row.key,
          title: row.title,
          items: (body.results ?? [])
            .filter((media) => media.media_type !== "person")
            .map((media) => toTitle(media, fallbackType)),
        };
      } catch {
        return { key: row.key, title: row.title, items: [] as RemoteTitle[] };
      }
    }),
  );
  const trending = replies.find((row) => row.key === "trending-day")?.items ?? [];
  return {
    featured: trending.find((item) => item.backdrop) ?? null,
    rows: replies.filter((row) => row.items.length > 0),
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
}

export async function fetchDetail(
  mediaType: RemoteMediaType,
  tmdbId: number,
  signal?: AbortSignal,
): Promise<RemoteDetail> {
  const body = await get<TmdbDetail>(
    `/${mediaType}/${tmdbId}?append_to_response=external_ids,credits`,
    signal,
  );
  const base = toTitle(body, mediaType);
  return {
    ...base,
    imdbId: body.external_ids?.imdb_id ?? null,
    tagline: body.tagline?.trim() || null,
    runtime: body.runtime ?? body.episode_run_time?.[0] ?? null,
    status: body.status ?? null,
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
}

export async function fetchSeason(
  tmdbId: number,
  season: number,
  signal?: AbortSignal,
): Promise<RemoteEpisode[]> {
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
  return (body.episodes ?? []).map((episode) => ({
    number: episode.episode_number,
    season: episode.season_number,
    title: episode.name ?? `Episode ${episode.episode_number}`,
    overview: episode.overview ?? "",
    still: posterUrl(episode.still_path, "w300"),
    runtime: episode.runtime ?? null,
    airDate: episode.air_date ?? null,
  }));
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
