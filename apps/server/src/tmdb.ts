/// TMDB HTTP client (PRD 5.5).
///
/// Handles everything the matching pipeline and UI need:
/// - Bearer auth with the raw read-access token from config.
/// - SQLite response cache: 24 h for search, 7 d for details; exact per-endpoint
///   TTLs live in `CACHE_TTL`.
/// - Conservative throttle (~1 request/second) so bursts never hit 429.
/// - Bounded retry (2 attempts) with `Retry-After`-aware backoff on 429/5xx.
/// - Zod validation of the few response shapes we consume.
import { createHash } from "node:crypto";
import { q, run, db } from "./db";
import { log } from "./logger";
import { getConfig } from "./config";
import { z } from "zod";

// --- response shapes ---------------------------------------------------------

const SearchResults = z.object({
  results: z.array(z.object({
    id: z.number(),
    title: z.string().optional(),
    name: z.string().optional(),
    original_title: z.string().optional(),
    original_name: z.string().optional(),
    release_date: z.string().optional(),
    first_air_date: z.string().optional(),
    overview: z.string().optional(),
    poster_path: z.string().nullable().optional(),
    popularity: z.number().optional(),
  })),
});
const ImagesConfig = z.object({
  images: z.object({
    base_url: z.string(),
    secure_base_url: z.string(),
    poster_sizes: z.array(z.string()),
    backdrop_sizes: z.array(z.string()),
    still_sizes: z.array(z.string()).optional(),
    profile_sizes: z.array(z.string()).optional(),
  }),
});
const Detail = z.object({
  id: z.number(),
  title: z.string().optional(),
  name: z.string().optional(),
  overview: z.string().nullish(),
  tagline: z.string().nullish(),
  runtime: z.number().nullish(),
  vote_average: z.number().nullish(),
  release_date: z.string().nullish(),
  first_air_date: z.string().nullish(),
  genres: z.array(z.object({ id: z.number(), name: z.string() })).nullish(),
  popularity: z.number().nullish(),
  poster_path: z.string().nullish(),
  backdrop_path: z.string().nullish(),
  seasons: z.array(z.object({
    id: z.number(),
    name: z.string().optional(),
    season_number: z.number(),
    overview: z.string().nullish(),
    poster_path: z.string().nullish(),
    episode_count: z.number().optional(),
    air_date: z.string().nullish(),
  })).nullish(),
  videos: z.object({ results: z.array(z.object({
    key: z.string(), name: z.string(), site: z.string(),
    type: z.string(), official: z.boolean().optional(),
    published_at: z.string().optional(),
  })) }).nullish(),
  credits: z.object({
    cast: z.array(z.object({
      id: z.number(), name: z.string(), character: z.string().optional(),
      profile_path: z.string().nullish(), order: z.number().optional(),
    })).nullish(),
    crew: z.array(z.object({
      id: z.number(), name: z.string(), job: z.string().optional(),
    })).nullish(),
  }).nullish(),
});
const EpisodeResults = z.object({ episodes: z.array(z.object({
  id: z.number(),
  name: z.string(),
  episode_number: z.number(),
  season_number: z.number().optional(),
  overview: z.string().nullish(),
  still_path: z.string().nullish(),
  runtime: z.number().nullish(),
  vote_average: z.number().nullish(),
  air_date: z.string().nullish(),
  order: z.number().optional(),
})) });
const ExternalIds = z.object({ imdb_id: z.string().nullable().optional() });

export type TmdbSearchResult = z.infer<typeof SearchResults>["results"][number];
export type TmdbDetail = z.infer<typeof Detail>;
export type TmdbEpisode = z.infer<typeof EpisodeResults>["episodes"][number];

// --- image urls --------------------------------------------------------------

export interface ImageConfig {
  baseUrl: string;
  posterSize: string;
  backdropSize: string;
  stillSize: string;
  profileSize: string;
}

const CONFIG_CACHE_KEY = "tmdb/images/config";
const imageConfigFlights = new Map<string, Promise<ImageConfig>>();

/** Image base URL + sizes, from TMDB's configuration endpoint (24 h cache). */
export async function imageConfig(): Promise<ImageConfig> {
  const cfg = await getConfig();
  const cacheKey = `${CONFIG_CACHE_KEY}/${cfg.imageQuality}`;
  const active = imageConfigFlights.get(cacheKey);
  if (active) return active;

  const request = loadImageConfig(cfg, cacheKey).catch((error) => {
    imageConfigFlights.delete(cacheKey);
    throw error;
  });
  imageConfigFlights.set(cacheKey, request);
  return request;
}

async function loadImageConfig(cfg: Awaited<ReturnType<typeof getConfig>>, cacheKey: string): Promise<ImageConfig> {
  const cached = await cacheGet(cacheKey);
  if (cached) {
    try {
      const parsed = JSON.parse(cached) as ImageConfig;
      if (parsed.baseUrl && parsed.posterSize && parsed.backdropSize && parsed.stillSize) {
        return parsed;
      }
    } catch { /* re-fetch */ }
  }
  const json = ImagesConfig.parse(await requestJson("/configuration", "", 10_000));
  const wanted = cfg.imageQuality;
  const pSizes = json.images.poster_sizes;
  const bSizes = json.images.backdrop_sizes;
  const sSizes = json.images.still_sizes ?? ["w300", "original"];
  const prSizes = json.images.profile_sizes ?? ["h632", "w185", "original"];

  // Poster: crisp w780 by default on high-res screens
  const posterSize = (wanted && pSizes.includes(wanted))
    ? wanted
    : pSizes.includes("w780")
      ? "w780"
      : pSizes.includes("w500")
        ? "w500"
        : "original";

  // Backdrop: 16:9 hero banner needs w1280 (or original/w780), NEVER low-res w300
  const backdropSize = bSizes.includes("w1280")
    ? "w1280"
    : bSizes.includes("original")
      ? "original"
      : bSizes.includes("w780")
        ? "w780"
        : bSizes[bSizes.length - 1] ?? "original";

  // Stills: episode thumbnails need w300 or original
  const stillSize = sSizes.includes("w300")
    ? "w300"
    : sSizes.includes("original")
      ? "original"
      : sSizes[sSizes.length - 1] ?? "original";

  // Profiles: cast photos
  const profileSize = prSizes.includes("h632")
    ? "h632"
    : prSizes.includes("w185")
      ? "w185"
      : "original";

  const value: ImageConfig = {
    baseUrl: json.images.secure_base_url || json.images.base_url,
    posterSize,
    backdropSize,
    stillSize,
    profileSize,
  };
  await cachePut(cacheKey, "configuration", JSON.stringify(value), 24 * 3600_000);
  return value;
}

/** Clear TMDB responses so the next metadata request fetches fresh values. */
export function clearTmdbCache(): number {
  const count = Number(q<{ count: number }>("SELECT COUNT(*) AS count FROM tmdb_cache").get()?.count ?? 0);
  run("DELETE FROM tmdb_cache");
  imageConfigFlights.clear();
  return count;
}

/** Full URL for a TMDB image path, or null when there is none. */
export async function imageUrl(
  path: string | null | undefined,
  kind: "poster" | "backdrop" | "still" | "profile" = "poster",
): Promise<string | null> {
  if (!path) return null;
  const cfg = await imageConfig();
  let size = cfg.posterSize;
  if (kind === "backdrop") size = cfg.backdropSize;
  else if (kind === "still") size = cfg.stillSize;
  else if (kind === "profile") size = cfg.profileSize;
  return cfg.baseUrl + size + path;
}

// --- cache -------------------------------------------------------------------

function cacheKey(url: string): string {
  return createHash("sha1").update(url).digest("hex");
}

async function cacheGet(key: string): Promise<string | null> {
  const row = q<{ body: string; expires_at: number }, [string]>(
    "SELECT body, expires_at FROM tmdb_cache WHERE key = ?").get(key);
  if (!row) return null;
  if (row.expires_at < Date.now()) return null;
  return row.body;
}

async function cachePut(key: string, endpoint: string, body: string, ttlMs: number): Promise<void> {
  run(
    `INSERT INTO tmdb_cache (key, endpoint, body, expires_at)
     VALUES (?, ?, ?, ?)
     ON CONFLICT(key) DO UPDATE SET body = excluded.body, expires_at = excluded.expires_at`,
    key, endpoint, body, Date.now() + ttlMs,
  );
}

/** Drop expired rows occasionally; called after successful scans. */
export function pruneCache(): void {
  run("DELETE FROM tmdb_cache WHERE expires_at < ?", Date.now());
}

// --- throttle + fetch --------------------------------------------------------

const MIN_GAP_MS = 1050; // ~1 req/s; well under TMDB's published limits
let lastRequestAt = 0;
let chain: Promise<unknown> = Promise.resolve();

const RETRYABLE = new Set([418, 429, 500, 502, 503, 504]);

function sleep(ms: number) {
  return new Promise<void>((res) => setTimeout(res, ms));
}

/**
 * Serialized fetch: every request waits for the throttle gap. Only requests
 * that miss the cache hit the network.
 */
async function requestJson(pathAndQuery: string, endpoint: string, ttlMs: number): Promise<unknown> {
  const cfg = await getConfig();
  const token = cfg.tmdbToken || Bun.env.VITE_PUBLIC_TMDB_ACCESS_TOKEN || Bun.env.TMDB_TOKEN;
  if (!token) throw new TmdbError("no-token", 401, "TMDB token is not configured");
  const apiBase = (Bun.env.VITE_PUBLIC_TMDB_API_URL || "https://api.themoviedb.org/3").replace(/\/+$/, "");
  const url = apiBase + pathAndQuery;
  const key = cacheKey(url);

  const hit = await cacheGet(key);
  if (hit) {
    log.debug("tmdb", `cache hit ${endpoint}`);
    return JSON.parse(hit);
  }

  const run = chain.then(() => doRequest(url, key, endpoint, ttlMs, token));
  void run.catch(() => {}); // the client of `run` handles its own errors
  chain = run;
  return run;
}

async function doRequest(
  url: string, key: string, endpoint: string, ttlMs: number, token: string,
): Promise<unknown> {
  for (let attempt = 0; attempt <= 2; attempt++) {
    const gap = Math.max(0, lastRequestAt + MIN_GAP_MS - Date.now());
    if (gap > 0) await sleep(gap);
    lastRequestAt = Date.now();

    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${token}`, accept: "application/json" },
    });
    if (res.ok) {
      const body = await res.text();
      await cachePut(key, endpoint, body, ttlMs);
      log.debug("tmdb", `${endpoint} ${res.status}`, { attempt });
      return JSON.parse(body);
    }
    const retryAfter = Number(res.headers.get("retry-after") ?? 60);
    const backoffMs = res.status === 429 ? retryAfter * 1000 : 500 * 2 ** attempt;
    log.warn("tmdb", `${endpoint} ${res.status}`, { attempt, backoffMs });
    if (!RETRYABLE.has(res.status) || attempt === 2) {
      throw new TmdbError(`(tmdb-${endpoint}) ${res.status}`, res.status,
        res.status === 429 ? "TMDB rate limit reached" : `TMDB request failed (${res.status})`);
    }
    await sleep(Math.min(backoffMs, retryAfter * 1000, 15_000));
  }
  throw new TmdbError(`(tmdb-${endpoint}) exhausted retries`, 502, "TMDB request failed after retries");
}

export class TmdbError extends Error {
  constructor(message: string, readonly status: number, readonly userMessage: string) {
    super(message);
  }
}

// --- endpoint helpers --------------------------------------------------------

/** Run a search for the given `query` + optional year against movie or tv. */
export async function search(kind: "movie" | "tv", query: string, year: number | null): Promise<TmdbSearchResult[]> {
  const cfg = await getConfig();
  const base = `/search/${kind}`;
  const mk = (q2: string, y: number | null) => {
    const p = new URLSearchParams({ query: q2, language: cfg.metadataLanguage });
    if (y) p.set(kind === "tv" ? "first_air_date_year" : "year", String(y));
    return `${base}?${p}`;
  };
  // PRD 5.4 step 4: with year → without year → simplified title fallback.
  const attempts = [mk(query, year), mk(query, null)];
  const simplified = query.replace(/[:\-–].*$/, "").replace(/\s+(the|a|an)\s+/i, " ").trim();
  if (simplified && simplified.toLowerCase() !== query.toLowerCase()) attempts.push(mk(simplified, year));
  for (const path of attempts) {
    const parsed = SearchResults.parse(await requestJson(path, `search/${kind}`, 24 * 3600_000));
    if (parsed.results.length) return parsed.results;
  }
  return [];
}

const DETAIL_TTL = 7 * 24 * 3600_000;

/** Combined details + videos + credits fetch used by matching and detail views. */
export async function detail(kind: "movie" | "tv", id: number): Promise<TmdbDetail> {
  const lang = (await getConfig()).metadataLanguage;
  const path = `/${kind}/${id}?append_to_response=videos,credits&language=${lang}`;
  const raw = await requestJson(path, `detail/${kind}`, DETAIL_TTL);
  const parsed = Detail.safeParse(raw);
  if (!parsed.success) throw new TmdbError(`bad detail payload for ${kind}/${id}`, 502, "TMDB returned unexpected data");
  return parsed.data;
}

/** Season fetch used to resolve episode numbers. */
export async function season(seriesId: number, season: number): Promise<TmdbEpisode[]> {
  const cfg = await getConfig();
  const path = `/tv/${seriesId}/season/${season}?language=${cfg.metadataLanguage}`;
  const parsed = EpisodeResults.parse(await requestJson(path, `season/${seriesId}/${season}`, DETAIL_TTL));
  return parsed.episodes;
}

/** IMDb id used by community skip-segment databases; cached by the normal TMDB layer. */
export async function externalImdbId(kind: "movie" | "tv", id: number): Promise<string | null> {
  const parsed = ExternalIds.safeParse(await requestJson(`/${kind}/${id}/external_ids`, `external-ids/${kind}`, DETAIL_TTL));
  return parsed.success ? parsed.data.imdb_id ?? null : null;
}

/** Validate the stored token by hitting the configuration endpoint (PRD 5.1). */
export async function testToken(): Promise<{ ok: boolean; message: string }> {
  try {
    const cfg = await imageConfig();
    return { ok: true, message: `Connected — image base ${cfg.baseUrl}` };
  } catch (err) {
    const e = err instanceof TmdbError ? err : new TmdbError(String(err), 502, "TMDB is unreachable");
    return { ok: false, message: e.userMessage };
  }
}
