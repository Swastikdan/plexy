/// Community skip markers (IntroDB).
///
/// IntroDB returns intro, recap, and end-credits windows for a TV episode (or a
/// movie's credits). The player used to ask the service on every playback, so a
/// slow lookup could land after the intro had already started. Markers are now
/// cached in SQLite: the scan hydrates them as titles are identified, and the
/// player reads local rows first. A live lookup only happens when an item has
/// no fresh row. "Checked, nothing found" is cached too, otherwise every
/// episode without community data would be fetched again on every play.
import { q, run, type Row } from "./db";
import { getConfig } from "./config";
import { log } from "./logger";
import { externalImdbId } from "./tmdb";

export type SegmentKind = "intro" | "recap" | "outro";
export interface SegmentWindow {
  start: number;
  end: number;
  confidence?: number;
  submissionCount?: number;
}
export type SkipSegments = Record<SegmentKind, SegmentWindow | null>;

export const EMPTY_SKIP_SEGMENTS: SkipSegments = Object.freeze({
  intro: null,
  recap: null,
  outro: null,
});

const SEGMENT_KINDS: readonly SegmentKind[] = ["intro", "recap", "outro"];
const SOURCE = "introdb";
const API_URL = "https://api.introdb.app/segments";
const REQUEST_TIMEOUT_MS = 2500;
const FOUND_TTL_MS = 30 * 24 * 3600_000;
const NONE_TTL_MS = 7 * 24 * 3600_000;
const ERROR_TTL_MS = 30 * 60_000;
const REFRESH_CONCURRENCY = 3;
const MIN_SEGMENT_SECONDS = 5;
const MAX_INTRO_SECONDS = 10 * 60;
const MAX_RECAP_SECONDS = 10 * 60;
const MAX_OUTRO_SECONDS = 30 * 60;
const MAX_INTRO_START_SECONDS = 20 * 60;
const MAX_RECAP_START_SECONDS = 15 * 60;
const MIN_OUTRO_START_SECONDS = 10 * 60;

interface LookupRow {
  status: string;
  imdb_id: string | null;
  expires_at: number;
}

interface Target {
  imdbId: string;
  season?: number;
  episode?: number;
  isMovie: boolean;
}

export interface RefreshSummary {
  checked: number;
  found: number;
}

/** Convert one IntroDB segment object to seconds and clamp it to the file. */
export function normalizeSegment(
  value: unknown,
  duration: number | null = null,
  kind: SegmentKind = "intro",
): SegmentWindow | null {
  if (!value || typeof value !== "object") return null;
  const segment = value as Record<string, unknown>;
  const start = typeof segment.start_sec === "number" ? segment.start_sec
    : typeof segment.start_ms === "number" ? segment.start_ms / 1000
      : null;
  const end = typeof segment.end_sec === "number" ? segment.end_sec
    : typeof segment.end_ms === "number" ? segment.end_ms / 1000
      : null;
  if (start == null || end == null) return null;
  return clampWindow(start, end, duration, kind, segment.confidence, segment.submission_count);
}

/**
 * Whether a window can plausibly be the given kind of marker. IntroDB
 * occasionally attributes another cut's credits to a film (The Dark Knight
 * returned an "outro" at 2:30 of a 152-minute runtime), and skipping there is
 * worse than showing no button at all.
 */
function isPlausibleWindow(
  kind: SegmentKind,
  start: number,
  end: number,
  duration: number | null,
): boolean {
  const length = end - start;
  if (length < MIN_SEGMENT_SECONDS) return false;
  switch (kind) {
    case "intro":
      return length <= MAX_INTRO_SECONDS && start <= MAX_INTRO_START_SECONDS;
    case "recap":
      return length <= MAX_RECAP_SECONDS && start <= MAX_RECAP_START_SECONDS;
    case "outro": {
      if (length > MAX_OUTRO_SECONDS) return false;
      // Credits sit at the end. With a known runtime, allow anything past the
      // midpoint; without one, fall back to the absolute floor.
      const earliest = duration != null
        ? Math.min(duration / 2, MIN_OUTRO_START_SECONDS)
        : MIN_OUTRO_START_SECONDS;
      return start >= earliest;
    }
  }
}

function clampWindow(
  start: number,
  end: number,
  duration: number | null,
  kind: SegmentKind,
  confidence: unknown,
  submissionCount: unknown,
): SegmentWindow | null {
  if (!Number.isFinite(start) || !Number.isFinite(end) || start < 0 || end <= start) return null;
  let knownDuration: number | null = null;
  if (duration != null && Number.isFinite(duration) && duration > 0) {
    // A marker that starts after the file ends, or overshoots it badly, almost
    // always belongs to a different cut. Drop it instead of skipping the wrong
    // part of the episode.
    if (start >= duration || end > duration + 15) return null;
    end = Math.min(end, duration);
    knownDuration = duration;
  }
  if (!isPlausibleWindow(kind, start, end, knownDuration)) return null;
  const window: SegmentWindow = { start, end };
  if (typeof confidence === "number" && Number.isFinite(confidence)) {
    window.confidence = confidence;
  }
  if (typeof submissionCount === "number" && Number.isFinite(submissionCount)) {
    window.submissionCount = submissionCount;
  }
  return window;
}

function hasSegments(segments: SkipSegments): boolean {
  return SEGMENT_KINDS.some((kind) => segments[kind] != null);
}

function readLookup(itemId: number): LookupRow | null {
  const row = q<LookupRow, [number]>(
    "SELECT status, imdb_id, expires_at FROM skip_segment_lookups WHERE item_id = ?",
  ).get(itemId);
  return row ?? null;
}

/** Read cached markers and clamp them against the current file duration. */
export function readStoredSegments(itemId: number, duration: number | null = null): SkipSegments {
  const rows = q<Row, [number]>(
    `SELECT kind, start_seconds, end_seconds, confidence, submission_count
       FROM skip_segments WHERE item_id = ?`,
  ).all(itemId);
  const out: SkipSegments = { intro: null, recap: null, outro: null };
  for (const row of rows) {
    const kind = String(row.kind) as SegmentKind;
    if (!SEGMENT_KINDS.includes(kind)) continue;
    out[kind] = clampWindow(
      Number(row.start_seconds),
      Number(row.end_seconds),
      duration,
      kind,
      row.confidence,
      row.submission_count,
    );
  }
  return out;
}

/**
 * Markers for one playable item. Reads the local cache first; only a missing
 * or stale row falls through to IntroDB.
 */
export async function getSkipSegments(
  itemId: number,
  duration: number | null = null,
): Promise<SkipSegments> {
  const cfg = await getConfig();
  if (!cfg.skipSegmentsEnabled) return EMPTY_SKIP_SEGMENTS;
  const lookup = readLookup(itemId);
  if (lookup && Number(lookup.expires_at) > Date.now()) {
    return readStoredSegments(itemId, duration);
  }
  return refreshSkipSegmentsForItem(itemId, { duration });
}

const inFlight = new Map<number, Promise<SkipSegments>>();

/** Fetch and persist markers for one item, de-duplicating concurrent lookups. */
export function refreshSkipSegmentsForItem(
  itemId: number,
  options: { duration?: number | null; force?: boolean } = {},
): Promise<SkipSegments> {
  const existing = inFlight.get(itemId);
  if (existing && !options.force) return existing;
  const promise = lookupAndPersist(itemId, options.duration ?? null, Boolean(options.force))
    .finally(() => {
      if (inFlight.get(itemId) === promise) inFlight.delete(itemId);
    });
  inFlight.set(itemId, promise);
  return promise;
}

async function lookupAndPersist(
  itemId: number,
  duration: number | null,
  force: boolean,
): Promise<SkipSegments> {
  const cfg = await getConfig();
  if (!cfg.skipSegmentsEnabled) return EMPTY_SKIP_SEGMENTS;

  const stored = readStoredSegments(itemId, duration);
  const lookup = readLookup(itemId);
  if (!force && lookup && Number(lookup.expires_at) > Date.now()) return stored;

  const item = q<Row, [number]>(
    `SELECT kind, tmdb_id, parent_id, season_number, episode_number
       FROM items WHERE id = ?`,
  ).get(itemId);
  if (!item) return stored;

  let target: Target | null;
  try {
    target = await resolveTarget(item);
  } catch (error) {
    // TMDB could not answer. Keep any markers already cached and retry soon.
    log.debug("player", "skip marker identity lookup failed", { itemId, message: String(error) });
    persistLookup(itemId, "error", null, null, ERROR_TTL_MS, true);
    return stored;
  }
  if (!target) return stored;

  try {
    const data = await requestSegments(target);
    // Keep the service's timing unclamped so a second cut of the same episode
    // still gets a correct marker instead of inheriting the first file's
    // shorter runtime. Implausible windows are rejected here, before they are
    // ever stored, and clamped against the file again at read time.
    const segments: SkipSegments = {
      intro: normalizeSegment(data.intro, null, "intro"),
      recap: normalizeSegment(data.recap, null, "recap"),
      outro: normalizeSegment(data.outro, null, "outro"),
    };
    const found = hasSegments(segments);
    persistLookup(
      itemId,
      found ? "found" : "none",
      target.imdbId,
      segments,
      found ? FOUND_TTL_MS : NONE_TTL_MS,
      false,
    );
    return readStoredSegments(itemId, duration);
  } catch (error) {
    log.debug("player", "skip marker lookup unavailable", { itemId, message: String(error) });
    persistLookup(itemId, "error", target.imdbId, null, ERROR_TTL_MS, true);
    return stored;
  }
}

async function resolveTarget(item: Row): Promise<Target | null> {
  const kind = String(item.kind);
  if (kind === "episode") {
    if (item.parent_id == null || item.season_number == null || item.episode_number == null) {
      return null;
    }
    const series = q<{ tmdb_id: number | null }, [number]>(
      "SELECT tmdb_id FROM items WHERE id = ?",
    ).get(Number(item.parent_id));
    if (!series?.tmdb_id) return null;
    const imdbId = await externalImdbId("tv", Number(series.tmdb_id));
    if (!imdbId) return null;
    return {
      imdbId,
      season: Number(item.season_number),
      episode: Number(item.episode_number),
      isMovie: false,
    };
  }
  if (kind === "movie") {
    if (item.tmdb_id == null) return null;
    const imdbId = await externalImdbId("movie", Number(item.tmdb_id));
    if (!imdbId) return null;
    return { imdbId, isMovie: true };
  }
  return null;
}

async function requestSegments(target: Target): Promise<Record<string, unknown>> {
  const params = new URLSearchParams({ imdb_id: target.imdbId });
  if (target.isMovie) {
    params.set("is_movie", "true");
  } else {
    params.set("season", String(target.season));
    params.set("episode", String(target.episode));
  }
  const response = await fetch(`${API_URL}?${params}`, {
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    headers: { accept: "application/json" },
  });
  // IntroDB answers 404 when the title/episode has no community markers.
  if (response.status === 404) return {};
  if (!response.ok) throw new Error(`IntroDB responded ${response.status}`);
  return await response.json() as Record<string, unknown>;
}

function persistLookup(
  itemId: number,
  status: "found" | "none" | "error",
  imdbId: string | null,
  segments: SkipSegments | null,
  ttlMs: number,
  keepExisting: boolean,
): void {
  const now = Date.now();
  if (!keepExisting) run("DELETE FROM skip_segments WHERE item_id = ?", itemId);
  if (segments) {
    for (const kind of SEGMENT_KINDS) {
      const window = segments[kind];
      if (!window) continue;
      run(
        `INSERT INTO skip_segments
           (item_id, kind, start_seconds, end_seconds, confidence, submission_count, source, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(item_id, kind) DO UPDATE SET
           start_seconds = excluded.start_seconds,
           end_seconds = excluded.end_seconds,
           confidence = excluded.confidence,
           submission_count = excluded.submission_count,
           source = excluded.source,
           updated_at = excluded.updated_at`,
        itemId, kind, window.start, window.end,
        window.confidence ?? null, window.submissionCount ?? null,
        SOURCE, new Date().toISOString(),
      );
    }
  }
  run(
    `INSERT INTO skip_segment_lookups
       (item_id, source, imdb_id, status, fetched_at, expires_at)
     VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT(item_id) DO UPDATE SET
       source = excluded.source,
       imdb_id = excluded.imdb_id,
       status = excluded.status,
       fetched_at = excluded.fetched_at,
       expires_at = excluded.expires_at`,
    itemId, SOURCE, imdbId, status, now, now + ttlMs,
  );
}

/** Fetch markers for every episode in a series that is missing a fresh row. */
export async function refreshSkipSegmentsForSeries(seriesItemId: number): Promise<number> {
  const cfg = await getConfig();
  if (!cfg.skipSegmentsEnabled) return 0;
  const episodes = q<{ id: number }, [number, number]>(
    `SELECT i.id FROM items i
      WHERE i.parent_id = ? AND i.kind = 'episode'
        AND i.season_number IS NOT NULL AND i.episode_number IS NOT NULL
        AND EXISTS (
          SELECT 1 FROM media_files f WHERE f.item_id = i.id AND f.unavailable = 0
        )
        AND NOT EXISTS (
          SELECT 1 FROM skip_segment_lookups l
           WHERE l.item_id = i.id AND l.expires_at > ?
        )`,
  ).all(seriesItemId, Date.now());

  let found = 0;
  await forEachLimit(episodes, REFRESH_CONCURRENCY, async (episode) => {
    const segments = await refreshSkipSegmentsForItem(Number(episode.id));
    if (hasSegments(segments)) found++;
  });
  return found;
}

let sweep: Promise<RefreshSummary> | null = null;

/**
 * Backfill every playable title that has no fresh lookup. Safe to call after a
 * scan, after enabling the setting, or from the admin refresh button.
 */
export function refreshMissingSkipSegments(): Promise<RefreshSummary> {
  if (sweep) return sweep;
  sweep = runSweep().finally(() => { sweep = null; });
  return sweep;
}

async function runSweep(): Promise<RefreshSummary> {
  const cfg = await getConfig();
  if (!cfg.skipSegmentsEnabled) return { checked: 0, found: 0 };

  const items = q<{ id: number }>(
    `SELECT i.id FROM items i
      WHERE i.kind IN ('movie', 'episode')
        AND i.match_status = 'matched'
        AND EXISTS (
          SELECT 1 FROM media_files f WHERE f.item_id = i.id AND f.unavailable = 0
        )
        AND (
          i.kind = 'movie'
          OR (i.season_number IS NOT NULL AND i.episode_number IS NOT NULL)
        )
        AND NOT EXISTS (
          SELECT 1 FROM skip_segment_lookups l
           WHERE l.item_id = i.id AND l.expires_at > ?
        )
      ORDER BY CASE i.kind WHEN 'episode' THEN 1 ELSE 0 END,
               i.parent_id, i.season_number, i.episode_number`,
  ).all(Date.now());

  let checked = 0;
  let found = 0;
  await forEachLimit(items, REFRESH_CONCURRENCY, async (item) => {
    const segments = await refreshSkipSegmentsForItem(Number(item.id));
    checked++;
    if (hasSegments(segments)) found++;
  });

  if (checked > 0) {
    log.info("player", "skip markers refreshed", { checked, found });
  }
  return { checked, found };
}

async function forEachLimit<T>(
  items: readonly T[],
  limit: number,
  fn: (item: T) => Promise<void>,
): Promise<void> {
  let index = 0;
  const workers = Array.from(
    { length: Math.min(Math.max(1, limit), items.length) },
    async () => {
      for (;;) {
        const current = index++;
        if (current >= items.length) return;
        await fn(items[current]!);
      }
    },
  );
  await Promise.all(workers);
}
