/// TMDB metadata hydration (PRD 5.5).
///
/// Writes the fetched essentials into `item_metadata`, `artwork`, `videos`,
/// `people`, and updates the items row. Shared by the scanner (auto matches)
/// and the manual match route. Everything requires network; failures are
/// logged and surfaced to the caller.
import { q, run, type Row } from "./db";
import { log } from "./logger";
import { normalizeTitle } from "./parse";
import { getConfig } from "./config";
import { indexItem } from "./search-index";
import * as tmdb from "./tmdb";
import type { TmdbDetail } from "./tmdb";
import { refreshSkipSegmentsForItem, refreshSkipSegmentsForSeries } from "./skip-segments";

/** Metadata language for the library that owns an item, or the global default. */
function libraryLanguage(itemId: number): string | undefined {
  const row = q<{ language: string | null }>(
    "SELECT l.language FROM items i JOIN libraries l ON l.id = i.library_id WHERE i.id = ?",
  ).get(itemId);
  return row?.language ? String(row.language) : undefined;
}

/** Fetch + persist one item's TMDB essentials. */
export async function hydrateItemMetadata(
  itemId: number, tmdbType: "movie" | "tv", tmdbId: number,
): Promise<void> {
  const language = libraryLanguage(itemId);
  const full = await tmdb.detail(tmdbType, tmdbId, language);
  const cfg = await getConfig();
  const certification = tmdb.certificationFromDetail(full, tmdbType, cfg.metadataRegion);
  const year = Number((full.release_date ?? full.first_air_date ?? "").slice(0, 4)) || null;

  const collection = full.belongs_to_collection;
  run(
    `INSERT INTO item_metadata
       (item_id, overview, tagline, runtime, rating, certification, genres, poster_path, backdrop_path, popularity,
        collection_id, collection_name, collection_checked_at, updated_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)
     ON CONFLICT(item_id) DO UPDATE SET
       overview=excluded.overview, tagline=excluded.tagline, runtime=excluded.runtime,
       rating=excluded.rating, certification=excluded.certification, genres=excluded.genres,
       poster_path=excluded.poster_path, backdrop_path=excluded.backdrop_path,
       popularity=excluded.popularity,
       collection_id=excluded.collection_id, collection_name=excluded.collection_name,
       collection_checked_at=excluded.collection_checked_at,
       updated_at=excluded.updated_at`,
    itemId, full.overview ?? null, full.tagline ?? null, full.runtime ?? null,
    full.vote_average ?? null, certification,
    JSON.stringify((full.genres ?? []).map((g) => g.name)),
    full.poster_path ?? null, full.backdrop_path ?? null, full.popularity ?? null,
    collection?.id ?? null,
    collection?.name?.trim() || null,
    new Date().toISOString(),
    new Date().toISOString(),
  );

  // Series: keep the canonical year on the items row.
  run("UPDATE items SET year=COALESCE(year, ?) WHERE id=?", year, itemId);

  const img = await tmdb.imageConfig();
  run("DELETE FROM artwork WHERE item_id=?", itemId);
  await writeArtwork(itemId, "poster", full.poster_path, img);
  await writeArtwork(itemId, "backdrop", full.backdrop_path, img);
  const logoPath = await tmdb.logo(tmdbType, tmdbId, language).catch(() => null);
  await writeArtwork(itemId, "logo", logoPath, img);

  run("DELETE FROM videos WHERE item_id=?", itemId);
  const videos = (full.videos?.results ?? [])
    .filter((video) => video.site === "YouTube")
    .slice(0, 16);
  for (const video of videos) {
    q("INSERT INTO videos (item_id, provider, key, name, type, official, published_at) VALUES (?,?,?,?,?,?,?)").run(
      itemId, "youtube", video.key, video.name, video.type, video.official ? 1 : 0,
      video.published_at ?? null,
    );
  }

  run("DELETE FROM item_people WHERE item_id=?", itemId);
  for (const member of (full.credits?.cast ?? []).slice(0, 12)) {
    await upsertPerson(itemId, member.id, member.name, member.profile_path ?? null, member.character ?? null, "cast", member.order ?? 0);
  }
  for (const member of (full.credits?.crew ?? [])
    .filter((c) => c.job === "Director" || c.job === "Creator" || c.job === "Screenplay")
    .slice(0, 3)) {
    await upsertPerson(itemId, member.id, member.name, null, member.job ?? "crew", "crew", 0);
  }

  run("UPDATE items SET name=COALESCE(NULLIF(?, ''), name), refreshed_at=? WHERE id=?",
    full.title ?? full.name ?? "", new Date().toISOString(), itemId);

  // Series: episode names + stills from the season endpoint (PRD 5.5 M list).
  if (tmdbType === "tv") await hydrateEpisodes(itemId, tmdbId, full.title ?? full.name ?? "", full, language);
  else {
    // Movies use the same community database for end-credits markers.
    void refreshSkipSegmentsForItem(itemId).catch((error) =>
      log.debug("player", "skip marker hydration skipped", {
        itemId, message: String(error),
      }));
  }

  indexItem(itemId);
  log.debug("tmdb", "metadata hydrated", { itemId, tmdbId, type: tmdbType });

  // Pre-cache artwork and cast photos in the background so item is immediately offline-ready
  void import("./artwork").then(({ prefetchItemArtwork }) => prefetchItemArtwork(itemId)).catch(() => {});
}

/**
 * Resolve episode names, descriptions, runtimes, ratings, and stills from TMDB.
 */
export async function hydrateEpisodes(
  seriesItemId: number,
  tmdbId: number,
  seriesTitle: string,
  fullDetail?: TmdbDetail,
  language?: string,
): Promise<void> {
  const img = await tmdb.imageConfig();

  // Attach season posters from TMDB series detail if available
  if (fullDetail?.seasons) {
    for (const s of fullDetail.seasons) {
      if (!s.poster_path) continue;
      const seasonRow = q<Row>(
        "SELECT id FROM items WHERE parent_id = ? AND kind = 'season' AND season_number = ?",
      ).get(seriesItemId, s.season_number);
      if (seasonRow) {
        run("DELETE FROM artwork WHERE item_id = ? AND kind = 'poster'", seasonRow.id);
        await writeArtwork(Number(seasonRow.id), "poster", s.poster_path, img);
      }
    }
  }

  // Find all distinct season numbers present on disk for this series
  const seasonRows = q<Row, [number]>(
    `SELECT DISTINCT season_number FROM items
     WHERE parent_id = ? AND season_number IS NOT NULL
     ORDER BY season_number`,
  ).all(seriesItemId);

  for (const s of seasonRows) {
    const seasonNumber = Number(s.season_number);
    let episodes: tmdb.TmdbEpisode[];
    try {
      episodes = await tmdb.season(tmdbId, seasonNumber, language);
    } catch (e) {
      log.warn("tmdb", "season hydration skipped", { season: seasonNumber, message: String(e) });
      continue;
    }

    for (const ep of episodes) {
      const itemRow = q<Row>(
        "SELECT id FROM items WHERE parent_id = ? AND kind = 'episode' AND season_number = ? AND episode_number = ?",
      ).get(seriesItemId, seasonNumber, ep.episode_number);
      if (!itemRow) continue;

      const epId = Number(itemRow.id);
      const name = ep.name?.trim()
        ? `S${String(seasonNumber).padStart(2, "0")}E${String(ep.episode_number).padStart(2, "0")} · ${ep.name.trim()}`
        : `S${String(seasonNumber).padStart(2, "0")}E${String(ep.episode_number).padStart(2, "0")}`;

      run(
        `UPDATE items SET
           name = ?,
           sort_title = ?,
           tmdb_id = ?,
           tmdb_type = 'tv',
           match_status = 'matched',
           matched_by = 'series',
           score = 1,
           refreshed_at = ?
         WHERE id = ?`,
        name,
        normalizeTitle(`${seriesTitle} ${name}`),
        ep.id,
        new Date().toISOString(),
        epId,
      );

      // Persist episode synopsis, runtime and rating
      run(
        `INSERT INTO item_metadata
           (item_id, overview, runtime, rating, poster_path, backdrop_path, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(item_id) DO UPDATE SET
           overview = excluded.overview,
           runtime = excluded.runtime,
           rating = excluded.rating,
           poster_path = excluded.poster_path,
           backdrop_path = excluded.backdrop_path,
           updated_at = excluded.updated_at`,
        epId,
        ep.overview ?? null,
        ep.runtime ?? null,
        ep.vote_average ?? null,
        ep.still_path ?? null,
        ep.still_path ?? null,
        new Date().toISOString(),
      );

      if (ep.still_path) {
        await writeEpisodeArtwork(epId, ep.still_path, img);
      }
      indexItem(epId);
    }
  }

  // Ensure any unmatched episodes under this series are marked matched so they do not pollute review queue
  run(
    `UPDATE items SET
       match_status = 'matched',
       matched_by = 'series',
       tmdb_type = 'tv',
       score = 1
     WHERE parent_id = ? AND kind = 'episode' AND match_status != 'matched'`,
    seriesItemId,
  );

  // Cache intro/recap/credits markers while the series identity is fresh, so
  // playback reads them from SQLite instead of waiting on a live lookup.
  void refreshSkipSegmentsForSeries(seriesItemId).catch((error) =>
    log.debug("player", "skip marker hydration skipped", {
      seriesItemId, message: String(error),
    }));
}

/** Write thumb, poster, and backdrop artwork rows for an episode still. */
export async function writeEpisodeArtwork(
  epId: number,
  stillPath: string | null | undefined,
  img: tmdb.ImageConfig,
): Promise<void> {
  if (!stillPath) return;
  run("DELETE FROM artwork WHERE item_id = ? AND kind IN ('thumb', 'poster', 'backdrop')", epId);
  const baseUrl = img.baseUrl;
  const thumbUrl = baseUrl + (img.stillSize ?? "w300") + stillPath;
  const originalUrl = baseUrl + "original" + stillPath;
  q("INSERT INTO artwork (item_id, kind, source, url) VALUES (?,?,?,?)").run(epId, "thumb", "tmdb", thumbUrl);
  q("INSERT INTO artwork (item_id, kind, source, url) VALUES (?,?,?,?)").run(epId, "poster", "tmdb", originalUrl);
  q("INSERT INTO artwork (item_id, kind, source, url) VALUES (?,?,?,?)").run(epId, "backdrop", "tmdb", originalUrl);
}

/** Hydrate a single episode item from its season data. */
export async function hydrateEpisodeItem(
  epId: number,
  seriesId: number,
  seasonNumber: number,
  episodeNumber: number,
  seriesTitle?: string,
): Promise<boolean> {
  const series = q<{ tmdb_id: number | null; name: string }, [number]>(
    "SELECT tmdb_id, name FROM items WHERE id = ?",
  ).get(seriesId);
  if (!series?.tmdb_id) return false;
  const language = libraryLanguage(seriesId);

  let episodes: tmdb.TmdbEpisode[];
  try {
    episodes = await tmdb.season(series.tmdb_id, seasonNumber, language);
  } catch {
    return false;
  }

  const ep = episodes.find((e) => e.episode_number === episodeNumber);
  if (!ep) return false;

  const title = seriesTitle ?? series.name;
  const name = ep.name?.trim()
    ? `S${String(seasonNumber).padStart(2, "0")}E${String(ep.episode_number).padStart(2, "0")} · ${ep.name.trim()}`
    : `S${String(seasonNumber).padStart(2, "0")}E${String(ep.episode_number).padStart(2, "0")}`;

  run(
    `UPDATE items SET
       name = ?,
       sort_title = ?,
       tmdb_id = ?,
       tmdb_type = 'tv',
       match_status = 'matched',
       matched_by = 'series',
       score = 1,
       refreshed_at = ?
     WHERE id = ?`,
    name,
    normalizeTitle(`${title} ${name}`),
    ep.id,
    new Date().toISOString(),
    epId,
  );
  indexItem(epId);

  run(
    `INSERT INTO item_metadata
       (item_id, overview, runtime, rating, poster_path, backdrop_path, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(item_id) DO UPDATE SET
       overview = excluded.overview,
       runtime = excluded.runtime,
       rating = excluded.rating,
       poster_path = excluded.poster_path,
       backdrop_path = excluded.backdrop_path,
       updated_at = excluded.updated_at`,
    epId,
    ep.overview ?? null,
    ep.runtime ?? null,
    ep.vote_average ?? null,
    ep.still_path ?? null,
    ep.still_path ?? null,
    new Date().toISOString(),
  );

  const img = await tmdb.imageConfig();
  await writeEpisodeArtwork(epId, ep.still_path, img);
  return true;
}

/** Hydrate missing episode records for a given series, or all matched series. */
export async function hydrateMissingEpisodes(targetSeriesId?: number): Promise<number> {
  const seriesList = targetSeriesId
    ? q<{ id: number; tmdb_id: number; name: string }>(
        `SELECT id, tmdb_id, name FROM items
         WHERE id = ? AND kind = 'series' AND match_status = 'matched' AND tmdb_id IS NOT NULL`,
      ).all(targetSeriesId)
    : q<{ id: number; tmdb_id: number; name: string }>(
        `SELECT DISTINCT s.id, s.tmdb_id, s.name FROM items s
         JOIN items e ON e.parent_id = s.id AND e.kind = 'episode'
         LEFT JOIN item_metadata m ON m.item_id = e.id
         WHERE s.kind = 'series' AND s.match_status = 'matched' AND s.tmdb_id IS NOT NULL
           AND (e.tmdb_id IS NULL OR m.item_id IS NULL)`,
      ).all();

  let count = 0;
  for (const s of seriesList) {
    try {
      await hydrateEpisodes(Number(s.id), Number(s.tmdb_id), String(s.name), undefined, libraryLanguage(Number(s.id)));
      count++;
    } catch (e) {
      log.warn("tmdb", "failed hydrating missing episodes for series", {
        seriesId: s.id,
        error: String(e),
      });
    }
  }
  return count;
}

async function writeArtwork(
  itemId: number,
  kind: "poster" | "backdrop" | "thumb" | "logo",
  path: string | null | undefined,
  img: tmdb.ImageConfig,
): Promise<void> {
  if (!path) return;
  const size = kind === "backdrop"
    ? img.backdropSize
    : kind === "thumb"
      ? img.stillSize
      : kind === "logo"
        ? img.logoSize
        : img.posterSize;
  const url = img.baseUrl + size + path;
  q("INSERT INTO artwork (item_id, kind, source, url) VALUES (?,?,?,?)").run(itemId, kind, "tmdb", url);
}

async function upsertPerson(
  itemId: number, personTmdbId: number, name: string, profilePath: string | null,
  characterName: string | null, department: "cast" | "crew", ord: number,
): Promise<void> {
  q("INSERT INTO people (tmdb_id, name, profile_path) VALUES (?,?,?) ON CONFLICT(tmdb_id) DO UPDATE SET name=excluded.name, profile_path=excluded.profile_path")
    .run(personTmdbId, name, profilePath);
  const row = q<{ id: number }, [number]>("SELECT id FROM people WHERE tmdb_id = ?").get(personTmdbId);
  if (!row) return;
  q("INSERT OR IGNORE INTO item_people (item_id, person_id, character_name, department, ord) VALUES (?,?,?,?,?)")
    .run(itemId, row.id, characterName, department, ord);
}

/** Reverse lookup for views that only know a TMDB id. */
export function personNameById(id: number): string | null {
  const row = q<{ name: string }, [number]>("SELECT name FROM people WHERE id = ?").get(id);
  return row?.name ?? null;
}

let refreshingLocalMetadata = false;
/** Refresh known IDs only, keeping manual matches and cached offline metadata intact. */
export async function refreshStaleLocalMetadata(): Promise<void> {
  if (!process.env.PLEXY_LOCAL_ONLY || refreshingLocalMetadata) return;
  refreshingLocalMetadata = true;
  try {
    const { getConfig } = await import("./config");
    const cfg = await getConfig();
    if (!cfg.tmdbToken) return;
    const cutoff = new Date(Date.now() - 7 * 86400_000).toISOString();
    const items = q<{ id: number; tmdb_id: number; tmdb_type: "movie" | "tv" }>(
      `SELECT id, tmdb_id, tmdb_type FROM items
       WHERE kind IN ('movie','series') AND tmdb_id IS NOT NULL
         AND (refreshed_at IS NULL OR refreshed_at < ?) ORDER BY refreshed_at LIMIT 25`,
    ).all(cutoff);
    if (!items.length) return;
    // Confirm connectivity before hydration: a stale-cache fallback must not mark
    // offline data as freshly downloaded and postpone the next online retry.
    const check = await fetch("https://api.themoviedb.org/3/configuration", {
      headers: { Authorization: `Bearer ${cfg.tmdbToken}` }, signal: AbortSignal.timeout(3500),
    });
    if (!check.ok) return;
    for (const item of items) {
      try { await hydrateItemMetadata(item.id, item.tmdb_type, item.tmdb_id); }
      catch { break; }
    }
  } catch { /* Offline operation uses the existing local metadata and artwork. */ }
  finally { refreshingLocalMetadata = false; }
}

const refreshingLibraries = new Set<number>();

/**
 * Refresh matched titles after a library's metadata language changes. Runs in
 * the background with a tiny worker pool so a language switch is immediate in
 * the UI and gradually propagates through TMDB-backed fields.
 */
export async function refreshLibraryMetadata(libraryId: number): Promise<number> {
  if (refreshingLibraries.has(libraryId)) return 0;
  refreshingLibraries.add(libraryId);
  let updated = 0;
  try {
    const rows = q<{ id: number; tmdb_id: number; tmdb_type: "movie" | "tv" }>(
      `SELECT id, tmdb_id, tmdb_type FROM items
       WHERE library_id = ? AND kind IN ('movie','series')
         AND tmdb_id IS NOT NULL AND tmdb_type IN ('movie','tv')
       ORDER BY id`,
    ).all(libraryId);
    const queue = [...rows];
    const workers = Array.from({ length: 2 }, async () => {
      while (queue.length) {
        const row = queue.shift();
        if (!row) break;
        try {
          await hydrateItemMetadata(Number(row.id), row.tmdb_type, Number(row.tmdb_id));
          updated++;
        } catch {
          // Network/offline failures leave the existing metadata in place.
        }
      }
    });
    await Promise.all(workers);
    if (updated) log.debug("tmdb", "library metadata refreshed", { libraryId, updated });
  } finally {
    refreshingLibraries.delete(libraryId);
  }
  return updated;
}

let backfillingLogos = false;/**
 * Titles hydrated before logo support existed keep text-only heroes. Fetch the
 * missing transparent logos in the background, one throttle-friendly request
 * at a time. Existing sidecar logos are left untouched.
 */
export async function backfillMissingLogos(limit = 50): Promise<number> {
  if (backfillingLogos) return 0;
  backfillingLogos = true;
  let updated = 0;
  try {
    const { getConfig } = await import("./config");
    const cfg = await getConfig();
    if (!cfg.tmdbToken) return 0;
    const rows = q<{ id: number; tmdb_id: number; tmdb_type: "movie" | "tv"; language: string | null }>(
      `SELECT i.id, i.tmdb_id, i.tmdb_type, l.language FROM items i
       JOIN libraries l ON l.id = i.library_id
       WHERE i.kind IN ('movie','series') AND i.tmdb_id IS NOT NULL
         AND i.tmdb_type IN ('movie','tv')
         AND NOT EXISTS (SELECT 1 FROM artwork a WHERE a.item_id = i.id AND a.kind = 'logo')
       ORDER BY i.added_at DESC, i.id DESC LIMIT ?`,
    ).all(limit);
    if (!rows.length) return 0;
    const img = await tmdb.imageConfig();
    for (const row of rows) {
      try {
        const path = await tmdb.logo(row.tmdb_type, Number(row.tmdb_id), row.language ?? undefined);
        if (!path) continue;
        await writeArtwork(Number(row.id), "logo", path, img);
        updated++;
      } catch {
        break;
      }
    }
    if (updated) log.debug("tmdb", "backfilled title logos", { updated });
  } catch {
    /* logos are decoration; a missing token or offline machine is not an error */
  } finally {
    backfillingLogos = false;
  }
  return updated;
}

let backfillingCertifications = false;
/**
 * Existing libraries were hydrated while the age-rating fields were being
 * discarded. Re-fetch only the certification for titles that still have none,
 * without rewriting artwork, cast, or the title itself.
 */
export async function backfillCertifications(
  limit = 100,
): Promise<{ checked: number; updated: number }> {
  if (backfillingCertifications) return { checked: 0, updated: 0 };
  backfillingCertifications = true;
  let checked = 0;
  let updated = 0;
  try {
    const cfg = await getConfig();
    if (!cfg.tmdbToken) return { checked, updated };
    const rows = q<{ id: number; tmdb_id: number; tmdb_type: "movie" | "tv"; language: string | null }>(
      `SELECT i.id, i.tmdb_id, i.tmdb_type, l.language
       FROM items i
       JOIN libraries l ON l.id = i.library_id
       LEFT JOIN item_metadata m ON m.item_id = i.id
       WHERE i.kind IN ('movie','series')
         AND i.tmdb_id IS NOT NULL AND i.tmdb_type IN ('movie','tv')
         AND (m.certification IS NULL OR trim(m.certification) = '')
       ORDER BY i.added_at DESC, i.id DESC
       LIMIT ?`,
    ).all(Math.max(1, Math.min(500, limit)));
    for (const row of rows) {
      checked++;
      try {
        const full = await tmdb.detail(row.tmdb_type, Number(row.tmdb_id), row.language ?? undefined);
        const certification = tmdb.certificationFromDetail(
          full,
          row.tmdb_type,
          cfg.metadataRegion,
        );
        if (!certification) continue;
        run(
          `INSERT INTO item_metadata (item_id, certification, updated_at)
           VALUES (?,?,?)
           ON CONFLICT(item_id) DO UPDATE SET
             certification = excluded.certification,
             updated_at = excluded.updated_at`,
          row.id,
          certification,
          new Date().toISOString(),
        );
        updated++;
      } catch {
        // A missing token, TMDB outage, or a deleted title must not stop the
        // rest of the backfill. The rows stay eligible for the next pass.
        break;
      }
    }
    if (updated) log.debug("tmdb", "backfilled certifications", { checked, updated });
  } catch {
    /* offline startup: the next pass retries */
  } finally {
    backfillingCertifications = false;
  }
  return { checked, updated };
}

let backfillingCollections = false;
/**
 * Group older matched movies into their TMDB collections. Hydration stores the
 * collection for every new match; this fills the libraries that were indexed
 * before automatic collections existed, a bounded batch per startup pass.
 */
export async function backfillCollections(limit = 50): Promise<number> {
  if (backfillingCollections) return 0;
  backfillingCollections = true;
  let updated = 0;
  try {
    const { getConfig } = await import("./config");
    const cfg = await getConfig();
    if (!cfg.tmdbToken) return 0;
    const rows = q<{ id: number; tmdb_id: number }>(
      `SELECT i.id, i.tmdb_id
       FROM items i
       LEFT JOIN item_metadata m ON m.item_id = i.id
       WHERE i.kind = 'movie' AND i.tmdb_type = 'movie'
         AND i.tmdb_id IS NOT NULL
         AND m.collection_checked_at IS NULL
       ORDER BY i.added_at DESC, i.id DESC
       LIMIT ?`,
    ).all(Math.max(1, Math.min(200, limit)));
    for (const row of rows) {
      try {
        await hydrateItemMetadata(Number(row.id), "movie", Number(row.tmdb_id));
        updated++;
      } catch {
        // Offline or rate-limited: leave the row for the next pass.
        break;
      }
    }
    if (updated) log.debug("tmdb", "backfilled movie collections", { updated });
  } catch {
    /* offline startup: the next pass retries */
  } finally {
    backfillingCollections = false;
  }
  return updated;
}
