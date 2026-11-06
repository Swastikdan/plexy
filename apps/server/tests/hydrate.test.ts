import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { runMigrations, run, q, type Row } from "../src/db";
import { initConfig, save } from "../src/config";
import { hydrateMissingEpisodes } from "../src/hydrate";

const originalFetch = globalThis.fetch;

function json(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

describe("Episode Hydration (PRD 5.5)", () => {
  beforeAll(async () => {
    await runMigrations();
    await initConfig();
    await save({ tmdbToken: "test-token" });

    globalThis.fetch = (async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith("/configuration")) {
        return json({
          images: {
            base_url: "https://image.tmdb.org/t/p/",
            secure_base_url: "https://image.tmdb.org/t/p/",
            poster_sizes: ["w342", "w780", "original"],
            backdrop_sizes: ["w300", "w780", "w1280", "original"],
            still_sizes: ["w300", "original"],
            profile_sizes: ["w185", "h632", "original"],
          },
        });
      }
      if (url.includes("/tv/12345/season/1")) {
        return json({
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
        });
      }
      return new Response("{}", { status: 404 });
    }) as unknown as typeof fetch;
  });

  afterAll(() => {
    globalThis.fetch = originalFetch;
  });

  test("fills unhydrated episodes with metadata and artwork", async () => {
    run("INSERT INTO libraries (id, name, type, language) VALUES (99, 'TV Lib', 'tv', 'en-US')");
    run(
      `INSERT INTO items (id, library_id, kind, name, sort_title, match_status, tmdb_id, tmdb_type)
       VALUES (900, 99, 'series', 'Test Show', 'test show', 'matched', 12345, 'tv')`,
    );
    run(
      `INSERT INTO items (id, library_id, parent_id, kind, name, sort_title, season_number)
       VALUES (901, 99, 900, 'season', 'Season 1', 'season 1', 1)`,
    );
    run(
      `INSERT INTO items (id, library_id, parent_id, kind, name, sort_title, season_number, episode_number, match_status, tmdb_id)
       VALUES (902, 99, 900, 'episode', 'S01E01', 's01e01', 1, 1, 'matched', NULL)`,
    );

    expect(await hydrateMissingEpisodes(900)).toBe(1);

    const episode = q<Row>("SELECT name, tmdb_id FROM items WHERE id = 902").get();
    expect(episode?.tmdb_id).toBe(99901);
    expect(String(episode?.name)).toBe("S01E01 · Pilot Episode");

    const metadata = q<Row>("SELECT overview, runtime, rating FROM item_metadata WHERE item_id = 902").get();
    expect(metadata?.overview).toBe("A thrilling beginning.");
    expect(metadata?.runtime).toBe(48);
    expect(metadata?.rating).toBe(8.5);

    const artwork = q<Row>("SELECT kind, url FROM artwork WHERE item_id = 902 ORDER BY kind").all();
    expect(artwork.map((row) => row.kind).sort()).toEqual(["backdrop", "poster", "thumb"]);
    for (const row of artwork) {
      expect(String(row.url)).toStartWith("https://image.tmdb.org/t/p/");
      expect(String(row.url)).toEndWith("/test_still.jpg");
    }
    expect(artwork.find((row) => row.kind === "thumb")?.url).toBe(
      "https://image.tmdb.org/t/p/w300/test_still.jpg",
    );
  });
});
