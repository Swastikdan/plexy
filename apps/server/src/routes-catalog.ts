import { accessSql, canAccessFile, canAccessItem } from "./access";
import { requestUser } from "./auth";
/// Catalog routes.
///
/// What the viewer sees: home rows, library grids, search, title detail, and
/// the shared watch state. Filesystem paths never leave the server through
/// these routes (PRD 11) — media resolves only by file id.
import { Elysia, t } from "elysia";
import { stat } from "node:fs/promises";
import { join } from "node:path";
import { db, q, run, type Row } from "./db";
import { log } from "./logger";
import { imageUrl } from "./tmdb";
import { classifyPlayability, rowPlayabilityFacts } from "./playback";
import { optimizationView } from "./optimize";
import { denyIfNotLocal, apiError } from "./essentials";
import { getConfig } from "./config";
import { removeOriginal } from "./trash";
import { fileForEpisode } from "./episode-files";
import {
  ensureSearchIndex,
  fallbackIds,
  searchIds,
  searchPeople,
} from "./search-index";
import type { ItemCard } from "@plexy/api-client";

// --- card assembly -----------------------------------------------------------

export type { ItemCard };

/** Upgrade any low-res TMDB artwork URLs to crisp modern definitions. */
export function upgradeArtworkUrl(url: string | null, kind: string): string | null {
  if (!url || !url.includes("image.tmdb.org/t/p/")) return url;
  if (kind === "backdrop") {
    return url.replace(/\/t\/p\/w300\//, "/t/p/w1280/");
  }
  if (kind === "poster") {
    return url.replace(/\/t\/p\/(w92|w154|w185|w342)\//, "/t/p/w780/");
  }
  if (kind === "thumb") {
    return url.replace(/\/t\/p\/(w92|w185)\//, "/t/p/w300/");
  }
  if (kind === "logo") {
    return url.replace(/\/t\/p\/(w45|w92|w154|w185)\//, "/t/p/w500/");
  }
  return url;
}

const ART_WIDTH: Record<string, number> = { poster: 500, backdrop: 1600, thumb: 300, logo: 800 };

/** Request exactly the pixels a card renders, not the full-size original. */
function sizedImageUrl(artworkId: number, kind: string): string {
  return `/api/images/${artworkId}?w=${ART_WIDTH[kind] ?? 500}`;
}

/**
 * Decorate raw item rows with artwork, metadata, files and watch state. Three indexed
 * queries beat a correlated subquery per row on large libraries.
 */
export async function attachArt(rows: Row[], request: Request): Promise<ItemCard[]> {
  const user = requestUser(request);
  if (user) rows = rows.filter(row => canAccessItem(user, Number(row.id)));
  const userId = user?.id ?? 0;
  const ids = rows.map((r) => Number(r.id));
  if (!ids.length) return [];
  const ph = ids.map(() => "?").join(",");

  const artRows = q<Row>(
    `SELECT id, item_id, kind, source, url FROM artwork WHERE item_id IN (${ph}) AND kind IN ('poster','backdrop','thumb','logo')`,
  ).all(...ids);
  const metaRows = q<Row>(
    `SELECT item_id, rating, runtime, overview, genres FROM item_metadata WHERE item_id IN (${ph})`,
  ).all(...ids);
  const watchRows = q<Row>(
    `SELECT item_id, position_seconds, duration_seconds, played FROM watch_state WHERE user_id = ${userId} AND item_id IN (${ph})`,
  ).all(...ids);
  const flagRows = userId
    ? q<Row>(
        `SELECT item_id, watchlist, favorite, hidden, rating FROM user_item_flags
         WHERE user_id = ? AND item_id IN (${ph})`,
      ).all(userId, ...ids)
    : [];
  const fileRows = q<Row>(
    `SELECT id, item_id FROM media_files WHERE item_id IN (${ph}) AND unavailable = 0 ORDER BY id DESC`,
  ).all(...ids);

  const fileIds = new Map<number, number>();
  for (const f of fileRows) {
    if (user && !canAccessFile(user, Number(f.id))) continue;
    const itId = Number(f.item_id);
    if (!fileIds.has(itId)) {
      fileIds.set(itId, Number(f.id));
    }
  }

  // Episode cards read best as "Series · S01E03". The parent lookup is one
  // extra indexed query for the whole page, not one per row.
  const parentIds = [...new Set(rows
    .map((row) => (row.parent_id == null ? null : Number(row.parent_id)))
    .filter((id): id is number => id != null && id > 0))];
  const parents = new Map<number, Row>();
  if (parentIds.length) {
    const parentPh = parentIds.map(() => "?").join(",");
    for (const parent of q<Row>(
      `SELECT id, name, public_id FROM items WHERE id IN (${parentPh})`,
    ).all(...parentIds)) {
      parents.set(Number(parent.id), parent);
    }
  }

  const art = new Map<number, Record<string, string>>();
  for (const a of artRows) {
    const id = Number(a.item_id);
    const m = art.get(id) ?? {};
    const kind = String(a.kind);
    m[kind] = sizedImageUrl(Number(a.id), kind);
    art.set(id, m);
  }
  const meta = new Map(metaRows.map((m) => [Number(m.item_id), m]));
  const watch = new Map(watchRows.map((w) => [Number(w.item_id), w]));
  const flags = new Map(flagRows.map((f) => [Number(f.item_id), f]));

  return rows.map((row) => {
    const id = Number(row.id);
    // A multi-episode file belongs to the first episode only; later siblings
    // resolve the same file through their stored range.
    if (!fileIds.has(id) && String(row.kind) === "episode") {
      const covering = fileForEpisode(id);
      if (covering && (!user || canAccessFile(user, Number(covering.id)))) {
        fileIds.set(id, Number(covering.id));
      }
    }
    const w = watch.get(id);
    const position = w ? Number(w.position_seconds) : 0;
    const duration = w && w.duration_seconds != null ? Number(w.duration_seconds) : null;
    const played = w ? !!Number(w.played) : false;
    const md = meta.get(id);
    const m = art.get(id);
    const flag = flags.get(id);
    return {
      id,
      publicId: String(row.public_id),
      kind: String(row.kind),
      name: String(row.name),
      year: row.year == null ? null : Number(row.year),
      seasonNumber: row.season_number == null ? null : Number(row.season_number),
      episodeNumber: row.episode_number == null ? null : Number(row.episode_number),
      fileId: fileIds.get(id) ?? null,
      parentId: row.parent_id == null ? null : Number(row.parent_id),
      parentTitle: row.parent_id == null
        ? null
        : parents.get(Number(row.parent_id))?.name != null
          ? String(parents.get(Number(row.parent_id))!.name)
          : null,
      parentPublicId: row.parent_id == null
        ? null
        : parents.get(Number(row.parent_id))?.public_id != null
          ? String(parents.get(Number(row.parent_id))!.public_id)
          : null,
      poster: m?.poster ?? (row.kind === "episode" ? m?.thumb ?? null : null),
      backdrop: m?.backdrop ?? (row.kind === "episode" ? m?.thumb ?? m?.poster ?? null : null),
      logo: m?.logo ?? null,
      overview: md?.overview == null ? null : String(md.overview),
      rating: md?.rating == null ? null : Number(md.rating),
      runtime: md?.runtime == null ? null : Number(md.runtime),
      genres: md?.genres ? JSON.parse(String(md.genres)) as string[] : [],
      matchStatus: String(row.match_status ?? ""),
      watchlist: Boolean(flag?.watchlist),
      favorite: Boolean(flag?.favorite),
      hidden: Boolean(flag?.hidden),
      userRating: flag?.rating == null ? null : Number(flag.rating),
      watch: played || position > 0
        ? {
            position, duration, played,
            percent: duration && position > 0
              ? Math.min(100, Math.round(position / duration * 100))
              : played ? 100 : 0,
          }
        : null,
    };
  });
}

/** File facts for the detail page (PRD 10.3 file info + predicted play path). */
function fileInfoView(file: Row) {
  const classification = classifyPlayability(rowPlayabilityFacts(file), null); // likely path from probe facts; the player refines per browser
  const subs = file.subtitles_json ? JSON.parse(String(file.subtitles_json)) as Array<unknown> : [];
  return {
    fileId: Number(file.id),
    itemId: file.item_id as number | null,
    size: Number(file.size),
    container: file.container as string | null,
    duration: file.duration as number | null,
    width: file.width as number | null,
    height: file.height as number | null,
    videoCodec: file.video_codec as string | null,
    videoProfile: file.video_profile as string | null,
    fps: file.fps as number | null,
    hdr: file.hdr as string | null,
    audio: file.audio_json ? JSON.parse(String(file.audio_json)) as Array<{ codec: string; channels: number; language: string; isDefault: boolean }> : [],
    subtitleCount: subs.length,
    analysisStatus: String(file.analysis_status),
    analysisError: file.analysis_error as string | null,
    likelyPlayPath: classification.path,
    likelyPlayReason: classification.reason,
    optimization: optimizationView(file),
  };
}

// --- helpers -----------------------------------------------------------------

const ITEM_ORDER: Record<string, string> = {
  name: "i.sort_title",
  year: "i.year DESC, i.sort_title",
  added: "i.added_at DESC, i.id DESC",
  rating: "m.rating DESC, i.sort_title",
};

/** Positive database id, or null for malformed path/body input. */
function parseItemId(value: unknown): number | null {
  const id = Math.trunc(Number(value));
  return Number.isInteger(id) && id > 0 ? id : null;
}

function invalidItemId(): Response {
  return apiError("itemId must be a positive number");
}

/**
 * "Next up": the episode that immediately follows a finished one.
 *
 * An episode that is only partially watched belongs to Continue watching, not
 * Next up — otherwise the same episode shows in both rows. It becomes "next"
 * only once the one before it is finished.
 */
async function nextUpEpisodes(request: Request): Promise<ItemCard[]> {
  const userId = requestUser(request)?.id ?? 0;
  const watchRows = q<Row>("SELECT item_id, position_seconds, played FROM watch_state WHERE user_id=?").all(userId);
  const played = new Set<number>();
  const started = new Set<number>();
  for (const w of watchRows) {
    const id = Number(w.item_id);
    if (Number(w.played)) played.add(id);
    else if (Number(w.position_seconds) > 0) started.add(id);
  }
  if (played.size === 0) return [];

  // Scoped query: fetch episodes ONLY for the series where the user has watched an episode
  const parentSeriesRows = q<Row>(
    `SELECT DISTINCT parent_id FROM items
     JOIN watch_state ON watch_state.item_id = items.id
     WHERE watch_state.user_id = ${userId} AND items.kind = 'episode' AND items.parent_id IS NOT NULL
       AND (watch_state.played = 1 OR watch_state.position_seconds > 0)`,
  ).all();

  const seriesIds = parentSeriesRows.map((r) => Number(r.parent_id)).filter((id) => !Number.isNaN(id));
  if (seriesIds.length === 0) return [];

  const placeholders = seriesIds.map(() => "?").join(",");
  const episodes = q<Row>(
    `SELECT * FROM items
     WHERE kind = 'episode' AND parent_id IN (${placeholders})
     ORDER BY parent_id, season_number, episode_number`,
  ).all(...seriesIds);

  const hiddenSeries = new Set(
    q<{ item_id: number }>(
      "SELECT item_id FROM user_item_flags WHERE user_id=? AND hidden=1",
    ).all(userId).map((row) => Number(row.item_id)),
  );
  const bySeries = new Map<number | null, Row[]>();
  for (const e of episodes) {
    const key = (e.parent_id as number | null) ?? null;
    const list = bySeries.get(key) ?? [];
    list.push(e);
    bySeries.set(key, list);
  }

  const picks: Row[] = [];
  for (const [parentId, list] of bySeries) {
    if (parentId != null && hiddenSeries.has(parentId)) continue;
    for (let i = 1; i < list.length; i++) {
      const ep = list[i]!;
      const prev = list[i - 1]!;
      const sameSeason = Number(prev.season_number) === Number(ep.season_number);
      const sequential = Number(prev.episode_number) === Number(ep.episode_number) - 1;
      const prevWatched = played.has(Number(prev.id));
      const thisStarted = started.has(Number(ep.id));
      const thisWatched = played.has(Number(ep.id));
      if ((sameSeason && sequential || !sameSeason) && prevWatched && !thisStarted && !thisWatched) {
        picks.push(ep);
        break; // one "next" per series keeps rows tidy
      }
    }
  }
  return attachArt(picks.slice(0, 20), request);
}

/**
 * The file the hero's Play button opens.
 *
 * A movie card names its own file. A series card names an episode: the episode
 * the viewer last watched (so Play continues the story), or the first episode
 * when they have not started it. The server decides because it already knows
 * the user's watch state, and the client only ever receives a file id.
 */
function heroPlayback(
  row: Row,
  request: Request,
): {
  playFileId: number | null;
  playSubtitle: string | null;
  playWatch: { position: number; duration: number | null; played: boolean; percent: number } | null;
} {
  const user = requestUser(request);
  const itemId = Number(row.id);
  const kind = String(row.kind ?? "");

  /** Accept a file only when it exists and the viewer may stream it. */
  const accessible = (candidate: Row | undefined | null): number | null => {
    if (!candidate) return null;
    const id = Number(candidate.id);
    if (!Number.isSafeInteger(id)) return null;
    // Mirrors accessSql: a server with no signed-in viewer is running open.
    return !user || canAccessFile(user, id) ? id : null;
  };

  const watchOf = (candidate: Row | undefined | null) => {
    if (!candidate || candidate.position_seconds == null) return null;
    const position = Number(candidate.position_seconds) || 0;
    const duration = candidate.duration_seconds == null ? null : Number(candidate.duration_seconds);
    if (!(position > 0)) return null;
    return {
      position,
      duration,
      played: Boolean(candidate.played),
      percent: duration && duration > 0 ? Math.min(100, (position / duration) * 100) : 0,
    };
  };

  if (kind === "series") {
    const watched = q<Row>(
      `SELECT e.id AS item_id, e.season_number, e.episode_number,
              w.position_seconds, w.duration_seconds, w.played
       FROM watch_state w
       JOIN items e ON e.id = w.item_id AND e.kind = 'episode' AND e.parent_id = ?
       WHERE w.user_id = ? AND w.position_seconds > 0
       ORDER BY w.updated_at DESC, w.item_id DESC LIMIT 1`,
    ).get(itemId, user?.id ?? 0);
    const resumeFile = watched ? accessible(fileForEpisode(Number(watched.item_id))) : null;
    if (resumeFile != null && watched) {
      return {
        playFileId: resumeFile,
        playSubtitle: episodeLabel(watched),
        playWatch: watchOf(watched),
      };
    }

    const firstEpisodes = q<Row>(
      `SELECT id, season_number, episode_number FROM items
       WHERE parent_id = ? AND kind = 'episode'
       ORDER BY season_number, episode_number LIMIT 50`,
    ).all(itemId);
    let firstEpisode: Row | null = null;
    let firstFile: Row | null = null;
    for (const episode of firstEpisodes) {
      const candidate = fileForEpisode(Number(episode.id));
      if (!candidate) continue;
      if (accessible(candidate) != null) {
        firstEpisode = episode;
        firstFile = candidate;
        break;
      }
    }
    return {
      playFileId: accessible(firstFile),
      playSubtitle: episodeLabel(firstEpisode),
      playWatch: null,
    };
  }

  const own = q<Row>(
    `SELECT id FROM media_files WHERE item_id = ? AND unavailable = 0
     ORDER BY height DESC, size DESC, id DESC LIMIT 1`,
  ).get(itemId);
  return { playFileId: accessible(own), playSubtitle: null, playWatch: null };
}

/** "S01E03" for the episode a hero Play button would start. */
function episodeLabel(row: Row | undefined | null): string | null {
  if (!row) return null;
  const season = Number(row.season_number);
  const episode = Number(row.episode_number);
  if (!Number.isFinite(season) || !Number.isFinite(episode)) return null;
  return `S${String(season).padStart(2, "0")}E${String(episode).padStart(2, "0")}`;
}

// --- routes ------------------------------------------------------------------
export const catalogRoutes = new Elysia({ prefix: "/api", normalize: "typebox" })
  /** Home rows (PRD 10.2): hero + continue watching + next up + recently added. */
  .get("/home", async ({ request }) => {
    const userId = requestUser(request)?.id ?? 0;
    // Deterministic hero per PRD 10.7: best-rated matched movie with a backdrop.
    const featuredRow =
      q<Row>(
        `SELECT i.* FROM items i
         JOIN item_metadata m ON m.item_id = i.id
         JOIN artwork a ON a.item_id = i.id AND a.kind = 'backdrop'
         WHERE ${accessSql(request)} AND i.kind = 'movie' AND i.match_status = 'matched' AND m.rating IS NOT NULL
           AND NOT EXISTS (SELECT 1 FROM user_item_flags hf WHERE hf.user_id=${userId} AND hf.item_id=i.id AND hf.hidden=1)
         ORDER BY m.rating DESC, i.sort_title LIMIT 1`,
      ).get()
      ?? q<Row>(
        `SELECT i.* FROM items i JOIN artwork a ON a.item_id = i.id AND a.kind = 'backdrop'
         WHERE ${accessSql(request)} AND i.kind IN ('movie','series') AND i.match_status != 'unmatched'
           AND NOT EXISTS (SELECT 1 FROM user_item_flags hf WHERE hf.user_id=${userId} AND hf.item_id=i.id AND hf.hidden=1)
         ORDER BY i.match_status = 'matched' DESC, i.added_at DESC, i.id DESC LIMIT 1`,
      ).get()
      ?? null;

    const hiddenSql = `AND NOT EXISTS (
      SELECT 1 FROM user_item_flags hf
      WHERE hf.user_id = ${userId} AND hf.hidden = 1
        AND (hf.item_id = i.id OR (i.parent_id IS NOT NULL AND hf.item_id = i.parent_id))
    )`;
    const continueRows = q<Row>(
      `SELECT i.* FROM items i JOIN watch_state w ON w.item_id = i.id
       WHERE w.user_id = ${userId} AND w.position_seconds > 15 AND w.played = 0
         AND w.duration_seconds IS NOT NULL
         AND w.position_seconds < w.duration_seconds * 0.95
         ${hiddenSql}
       ORDER BY w.updated_at DESC LIMIT 50`,
    ).all();
    const recentMovies = q<Row>(
      `SELECT * FROM items i WHERE ${accessSql(request, 'i.id')} AND i.kind='movie' AND i.match_status='matched'
       ${hiddenSql}
       ORDER BY i.added_at DESC, i.id DESC LIMIT 20`,
    ).all();
    const recentShows = q<Row>(
      `SELECT * FROM items i WHERE ${accessSql(request, 'i.id')} AND i.kind='series'
       ${hiddenSql}
       ORDER BY i.added_at DESC, i.id DESC LIMIT 20`,
    ).all();
    const watchlist = userId
      ? q<Row>(
          `SELECT i.* FROM items i
           JOIN user_item_flags f ON f.item_id = i.id
           WHERE f.user_id = ? AND f.watchlist = 1 AND f.hidden = 0
             AND i.kind IN ('movie','series') AND ${accessSql(request, 'i.id')}
           ORDER BY f.updated_at DESC LIMIT 20`,
        ).all(userId)
      : [];
    const favorites = userId
      ? q<Row>(
          `SELECT i.* FROM items i
           JOIN user_item_flags f ON f.item_id = i.id
           WHERE f.user_id = ? AND f.favorite = 1 AND f.hidden = 0
             AND i.kind IN ('movie','series') AND ${accessSql(request, 'i.id')}
           ORDER BY f.updated_at DESC LIMIT 20`,
        ).all(userId)
      : [];
    const nextUp = await nextUpEpisodes(request);

    const [
      featured,
      continueWatching,
      recentlyMovies,
      recentlyShows,
      watchlistCards,
      favoriteCards,
    ] = await Promise.all([
      featuredRow
        ? attachArt([featuredRow], request).then((r) => {
            const card = r[0];
            if (!card) return null;
            const playback = heroPlayback(featuredRow, request);
            return { ...card, ...playback };
          })
        : Promise.resolve(null),
      attachArt(continueRows, request),
      attachArt(recentMovies, request),
      attachArt(recentShows, request),
      attachArt(watchlist, request),
      attachArt(favorites, request),
    ]);

    const rows = [
      continueWatching.length > 0 && { key: "continue", title: "Continue watching", items: continueWatching },
      nextUp.length > 0 && { key: "next", title: "Next up", items: nextUp },
      watchlistCards.length > 0 && { key: "watchlist", title: "Watchlist", items: watchlistCards },
      favoriteCards.length > 0 && { key: "favorites", title: "Favorites", items: favoriteCards },
      recentlyMovies.length > 0 && { key: "recent-movies", title: "Recently added movies", items: recentlyMovies },
      recentlyShows.length > 0 && { key: "recent-shows", title: "Recently added shows", items: recentlyShows },
    ].filter(Boolean);
    return { featured, rows };
  })

  /** Recently watched movies and episodes, newest first. */
  .get("/history", async ({ query, request }) => {
    const user = requestUser(request);
    if (!user) return { items: [], total: 0 };
    const limit = Math.min(Math.max(Number(query.limit), 1), 500);
    const offset = Math.max(0, Number(query.offset));
    const whereSql = [
      accessSql(request, "i.id"),
      "w.user_id = ?",
      "i.kind IN ('movie','episode')",
      "(w.position_seconds > 0 OR w.played = 1)",
      "NOT EXISTS (SELECT 1 FROM user_item_flags hf WHERE hf.user_id = ? AND hf.hidden = 1 AND (hf.item_id = i.id OR (i.parent_id IS NOT NULL AND hf.item_id = i.parent_id)))",
    ].join(" AND ");
    const rows = q<Row>(
      `SELECT i.*, w.updated_at AS watched_at
       FROM items i JOIN watch_state w ON w.item_id = i.id
       WHERE ${whereSql}
       ORDER BY w.updated_at DESC, i.id DESC
       LIMIT ? OFFSET ?`,
    ).all(user.id, user.id, limit, offset);
    const total = Number(
      q<{ n: number }>(
        `SELECT COUNT(*) AS n
         FROM items i JOIN watch_state w ON w.item_id = i.id
         WHERE ${whereSql}`,
      ).get(user.id, user.id)?.n ?? 0,
    );
    const cards = await attachArt(rows, request);
    const watchedAt = new Map(
      rows.map((row) => [Number(row.id), row.watched_at == null ? null : String(row.watched_at)]),
    );
    return {
      items: cards.map((card) => ({
        ...card,
        watchedAt: watchedAt.get(card.id) ?? null,
      })),
      total,
    };
  }, {
    query: t.Object({
      limit: t.Numeric({ default: 60 }),
      offset: t.Numeric({ default: 0 }),
    }),
  })

  /** Remove one title from this user's history (also clears its resume point). */
  .delete("/history/:itemId", ({ params, request }) => {
    const user = requestUser(request);
    if (!user) return apiError("Sign in required.", 401);
    const itemId = parseItemId(params.itemId);
    if (itemId == null) return invalidItemId();
    run("DELETE FROM watch_state WHERE user_id = ? AND item_id = ?", user.id, itemId);
    return { ok: true };
  }, { params: t.Object({ itemId: t.Numeric() }) })

  /** Clear this user's whole watch history and resume points. */
  .delete("/history", ({ request }) => {
    const user = requestUser(request);
    if (!user) return apiError("Sign in required.", 401);
    run("DELETE FROM watch_state WHERE user_id = ?", user.id);
    return { ok: true };
  })

  /** Library grid with sort + filters (PRD 5.9, 10.2). */
  .get("/items", async ({ query, request }) => {
    // Browse surfaces list titles, not their episodes or season containers. An
    // episode card only belongs in Continue watching, Next up, or search.
    const userId = requestUser(request)?.id ?? 0;
    const where: string[] = [accessSql(request), "i.kind IN ('movie','series')"];
    const params: unknown[] = [];
    if (query.kind) { where.push("i.kind = ?"); params.push(query.kind); }
    if (query.year) { where.push("i.year = ?"); params.push(query.year); }
    if (query.yearFrom) { where.push("i.year >= ?"); params.push(query.yearFrom); }
    if (query.yearTo) { where.push("i.year <= ?"); params.push(query.yearTo); }
    if (query.libraryId) { where.push("i.library_id = ?"); params.push(query.libraryId); }
    if (query.unwatched) {
      where.push(`i.id NOT IN (SELECT item_id FROM watch_state WHERE user_id=${userId} AND played = 1)`);
    }
    if (query.q) {
      where.push("(i.name LIKE ? OR i.sort_title LIKE ?)");
      params.push(`%${query.q}%`, `%${query.q}%`);
    }
    if (query.genre) {
      where.push(
        `EXISTS (SELECT 1 FROM json_each(COALESCE(m.genres, '[]')) j WHERE j.value = ?)`,
      );
      params.push(query.genre);
    }
    if (query.minRating) {
      where.push("m.rating IS NOT NULL AND m.rating >= ?");
      params.push(query.minRating);
    }
    if (query.maxRuntime) {
      where.push("m.runtime IS NOT NULL AND m.runtime <= ?");
      params.push(query.maxRuntime);
    }
    if (query.watchlist) {
      where.push(
        `EXISTS (SELECT 1 FROM user_item_flags f WHERE f.user_id=${userId} AND f.item_id=i.id AND f.watchlist=1)`,
      );
    }
    if (query.favorite) {
      where.push(
        `EXISTS (SELECT 1 FROM user_item_flags f WHERE f.user_id=${userId} AND f.item_id=i.id AND f.favorite=1)`,
      );
    }
    if (query.minUserRating) {
      where.push(
        `EXISTS (SELECT 1 FROM user_item_flags f WHERE f.user_id=${userId} AND f.item_id=i.id AND f.rating >= ?)`,
      );
      params.push(query.minUserRating);
    }
    if (query.hidden) {
      where.push(
        `EXISTS (SELECT 1 FROM user_item_flags f WHERE f.user_id=${userId} AND f.item_id=i.id AND f.hidden=1)`,
      );
    } else {
      where.push(
        `NOT EXISTS (SELECT 1 FROM user_item_flags f WHERE f.user_id=${userId} AND f.item_id=i.id AND f.hidden=1)`,
      );
    }
    const order = query.sort === "userRating"
      ? `COALESCE((SELECT f.rating FROM user_item_flags f WHERE f.user_id=${userId} AND f.item_id=i.id), 0) DESC, i.sort_title`
      : ITEM_ORDER[query.sort ?? "name"] ?? ITEM_ORDER.name;
    const limit = Math.min(Math.max(Number(query.limit ?? 60), 1), 5000);
    const offset = Math.max(0, Number(query.offset ?? 0));
    const whereSql = where.join(" AND ");
    const rows = q<Row>(
      `SELECT i.* FROM items i
       LEFT JOIN item_metadata m ON m.item_id = i.id
       WHERE ${whereSql}
       ORDER BY ${order} LIMIT ? OFFSET ?`,
    ).all(...params, limit, offset);
    const total = Number(
      q<{ n: number }>(
        `SELECT COUNT(*) AS n FROM items i
         LEFT JOIN item_metadata m ON m.item_id = i.id
         WHERE ${whereSql}`,
      ).get(...params)?.n ?? 0,
    );
    return { items: await attachArt(rows, request), total };
  }, {
    query: t.Object({
      libraryId: t.Optional(t.Numeric()),
      kind: t.Optional(t.Union([t.Literal("movie"), t.Literal("series")])),
      year: t.Optional(t.Numeric()),
      yearFrom: t.Optional(t.Numeric()),
      yearTo: t.Optional(t.Numeric()),
      genre: t.Optional(t.String()),
      minRating: t.Optional(t.Numeric()),
      maxRuntime: t.Optional(t.Numeric()),
      watchlist: t.Optional(t.BooleanString()),
      favorite: t.Optional(t.BooleanString()),
      hidden: t.Optional(t.BooleanString()),
      minUserRating: t.Optional(t.Numeric()),
      unwatched: t.Optional(t.BooleanString()),
      sort: t.Optional(t.String()),
      q: t.Optional(t.String()),
      limit: t.Numeric({ default: 60 }),
      offset: t.Numeric({ default: 0 }),
    }),
  })

  /** Title detail (PRD 10.3). */
  .get("/items/:id", async ({ params, request }) => {
    const user = requestUser(request);
    const legacyId = /^\d+$/.test(params.id) ? Number(params.id) : null;
    const row = legacyId != null
      ? q<Row>("SELECT * FROM items WHERE id = ?").get(legacyId)
      : q<Row>("SELECT * FROM items WHERE public_id = ?").get(params.id);
    if (!row) return apiError("Not found", 404);
    const id = Number(row.id);

    const [card] = await attachArt([row], request);
    if (!card) return apiError("Not found", 404);
    const meta = q<Row>("SELECT * FROM item_metadata WHERE item_id = ?").get(id);
    const castRows = q<Row>(
      `SELECT p.id, p.name, p.profile_path, ip.character_name
       FROM item_people ip JOIN people p ON p.id = ip.person_id
       WHERE ip.item_id = ? AND ip.department = 'cast' ORDER BY ip.ord LIMIT 12`,
    ).all(id);
    const cast = castRows.map((p) => ({
      id: Number(p.id),
      name: String(p.name),
      character: p.character_name ? String(p.character_name) : null,
      photo: p.profile_path ? `/api/people/${Number(p.id)}/photo?w=300` : null,
    }));
    const videos = q<Row>(
      `SELECT id, provider, key, name, type, official, published_at
       FROM videos WHERE item_id = ?
       ORDER BY CASE WHEN type = 'Trailer' THEN 0 WHEN type = 'Teaser' THEN 1 ELSE 2 END,
                official DESC, published_at DESC
       LIMIT 16`,
    ).all(id);
    const video = videos[0];
    const extras = videos.slice(1).map((entry) => ({
      provider: String(entry.provider),
      key: String(entry.key),
      name: String(entry.name),
      type: String(entry.type),
    }));

    let seasons: Array<{ id: number; number: number; name?: string; poster?: string | null }> | null = null;
    let episodes: ItemCard[] | null = null;
    if (row.kind === "series") {
      const seasonItems = q<Row>(
        "SELECT * FROM items WHERE parent_id = ? AND kind = 'season' ORDER BY season_number",
      ).all(id);

      const epSeasonNums = q<Row>(
        "SELECT DISTINCT season_number FROM items WHERE parent_id = ? AND kind = 'episode' AND season_number IS NOT NULL ORDER BY season_number",
      ).all(id);

      const allNums = Array.from(new Set([
        ...seasonItems.map((s) => Number(s.season_number)),
        ...epSeasonNums.map((s) => Number(s.season_number)),
      ])).filter((n) => !isNaN(n)).sort((a, b) => a - b);

      const sCards = await attachArt(seasonItems, request);
      const sCardMap = new Map(sCards.map((s) => [s.seasonNumber ?? 0, s]));

      seasons = allNums.filter(num => !user || user.role === "admin" || sCards.some(card => card.seasonNumber === num)).map((num) => {
        const item = seasonItems.find((s) => Number(s.season_number) === num);
        const c = sCardMap.get(num);
        return {
          id: item ? Number(item.id) : num,
          number: num,
          name: item?.name ? String(item.name) : (num === 0 ? "Specials" : `Season ${num}`),
          poster: c?.poster ?? null,
        };
      });

      episodes = await attachArt(
        q<Row>("SELECT * FROM items WHERE parent_id = ? AND kind = 'episode' ORDER BY season_number, episode_number").all(id), request,
      );

      if (row.kind === "series" && row.tmdb_id && row.match_status === "matched") {
        const hasMissing = episodes.some((ep) => !ep.poster || ep.matchStatus !== "matched");
        if (hasMissing) {
          const { hydrateMissingEpisodes } = await import("./hydrate");
          void hydrateMissingEpisodes(id);
        }
      }
    }

    if (row.kind === "episode" && row.parent_id) {
      const parentRow = q<Row>("SELECT name, public_id FROM items WHERE id = ?").get(Number(row.parent_id));
      if (parentRow) {
        card.parentTitle = String(parentRow.name);
        card.parentPublicId = String(parentRow.public_id);
      }
    }

    let file = row.kind === "movie" || row.kind === "episode"
      ? q<Row>("SELECT * FROM media_files WHERE item_id = ? AND unavailable = 0 ORDER BY id DESC").all(id).find(file => !user || canAccessFile(user, Number(file.id)))
      : null;
    if (!file && row.kind === "episode") {
      const covering = fileForEpisode(id);
      if (covering && (!user || canAccessFile(user, Number(covering.id)))) file = covering;
    }

    // Sidecar logo (clear-art) is a detail-hero nicety; missing is fine.
    const logoRow = q<Row>(
      "SELECT id, source, url FROM artwork WHERE item_id = ? AND kind = 'logo' LIMIT 1",
    ).get(id);
    const logo = logoRow ? `/api/images/${Number(logoRow.id)}` : null;

    return Response.json({
      item: card,
      logo,
      metadata: meta ? {
        overview: meta.overview ?? null,
        tagline: meta.tagline ?? null,
        runtime: meta.runtime ?? null,
        rating: meta.rating ?? null,
        certification: meta.certification ?? null,
        genres: meta.genres ? JSON.parse(String(meta.genres)) : [],
      } : null,
      cast,
      trailer: video ? { provider: String(video.provider), key: String(video.key), name: String(video.name) } : null,
      extras,
      seasons,
      episodes,
      file: file ? fileInfoView(file) : null,
      tmdbType: row.tmdb_type ?? null,
      unmatched: row.kind !== "episode" && row.match_status !== "matched",
      matchReason: (row.reason as string | null) ?? null,
    });
  })

  /** Local recommendation shelf: shared genres and people, rating as a tie-break. */
  .get("/items/:id/similar", async ({ params, request }) => {
    const itemId = parseItemId(params.id);
    if (itemId == null) return apiError("Not found", 404);
    const target = q<Row>(
      `SELECT i.id, i.kind, COALESCE(m.genres, '[]') AS genres
       FROM items i LEFT JOIN item_metadata m ON m.item_id=i.id
       WHERE i.id = ?`,
    ).get(itemId);
    if (!target) return apiError("Not found", 404);
    const rows = q<Row>(
      `SELECT i.*,
         (
           SELECT COUNT(*) FROM json_each(COALESCE(m.genres, '[]')) g
           WHERE g.value IN (SELECT value FROM json_each(?))
         ) * 3 +
         (
           SELECT COUNT(DISTINCT ip2.person_id)
           FROM item_people ip1 JOIN item_people ip2 ON ip2.person_id = ip1.person_id
           WHERE ip1.item_id = ? AND ip2.item_id = i.id
         ) AS affinity
       FROM items i
       LEFT JOIN item_metadata m ON m.item_id = i.id
       WHERE i.id != ? AND i.kind IN ('movie','series')
         AND ${accessSql(request, 'i.id')}
         AND NOT EXISTS (
           SELECT 1 FROM user_item_flags f
           WHERE f.user_id = ? AND f.item_id = i.id AND f.hidden = 1
         )
       ORDER BY affinity DESC, COALESCE(m.rating, 0) DESC, i.added_at DESC
       LIMIT 14`,
    ).all(String(target.genres), itemId, itemId, requestUser(request)?.id ?? 0);
    return { items: await attachArt(rows.filter((row) => Number(row.affinity) > 0), request) };
  }, { params: t.Object({ id: t.String() }) })

  /**
   * Person detail: photo plus every title they appear in that is locally
   * available. Local-only by design — this never calls TMDB, so cast pages keep
   * working when the machine is offline.
   */
  .get("/people/:personId", async ({ params, request }) => {
    const personId = Number(params.personId);
    if (!Number.isFinite(personId)) {
      return apiError("Not found", 404);
    }
    const person = q<Row>(
      "SELECT id, name, profile_path FROM people WHERE id = ?",
    ).get(personId);
    if (!person) return apiError("Not found", 404);

    const rows = q<Row>(
      `SELECT DISTINCT i.* FROM items i
       JOIN item_people ip ON ip.item_id = i.id
       WHERE ip.person_id = ? AND ip.department = 'cast'
         AND i.kind IN ('movie', 'series') AND ${accessSql(request)}
       ORDER BY (i.year IS NULL), i.year DESC, i.name`,
    ).all(personId);
    const items = await attachArt(rows, request);

    return Response.json({
      person: {
        id: Number(person.id),
        name: String(person.name),
        photo: person.profile_path
          ? `/api/people/${Number(person.id)}/photo?w=300`
          : null,
      },
      items,
    });
  }, { params: t.Object({ personId: t.Numeric() }) })

  /**
   * Set the signed-in viewer's watchlist/favorite/hidden/rating flags. Missing
   * fields keep their previous value; `rating: null` clears the rating.
   */
  .put("/items/:id/flags", ({ params, body, request }) => {
    const user = requestUser(request);
    const itemId = parseItemId(params.id);
    if (itemId == null) return invalidItemId();
    if (!user) return apiError("Sign in required.", 401);
    if (!canAccessItem(user, itemId)) return apiError("Not found", 404);

    const existing = q<Row>(
      "SELECT watchlist, favorite, hidden, rating FROM user_item_flags WHERE user_id=? AND item_id=?",
    ).get(user.id, itemId);
    const watchlist = body.watchlist ?? Boolean(existing?.watchlist);
    const favorite = body.favorite ?? Boolean(existing?.favorite);
    const hidden = body.hidden ?? Boolean(existing?.hidden);
    const rating = body.rating !== undefined
      ? body.rating
      : existing?.rating == null ? null : Number(existing.rating);

    if (!watchlist && !favorite && !hidden && rating == null) {
      run("DELETE FROM user_item_flags WHERE user_id=? AND item_id=?", user.id, itemId);
    } else {
      run(
        `INSERT INTO user_item_flags
           (user_id,item_id,watchlist,favorite,hidden,rating,updated_at)
         VALUES (?,?,?,?,?,?,datetime('now'))
         ON CONFLICT(user_id,item_id) DO UPDATE SET
           watchlist=excluded.watchlist, favorite=excluded.favorite,
           hidden=excluded.hidden, rating=excluded.rating,
           updated_at=datetime('now')`,
        user.id,
        itemId,
        watchlist ? 1 : 0,
        favorite ? 1 : 0,
        hidden ? 1 : 0,
        rating,
      );
    }
    return {
      ok: true as const,
      watchlist,
      favorite,
      hidden,
      rating,
    };
  }, {
    params: t.Object({ id: t.String() }),
    body: t.Object({
      watchlist: t.Optional(t.Boolean()),
      favorite: t.Optional(t.Boolean()),
      hidden: t.Optional(t.Boolean()),
      rating: t.Optional(t.Union([t.Null(), t.Integer({ minimum: 1, maximum: 5 })])),
    }),
  })

  /**
   * Remove a title and its indexed descendants. Source files follow the
   * owner's deletion policy: the system Trash by default, permanent only when
   * explicitly selected in settings.
   */
  .delete("/items/:id", async (ctx) => {
    const denied = denyIfNotLocal(ctx);
    if (denied) return denied;
    const itemId = parseItemId(ctx.params.id);
    if (itemId == null) return invalidItemId();
    const exists = q<{ id: number }, [number]>("SELECT id FROM items WHERE id=?").get(itemId);
    if (!exists) return apiError("Title not found", 404);
    const indexedFiles = q<{ id: number; path: string; size: number; mtime: number }>(
      `WITH RECURSIVE descendants(id) AS (
         SELECT ? UNION ALL SELECT i.id FROM items i JOIN descendants d ON i.parent_id=d.id
       ) SELECT f.id, f.path, f.size, f.mtime FROM media_files f JOIN descendants d ON d.id=f.item_id`,
    ).all(itemId);
    const fileIds = indexedFiles.map((row) => Number(row.id));
    const existingFiles = [] as Array<{ id: number; path: string }>;
    for (const file of indexedFiles) {
      const source = await stat(file.path).catch(() => null);
      if (!source?.isFile()) continue;
      if (source.size !== Number(file.size) || Math.floor(source.mtimeMs) !== Number(file.mtime)) {
        return apiError("A source file changed since it was indexed. Rescan the library before deleting this title.", 409);
      }
      existingFiles.push({ id: Number(file.id), path: file.path });
    }
    const cfg = await getConfig();
    try {
      for (const file of existingFiles) {
        await removeOriginal(file.path, cfg.moveOriginalsToTrash ? "system" : "permanent");
      }
    } catch {
      return apiError(
        cfg.moveOriginalsToTrash
          ? "Could not move a source file to the recycle bin. The title remains in the catalog."
          : "Could not delete a source file. The title remains in the catalog.",
        500,
      );
    }
    db.exec("BEGIN");
    try {
      if (fileIds.length) {
        const placeholders = fileIds.map(() => "?").join(",");
        run(`DELETE FROM media_files WHERE id IN (${placeholders})`, ...fileIds);
      }
      run("DELETE FROM items WHERE id=?", itemId);
      db.exec("COMMIT");
    } catch (error) {
      db.exec("ROLLBACK");
      throw error;
    }
    log.info("media", "title removed from catalog", { itemId, indexedFiles: fileIds.length });
    return { ok: true };
  })

  /**
   * Search titles and episodes (PRD 5.9).
   *
   * Results are split so the viewer can tell films/shows apart from individual
   * episodes at a glance. Episode matching also considers the parent series
   * name, so searching "The Bear" surfaces its episodes even when the episode
   * title itself does not contain the query.
   */
  .get("/search", async ({ query, request }) => {
    const text = query.q.trim();
    const empty = {
      titles: [] as ItemCard[],
      episodes: [] as ItemCard[],
      people: [] as Array<{ id: number; name: string; photo: string | null }>,
      total: 0,
      query: text,
      items: [] as ItemCard[],
    };
    if (!text) return empty;

    ensureSearchIndex();
    const limit = Math.min(Math.max(Number(query.limit ?? 60), 1), 120);
    const offset = Math.max(0, Number(query.offset ?? 0));
    // Ask FTS for a little more than a page because access filtering and the
    // title/episode split happen after the rows are decorated.
    let hits = searchIds(text, limit * 3, offset);
    if (!hits.length) hits = fallbackIds(text, limit * 3, offset);
    if (!hits.length) {
      return { ...empty, people: searchPeople(text) };
    }

    const ids = hits.map((hit) => hit.itemId);
    const ph = ids.map(() => "?").join(",");
    const rows = q<Row>(`SELECT * FROM items WHERE id IN (${ph})`).all(...ids);
    const cards = await attachArt(rows, request);
    const byId = new Map(cards.map((card) => [card.id, card]));
    const userId = requestUser(request)?.id ?? 0;
    const hiddenIds = new Set(
      userId
        ? q<{ item_id: number }>(
            "SELECT item_id FROM user_item_flags WHERE user_id = ? AND hidden = 1",
          ).all(userId).map((row) => Number(row.item_id))
        : [],
    );
    const visible = ids
      .map((id) => byId.get(id))
      .filter((card): card is ItemCard =>
        Boolean(card) &&
        !card!.hidden &&
        !(card!.parentId != null && hiddenIds.has(card!.parentId)),
      )
      .slice(0, limit);

    const titles = visible.filter((item) => item.kind !== "episode");
    const episodes = visible.filter((item) => item.kind === "episode");

    // Episodes carry their series name and public id so the card can show
    // "The Bear · S02E03" and link the episode rather than the show.
    const parentIds = [...new Set(episodes.map((e) => e.parentId).filter((id): id is number => id != null))];
    if (parentIds.length) {
      const parentPh = parentIds.map(() => "?").join(",");
      const parents = new Map(
        q<Row>(`SELECT id, name, public_id FROM items WHERE id IN (${parentPh})`)
          .all(...parentIds)
          .map((p) => [Number(p.id), p]),
      );
      for (const episode of episodes) {
        const parent = episode.parentId != null ? parents.get(episode.parentId) : undefined;
        if (parent) {
          episode.parentTitle = String(parent.name);
          episode.parentPublicId = String(parent.public_id);
        }
      }
    }

    // Keep the flat alias while older desktop bundles may still request
    // `items`; current clients render the typed groups above.
    return {
      titles,
      episodes,
      people: searchPeople(text),
      total: titles.length + episodes.length,
      query: text,
      items: [...titles, ...episodes],
    };
  }, {
    query: t.Object({
      q: t.String(),
      limit: t.Optional(t.Numeric()),
      offset: t.Optional(t.Numeric()),
    }),
  })

  /**
   * Shared playback progress (PRD 5.8, 5.10) — the only LAN-allowed mutation.
   * The player reports every 10 s and on pause/close.
   *
   * `played` is monotonic here on purpose: a routine progress report must never
   * silently unmark a finished title. Explicit watched/unwatched changes go
   * through `POST /api/watch/:itemId/played`.
   */
  .post("/progress", ({ body, request }) => {
    const userId = requestUser(request)?.id ?? 0;
    const itemId = parseItemId(body.itemId);
    if (itemId == null) return invalidItemId();
    if (!canAccessItem(requestUser(request), itemId)) return apiError("Not found", 404);
    run(
      `INSERT INTO watch_state (user_id, item_id, position_seconds, duration_seconds, played, updated_at)
       VALUES (?, ?,?,?,?,datetime('now'))
       ON CONFLICT(user_id,item_id) DO UPDATE SET
         position_seconds = excluded.position_seconds,
         duration_seconds = COALESCE(excluded.duration_seconds, watch_state.duration_seconds),
         played = CASE WHEN excluded.played = 1 THEN 1 ELSE watch_state.played END,
         updated_at = datetime('now')`,
      userId, itemId, Math.max(0, Number(body.position) || 0), body.duration ?? null, body.played ? 1 : 0,
    );
    log.debug("player", "progress saved", { itemId, position: body.position });
    return { ok: true };
  }, {
    body: t.Object({
      itemId: t.Numeric(),
      position: t.Numeric(),
      duration: t.Optional(t.Numeric()),
      played: t.Boolean({ default: false }),
    }),
  })

  /** Explicit mark-as-watched / mark-as-unwatched. */
  .post("/watch/:itemId/played", ({ params, body, request }) => {
    const userId = requestUser(request)?.id ?? 0;
    const itemId = parseItemId(params.itemId);
    if (itemId == null) return invalidItemId();
    const item = q<{ id: number; kind: string }, [number]>("SELECT id, kind FROM items WHERE id = ?").get(itemId);
    if (!item) return apiError("Not found", 404);

    const playedVal = body.played ? 1 : 0;
    run(
      `INSERT INTO watch_state (user_id, item_id, position_seconds, duration_seconds, played, updated_at)
       VALUES (?, ?, 0, NULL, ?, datetime('now'))
       ON CONFLICT(user_id,item_id) DO UPDATE SET
         position_seconds = 0, played = excluded.played, updated_at = datetime('now')`,
      userId, itemId, playedVal,
    );

    // If marking a series as watched / unwatched, cascade to all of its episodes!
    if (String(item.kind) === "series") {
      const episodes = q<{ id: number; duration: number | null }, [number]>(
        "SELECT id, duration FROM items WHERE parent_id = ? AND kind = 'episode'",
      ).all(itemId);
      for (const ep of episodes) {
        run(
          `INSERT INTO watch_state (user_id, item_id, position_seconds, duration_seconds, played, updated_at)
           VALUES (?, ?, 0, ?, ?, datetime('now'))
           ON CONFLICT(user_id,item_id) DO UPDATE SET
             position_seconds = 0, played = excluded.played, updated_at = datetime('now')`,
          userId, ep.id, ep.duration ?? null, playedVal,
        );
      }
    } else if (String(item.kind) === "season") {
      const season = q<{ parent_id: number | null; season_number: number | null }, [number]>(
        "SELECT parent_id, season_number FROM items WHERE id = ?",
      ).get(itemId);
      if (season?.parent_id != null && season?.season_number != null) {
        const episodes = q<{ id: number; duration: number | null }, [number, number]>(
          "SELECT id, duration FROM items WHERE parent_id = ? AND season_number = ? AND kind = 'episode'",
        ).all(Number(season.parent_id), Number(season.season_number));
        for (const ep of episodes) {
          run(
            `INSERT INTO watch_state (user_id, item_id, position_seconds, duration_seconds, played, updated_at)
             VALUES (?, ?, 0, ?, ?, datetime('now'))
             ON CONFLICT(user_id,item_id) DO UPDATE SET
               position_seconds = 0, played = excluded.played, updated_at = datetime('now')`,
            userId, ep.id, ep.duration ?? null, playedVal,
          );
        }
      }
    }

    log.debug("player", body.played ? "marked watched" : "marked unwatched", { itemId, kind: item.kind });
    return { ok: true, played: body.played };
  }, {
    params: t.Object({ itemId: t.Numeric() }),
    body: t.Object({ played: t.Boolean() }),
  })

  /** Remove a watch-state row entirely ("delete" / remove from Continue Watching). */
  .delete("/watch/:itemId", ({ params, request }) => {
    const userId = requestUser(request)?.id ?? 0;
    const itemId = parseItemId(params.itemId);
    if (itemId == null) return invalidItemId();
    run("DELETE FROM watch_state WHERE user_id=? AND item_id = ?", userId, itemId);
    log.debug("player", "watch state cleared", { itemId });
    return { ok: true };
  }, { params: t.Object({ itemId: t.Numeric() }) });
