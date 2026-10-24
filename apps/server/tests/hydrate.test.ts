import { beforeAll, describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { runMigrations, run, q, type Row } from "../src/db";
import { initConfig } from "../src/config";
import { hydrateMissingEpisodes } from "../src/hydrate";

describe("Episode Hydration (PRD 5.5)", () => {
  beforeAll(async () => {
    await runMigrations();
    await initConfig();
  });

  test("hydrateMissingEpisodes populates unhydrated episodes and artwork", async () => {
    // Insert mock series and season
    run("INSERT OR IGNORE INTO libraries (id, name, type, language) VALUES (99, 'TV Lib', 'tv', 'en-US')");
    run(
      `INSERT INTO items (id, library_id, kind, name, sort_title, match_status, tmdb_id, tmdb_type)
       VALUES (900, 99, 'series', 'Test Show', 'test show', 'matched', 12345, 'tv')
       ON CONFLICT(id) DO UPDATE SET match_status='matched', tmdb_id=12345`,
    );
    run(
      `INSERT INTO items (id, library_id, parent_id, kind, name, sort_title, season_number)
       VALUES (901, 99, 900, 'season', 'Season 1', 'season 1', 1)
       ON CONFLICT(id) DO NOTHING`,
    );

    // Insert an unhydrated episode (like raw scanner insertion)
    run(
      `INSERT INTO items (id, library_id, parent_id, kind, name, sort_title, season_number, episode_number, match_status, tmdb_id)
       VALUES (902, 99, 900, 'episode', 'S01E01', 's01e01', 1, 1, 'matched', NULL)
       ON CONFLICT(id) DO UPDATE SET tmdb_id=NULL`,
    );

    // Seed tmdb_cache for image config
    run(
      `INSERT INTO tmdb_cache (key, endpoint, body, expires_at)
       VALUES ('tmdb/images/config/original', 'config', ?, ?)
       ON CONFLICT(key) DO UPDATE SET body=excluded.body, expires_at=excluded.expires_at`,
      JSON.stringify({
        baseUrl: "https://image.tmdb.org/t/p/",
        posterSize: "original",
        backdropSize: "w1280",
        stillSize: "w300",
        profileSize: "original",
      }),
      Date.now() + 86400000,
    );

    // Seed tmdb_cache for season 1
    const seasonUrl = "https://api.themoviedb.org/3/tv/12345/season/1?language=en-US";
    const seasonKey = createHash("sha1").update(seasonUrl).digest("hex");
    run(
      `INSERT INTO tmdb_cache (key, endpoint, body, expires_at)
       VALUES (?, 'season', ?, ?)
       ON CONFLICT(key) DO UPDATE SET body=excluded.body, expires_at=excluded.expires_at`,
      seasonKey,
      JSON.stringify({
        episodes: [
          {
            id: 99901,
            name: "Pilot Episode",
            episode_number: 1,
            season_number: 1,
            overview: "A thrilling beginning.",
            still_path: "/test_still.jpg",
            runtime: 48,
            vote_average: 8.5,
          },
        ],
      }),
      Date.now() + 86400000,
    );

    const count = await hydrateMissingEpisodes(900);
    expect(count).toBe(1);

    // Verify episode item was updated with name and tmdb_id
    const epRow = q<Row>("SELECT * FROM items WHERE id = 902").get();
    expect(epRow?.tmdb_id).toBe(99901);
    expect(String(epRow?.name)).toContain("Pilot Episode");

    // Verify metadata was persisted
    const metaRow = q<Row>("SELECT * FROM item_metadata WHERE item_id = 902").get();
    expect(metaRow?.overview).toBe("A thrilling beginning.");
    expect(metaRow?.runtime).toBe(48);
    expect(metaRow?.poster_path).toBe("/test_still.jpg");

    // Verify artwork was created for thumb, poster, and backdrop
    const artRows = q<Row>("SELECT kind, url FROM artwork WHERE item_id = 902").all();
    expect(artRows.length).toBe(3);
    const kinds = artRows.map((a) => a.kind);
    expect(kinds).toContain("thumb");
    expect(kinds).toContain("poster");
    expect(kinds).toContain("backdrop");
  });
});
