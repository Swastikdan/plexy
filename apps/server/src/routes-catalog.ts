/// Catalog routes.
///
/// What the viewer sees: home rows, library grids, search, title detail, and
/// the shared watch state. Filesystem paths never leave the server through
/// these routes (PRD 11) — media resolves only by file id.
import { Elysia, t } from "elysia";
import { readdir, rm, stat, unlink } from "node:fs/promises";
import { join } from "node:path";
import { db, q, run, type Row } from "./db";
import { log } from "./logger";
import { imageUrl } from "./tmdb";
import { classifyPlayability } from "./playback";
import { optimizationView } from "./optimize";
import { denyIfNotLocal } from "./essentials";
import { resolveOptimizedDir } from "./paths";
import { cancelStreamPreparationsForFiles } from "./hls-preparation";

// --- card assembly -----------------------------------------------------------

export interface ItemCard {
  id: number;
  publicId: string;
  kind: string;
  name: string;
  year: number | null;
  seasonNumber?: number | null;
  episodeNumber?: number | null;
  fileId?: number | null;
  parentId?: number | null;
  parentPublicId?: string | null;
  parentTitle?: string | null;
  poster: string | null;
  backdrop: string | null;
  overview: string | null;
  rating: number | null;
  runtime: number | null;
  genres: string[];
  matchStatus: string;
  watch: { position: number; duration: number | null; played: boolean; percent: number } | null;
}

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
  return url;
}

const ART_WIDTH: Record<string, number> = { poster: 500, backdrop: 1600, thumb: 300 };

/** Request exactly the pixels a card renders, not the full-size original. */
function sizedImageUrl(artworkId: number, kind: string): string {
  return `/api/images/${artworkId}?w=${ART_WIDTH[kind] ?? 500}`;
}

/**
 * Decorate raw item rows with artwork, metadata, files and watch state. Three indexed
 * queries beat a correlated subquery per row on large libraries.
 */
async function attachArt(rows: Row[]): Promise<ItemCard[]> {
  const ids = rows.map((r) => Number(r.id));
  if (!ids.length) return [];
  const ph = ids.map(() => "?").join(",");

  const artRows = q<Row>(
    `SELECT id, item_id, kind, source, url FROM artwork WHERE item_id IN (${ph}) AND kind IN ('poster','backdrop','thumb')`,
  ).all(...ids);
  const metaRows = q<Row>(
    `SELECT item_id, rating, runtime, overview, genres FROM item_metadata WHERE item_id IN (${ph})`,
  ).all(...ids);
  const watchRows = q<Row>(
    `SELECT item_id, position_seconds, duration_seconds, played FROM watch_state WHERE item_id IN (${ph})`,
  ).all(...ids);
  const fileRows = q<Row>(
    `SELECT id, item_id FROM media_files WHERE item_id IN (${ph}) AND unavailable = 0 ORDER BY id DESC`,
  ).all(...ids);

  const fileIds = new Map<number, number>();
  for (const f of fileRows) {
    const itId = Number(f.item_id);
    if (!fileIds.has(itId)) {
      fileIds.set(itId, Number(f.id));
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

  return rows.map((row) => {
    const id = Number(row.id);
    const w = watch.get(id);
    const position = w ? Number(w.position_seconds) : 0;
    const duration = w && w.duration_seconds != null ? Number(w.duration_seconds) : null;
    const played = w ? !!Number(w.played) : false;
    const md = meta.get(id);
    const m = art.get(id);
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
      poster: m?.poster ?? (row.kind === "episode" ? m?.thumb ?? null : null),
      backdrop: m?.backdrop ?? (row.kind === "episode" ? m?.thumb ?? m?.poster ?? null : null),
      overview: md?.overview == null ? null : String(md.overview),
      rating: md?.rating == null ? null : Number(md.rating),
      runtime: md?.runtime == null ? null : Number(md.runtime),
      genres: md?.genres ? JSON.parse(String(md.genres)) as string[] : [],
      matchStatus: String(row.match_status ?? ""),
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
  const classification = classifyPlayability({
    container: (file.container as string | null) ?? "",
    videoCodec: file.video_codec as string | null,
    audioJson: (file.audio_json as string | null) ?? "[]",
    subtitlesJson: (file.subtitles_json as string | null) ?? "[]",
  }, null); // likely path from probe facts; the player refines per browser
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

/**
 * "Next up": the episode that immediately follows a finished one.
 *
 * An episode that is only partially watched belongs to Continue watching, not
 * Next up — otherwise the same episode shows in both rows. It becomes "next"
 * only once the one before it is finished.
 */
async function nextUpEpisodes(): Promise<ItemCard[]> {
  const watchRows = q<Row>("SELECT item_id, position_seconds, played FROM watch_state").all();
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
     WHERE items.kind = 'episode' AND items.parent_id IS NOT NULL
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

  // index episodes by their parent series for O(1) neighbor lookup
  const bySeries = new Map<number | null, Row[]>();
  for (const e of episodes) {
    const key = (e.parent_id as number | null) ?? null;
    const list = bySeries.get(key) ?? [];
    list.push(e);
    bySeries.set(key, list);
  }

  const picks: Row[] = [];
  for (const list of bySeries.values()) {
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
  // newest series first by added order is fine as stored order
  return attachArt(picks.slice(0, 20));
}

// --- routes ------------------------------------------------------------------

export const catalogRoutes = new Elysia({ prefix: "/api", normalize: "typebox" })
  /** Home rows (PRD 10.2): hero + continue watching + next up + recently added. */
  .get("/home", async () => {
    // Deterministic hero per PRD 10.7: best-rated matched movie with a backdrop.
    const featuredRow =
      q<Row>(
        `SELECT i.* FROM items i
         JOIN item_metadata m ON m.item_id = i.id
         JOIN artwork a ON a.item_id = i.id AND a.kind = 'backdrop'
         WHERE i.kind = 'movie' AND i.match_status = 'matched' AND m.rating IS NOT NULL
         ORDER BY m.rating DESC, i.sort_title LIMIT 1`,
      ).get()
      ?? q<Row>(
        `SELECT i.* FROM items i JOIN artwork a ON a.item_id = i.id AND a.kind = 'backdrop'
         WHERE i.kind IN ('movie','series') AND i.match_status != 'unmatched'
         ORDER BY i.match_status = 'matched' DESC, i.added_at DESC, i.id DESC LIMIT 1`,
      ).get()
      ?? null;

    const continueRows = q<Row>(
      `SELECT i.* FROM items i JOIN watch_state w ON w.item_id = i.id
       WHERE w.position_seconds > 15 AND w.played = 0
         AND w.duration_seconds IS NOT NULL
         AND w.position_seconds < w.duration_seconds * 0.95
       ORDER BY w.updated_at DESC LIMIT 50`,
    ).all();
    const recentMovies = q<Row>(
      `SELECT * FROM items WHERE kind='movie' AND match_status='matched'
       ORDER BY added_at DESC, id DESC LIMIT 20`,
    ).all();
    const recentShows = q<Row>(
      `SELECT * FROM items WHERE kind='series' ORDER BY added_at DESC, id DESC LIMIT 20`,
    ).all();
    const nextUp = await nextUpEpisodes();

    const [featured, continueWatching, recentlyMovies, recentlyShows] = await Promise.all([
      featuredRow ? attachArt([featuredRow]).then((r) => r[0] ?? null) : Promise.resolve(null),
      attachArt(continueRows),
      attachArt(recentMovies),
      attachArt(recentShows),
    ]);

    const rows = [
      continueWatching.length > 0 && { key: "continue", title: "Continue watching", items: continueWatching },
      nextUp.length > 0 && { key: "next", title: "Next up", items: nextUp },
      recentlyMovies.length > 0 && { key: "recent-movies", title: "Recently added movies", items: recentlyMovies },
      recentlyShows.length > 0 && { key: "recent-shows", title: "Recently added shows", items: recentlyShows },
    ].filter(Boolean);
    return { featured, rows };
  })

  /** Library grid with sort + filters (PRD 5.9, 10.2). */
  .get("/items", async ({ query }) => {
    const where: string[] = ["1=1"];
    const params: unknown[] = [];
    if (query.kind) { where.push("i.kind = ?"); params.push(query.kind); }
    if (query.year) { where.push("i.year = ?"); params.push(query.year); }
    if (query.libraryId) { where.push("i.library_id = ?"); params.push(query.libraryId); }
    if (query.unwatched) where.push("i.id NOT IN (SELECT item_id FROM watch_state WHERE played = 1)");
    if (query.q) { where.push("i.name LIKE ?"); params.push(`%${query.q}%`); }
    const order = ITEM_ORDER[query.sort ?? "name"] ?? ITEM_ORDER.name;
    const rows = q<Row>(
      `SELECT i.* FROM items i
       LEFT JOIN item_metadata m ON m.item_id = i.id
       WHERE ${where.join(" AND ")}
       ORDER BY ${order} LIMIT ? OFFSET ?`,
    ).all(...params, query.limit, query.offset);
    return { items: await attachArt(rows) };
  }, {
    query: t.Object({
      libraryId: t.Optional(t.Numeric()),
      kind: t.Optional(t.Union([t.Literal("movie"), t.Literal("series")])),
      year: t.Optional(t.Numeric()),
      unwatched: t.Optional(t.BooleanString()),
      sort: t.Optional(t.String()),
      q: t.Optional(t.String()),
      limit: t.Numeric({ default: 60 }),
      offset: t.Numeric({ default: 0 }),
    }),
  })

  /** Title detail (PRD 10.3). */
  .get("/items/:id", async ({ params }) => {
    const legacyId = /^\d+$/.test(params.id) ? Number(params.id) : null;
    const row = legacyId != null
      ? q<Row>("SELECT * FROM items WHERE id = ?").get(legacyId)
      : q<Row>("SELECT * FROM items WHERE public_id = ?").get(params.id);
    if (!row) return Response.json({ error: "Not found" }, { status: 404 });
    const id = Number(row.id);

    const [card] = await attachArt([row]);
    const meta = q<Row>("SELECT * FROM item_metadata WHERE item_id = ?").get(id);
    const castRows = q<Row>(
      `SELECT p.name, p.profile_path, ip.character_name
       FROM item_people ip JOIN people p ON p.id = ip.person_id
       WHERE ip.item_id = ? AND ip.department = 'cast' ORDER BY ip.ord LIMIT 12`,
    ).all(id);
    const cast = await Promise.all(castRows.map(async (p) => ({
      name: String(p.name),
      character: p.character_name ? String(p.character_name) : null,
      photo: await imageUrl(p.profile_path as string | null, "poster"),
    })));
    const video = q<Row>(
      "SELECT * FROM videos WHERE item_id = ? ORDER BY official DESC, published_at DESC LIMIT 1",
    ).get(id);

    let seasons: Array<{ id: number; number: number; name?: string; poster?: string | null }> | null = null;
    let episodes: ItemCard[] | null = null;
    if (row.kind === "series") {
      const seasonItems = q<Row>(
        "SELECT id, season_number, name FROM items WHERE parent_id = ? AND kind = 'season' ORDER BY season_number",
      ).all(id);

      const epSeasonNums = q<Row>(
        "SELECT DISTINCT season_number FROM items WHERE parent_id = ? AND kind = 'episode' AND season_number IS NOT NULL ORDER BY season_number",
      ).all(id);

      const allNums = Array.from(new Set([
        ...seasonItems.map((s) => Number(s.season_number)),
        ...epSeasonNums.map((s) => Number(s.season_number)),
      ])).filter((n) => !isNaN(n)).sort((a, b) => a - b);

      const sCards = await attachArt(seasonItems);
      const sCardMap = new Map(sCards.map((s) => [s.seasonNumber ?? 0, s]));

      seasons = allNums.map((num) => {
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
        q<Row>("SELECT * FROM items WHERE parent_id = ? AND kind = 'episode' ORDER BY season_number, episode_number").all(id),
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

    const file = row.kind === "movie" || row.kind === "episode"
      ? q<Row>("SELECT * FROM media_files WHERE item_id = ? AND unavailable = 0 ORDER BY id DESC LIMIT 1").get(id)
      : null;

    // Sidecar logo (clear-art) is a detail-hero nicety; missing is fine.
    const logoRow = q<Row>(
      "SELECT id, source, url FROM artwork WHERE item_id = ? AND kind = 'logo' LIMIT 1",
    ).get(id);
    const logo = logoRow
      ? logoRow.source === "local" ? `/api/images/${Number(logoRow.id)}` : String(logoRow.url)
      : null;

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
      seasons,
      episodes,
      file: file ? fileInfoView(file) : null,
      tmdbType: row.tmdb_type ?? null,
      unmatched: row.kind !== "episode" && row.match_status !== "matched",
      matchReason: (row.reason as string | null) ?? null,
    });
  })

  /** Remove a title and its indexed descendants; original video files stay on disk. */
  .delete("/items/:id", async (ctx) => {
    const denied = denyIfNotLocal(ctx, "DELETE /api/items/:id");
    if (denied) return denied;
    const itemId = Number(ctx.params.id);
    if (!Number.isInteger(itemId) || itemId <= 0) return Response.json({ error: "Invalid title id" }, { status: 400 });
    const exists = q<{ id: number }, [number]>("SELECT id FROM items WHERE id=?").get(itemId);
    if (!exists) return Response.json({ error: "Title not found" }, { status: 404 });
    const indexedFiles = q<{ id: number; path: string; size: number; mtime: number }>(
      `WITH RECURSIVE descendants(id) AS (
         SELECT ? UNION ALL SELECT i.id FROM items i JOIN descendants d ON i.parent_id=d.id
       ) SELECT f.id, f.path, f.size, f.mtime FROM media_files f JOIN descendants d ON d.id=f.item_id`,
    ).all(itemId);
    const fileIds = indexedFiles.map((row) => Number(row.id));
    await cancelStreamPreparationsForFiles(fileIds);
    const existingFiles = [] as Array<{ id: number; path: string }>;
    for (const file of indexedFiles) {
      const source = await stat(file.path).catch(() => null);
      if (!source?.isFile()) continue;
      if (source.size !== Number(file.size) || Math.floor(source.mtimeMs) !== Number(file.mtime)) {
        return Response.json({ error: "A source file changed since it was indexed. Rescan the library before deleting this title." }, { status: 409 });
      }
      existingFiles.push({ id: Number(file.id), path: file.path });
    }
    try {
      for (const file of existingFiles) await unlink(file.path);
    } catch {
      return Response.json({ error: "Could not delete a source file. The title remains in the catalog." }, { status: 500 });
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
    const hlsDir = join(resolveOptimizedDir(), "hls");
    const dirs = await readdir(hlsDir, { withFileTypes: true }).catch(() => []);
    await Promise.all(fileIds.flatMap((id) => dirs
      .filter((entry) => entry.isDirectory() && entry.name.startsWith(`${id}-`))
      .map((entry) => rm(join(hlsDir, entry.name), { recursive: true, force: true }))));
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
  .get("/search", async ({ query }) => {
    const text = query.q.trim();
    if (!text) return { titles: [] as ItemCard[], episodes: [] as ItemCard[], items: [] as ItemCard[] };
    const like = `%${text}%`;

    const titleRows = q<Row>(
      `SELECT * FROM items
       WHERE kind IN ('movie', 'series') AND match_status = 'matched' AND name LIKE ?
       ORDER BY score DESC, sort_title LIMIT 24`,
    ).all(like);

    const episodeRows = q<Row>(
      `SELECT e.* FROM items e
       LEFT JOIN items s ON s.id = e.parent_id
       WHERE e.kind = 'episode' AND e.match_status = 'matched'
         AND (e.name LIKE ? OR s.name LIKE ?)
       ORDER BY s.sort_title, e.season_number, e.episode_number
       LIMIT 40`,
    ).all(like, like);

    const [titles, episodes] = await Promise.all([
      attachArt(titleRows),
      attachArt(episodeRows),
    ]);

    // Episodes carry their series name and public id so the card can show
    // "The Bear · S02E03" and link the episode rather than the show.
    const parentIds = [...new Set(episodes.map((e) => e.parentId).filter((id): id is number => id != null))];
    if (parentIds.length) {
      const ph = parentIds.map(() => "?").join(",");
      const parents = new Map(
        q<Row>(`SELECT id, name, public_id FROM items WHERE id IN (${ph})`)
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
    // `items`; current clients render the two typed sections above.
    return { titles, episodes, items: [...titles, ...episodes] };
  }, { query: t.Object({ q: t.String() }) })

  /**
   * Shared playback progress (PRD 5.8, 5.10) — the only LAN-allowed mutation.
   * The player reports every 10 s and on pause/close.
   *
   * `played` is monotonic here on purpose: a routine progress report must never
   * silently unmark a finished title. Explicit watched/unwatched changes go
   * through `POST /api/watch/:itemId/played`.
   */
  .post("/progress", ({ body }) => {
    const itemId = Math.trunc(Number(body.itemId));
    if (!Number.isFinite(itemId) || itemId <= 0) {
      return Response.json({ error: "itemId must be a positive number" }, { status: 400 });
    }
    run(
      `INSERT INTO watch_state (item_id, position_seconds, duration_seconds, played, updated_at)
       VALUES (?,?,?,?,datetime('now'))
       ON CONFLICT(item_id) DO UPDATE SET
         position_seconds = excluded.position_seconds,
         duration_seconds = COALESCE(excluded.duration_seconds, watch_state.duration_seconds),
         played = CASE WHEN excluded.played = 1 THEN 1 ELSE watch_state.played END,
         updated_at = datetime('now')`,
      itemId, Math.max(0, Number(body.position) || 0), body.duration ?? null, body.played ? 1 : 0,
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
  .post("/watch/:itemId/played", ({ params, body }) => {
    const itemId = Math.trunc(Number(params.itemId));
    if (!Number.isFinite(itemId) || itemId <= 0) {
      return Response.json({ error: "itemId must be a positive number" }, { status: 400 });
    }
    const exists = q<{ id: number }, [number]>("SELECT id FROM items WHERE id = ?").get(itemId);
    if (!exists) return Response.json({ error: "Not found" }, { status: 404 });

    if (body.played) {
      run(
        `INSERT INTO watch_state (item_id, position_seconds, duration_seconds, played, updated_at)
         VALUES (?, 0, NULL, 1, datetime('now'))
         ON CONFLICT(item_id) DO UPDATE SET
           position_seconds = 0, played = 1, updated_at = datetime('now')`,
        itemId,
      );
    } else {
      // Keep the duration for the progress bar, but restart from the beginning
      // and clear the finished flag.
      run(
        `INSERT INTO watch_state (item_id, position_seconds, duration_seconds, played, updated_at)
         VALUES (?, 0, NULL, 0, datetime('now'))
         ON CONFLICT(item_id) DO UPDATE SET
           position_seconds = 0, played = 0, updated_at = datetime('now')`,
        itemId,
      );
    }
    log.info("player", body.played ? "marked watched" : "marked unwatched", { itemId });
    return { ok: true, played: body.played };
  }, {
    params: t.Object({ itemId: t.Numeric() }),
    body: t.Object({ played: t.Boolean() }),
  })

  /** Remove a watch-state row entirely ("delete" / remove from Continue Watching). */
  .delete("/watch/:itemId", ({ params }) => {
    const itemId = Math.trunc(Number(params.itemId));
    if (!Number.isFinite(itemId) || itemId <= 0) {
      return Response.json({ error: "itemId must be a positive number" }, { status: 400 });
    }
    run("DELETE FROM watch_state WHERE item_id = ?", itemId);
    log.info("player", "watch state cleared", { itemId });
    return { ok: true };
  }, { params: t.Object({ itemId: t.Numeric() }) });
