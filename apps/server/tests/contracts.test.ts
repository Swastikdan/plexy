/// Contract checks for the web API.
///
/// Each entry asserts the fields the UI actually reads, so a server handler
/// cannot silently rename or drop a property that a screen depends on.
import { beforeAll, describe, expect, test } from "bun:test";
import { buildApp } from "../src/app";
import { run, runMigrations } from "../src/db";
import { initConfig } from "../src/config";

const LIBRARY_ID = 9901;
const MOVIE_ID = 9901;
const SERIES_ID = 9902;
const PERSON_ID = 9901;

function get(app: ReturnType<typeof buildApp>, path: string, init?: RequestInit) {
  return app.handle(new Request(`http://localhost:8765/api${path}`, init));
}

describe("API contracts", () => {
  const app = buildApp();

  beforeAll(async () => {
    await runMigrations();
    await initConfig();
    run(
      "INSERT OR REPLACE INTO libraries (id, name, type, language) VALUES (?, 'Contract Lib', 'movies', 'en-US')",
      LIBRARY_ID,
    );
    run(
      "INSERT OR REPLACE INTO items (id, library_id, kind, name, sort_title, year, match_status) VALUES (?, ?, 'movie', 'Contract Movie', 'contract movie', 2024, 'matched')",
      MOVIE_ID,
      LIBRARY_ID,
    );
    run(
      "INSERT OR REPLACE INTO items (id, library_id, kind, name, sort_title, year, match_status) VALUES (?, ?, 'series', 'Contract Show', 'contract show', 2023, 'matched')",
      SERIES_ID,
      LIBRARY_ID,
    );
    run(
      "INSERT OR REPLACE INTO people (id, tmdb_id, name) VALUES (?, 9901, 'Contract Actor')",
      PERSON_ID,
    );
    run(
      "INSERT OR REPLACE INTO item_people (item_id, person_id, character_name, department, ord) VALUES (?, ?, 'Lead', 'cast', 0)",
      MOVIE_ID,
      PERSON_ID,
    );
  });

  test("home exposes a featured card and rows of cards", async () => {
    const response = await get(app, "/home");
    expect(response.status).toBe(200);
    const body = (await response.json()) as Record<string, unknown>;
    expect(body).toHaveProperty("featured");
    expect(Array.isArray(body.rows)).toBe(true);
    for (const row of body.rows as Array<Record<string, unknown>>) {
      expect(typeof row.key).toBe("string");
      expect(typeof row.title).toBe("string");
      expect(Array.isArray(row.items)).toBe(true);
    }
  });

  test("item list returns the fields the grids render", async () => {
    const response = await get(app, "/items?limit=5");
    expect(response.status).toBe(200);
    const body = (await response.json()) as { items: Array<Record<string, unknown>> };
    expect(Array.isArray(body.items)).toBe(true);
    const card = body.items[0];
    if (!card) return;
    for (const field of ["id", "publicId", "kind", "name", "poster", "backdrop", "genres", "matchStatus"]) {
      expect(card).toHaveProperty(field);
    }
  });

  test("title detail carries item, metadata, cast, seasons, episodes, and file facts", async () => {
    const response = await get(app, `/items/${MOVIE_ID}`);
    expect(response.status).toBe(200);
    const body = (await response.json()) as Record<string, unknown>;
    for (const field of ["item", "logo", "metadata", "cast", "trailer", "seasons", "episodes", "file", "unmatched"]) {
      expect(body).toHaveProperty(field);
    }
    const cast = body.cast as Array<Record<string, unknown>>;
    expect(cast.length).toBeGreaterThan(0);
    for (const field of ["id", "name", "character", "photo"]) expect(cast[0]).toHaveProperty(field);
  });

  test("person detail returns the photo and only locally available titles", async () => {
    const response = await get(app, `/people/${PERSON_ID}`);
    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      person: Record<string, unknown>;
      items: Array<Record<string, unknown>>;
    };
    expect(body.person).toMatchObject({ id: PERSON_ID, name: "Contract Actor" });
    expect(body.person).toHaveProperty("photo");
    expect(body.items.some((item) => item.id === MOVIE_ID)).toBe(true);
  });

  test("search splits titles from episodes", async () => {
    const response = await get(app, "/search?q=contract");
    expect(response.status).toBe(200);
    const body = (await response.json()) as Record<string, unknown>;
    expect(Array.isArray(body.titles)).toBe(true);
    expect(Array.isArray(body.episodes)).toBe(true);
  });

  test("library list keeps id, name, type, paths, and counts", async () => {
    const response = await get(app, "/libraries");
    expect(response.status).toBe(200);
    const body = (await response.json()) as { libraries: Array<Record<string, unknown>> };
    expect(Array.isArray(body.libraries)).toBe(true);
    const library = body.libraries.find((entry) => entry.id === LIBRARY_ID);
    expect(library).toBeDefined();
    for (const field of ["id", "name", "type", "language", "paths", "counts"]) {
      expect(library).toHaveProperty(field);
    }
  });
});
