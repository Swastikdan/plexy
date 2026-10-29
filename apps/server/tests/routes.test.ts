import { beforeAll, describe, expect, test } from "bun:test";
import { buildApp } from "../src/app";
import { runMigrations, run } from "../src/db";
import { initConfig, APP_VERSION } from "../src/config";
import { createDevice } from "../src/auth";

describe("Elysia API Routes (PRD 9)", () => {
  let app: ReturnType<typeof buildApp>;

  beforeAll(async () => {
    await runMigrations();
    await initConfig();
    run("INSERT OR IGNORE INTO libraries (id, name, type, language) VALUES (1, 'Test Lib', 'movies', 'en-US')");
    run("INSERT OR IGNORE INTO items (id, library_id, kind, name, sort_title) VALUES (1, 1, 'movie', 'Test Movie', 'test movie')");
    app = buildApp();
  });

  test("public status probe omits operational details; paired status includes them", async () => {
    const res = await app.handle(new Request("http://localhost:8765/api/server/status"));
    expect(res.status).toBe(200);

    const data = await res.json();
    expect(data.version).toBe(APP_VERSION);
    expect(typeof data.serverId).toBe("string");
    expect(typeof data.setupComplete).toBe("boolean");
    expect(data).not.toHaveProperty("recentScans");

    const { token } = createDevice("Status test device");
    const paired = await app.handle(new Request("http://localhost:8765/api/server/status", {
      headers: { Authorization: `Bearer ${token}` },
    }));
    const privateStatus = await paired.json();
    expect(typeof privateStatus.adminAvailable).toBe("boolean");
    expect(privateStatus.serverId).toBe(data.serverId);
    expect(Array.isArray(privateStatus.recentScans)).toBe(true);
  });

  test("playback diagnostics retain bounded metadata without media paths", async () => {
    const reported = await app.handle(new Request("http://localhost:8765/api/diagnostics/playback", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ kind: "rebuffer", path: "hls", durationMs: 850 }),
    }));
    expect(reported.status).toBe(200);

    const response = await app.handle(new Request("http://localhost:8765/api/diagnostics/playback"));
    const { events } = await response.json();
    expect(events[0]).toMatchObject({ kind: "rebuffer", path: "hls", durationMs: 850 });
    expect(events[0]).not.toHaveProperty("filePath");
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

  test("GET /api/search splits titles and episodes for query", async () => {
    const res = await app.handle(
      new Request("http://localhost:8765/api/search?q=Avatar"),
    );
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(Array.isArray(data.titles)).toBe(true);
    expect(Array.isArray(data.episodes)).toBe(true);
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

  test("GET /api/logs returns a lines array", async () => {
    const res = await app.handle(new Request("http://localhost:8765/api/logs"));
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(Array.isArray(data.lines)).toBe(true);
  });

  test("GET /api/matches/review?status=all exposes matched titles for manual remapping", async () => {
    run("INSERT OR IGNORE INTO items (id, library_id, kind, folder_key, name, sort_title, match_status, tmdb_type, tmdb_id, matched_by, score) VALUES (20, 1, 'movie', 'Inception (2010)', 'Wrongly Matched Film', 'wrongly matched film', 'matched', 'movie', 999, 'search', 0.61)");
    run("UPDATE items SET folder_key = 'Inception (2010)' WHERE id = 20");
    run("INSERT OR IGNORE INTO media_files (id, library_id, item_id, path, folder_key, size, mtime) VALUES (200, 1, 20, '/tmp/Movies/Inception (2010)/Inception.2010.1080p.mkv', 'Inception (2010)', 1, 1)");
    run("UPDATE media_files SET item_id = 20, unavailable = 0 WHERE id = 200");

    const attention = await app.handle(new Request("http://localhost:8765/api/matches/review"));
    const attentionData = await attention.json();
    expect(attentionData.items.some((i: any) => i.id === 20)).toBe(false);
    expect(typeof attentionData.counts.all).toBe("number");
    expect(attentionData.counts.attention).toBe(attentionData.counts.review + attentionData.counts.unmatched);

    const all = await app.handle(new Request("http://localhost:8765/api/matches/review?status=all"));
    const allData = await all.json();
    const entry = allData.items.find((i: any) => i.id === 20);
    expect(entry).toBeTruthy();
    expect(entry.matchStatus).toBe("matched");
    expect(entry.matchedBy).toBe("search");
    expect(entry.tmdbId).toBe(999);
    expect(entry.originalName).toBe("Inception (2010)");
    expect(entry.fileName).toBe("Inception.2010.1080p.mkv");

    const searched = await app.handle(new Request("http://localhost:8765/api/matches/review?status=all&q=Wrongly"));
    const searchedData = await searched.json();
    expect(searchedData.items.some((i: any) => i.id === 20)).toBe(true);
    expect(searchedData.items.every((i: any) => /wrongly/i.test(i.name) || /wrongly/i.test(i.sort_title ?? ""))).toBe(true);

    // A wrong match replaces the title, so searching by the on-disk folder name
    // must still find the item through its file path.
    const byFolder = await app.handle(new Request("http://localhost:8765/api/matches/review?status=all&q=Inception"));
    const byFolderData = await byFolder.json();
    expect(byFolderData.items.some((i: any) => i.id === 20)).toBe(true);
  });

  test("nextUpEpisodes and GET /api/home handles played episodes without crashing", async () => {
    // Mark episode 12 as played
    run("INSERT OR REPLACE INTO watch_state (item_id, position_seconds, duration_seconds, played) VALUES (12, 2700, 2700, 1)");
    const res = await app.handle(new Request("http://localhost:8765/api/home"));
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data).toHaveProperty("rows");
  });

  test("Next up never repeats the in-progress episode from Continue watching", async () => {
    // Use a dedicated series so this test never changes the series fixture above.
    run("INSERT OR IGNORE INTO items (id, library_id, parent_id, kind, name, sort_title, season_number) VALUES (910, 1, NULL, 'season', 'Nested Season 1', 'nested season 1', 1)");
    run("INSERT OR IGNORE INTO items (id, library_id, parent_id, kind, name, sort_title, season_number, episode_number, match_status) VALUES (911, 1, 910, 'episode', 'S01E01 · First', 'nested first', 1, 1, 'matched')");
    run("INSERT OR IGNORE INTO items (id, library_id, parent_id, kind, name, sort_title, season_number, episode_number, match_status) VALUES (912, 1, 910, 'episode', 'S01E02 · Second', 'nested second', 1, 2, 'matched')");
    run("INSERT OR IGNORE INTO items (id, library_id, parent_id, kind, name, sort_title, season_number, episode_number, match_status) VALUES (913, 1, 910, 'episode', 'S01E03 · Third', 'nested third', 1, 3, 'matched')");

    const rowsOf = (data: any, key: string) =>
      (data.rows.find((r: any) => r.key === key)?.items ?? []).map((i: any) => i.id);

    try {
      // Episode 911 is finished; episode 912 is mid-playback.
      run("INSERT OR REPLACE INTO watch_state (item_id, position_seconds, duration_seconds, played) VALUES (911, 2700, 2700, 1)");
      run("INSERT OR REPLACE INTO watch_state (item_id, position_seconds, duration_seconds, played) VALUES (912, 600, 2700, 0)");

      const inProgress = await (await app.handle(new Request("http://localhost:8765/api/home"))).json();
      expect(rowsOf(inProgress, "continue")).toContain(912);
      expect(rowsOf(inProgress, "next")).not.toContain(912);
      expect(rowsOf(inProgress, "next")).not.toContain(913);

      // Once episode 912 is finished, episode 913 becomes Next up.
      await app.handle(
        new Request("http://localhost:8765/api/watch/912/played", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ played: true }),
        }),
      );
      const finished = await (await app.handle(new Request("http://localhost:8765/api/home"))).json();
      expect(rowsOf(finished, "next")).toContain(913);
      expect(rowsOf(finished, "next")).not.toContain(912);
      expect(rowsOf(finished, "continue")).not.toContain(912);
    } finally {
      run("DELETE FROM watch_state WHERE item_id IN (911, 912, 913)");
      run("DELETE FROM items WHERE id IN (913, 912, 911, 910)");
    }
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

  test("PUT /api/settings persists local prefetch preferences and rejects out-of-range values", async () => {
    try {
      const res = await app.handle(
        new Request("http://localhost:8765/api/settings", {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            prefetchAggressiveLocal: false,
            prefetchMaxConcurrent: 4,
            prefetchMaxCacheMb: 120,
            prefetchOnHover: false,
            prefetchOnScroll: true,
            prefetchNextCount: 7,
          }),
        }),
      );
      expect(res.status).toBe(200);
      const saved = await res.json();
      expect(saved.settings).toMatchObject({
        prefetchAggressiveLocal: false,
        prefetchMaxConcurrent: 4,
        prefetchMaxCacheMb: 120,
        prefetchOnHover: false,
        prefetchOnScroll: true,
        prefetchNextCount: 7,
      });

      // Round-trips through GET instead of only echoing the request.
      const read = await (await app.handle(new Request("http://localhost:8765/api/settings"))).json();
      expect(read.settings.prefetchMaxConcurrent).toBe(4);
      expect(read.settings.prefetchNextCount).toBe(7);

      const invalid = await app.handle(
        new Request("http://localhost:8765/api/settings", {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ prefetchMaxConcurrent: 50 }),
        }),
      );
      expect(invalid.status).toBe(422);
    } finally {
      await app.handle(
        new Request("http://localhost:8765/api/settings", {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            prefetchAggressiveLocal: true,
            prefetchMaxConcurrent: 3,
            prefetchMaxCacheMb: 50,
            prefetchOnHover: true,
            prefetchOnScroll: true,
            prefetchNextCount: 5,
          }),
        }),
      );
    }
  });

  test("GET /api/unknown-route returns 404", async () => {
    const res = await app.handle(new Request("http://localhost:8765/api/does-not-exist"));
    expect(res.status).toBe(404);
  });
});
