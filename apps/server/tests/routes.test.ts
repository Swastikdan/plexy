import { beforeAll, describe, expect, test } from "bun:test";
import { buildApp } from "../src/app";
import { runMigrations, run } from "../src/db";
import { initConfig, APP_VERSION } from "../src/config";

describe("Elysia API Routes (PRD 9)", () => {
  let app: ReturnType<typeof buildApp>;

  beforeAll(async () => {
    await runMigrations();
    await initConfig();
    run("INSERT OR IGNORE INTO libraries (id, name, type, language) VALUES (1, 'Test Lib', 'movies', 'en-US')");
    run("INSERT OR IGNORE INTO items (id, library_id, kind, name, sort_title) VALUES (1, 1, 'movie', 'Test Movie', 'test movie')");
    app = buildApp();
  });

  test("GET /api/server/status returns server metadata and version", async () => {
    const res = await app.handle(new Request("http://localhost:8765/api/server/status"));
    expect(res.status).toBe(200);

    const data = await res.json();
    expect(data.version).toBe(APP_VERSION);
    expect(typeof data.adminAvailable).toBe("boolean");
    expect(Array.isArray(data.recentScans)).toBe(true);
  });

  test("GET /api/home returns home payload structure", async () => {
    const res = await app.handle(new Request("http://localhost:8765/api/home"));
    expect(res.status).toBe(200);

    const data = await res.json();
    expect(data).toHaveProperty("featured");
    expect(data).toHaveProperty("rows");
    expect(Array.isArray(data.rows)).toBe(true);
  });

  test("GET /api/items returns item list with limit", async () => {
    const res = await app.handle(new Request("http://localhost:8765/api/items?limit=10"));
    expect(res.status).toBe(200);

    const data = await res.json();
    expect(Array.isArray(data.items)).toBe(true);
  });

  test("POST /api/progress saves watch progress", async () => {
    const res = await app.handle(
      new Request("http://localhost:8765/api/progress", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          itemId: 1,
          position: 120,
          duration: 3600,
          played: false,
        }),
      }),
    );
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.ok).toBe(true);
  });

  test("GET /api/search returns results array for query", async () => {
    const res = await app.handle(
      new Request("http://localhost:8765/api/search?q=Avatar"),
    );
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(Array.isArray(data.items)).toBe(true);
  });

  test("GET /api/items/:id returns series with seasons and episodes", async () => {
    run("INSERT OR IGNORE INTO items (id, library_id, kind, name, sort_title, match_status) VALUES (10, 1, 'series', 'Test Series', 'test series', 'matched')");
    run("INSERT OR IGNORE INTO items (id, library_id, parent_id, kind, name, sort_title, season_number) VALUES (11, 1, 10, 'season', 'Season 1', 'season 1', 1)");
    run("INSERT OR IGNORE INTO items (id, library_id, parent_id, kind, name, sort_title, season_number, episode_number, match_status) VALUES (12, 1, 10, 'episode', 'S01E01 · Pilot', 'pilot', 1, 1, 'matched')");
    run("INSERT OR IGNORE INTO item_metadata (item_id, overview, runtime, rating) VALUES (12, 'Great pilot episode', 45, 8.5)");
    run("INSERT OR IGNORE INTO media_files (id, library_id, item_id, path, folder_key, size, mtime, container, video_codec) VALUES (100, 1, 12, '/test/s01e01.mp4', 'test', 1000, 1000, 'mp4', 'h264')");

    const res = await app.handle(new Request("http://localhost:8765/api/items/10"));
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.item.kind).toBe("series");
    expect(Array.isArray(data.seasons)).toBe(true);
    expect(data.seasons.length).toBe(1);
    expect(data.seasons[0].number).toBe(1);
    expect(Array.isArray(data.episodes)).toBe(true);
    expect(data.episodes.length).toBe(1);
    expect(data.episodes[0].seasonNumber).toBe(1);
    expect(data.episodes[0].episodeNumber).toBe(1);
    expect(data.episodes[0].fileId).toBe(100);
    expect(data.episodes[0].overview).toBe("Great pilot episode");
    expect(data.episodes[0].runtime).toBe(45);
  });

  test("GET /api/matches/review excludes episodes from review queue", async () => {
    const res = await app.handle(new Request("http://localhost:8765/api/matches/review"));
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(Array.isArray(data.items)).toBe(true);
    // Ensure no items in the review queue have kind = 'episode'
    const episodeEntries = data.items.filter((i: any) => i.kind === "episode");
    expect(episodeEntries.length).toBe(0);
  });

  test("nextUpEpisodes and GET /api/home handles played episodes without crashing", async () => {
    // Mark episode 12 as played
    run("INSERT OR REPLACE INTO watch_state (item_id, position_seconds, duration_seconds, played) VALUES (12, 2700, 2700, 1)");
    const res = await app.handle(new Request("http://localhost:8765/api/home"));
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data).toHaveProperty("rows");
  });

  test("POST /api/items/:id/match strictly rejects cross-type matching and episode matching", async () => {
    // 1. Movie matching as tv should be rejected with 400
    const resMovieAsTv = await app.handle(
      new Request("http://localhost:8765/api/items/1/match", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tmdbId: 100, type: "tv" }),
      }),
    );
    expect(resMovieAsTv.status).toBe(400);

    // 2. Series matching as movie should be rejected with 400
    const resSeriesAsMovie = await app.handle(
      new Request("http://localhost:8765/api/items/10/match", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tmdbId: 100, type: "movie" }),
      }),
    );
    expect(resSeriesAsMovie.status).toBe(400);

    // 3. Episode matching should be rejected with 400
    const resEpisode = await app.handle(
      new Request("http://localhost:8765/api/items/12/match", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tmdbId: 100, type: "tv" }),
      }),
    );
    expect(resEpisode.status).toBe(400);
  });

  test("GET /api/admin/artwork/storage returns storage metrics", async () => {
    const res = await app.handle(new Request("http://localhost:8765/api/admin/artwork/storage"));
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data).toHaveProperty("originalsCount");
    expect(data).toHaveProperty("derivedCount");
    expect(data).toHaveProperty("totalBytes");
  });

  test("GET /api/unknown-route returns 404", async () => {
    const res = await app.handle(new Request("http://localhost:8765/api/does-not-exist"));
    expect(res.status).toBe(404);
  });
});
