/// Search, per-user flags, collections, and age-rating helpers.
import { beforeAll, describe, expect, test } from "bun:test";
import { buildApp } from "@/app";
import { run, runMigrations } from "@/db";
import { initConfig } from "@/config";
import { createUser } from "@/accounts";
import { createDevice } from "@/auth";
import { certificationFromDetail } from "@/tmdb";

const LIBRARY_ID = 9801;
const MOVIE_ID = 9801;
const SERIES_ID = 9802;
const EPISODE_ID = 9803;
const EPISODE_TWO_ID = 9804;
const MULTI_FILE_ID = 9899;
const PERSON_ID = 9801;

function request(app: ReturnType<typeof buildApp>, path: string, token: string, init: RequestInit = {}) {
  return app.handle(
    new Request(`http://localhost:8765/api${path}`, {
      ...init,
      headers: {
        ...(init.headers ?? {}),
        Authorization: `Bearer ${token}`,
      },
    }),
  );
}

describe("catalog feature layer", () => {
  let app: ReturnType<typeof buildApp>;
  let token: string;
  let userId: number;

  beforeAll(async () => {
    await runMigrations();
    await initConfig();
    run(
      "INSERT OR REPLACE INTO libraries (id, name, type, language) VALUES (?, 'Feature Lib', 'movies', 'en-US')",
      LIBRARY_ID,
    );
    run(
      `INSERT OR REPLACE INTO items (id, library_id, kind, name, sort_title, year, match_status)
       VALUES (?, ?, 'movie', 'Zebra Unmatched', 'zebra unmatched', 2024, 'unmatched')`,
      MOVIE_ID,
      LIBRARY_ID,
    );
    run(
      `INSERT OR REPLACE INTO item_metadata (item_id, genres, rating, certification)
       VALUES (?, '["Drama","Action"]', 8.1, 'PG-13')`,
      MOVIE_ID,
    );
    run(
      `INSERT OR REPLACE INTO items (id, library_id, kind, name, sort_title, year, match_status)
       VALUES (?, ?, 'series', 'The Bear', 'the bear', 2022, 'matched')`,
      SERIES_ID,
      LIBRARY_ID,
    );
    run(
      `INSERT OR REPLACE INTO items (id, library_id, parent_id, kind, name, sort_title, season_number, episode_number, match_status)
       VALUES (?, ?, ?, 'episode', 'S01E01 · System', 'the bear s01e01', 1, 1, 'matched')`,
      EPISODE_ID,
      LIBRARY_ID,
      SERIES_ID,
    );
    run(
      `INSERT OR REPLACE INTO items (id, library_id, parent_id, kind, name, sort_title, season_number, episode_number, match_status)
       VALUES (?, ?, ?, 'episode', 'S01E02 · System', 'the bear s01e02', 1, 2, 'matched')`,
      EPISODE_TWO_ID,
      LIBRARY_ID,
      SERIES_ID,
    );
    run(
      `INSERT OR REPLACE INTO media_files
         (id, library_id, path, folder_key, size, mtime, item_id, episode_range)
       VALUES (?, ?, '/tmp/plexy-multi-episode.mkv', 'The Bear/Season 01', 1, 1, ?, 'S01E01-E02')`,
      MULTI_FILE_ID,
      LIBRARY_ID,
      EPISODE_ID,
    );
    run(
      "INSERT OR REPLACE INTO people (id, tmdb_id, name) VALUES (?, 9801, 'Zebra Actor')",
      PERSON_ID,
    );
    run(
      "INSERT OR REPLACE INTO item_people (item_id, person_id, character_name, department, ord) VALUES (?, ?, 'Lead', 'cast', 0)",
      MOVIE_ID,
      PERSON_ID,
    );

    const username = `feature-${Date.now()}`;
    const user = await createUser(username, "feature-user-password", "admin");
    userId = user.id;
    token = createDevice("Feature test", null, null, user.id).token;
    app = buildApp({ requireAuth: true });
  });

  test("search indexes unmatched titles, parent series, genres, and people", async () => {
    const byGenre = await request(app, "/search?q=drama", token);
    expect(byGenre.status).toBe(200);
    const genreBody = await byGenre.json();
    expect(genreBody.titles.map((item: any) => item.id)).toContain(MOVIE_ID);

    const byPerson = await request(app, "/search?q=zebra", token);
    const personBody = await byPerson.json();
    expect(personBody.people.map((person: any) => person.id)).toContain(PERSON_ID);

    const bySeries = await request(app, "/search?q=bear", token);
    const seriesBody = await bySeries.json();
    expect(seriesBody.episodes.map((item: any) => item.id)).toContain(EPISODE_ID);
  });

  test("similar-title route is reachable and returns a typed list", async () => {
    const response = await request(app, `/items/${MOVIE_ID}/similar`, token);
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(Array.isArray(body.items)).toBe(true);
  });

  test("watchlist/favorite/rating flags survive and filter the library", async () => {
    const update = await request(app, `/items/${MOVIE_ID}/flags`, token, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ watchlist: true, favorite: true, rating: 4 }),
    });
    expect(update.status).toBe(200);
    const updated = await update.json();
    expect(updated).toMatchObject({ watchlist: true, favorite: true, rating: 4 });

    const watchlist = await request(app, "/items?watchlist=true", token);
    if (watchlist.status !== 200) {
      throw new Error(`watchlist filter failed: ${watchlist.status} ${await watchlist.text()}`);
    }
    const watchBody = await watchlist.json();
    expect(watchBody.items.map((item: any) => item.id)).toContain(MOVIE_ID);

    const favorites = await request(app, "/items?favorite=true", token);
    const favoriteBody = await favorites.json();
    expect(favoriteBody.items.map((item: any) => item.id)).toContain(MOVIE_ID);

    const titled = await request(app, `/items/${MOVIE_ID}`, token);
    const titleBody = await titled.json();
    expect(titleBody.item).toMatchObject({
      watchlist: true,
      favorite: true,
      userRating: 4,
    });
  });

  test("collections can be created, populated, and removed", async () => {
    const created = await request(app, "/collections", token, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "Weekend" }),
    });
    expect(created.status).toBe(200);
    const { collection } = await created.json();
    const added = await request(app, `/collections/${collection.id}/items`, token, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ itemId: MOVIE_ID }),
    });
    expect(added.status).toBe(200);

    const detail = await request(app, `/collections/${collection.id}`, token);
    const body = await detail.json();
    expect(body.collection.count).toBe(1);
    expect(body.items.map((item: any) => item.id)).toContain(MOVIE_ID);

    const removed = await request(app, `/collections/${collection.id}`, token, {
      method: "DELETE",
    });
    expect(removed.status).toBe(200);
  });

  test("a multi-episode file resolves for its later episode", async () => {
    const detail = await request(app, `/items/${EPISODE_TWO_ID}`, token);
    expect(detail.status).toBe(200);
    const body = await detail.json();
    expect(body.file).toMatchObject({ fileId: MULTI_FILE_ID, itemId: EPISODE_ID });

    const series = await request(app, `/items/${SERIES_ID}`, token);
    const seriesBody = await series.json();
    expect(seriesBody.episodes.map((episode: any) => episode.id)).toContain(EPISODE_TWO_ID);
  });

  test("history lists watched movies and episodes, and can be cleared one by one", async () => {
    const progress = (itemId: number) => request(app, "/progress", token, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ itemId, position: 60, duration: 1200, played: false }),
    });
    expect((await progress(MOVIE_ID)).status).toBe(200);
    expect((await progress(EPISODE_ID)).status).toBe(200);

    // Hiding the series also hides its episode from history.
    await request(app, `/items/${SERIES_ID}/flags`, token, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ hidden: true }),
    });
    const hidden = await (await request(app, "/history", token)).json();
    expect(hidden.items.map((item: any) => item.id)).not.toContain(EPISODE_ID);
    await request(app, `/items/${SERIES_ID}/flags`, token, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ hidden: false }),
    });

    const history = await request(app, "/history?limit=10", token);
    expect(history.status).toBe(200);
    const body = await history.json();
    expect(body.total).toBe(2);
    const episode = body.items.find((item: any) => item.id === EPISODE_ID);
    expect(episode).toMatchObject({ parentTitle: "The Bear", watchedAt: expect.any(String) });

    const removed = await request(app, `/history/${MOVIE_ID}`, token, { method: "DELETE" });
    expect(removed.status).toBe(200);
    const after = await (await request(app, "/history", token)).json();
    expect(after.items.map((item: any) => item.id)).not.toContain(MOVIE_ID);

    const cleared = await request(app, "/history", token, { method: "DELETE" });
    expect(cleared.status).toBe(200);
    const empty = await (await request(app, "/history", token)).json();
    expect(empty.total).toBe(0);
  });

  test("admin sessions list live playback and stop it on the next heartbeat", async () => {
    const progress = (position: number) => request(app, "/progress", token, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ itemId: MOVIE_ID, position, duration: 1200, played: false }),
    });
    expect((await progress(30)).status).toBe(200);

    const listed = await request(app, "/admin/sessions", token);
    expect(listed.status).toBe(200);
    const body = await listed.json();
    const session = body.sessions.find((entry: any) => entry.itemId === MOVIE_ID && entry.active);
    expect(session).toMatchObject({ userId, itemId: MOVIE_ID, status: "playing" });
    expect(body.active).toBeGreaterThanOrEqual(1);

    const stopped = await request(app, `/admin/sessions/${session.id}/stop`, token, { method: "POST" });
    expect(stopped.status).toBe(200);

    const acknowledged = await progress(45);
    expect(await acknowledged.json()).toMatchObject({ ok: true, stop: true });

    const resumed = await progress(60);
    expect(await resumed.json()).toMatchObject({ ok: true, stop: false });
  });

  test("certification selection prefers the requested region, then US", () => {
    const detail = {
      release_dates: {
        results: [
          {
            iso_3166_1: "GB",
            release_dates: [{ certification: "15" }],
          },
          {
            iso_3166_1: "US",
            release_dates: [{ certification: "R" }],
          },
        ],
      },
    } as any;
    expect(certificationFromDetail(detail, "movie", "GB")).toBe("15");
    expect(certificationFromDetail(detail, "movie", "IN")).toBe("R");

    const tv = {
      content_ratings: {
        results: [
          { iso_3166_1: "US", rating: "TV-MA" },
          { iso_3166_1: "IN", rating: "U/A" },
        ],
      },
    } as any;
    expect(certificationFromDetail(tv, "tv", "IN")).toBe("U/A");
  });
});
