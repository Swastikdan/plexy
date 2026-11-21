/// Home hero playback: a series hero must hand the Play button a real episode
/// file, because the series row itself owns no media. The server resolves it
/// from the candidate's first episode (or the last watched one) so the client
/// never has to guess.
import { beforeAll, describe, expect, test } from "bun:test";
import { buildApp } from "@/app";
import { run, runMigrations } from "@/db";
import { initConfig } from "@/config";
import { createDevice } from "@/auth";

const LIBRARY_ID = 9960;
const SERIES_ID = 9961;
const SEASON_ONE_EPISODE_ONE = 9962;
const SEASON_ONE_EPISODE_TWO = 9963;
const SEASON_TWO_EPISODE_ONE = 9964;

/** Media file ids are chosen explicitly so the assertion can name one. */
const FILE_S01E01 = 9962;
const FILE_S01E02 = 9963;
const FILE_S02E01 = 9964;

function get(app: ReturnType<typeof buildApp>, path: string, token?: string) {
  return app.handle(
    new Request(`http://localhost:8765/api${path}`, {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    }),
  );
}

function addEpisode(id: number, season: number, episode: number) {
  run(
    `INSERT OR REPLACE INTO items (id, library_id, parent_id, kind, name, sort_title, season_number, episode_number, match_status)
     VALUES (?, ?, ?, 'episode', ?, ?, ?, ?, 'matched')`,
    id, LIBRARY_ID, SERIES_ID, `S0${season}E0${episode}`, `contract show s0${season}e0${episode}`, season, episode,
  );
  run(
    `INSERT OR REPLACE INTO media_files (id, library_id, path, folder_key, size, mtime, item_id)
     VALUES (?, ?, ?, 'contract-show', 1000, 1, ?)`,
    id, LIBRARY_ID, `/media/contract-show/S0${season}E0${episode}.mkv`, id,
  );
}

describe("home hero playback", () => {
  const app = buildApp();

  beforeAll(async () => {
    await runMigrations();
    await initConfig();
    run(
      "INSERT OR REPLACE INTO libraries (id, name, type, language) VALUES (?, 'Hero Lib', 'tv', 'en-US')",
      LIBRARY_ID,
    );
    run(
      `INSERT OR REPLACE INTO items (id, library_id, kind, name, sort_title, year, match_status)
       VALUES (?, ?, 'series', 'Hero Show', 'hero show', 2024, 'matched')`,
      SERIES_ID, LIBRARY_ID,
    );
    run(
      "INSERT OR REPLACE INTO artwork (item_id, kind, source, url) VALUES (?, 'backdrop', 'tmdb', 'https://image.tmdb.org/t/p/w1280/hero.jpg')",
      SERIES_ID,
    );
    run(
      "INSERT OR REPLACE INTO item_metadata (item_id, rating) VALUES (?, 9.1)",
      SERIES_ID,
    );
    // Season two is inserted first: the hero must still start from the real
    // opening episode, not from insertion order.
    addEpisode(SEASON_TWO_EPISODE_ONE, 2, 1);
    addEpisode(SEASON_ONE_EPISODE_TWO, 1, 2);
    addEpisode(SEASON_ONE_EPISODE_ONE, 1, 1);
  });

  test("a series hero opens its first episode", async () => {
    const response = await get(app, "/home");
    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      featured: { id: number; kind: string; playFileId?: number | null; playSubtitle?: string | null } | null;
    };
    expect(body.featured?.id).toBe(SERIES_ID);
    expect(body.featured?.kind).toBe("series");
    expect(body.featured?.playFileId).toBe(FILE_S01E01);
    expect(body.featured?.playSubtitle).toBe("S01E01");
  });

  test("a continuing viewer resumes the episode they were watching", async () => {
    run(
      "INSERT OR REPLACE INTO users (id, username, password_hash, role) VALUES (9971, 'hero-viewer', 'x', 'user')",
    );
    run(
      "INSERT OR REPLACE INTO access_rules (user_id, scope, target, allowed) VALUES (9971, 'library', ?, 1)",
      String(LIBRARY_ID),
    );
    const { token } = createDevice("hero-viewer", null, null, 9971);
    run(
      `INSERT OR REPLACE INTO watch_state (user_id, item_id, position_seconds, duration_seconds, played, updated_at)
       VALUES (9971, ?, 420, 2400, 0, datetime('now'))`,
      SEASON_ONE_EPISODE_TWO,
    );

    const response = await get(app, "/home", token);
    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      featured: {
        id: number;
        playFileId?: number | null;
        playSubtitle?: string | null;
        playWatch?: { position: number; played: boolean } | null;
      } | null;
    };
    expect(body.featured?.id).toBe(SERIES_ID);
    // The last watched episode wins over the first one, so Play continues.
    expect(body.featured?.playFileId).toBe(FILE_S01E02);
    expect(body.featured?.playSubtitle).toBe("S01E02");
    expect(body.featured?.playWatch?.position).toBe(420);
    expect(body.featured?.playWatch?.played).toBe(false);
  });

  test("a series without episodes has nothing to play", async () => {
    run(
      `INSERT OR REPLACE INTO items (id, library_id, kind, name, sort_title, year, match_status)
       VALUES (9970, ?, 'series', 'Empty Show', 'empty show', 2022, 'matched')`,
      LIBRARY_ID,
    );
    run(
      "INSERT OR REPLACE INTO item_metadata (item_id, rating) VALUES (9970, 9.9)",
    );
    run(
      "INSERT OR REPLACE INTO artwork (item_id, kind, source, url) VALUES (9970, 'backdrop', 'tmdb', 'https://image.tmdb.org/t/p/w1280/empty.jpg')",
    );
    const response = await get(app, "/home");
    const body = (await response.json()) as {
      featured: { id: number; playFileId?: number | null } | null;
    };
    // The best-rated title with a backdrop is the empty series, and Play falls
    // back to the title page because there is no file to open.
    expect(body.featured?.id).toBe(9970);
    expect(body.featured?.playFileId ?? null).toBeNull();
  });
});
