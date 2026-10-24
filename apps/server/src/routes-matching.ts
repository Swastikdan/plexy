/// Matching admin routes (PRD 5.4, 5.5, 9, 10.5).
///
/// Review queue listing, TMDB search for the "Fix match" dialog, applying a
/// locked manual match, per-item metadata refresh, and the name-parser "test a
/// file name" helper. All loopback-only.
import { Elysia, t } from "elysia";
import { db, q, run, type Row } from "./db";
import { log } from "./logger";
import { denyIfNotLocal } from "./essentials";
import { search, detail, imageUrl, TmdbError } from "./tmdb";
import { match, refineWithRuntime, type Candidate } from "./matcher";
import { parsePath } from "./parse";
import { normalizeTitle } from "./parse";

/** View of one item in the review queue. */
function reviewRow(row: Row): Record<string, unknown> {
  const candidates = q<Row>(
    "SELECT * FROM match_candidates WHERE item_id = ? ORDER BY position LIMIT 3",
  ).all(Number(row.id));
  return {
    id: Number(row.id),
    kind: String(row.kind),
    name: String(row.name),
    year: row.year as number | null,
    parsedTitle: row.reason as string | null,
    matchStatus: String(row.match_status),
    score: row.score as number | null,
    matchedBy: row.matched_by as string | null,
    reason: row.reason as string | null,
    tmdbId: row.tmdb_id as number | null,
    candidatesScroll: candidates.length,
  };
}

export const matchingRoutes = new Elysia({ prefix: "/api", normalize: "typebox" })
  /** Items to fix: review + unmatched, with their stored candidates. */
  .get("/matches/review", async (ctx) => {
    const denied = denyIfNotLocal(ctx, "GET /api/matches/review");
    if (denied) return denied;
    const rows = q<Row>(
      `SELECT * FROM items
       WHERE match_status IN ('review','unmatched') AND kind IN ('movie','series')
       ORDER BY CASE match_status WHEN 'review' THEN 0 ELSE 1 END, sort_title
       LIMIT 200`,
    ).all();
    const out = await Promise.all(rows.map(async (row) => {
      const candidates = q<Row>(
        "SELECT * FROM match_candidates WHERE item_id = ? ORDER BY position LIMIT 3",
      ).all(Number(row.id)).map(async (c) => ({
        tmdbId: Number(c.tmdb_id),
        tmdbType: String(c.tmdb_type),
        title: String(c.title),
        year: c.year as number | null,
        score: Number(c.score),
        reason: String(c.reason),
        poster: await imageUrl(c.poster_path as string | null, "poster"),
      }));
      return {
        id: Number(row.id),
        kind: String(row.kind),
        parentTitle: row.parent_id ? (q<Row>("SELECT name FROM items WHERE id = ?").get(Number(row.parent_id))?.name ?? null) : null,
        name: String(row.name),
        year: row.year as number | null,
        seasonNumber: row.season_number as number | null,
        episodeNumber: row.episode_number as number | null,
        matchStatus: String(row.match_status),
        score: row.score as number | null,
        reason: row.reason as string | null,
        candidates: await Promise.all(candidates),
      };
    }));
    return { items: out };
  })

  /** TMDB search straight from the fix-match dialog (no saved state). */
  .post("/match/search", async ({ body, server, request }) => {
    const denied = denyIfNotLocal({ server, request }, "POST /api/match/search");
    if (denied) return denied;
    try {
      const results = await search(body.type, body.query, body.year ?? null);
      return {
        results: await Promise.all(results.slice(0, 6).map(async (r) => ({
          tmdbId: r.id,
          type: body.type,
          title: r.title ?? r.name ?? "",
          year: Number((r.release_date ?? r.first_air_date ?? "").slice(0, 4)) || null,
          overview: r.overview ?? null,
          poster: await imageUrl(r.poster_path ?? null, "poster"),
        }))),
      };
    } catch (err) {
      const e = err instanceof TmdbError ? err : new TmdbError(String(err), 502, "TMDB request failed");
      return Response.json({ error: e.userMessage }, { status: 502 });
    }
  }, {
    body: t.Object({
      type: t.Union([t.Literal("movie"), t.Literal("tv")]),
      query: t.String({ minLength: 1 }),
      year: t.Optional(t.Numeric()),
    }),
  })

  /** Preview a candidate before applying (PRD 5.5 "Fix match" flow). */
  .get("/match/preview/:type/:tmdbId", async ({ params, server, request }) => {
    const denied = denyIfNotLocal({ server, request }, "GET /api/match/preview");
    if (denied) return denied;
    try {
      const full = await detail(params.type as "movie" | "tv", Number(params.tmdbId));
      return {
        tmdbId: full.id,
        type: params.type,
        title: full.title ?? full.name ?? "",
        year: Number((full.release_date ?? full.first_air_date ?? "").slice(0, 4)) || null,
        overview: full.overview ?? null,
        runtime: full.runtime ?? null,
        rating: full.vote_average ?? null,
        poster: await imageUrl(full.poster_path ?? null, "poster"),
        backdrop: await imageUrl(full.backdrop_path ?? null, "backdrop"),
      };
    } catch (err) {
      const e = err instanceof TmdbError ? err : new TmdbError(String(err), 502, "TMDB request failed");
      return Response.json({ error: e.userMessage }, { status: 502 });
    }
  })

  /**
   * Apply a manual match. Locked (PRD 5.4.8): rescans never overwrite it and
   * the matcher skips the item entirely.
   */
  .post("/items/:id/match", async (ctx) => {
    const denied = denyIfNotLocal(ctx, "POST /api/items/:id/match");
    if (denied) return denied;
    const itemId = Number(ctx.params.id);
    const row = q<Row>("SELECT * FROM items WHERE id = ?").get(itemId);
    if (!row) return Response.json({ error: "Not found" }, { status: 404 });

    const type: "movie" | "tv" = ctx.body.type;
    if (row.kind === "episode") {
      return Response.json({ error: "Cannot match individual episodes. Match the parent series instead." }, { status: 400 });
    }
    if (row.kind === "movie" && type !== "movie") {
      return Response.json({ error: "A movie cannot be matched as a TV show." }, { status: 400 });
    }
    if (row.kind === "series" && type !== "tv") {
      return Response.json({ error: "A TV series cannot be matched as a movie." }, { status: 400 });
    }
    try {
      const full = await detail(type, ctx.body.tmdbId);
      const title = full.title ?? full.name ?? "";
      const year = Number((full.release_date ?? full.first_air_date ?? "").slice(0, 4)) || null;
      run(
        `UPDATE items SET
           match_status = 'matched',
           tmdb_type = ?, tmdb_id = ?, score = 1,
           matched_by = 'manual', locked = 1,
           reason = ?,
           year = COALESCE(?, year),
           name = CASE WHEN kind IN ('movie','series') THEN ? ELSE name END,
           sort_title = CASE WHEN kind IN ('movie','series') THEN ? ELSE sort_title END,
           refreshed_at = ?
         WHERE id = ?`,
        type, full.id, `manual match`, year, title,
        normalizeTitle(title), new Date().toISOString(), itemId,
      );
      q("DELETE FROM match_candidates WHERE item_id = ?").run(itemId);
      log.info("matcher", "manual match applied", { itemId, tmdbId: full.id, type });

      // Hydrate metadata + artwork immediately so the UI can show the result.
      const { hydrateItemMetadata } = await import("./hydrate");
      await hydrateItemMetadata(itemId, type, full.id);
      return { ok: true };
    } catch (err) {
      const e = err instanceof TmdbError ? err : new TmdbError(String(err), 502, "TMDB request failed");
      return Response.json({ error: e.userMessage }, { status: 502 });
    }
  }, {
    body: t.Object({
      tmdbId: t.Numeric(),
      type: t.Union([t.Literal("movie"), t.Literal("tv")]),
    }),
  })

  /** Explicit metadata refresh (S in PRD 5.5, exposed for matched items). */
  .post("/items/:id/refresh", async (ctx) => {
    const denied = denyIfNotLocal(ctx, "POST /api/items/:id/refresh");
    if (denied) return denied;
    const row = q<Row>("SELECT * FROM items WHERE id = ?").get(Number(ctx.params.id));
    if (!row) return Response.json({ error: "Not found" }, { status: 404 });
    if (!row.tmdb_id) return Response.json({ error: "Item is not matched yet" }, { status: 400 });
    const { hydrateItemMetadata } = await import("./hydrate");
    await hydrateItemMetadata(Number(row.id), row.tmdb_type as "movie" | "tv", Number(row.tmdb_id));
    return { ok: true };
  })

  /**
   * Offline helper for admins: parse a file name without saving anything
   * ("Test a file name" in the matching review, PRD 10.5).
   */
  .post("/match/test-name", ({ body }) => {
    const parsed = parsePath(body.name, body.type, ["/"]);
    return { parsed };
  }, {
    body: t.Object({
      name: t.String({ minLength: 1 }),
      type: t.Union([t.Literal("movies"), t.Literal("tv")]),
    }),
  });

/** Exported for scan.ts reuse: candidate persistence shape. */
export type { Candidate };
