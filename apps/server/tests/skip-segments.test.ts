import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { q, run, runMigrations, type Row } from "../src/db";
import { initConfig, save } from "../src/config";
import { buildApp } from "../src/app";
import {
  getSkipSegments,
  normalizeSegment,
  refreshSkipSegmentsForItem,
} from "../src/skip-segments";

const originalFetch = globalThis.fetch;
const LIBRARY_ID = 7400;
const SERIES_ID = 7401;
const EPISODE_ID = 7402;
const FILE_ID = 7403;
const EMPTY_EPISODE_ID = 7404;
const EMPTY_FILE_ID = 7405;
const MOVIE_ID = 7406;
const MOVIE_FILE_ID = 7407;

function seedExternalId(kind: "movie" | "tv", tmdbId: number, imdbId: string): void {
  const url = `https://api.themoviedb.org/3/${kind}/${tmdbId}/external_ids`;
  const key = createHash("sha1").update(url).digest("hex");
  run(
    `INSERT INTO tmdb_cache (key, endpoint, body, expires_at)
     VALUES (?, ?, ?, ?)
     ON CONFLICT(key) DO UPDATE SET body = excluded.body, expires_at = excluded.expires_at`,
    key, `external-ids/${kind}`, JSON.stringify({ imdb_id: imdbId }), Date.now() + 86_400_000,
  );
}

let lastSegmentsUrl = "";

function introDbFetch(payload: Record<string, unknown> | null): void {
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    if (String(input).startsWith("https://api.introdb.app/segments")) {
      lastSegmentsUrl = String(input);
      if (payload == null) return new Response("{}", { status: 404 });
      return new Response(JSON.stringify(payload), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }
    return originalFetch(input as RequestInfo);
  }) as unknown as typeof fetch;
}

describe("skip markers (IntroDB cache)", () => {
  beforeAll(async () => {
    await runMigrations();
    await initConfig();
    run("INSERT OR IGNORE INTO libraries (id, name, type, language) VALUES (?, 'Skip Lib', 'tv', 'en-US')", LIBRARY_ID);
    run(
      `INSERT OR REPLACE INTO items
         (id, library_id, kind, name, sort_title, match_status, tmdb_id, tmdb_type)
       VALUES (?, ?, 'series', 'Skip Show', 'skip show', 'matched', 777, 'tv')`,
      SERIES_ID, LIBRARY_ID,
    );
    run(
      `INSERT OR REPLACE INTO items
         (id, library_id, parent_id, kind, name, sort_title, season_number, episode_number, match_status, tmdb_id, tmdb_type)
       VALUES (?, ?, ?, 'episode', 'S01E01', 'skip show s01e01', 1, 1, 'matched', 9001, 'tv')`,
      EPISODE_ID, LIBRARY_ID, SERIES_ID,
    );
    run(
      `INSERT OR REPLACE INTO items
         (id, library_id, parent_id, kind, name, sort_title, season_number, episode_number, match_status, tmdb_id, tmdb_type)
       VALUES (?, ?, ?, 'episode', 'S01E02', 'skip show s01e02', 1, 2, 'matched', 9002, 'tv')`,
      EMPTY_EPISODE_ID, LIBRARY_ID, SERIES_ID,
    );
    run(
      `INSERT OR REPLACE INTO media_files (id, library_id, path, folder_key, size, mtime, item_id)
       VALUES (?, ?, '/tmp/skip-s01e01.mkv', 'skip show', 1, 1, ?)`,
      FILE_ID, LIBRARY_ID, EPISODE_ID,
    );
    run(
      `INSERT OR REPLACE INTO media_files (id, library_id, path, folder_key, size, mtime, item_id)
       VALUES (?, ?, '/tmp/skip-s01e02.mkv', 'skip show', 1, 1, ?)`,
      EMPTY_FILE_ID, LIBRARY_ID, EMPTY_EPISODE_ID,
    );
    run(
      `INSERT OR REPLACE INTO items
         (id, library_id, kind, name, sort_title, match_status, tmdb_id, tmdb_type)
       VALUES (?, ?, 'movie', 'Skip Movie', 'skip movie', 'matched', 778, 'movie')`,
      MOVIE_ID, LIBRARY_ID,
    );
    run(
      `INSERT OR REPLACE INTO media_files (id, library_id, path, folder_key, size, mtime, item_id)
       VALUES (?, ?, '/tmp/skip-movie.mkv', 'skip movie', 1, 1, ?)`,
      MOVIE_FILE_ID, LIBRARY_ID, MOVIE_ID,
    );
    seedExternalId("tv", 777, "tt1234567");
    seedExternalId("movie", 778, "tt0468569");
    await save({ skipSegmentsEnabled: true, tmdbToken: "test-token" });
  });

  afterAll(async () => {
    globalThis.fetch = originalFetch;
    await save({ skipSegmentsEnabled: false, tmdbToken: "" });
    run("DELETE FROM media_files WHERE id IN (?, ?, ?)", FILE_ID, EMPTY_FILE_ID, MOVIE_FILE_ID);
    run("DELETE FROM items WHERE id IN (?, ?, ?)", EPISODE_ID, EMPTY_EPISODE_ID, MOVIE_ID);
    run("DELETE FROM items WHERE id = ?", SERIES_ID);
    run("DELETE FROM libraries WHERE id = ?", LIBRARY_ID);
  });

  test("normalizes second and millisecond payloads", () => {
    expect(normalizeSegment({ start_sec: 10, end_sec: 70 })).toEqual({ start: 10, end: 70 });
    expect(normalizeSegment({ start_ms: 10_000, end_ms: 70_000 })).toEqual({ start: 10, end: 70 });
    expect(normalizeSegment({ start_sec: 10, end_sec: 70 }, 65)).toEqual({ start: 10, end: 65 });
    expect(normalizeSegment({ start_sec: 10, end_sec: 70 }, 30)).toBeNull();
    expect(normalizeSegment({ start_sec: 10, end_sec: 70 }, 5)).toBeNull();
    expect(normalizeSegment({ start_sec: 70, end_sec: 10 })).toBeNull();
  });

  test("rejects windows that cannot be the requested kind of marker", () => {
    // The Dark Knight: IntroDB reported an outro at 2:30 of a 152-minute film.
    expect(normalizeSegment({ start_sec: 150, end_sec: 210 }, 9120, "outro")).toBeNull();
    expect(normalizeSegment({ start_sec: 150, end_sec: 210 }, null, "outro")).toBeNull();
    expect(normalizeSegment({ start_sec: 8900, end_sec: 9000 }, 9120, "outro"))
      .toEqual({ start: 8900, end: 9000 });
    // A short file still allows credits in its second half.
    expect(normalizeSegment({ start_sec: 400, end_sec: 460 }, 600, "outro"))
      .toEqual({ start: 400, end: 460 });
    // Intro and recap must sit near the start and stay short.
    expect(normalizeSegment({ start_sec: 10, end_sec: 70 }, null, "recap"))
      .toEqual({ start: 10, end: 70 });
    expect(normalizeSegment({ start_sec: 1000, end_sec: 1060 }, null, "recap")).toBeNull();
    expect(normalizeSegment({ start_sec: 0, end_sec: 700 }, null, "intro")).toBeNull();
    expect(normalizeSegment({ start_sec: 0, end_sec: 3 }, null, "intro")).toBeNull();
  });

  test("persists IntroDB markers and serves them without another request", async () => {
    introDbFetch({
      intro: { start_sec: 10, end_sec: 70, confidence: 0.9, submission_count: 4 },
      recap: null,
      outro: { start_sec: 1400, end_sec: 1500 },
    });

    const first = await refreshSkipSegmentsForItem(EPISODE_ID);
    expect(first.intro).toMatchObject({ start: 10, end: 70, confidence: 0.9, submissionCount: 4 });
    expect(first.outro).toMatchObject({ start: 1400, end: 1500 });

    const stored = q<Row>("SELECT * FROM skip_segments WHERE item_id = ? ORDER BY kind").all(EPISODE_ID);
    expect(stored.length).toBe(2);
    const lookup = q<Row>("SELECT * FROM skip_segment_lookups WHERE item_id = ?").get(EPISODE_ID);
    expect(lookup?.status).toBe("found");
    expect(lookup?.imdb_id).toBe("tt1234567");

    // A fresh lookup row means the player never touches the network.
    globalThis.fetch = (async () => {
      throw new Error("network should not be used for a fresh row");
    }) as unknown as typeof fetch;
    const cached = await getSkipSegments(EPISODE_ID, 1500);
    expect(cached.intro).toMatchObject({ start: 10, end: 70 });
    expect(cached.outro).toMatchObject({ start: 1400, end: 1500 });

    // A shorter file must not skip to a marker beyond its runtime.
    const shorter = await getSkipSegments(EPISODE_ID, 100);
    expect(shorter.intro).toMatchObject({ start: 10, end: 70 });
    expect(shorter.outro).toBeNull();
  });

  test("caches a no-marker answer instead of refetching forever", async () => {
    introDbFetch(null);
    const first = await refreshSkipSegmentsForItem(EMPTY_EPISODE_ID);
    expect(first).toEqual({ intro: null, recap: null, outro: null });

    const lookup = q<Row>("SELECT * FROM skip_segment_lookups WHERE item_id = ?").get(EMPTY_EPISODE_ID);
    expect(lookup?.status).toBe("none");

    globalThis.fetch = (async () => {
      throw new Error("network should not be used for a cached empty result");
    }) as unknown as typeof fetch;
    const cached = await getSkipSegments(EMPTY_EPISODE_ID, 1500);
    expect(cached).toEqual({ intro: null, recap: null, outro: null });
  });

  test("the player route serves cached markers for a media file", async () => {
    const app = buildApp();
    const response = await app.handle(
      new Request(`http://localhost:8765/api/skip-segments/${FILE_ID}`),
    );
    expect(response.status).toBe(200);
    const data = await response.json() as {
      enabled: boolean;
      intro: { start: number; end: number } | null;
      outro: { start: number; end: number } | null;
    };
    expect(data.enabled).toBe(true);
    expect(data.intro).toMatchObject({ start: 10, end: 70 });
    expect(data.outro).toMatchObject({ start: 1400, end: 1500 });
  });

  test("movie lookups use is_movie and drop bogus credits", async () => {
    introDbFetch({
      intro: null,
      recap: null,
      outro: { start_sec: 150, end_sec: 210 },
    });
    const rejected = await refreshSkipSegmentsForItem(MOVIE_ID);
    expect(rejected.outro).toBeNull();
    expect(lastSegmentsUrl).toContain("is_movie=true");
    expect(lastSegmentsUrl).toContain("imdb_id=tt0468569");

    const lookup = q<Row>("SELECT status FROM skip_segment_lookups WHERE item_id = ?").get(MOVIE_ID);
    expect(lookup?.status).toBe("none");
    expect(q<Row>("SELECT * FROM skip_segments WHERE item_id = ?").all(MOVIE_ID).length).toBe(0);

    introDbFetch({
      intro: null,
      recap: null,
      outro: { start_sec: 8900, end_sec: 9000 },
    });
    const accepted = await refreshSkipSegmentsForItem(MOVIE_ID, { force: true });
    expect(accepted.outro).toMatchObject({ start: 8900, end: 9000 });

    const served = await getSkipSegments(MOVIE_ID, 9120);
    expect(served.outro).toMatchObject({ start: 8900, end: 9000 });
  });
});
