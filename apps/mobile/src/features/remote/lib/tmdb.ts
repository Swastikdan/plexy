/// TMDB catalog for the online source.
///
/// The mobile app already has a TMDB token (bundled via `app.config.ts`), so
/// this talks to TMDB directly — no Plexy server and no proxy in the middle.
/// Mapped responses are cached in SQLite (`plexy-remote.db`) and mirrored in
/// memory, so screens open from disk and refresh quietly in the background.
/// Home is the only screen that refreshes on open.

import Constants from "expo-constants";
import * as SecureStore from "expo-secure-store";
import {
  familyAllows,
  familyCertificateList,
} from "@/core/content/audience";
import { isReleased } from "@/core/content/release";
import { readRemoteCache, writeRemoteCache } from "./remote-cache";

const BASE = "https://api.themoviedb.org/3";
const IMAGE = "https://image.tmdb.org/t/p";
const TOKEN_KEY = "plexy.local.tmdb-token";
const CACHE_MS = 10 * 60_000;
/** Revalidate a cached title/season only when it is this old. */
const BACKGROUND_REFRESH_MS = 10 * 60_000;

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
  /** TMDB release date (movies) or first-air date (TV). */
  releaseDate?: string | null;
  /** Age rating for the selected region, when a detail response resolved it. */
  certification?: string | null;
  /** The TMDB movie collection this title belongs to, when known. */
  collection?: { id: number; name: string } | null;
}

/** Region and maturity settings used to filter the online catalog. */
export interface RemoteCatalogOptions {
  maxAge?: number | null;
  blockUnrated?: boolean;
  region?: string;
}

export function remoteCatalogOptions(options: RemoteCatalogOptions = {}) {
  return {
    maxAge: options.maxAge ?? null,
    blockUnrated: options.blockUnrated ?? true,
    region: (options.region || "US").toUpperCase(),
  };
}

export function remoteOptionsKey(options: RemoteCatalogOptions = {}) {
  const value = remoteCatalogOptions(options);
  // Keep the pre-existing cache slot for the unrestricted catalog so a cold
  // launch still paints the last saved rows. Family shelves get their own key.
  if (value.maxAge == null) return "latest";
  return `family:${value.maxAge}:${value.blockUnrated ? "rated" : "all"}:${value.region}`;
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
  /** The TMDB movie collection this title belongs to, when there is one. */
  collection: { id: number; name: string } | null;
  /** Every regional certificate TMDB returned, keyed by ISO country code. */
  certifications: Record<string, string>;
}

export interface RemoteCollection {
  id: number;
  name: string;
  overview: string;
  poster: string | null;
  backdrop: string | null;
  parts: RemoteTitle[];
}

/** Pick the certificate for a region, falling back to the US rating. */
export function certificationFor(
  title: Pick<RemoteTitle, "certification"> & {
    certifications?: Record<string, string>;
  },
  region = "US",
) {
  const code = (region || "US").toUpperCase();
  return (
    title.certifications?.[code] ??
    title.certifications?.US ??
    title.certification ??
    null
  );
}

export function remoteAllowed(
  title: Pick<RemoteTitle, "releaseDate" | "certification"> & {
    certifications?: Record<string, string>;
  },
  options: RemoteCatalogOptions = {},
) {
  const value = remoteCatalogOptions(options);
  if (!isReleased(title.releaseDate)) return false;
  if (value.maxAge == null) return true;
  return familyAllows(
    certificationFor(title, value.region),
    value.maxAge <= 7 ? "little" : value.maxAge <= 10 ? "older" : "teen",
    value.blockUnrated,
  );
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
const recommendationCache = new Map<string, RemoteTitle[]>();
const collectionCache = new Map<number, RemoteCollection>();
const detailRequests = new Map<string, Promise<RemoteDetail>>();
const seasonRequests = new Map<string, Promise<RemoteEpisode[]>>();
const detailStamps = new Map<string, number>();
const seasonStamps = new Map<string, number>();
const recommendationStamps = new Map<string, number>();
const collectionStamps = new Map<string, number>();
const detailRefreshes = new Set<string>();
const seasonRefreshes = new Set<string>();
const recommendationRefreshes = new Set<string>();
const collectionRefreshes = new Set<string>();
let homeCache: { key: string; value: RemoteHome } | null = null;
const DETAIL_LIMIT = 48;
const SEASON_LIMIT = 32;

/** A prefetched detail already mapped to the UI shape, for a synchronous first frame. */
export function peekDetail(mediaType: RemoteMediaType, tmdbId: number) {
  return detailCache.get(`${mediaType}:${tmdbId}`) ?? null;
}

export function peekSeason(tmdbId: number, season: number) {
  return seasonCache.get(`${tmdbId}:${season}`) ?? null;
}

export function peekHome(key = "latest") {
  return homeCache?.key === key ? homeCache.value : null;
}

export function peekCollection(collectionId: number) {
  return collectionCache.get(collectionId) ?? null;
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

/** True when a background refresh is worth spending a TMDB request on. */
function stale(stamps: Map<string, number>, key: string) {
  const stamp = stamps.get(key);
  return stamp == null || Date.now() - stamp >= BACKGROUND_REFRESH_MS;
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
  recommendationCache.clear();
  collectionCache.clear();
  detailStamps.clear();
  seasonStamps.clear();
  recommendationStamps.clear();
  collectionStamps.clear();
  detailRefreshes.clear();
  seasonRefreshes.clear();
  recommendationRefreshes.clear();
  collectionRefreshes.clear();
  homeCache = null;
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
  /** TMDB's explicit adult flag. Kept out of the family catalog. */
  adult?: boolean;
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
    releaseDate: media.release_date ?? media.first_air_date ?? null,
    certification: null,
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
    key: "airing-now",
    title: "Airing now",
    paths: ["/tv/on_the_air"],
  },
] as const;

function isoDay(now = new Date()) {
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
}

/**
 * TMDB's list endpoints have no maturity filter. In family mode the shelves
 * switch to Discover, where every result is restricted to the selected rating
 * system before it reaches the device.
 */
function familyHomeRows(options: RemoteCatalogOptions) {
  const value = remoteCatalogOptions(options);
  const maxAge = value.maxAge ?? 14;
  const movie = familyCertificateList(value.region, maxAge, false);
  // TMDB has TV content ratings for only a few regions. Everywhere else the
  // US TV labels are the only useful filter; Indian TV uses the Indian bands.
  const tvRegion = value.region === "IN" ? "IN" : "US";
  const tv = familyCertificateList(tvRegion, maxAge, true);
  const common = (country: string, certificates: string) =>
    new URLSearchParams({
      include_adult: "false",
      certification_country: country,
      certification: certificates,
    }).toString();
  const movieBase = common(value.region, movie);
  const tvBase = common(tvRegion, tv);
  const today = isoDay();
  const discover = (path: string, params: string, extra = "") =>
    `${path}?${params}${extra}`;
  return [
    {
      key: "popular",
      title: "Popular",
      paths: [
        discover("/discover/movie", movieBase, `&sort_by=popularity.desc&release_date.lte=${today}`),
        discover("/discover/tv", tvBase, `&sort_by=popularity.desc&first_air_date.lte=${today}`),
      ],
    },
    {
      key: "family-picks",
      title: "Family picks",
      paths: [
        discover("/discover/movie", movieBase, `&sort_by=popularity.desc&with_genres=10751&release_date.lte=${today}`),
        discover("/discover/tv", tvBase, `&sort_by=popularity.desc&with_genres=10751&first_air_date.lte=${today}`),
      ],
    },
    {
      key: "top-rated",
      title: "Top rated",
      paths: [
        discover("/discover/movie", movieBase, `&sort_by=vote_average.desc&vote_count.gte=300&release_date.lte=${today}`),
        discover("/discover/tv", tvBase, `&sort_by=vote_average.desc&vote_count.gte=100&first_air_date.lte=${today}`),
      ],
    },
  ];
}

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

export async function fetchHome(
  signal?: AbortSignal,
  options: RemoteCatalogOptions = {},
): Promise<RemoteHome> {
  const value = remoteCatalogOptions(options);
  const rowsDefinition =
    value.maxAge != null ? familyHomeRows(value) : HOME_ROWS;
  let failures = 0;
  let lastError: unknown = null;
  const replies = await Promise.all(
    rowsDefinition.map(async (row) => {
      const lists = await Promise.all(
        row.paths.map(async (path) => {
          const fallbackType: RemoteMediaType =
            path.startsWith("/tv") || path.startsWith("/discover/tv")
              ? "tv"
              : "movie";
          try {
            const body = await get<{ results?: TmdbMedia[] }>(path, signal);
            return (body.results ?? [])
              .filter(
                (media) =>
                  media.media_type !== "person" &&
                  media.adult !== true &&
                  isReleased(media.release_date ?? media.first_air_date),
              )
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
  const trending =
    replies.find((row) => row.key === "trending-day")?.items ??
    replies.find((row) => row.key === "popular")?.items ??
    replies.find((row) => row.items.length > 0)?.items ??
    [];
  const rows = replies.filter((row) => row.items.length > 0);
  // Every request failed (offline, expired token, TMDB outage). Surface the
  // error so Home can render a real offline/error page instead of an empty
  // "start here" shelf.
  if (!rows.length && failures > 0) {
    throw lastError instanceof Error
      ? lastError
      : new CatalogError("Could not load online titles.");
  }
  const home: RemoteHome = {
    featured: trending.find((item) => item.backdrop) ?? null,
    rows,
  };
  const key = remoteOptionsKey(value);
  homeCache = { key, value: home };
  // A partial outage can leave empty shelves; keep the last complete snapshot.
  if (rows.length > 0) void writeRemoteCache("home", key, home);
  return home;
}

/** The shelf definition behind a Home row, for the same family options. */
export function homeRowDefinition(
  key: string,
  options: RemoteCatalogOptions = {},
) {
  const value = remoteCatalogOptions(options);
  const rows = value.maxAge != null ? familyHomeRows(value) : HOME_ROWS;
  return (rows as readonly { key: string; title: string; paths: readonly string[] }[])
    .find((row) => row.key === key) ?? null;
}

/**
 * One page of a Home shelf for the "See all" list. Each path of the shelf is
 * paged together, so a mixed shelf keeps movies and series interleaved.
 */
export async function fetchHomeRowPage(
  key: string,
  page: number,
  options: RemoteCatalogOptions = {},
  signal?: AbortSignal,
): Promise<{ title: string; items: RemoteTitle[]; hasMore: boolean }> {
  const row = homeRowDefinition(key, options);
  if (!row) throw new CatalogError("This list is not available.");
  let hasMore = false;
  const lists = await Promise.all(
    row.paths.map(async (path) => {
      const fallbackType: RemoteMediaType =
        path.startsWith("/tv") || path.startsWith("/discover/tv") ? "tv" : "movie";
      const body = await get<{ results?: TmdbMedia[]; total_pages?: number }>(
        `${path}${path.includes("?") ? "&" : "?"}page=${page}`,
        signal,
      );
      // TMDB serves at most 500 pages per list.
      if (page < Math.min(500, body.total_pages ?? 1)) hasMore = true;
      return (body.results ?? [])
        .filter(
          (media) =>
            media.media_type !== "person" &&
            media.adult !== true &&
            isReleased(media.release_date ?? media.first_air_date),
        )
        .map((media) => toTitle(media, fallbackType));
    }),
  );
  return { title: row.title, items: interleave(lists), hasMore };
}

/**
 * The last home response saved on this device. Home paints from this before
 * its network refresh finishes; the refresh then replaces the stored rows.
 */
export async function loadCachedHome(
  options: RemoteCatalogOptions = {},
): Promise<RemoteHome | null> {
  const key = remoteOptionsKey(options);
  if (homeCache?.key === key) return homeCache.value;
  const cached = await readRemoteCache<RemoteHome>("home", key);
  if (!cached) return null;
  homeCache = { key, value: cached.value };
  return cached.value;
}

export async function searchTitles(
  query: string,
  signal?: AbortSignal,
  options: RemoteCatalogOptions = {},
): Promise<RemoteTitle[]> {
  const trimmed = query.trim();
  if (!trimmed) return [];
  const value = remoteCatalogOptions(options);
  const body = await get<{ results?: TmdbMedia[] }>(
    `/search/multi?query=${encodeURIComponent(trimmed)}&include_adult=false`,
    signal,
  );
  const titles = (body.results ?? [])
    .filter(
      (media) =>
        (media.media_type === "movie" || media.media_type === "tv") &&
        media.adult !== true &&
        isReleased(media.release_date ?? media.first_air_date),
    )
    .map((media) => toTitle(media, media.media_type === "tv" ? "tv" : "movie"));
  return value.maxAge == null
    ? titles
    : certifyTitles(titles, value, signal);
}

// --- detail ------------------------------------------------------------------

interface TmdbDetail extends TmdbMedia {
  tagline?: string;
  runtime?: number;
  episode_run_time?: number[];
  status?: string;
  external_ids?: { imdb_id?: string | null };
  belongs_to_collection?: { id: number; name?: string } | null;
  release_dates?: {
    results?: {
      iso_3166_1?: string;
      release_dates?: { certification?: string }[];
    }[];
  };
  content_ratings?: {
    results?: { iso_3166_1?: string; rating?: string }[];
  };
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

function certificatesOf(body: TmdbDetail, mediaType: RemoteMediaType) {
  const certifications: Record<string, string> = {};
  if (mediaType === "tv") {
    for (const entry of body.content_ratings?.results ?? []) {
      if (entry.iso_3166_1 && entry.rating)
        certifications[entry.iso_3166_1] = entry.rating;
    }
  } else {
    for (const entry of body.release_dates?.results ?? []) {
      const rating = entry.release_dates?.find((row) => row.certification)
        ?.certification;
      if (entry.iso_3166_1 && rating)
        certifications[entry.iso_3166_1] = rating;
    }
  }
  return certifications;
}

function mapDetail(body: TmdbDetail, mediaType: RemoteMediaType): RemoteDetail {
  const base = toTitle(body, mediaType);
  const certifications = certificatesOf(body, mediaType);
  return {
    ...base,
    certifications,
    certification:
      certifications.US ?? Object.values(certifications)[0] ?? null,
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
    collection: body.belongs_to_collection?.id
      ? {
          id: body.belongs_to_collection.id,
          name: body.belongs_to_collection.name?.trim() || "Collection",
        }
      : null,
  };
}

async function requestDetail(
  mediaType: RemoteMediaType,
  tmdbId: number,
  signal?: AbortSignal,
): Promise<RemoteDetail> {
  const requestKey = `${mediaType}:${tmdbId}`;
  const ratings =
    mediaType === "tv" ? "content_ratings" : "release_dates";
  const body = await get<TmdbDetail>(
    `/${mediaType}/${tmdbId}?append_to_response=external_ids,credits,videos,images,${ratings}&include_image_language=en,null`,
    signal,
  );
  const detail = mapDetail(body, mediaType);
  rememberDetail(mediaType, tmdbId, detail);
  detailStamps.set(requestKey, Date.now());
  void writeRemoteCache("detail", requestKey, detail);
  return detail;
}

/** Update a cached title quietly; the current screen keeps its snapshot. */
function scheduleDetailRefresh(mediaType: RemoteMediaType, tmdbId: number) {
  const requestKey = `${mediaType}:${tmdbId}`;
  if (detailRefreshes.has(requestKey) || !stale(detailStamps, requestKey)) return;
  detailRefreshes.add(requestKey);
  void requestDetail(mediaType, tmdbId)
    .catch(() => {})
    .finally(() => detailRefreshes.delete(requestKey));
}

export async function fetchDetail(
  mediaType: RemoteMediaType,
  tmdbId: number,
  signal?: AbortSignal,
): Promise<RemoteDetail> {
  const requestKey = `${mediaType}:${tmdbId}`;
  // Already resolved in this session. The next screen render is instant.
  const memo = detailCache.get(requestKey);
  if (memo) {
    scheduleDetailRefresh(mediaType, tmdbId);
    return memo;
  }
  // A card prefetch can overlap the tap that opens its page. Share the request
  // so the page waits on one round trip instead of starting a second one.
  const pending = detailRequests.get(requestKey);
  if (pending) return pending;
  const request = (async () => {
    const stored = await readRemoteCache<RemoteDetail>("detail", requestKey);
    if (
      stored &&
      "releaseDate" in stored.value &&
      typeof stored.value.certifications === "object"
    ) {
      rememberDetail(mediaType, tmdbId, stored.value);
      if (!detailStamps.has(requestKey))
        detailStamps.set(requestKey, stored.updatedAt);
      // Show the saved title now, then refresh it for the next open.
      scheduleDetailRefresh(mediaType, tmdbId);
      return stored.value;
    }
    // An entry written before ratings/release dates existed is replaced now:
    // never paint an old, unrated title into Kids mode.
    return requestDetail(mediaType, tmdbId, signal);
  })();
  detailRequests.set(requestKey, request);
  request
    .catch(() => {})
    .finally(() => {
      if (detailRequests.get(requestKey) === request)
        detailRequests.delete(requestKey);
    });
  return request;
}

/**
 * Search and recommendation endpoints omit age ratings. In family mode only,
 * resolve each candidate's detail (already cached/prefetched) and keep the
 * titles that pass the policy. Failures are treated as unrated.
 */
async function certifyTitles(
  titles: RemoteTitle[],
  options: RemoteCatalogOptions,
  signal?: AbortSignal,
): Promise<RemoteTitle[]> {
  const value = remoteCatalogOptions(options);
  const candidates = titles.filter((title) =>
    isReleased(title.releaseDate),
  );
  const accepted = new Map<string, RemoteTitle>();
  const queue = [...candidates];
  const worker = async () => {
    for (;;) {
      const title = queue.shift();
      if (!title) return;
      if (signal?.aborted) throw new CatalogError("Cancelled.");
      try {
        const detail = await fetchDetail(title.mediaType, title.tmdbId, signal);
        if (!remoteAllowed(detail, value)) continue;
        accepted.set(`${title.mediaType}:${title.tmdbId}`, {
          ...title,
          releaseDate: detail.releaseDate ?? title.releaseDate,
          certification: certificationFor(detail, value.region),
        });
      } catch {
        if (!value.blockUnrated)
          accepted.set(`${title.mediaType}:${title.tmdbId}`, title);
      }
    }
  };
  await Promise.all(
    Array.from({ length: Math.min(5, queue.length) }, () => worker()),
  );
  return candidates
    .map((title) => accepted.get(`${title.mediaType}:${title.tmdbId}`))
    .filter((title): title is RemoteTitle => Boolean(title));
}

async function requestSeason(
  tmdbId: number,
  season: number,
  signal?: AbortSignal,
): Promise<RemoteEpisode[]> {
  const requestKey = `${tmdbId}:${season}`;
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
  seasonStamps.set(requestKey, Date.now());
  void writeRemoteCache("season", requestKey, episodes);
  return episodes;
}

function scheduleSeasonRefresh(tmdbId: number, season: number) {
  const requestKey = `${tmdbId}:${season}`;
  if (seasonRefreshes.has(requestKey) || !stale(seasonStamps, requestKey)) return;
  seasonRefreshes.add(requestKey);
  void requestSeason(tmdbId, season)
    .catch(() => {})
    .finally(() => seasonRefreshes.delete(requestKey));
}

export async function fetchSeason(
  tmdbId: number,
  season: number,
  signal?: AbortSignal,
): Promise<RemoteEpisode[]> {
  const requestKey = `${tmdbId}:${season}`;
  const memo = seasonCache.get(requestKey);
  if (memo) {
    scheduleSeasonRefresh(tmdbId, season);
    return memo;
  }
  // The title header and the season page both ask for the same season in the
  // same commit. Share that request instead of spending two network round trips.
  const pending = seasonRequests.get(requestKey);
  if (pending) return pending;
  const request = (async () => {
    const stored = await readRemoteCache<RemoteEpisode[]>("season", requestKey);
    if (stored) {
      rememberSeason(tmdbId, season, stored.value);
      if (!seasonStamps.has(requestKey))
        seasonStamps.set(requestKey, stored.updatedAt);
      scheduleSeasonRefresh(tmdbId, season);
      return stored.value;
    }
    return requestSeason(tmdbId, season, signal);
  })();
  seasonRequests.set(requestKey, request);
  request
    .catch(() => {})
    .finally(() => {
      if (seasonRequests.get(requestKey) === request)
        seasonRequests.delete(requestKey);
    });
  return request;
}

async function requestRecommendations(
  mediaType: RemoteMediaType,
  tmdbId: number,
  signal?: AbortSignal,
): Promise<RemoteTitle[]> {
  const requestKey = `${mediaType}:${tmdbId}`;
  const body = await get<{ results?: TmdbMedia[] }>(
    `/${mediaType}/${tmdbId}/recommendations`,
    signal,
  );
  const seen = new Set<number>();
  const titles: RemoteTitle[] = [];
  for (const media of body.results ?? []) {
    if (media.media_type === "person" || media.adult === true) continue;
    const title = toTitle(media, mediaType);
    if (seen.has(title.tmdbId)) continue;
    seen.add(title.tmdbId);
    titles.push(title);
  }
  recommendationCache.set(requestKey, titles);
  recommendationStamps.set(requestKey, Date.now());
  void writeRemoteCache("recommendations", requestKey, titles);
  return titles;
}

function scheduleRecommendationRefresh(
  mediaType: RemoteMediaType,
  tmdbId: number,
) {
  const requestKey = `${mediaType}:${tmdbId}`;
  if (
    recommendationRefreshes.has(requestKey) ||
    !stale(recommendationStamps, requestKey)
  )
    return;
  recommendationRefreshes.add(requestKey);
  void requestRecommendations(mediaType, tmdbId)
    .catch(() => {})
    .finally(() => recommendationRefreshes.delete(requestKey));
}

export async function fetchRecommendations(
  mediaType: RemoteMediaType,
  tmdbId: number,
  signal?: AbortSignal,
  options: RemoteCatalogOptions = {},
): Promise<RemoteTitle[]> {
  const requestKey = `${mediaType}:${tmdbId}`;
  const value = remoteCatalogOptions(options);
  const memo = recommendationCache.get(requestKey);
  if (memo) {
    scheduleRecommendationRefresh(mediaType, tmdbId);
    return value.maxAge == null
      ? memo.filter((title) => isReleased(title.releaseDate))
      : certifyTitles(memo, value, signal);
  }
  const stored = await readRemoteCache<RemoteTitle[]>(
    "recommendations",
    requestKey,
  );
  if (stored) {
    recommendationCache.set(requestKey, stored.value);
    if (!recommendationStamps.has(requestKey))
      recommendationStamps.set(requestKey, stored.updatedAt);
    scheduleRecommendationRefresh(mediaType, tmdbId);
    return value.maxAge == null
      ? stored.value.filter((title) => isReleased(title.releaseDate))
      : certifyTitles(stored.value, value, signal);
  }
  const fresh = await requestRecommendations(mediaType, tmdbId, signal);
  return value.maxAge == null
    ? fresh.filter((title) => isReleased(title.releaseDate))
    : certifyTitles(fresh, value, signal);
}

interface TmdbCollection {
  id: number;
  name?: string;
  overview?: string;
  poster_path?: string | null;
  backdrop_path?: string | null;
  parts?: TmdbMedia[];
}

async function requestCollection(
  collectionId: number,
  signal?: AbortSignal,
): Promise<RemoteCollection> {
  const requestKey = String(collectionId);
  const body = await get<TmdbCollection>(
    `/collection/${collectionId}?language=en-US`,
    signal,
  );
  const seen = new Set<number>();
  const parts: RemoteTitle[] = [];
  for (const media of body.parts ?? []) {
    if (!media.id || media.adult === true || seen.has(media.id)) continue;
    seen.add(media.id);
    parts.push(toTitle(media, "movie"));
  }
  const collection: RemoteCollection = {
    id: body.id,
    name: body.name?.trim() || "Collection",
    overview: body.overview ?? "",
    poster: posterUrl(body.poster_path, "w500"),
    backdrop: posterUrl(body.backdrop_path, "w1280"),
    parts,
  };
  collectionCache.delete(collectionId);
  collectionCache.set(collectionId, collection);
  if (collectionCache.size > DETAIL_LIMIT)
    collectionCache.delete(collectionCache.keys().next().value!);
  collectionStamps.set(requestKey, Date.now());
  void writeRemoteCache("collection", requestKey, collection);
  return collection;
}

function scheduleCollectionRefresh(collectionId: number) {
  const requestKey = String(collectionId);
  if (collectionRefreshes.has(requestKey) || !stale(collectionStamps, requestKey))
    return;
  collectionRefreshes.add(requestKey);
  void requestCollection(collectionId)
    .catch(() => {})
    .finally(() => collectionRefreshes.delete(requestKey));
}

/** Every movie in a TMDB collection, cached so the list opens offline. */
export async function fetchCollection(
  collectionId: number,
  signal?: AbortSignal,
  options: RemoteCatalogOptions = {},
): Promise<RemoteCollection> {
  const requestKey = String(collectionId);
  const value = remoteCatalogOptions(options);
  const filtered = async (collection: RemoteCollection) => {
    if (value.maxAge == null)
      return {
        ...collection,
        parts: collection.parts.filter((part) =>
          isReleased(part.releaseDate),
        ),
      };
    const parts = await certifyTitles(collection.parts, value, signal);
    return { ...collection, parts };
  };
  const memo = collectionCache.get(collectionId);
  if (memo) {
    scheduleCollectionRefresh(collectionId);
    return filtered(memo);
  }
  const stored = await readRemoteCache<RemoteCollection>(
    "collection",
    requestKey,
  );
  if (stored) {
    collectionCache.set(collectionId, stored.value);
    if (!collectionStamps.has(requestKey))
      collectionStamps.set(requestKey, stored.updatedAt);
    scheduleCollectionRefresh(collectionId);
    return filtered(stored.value);
  }
  return filtered(await requestCollection(collectionId, signal));
}

export async function fetchEpisodeCalendar(
  tmdbId: number,
  from: string,
  to: string,
  signal?: AbortSignal,
) {
  type Airing = { season_number: number; episode_number: number; air_date: string | null; name: string };
  const show = await get<{
    last_episode_to_air?: Airing | null;
    next_episode_to_air?: Airing | null;
  }>(`/tv/${tmdbId}`, signal);
  const airings = [show.last_episode_to_air, show.next_episode_to_air].filter(
    (episode) => episode != null,
  );
  const seasons = [...new Set(airings.map((episode) => episode.season_number))];
  const known = new Map(airings.map((episode) => [
    `${episode.season_number}:${episode.episode_number}`,
    { season: episode.season_number, number: episode.episode_number, title: episode.name, airDate: episode.air_date },
  ]));
  await Promise.all(seasons.map(async (season) => {
    const episodes = await fetchSeason(tmdbId, season, signal).catch(() => []);
    for (const episode of episodes) known.set(`${season}:${episode.number}`, episode);
  }));
  return [...known.values()].filter((episode) => episode.airDate && episode.airDate >= from && episode.airDate <= to);
}
