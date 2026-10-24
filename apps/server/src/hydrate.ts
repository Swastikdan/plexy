/// TMDB metadata hydration (PRD 5.5).
///
/// Writes the fetched essentials into `item_metadata`, `artwork`, `videos`,
/// `people`, and updates the items row. Shared by the scanner (auto matches)
/// and the manual match route. Everything requires network; failures are
/// logged and surfaced to the caller.
import { q, run, type Row } from "./db";
import { log } from "./logger";
import { normalizeTitle } from "./parse";
import * as tmdb from "./tmdb";
import type { TmdbDetail } from "./tmdb";

/** Fetch + persist one item's TMDB essentials. */
export async function hydrateItemMetadata(
  itemId: number, tmdbType: "movie" | "tv", tmdbId: number,
): Promise<void> {
  const full = await tmdb.detail(tmdbType, tmdbId);
  const year = Number((full.release_date ?? full.first_air_date ?? "").slice(0, 4)) || null;

  run(
    `INSERT INTO item_metadata
       (item_id, overview, tagline, runtime, rating, certification, genres, poster_path, backdrop_path, popularity, updated_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?)
     ON CONFLICT(item_id) DO UPDATE SET
       overview=excluded.overview, tagline=excluded.tagline, runtime=excluded.runtime,
       rating=excluded.rating, certification=excluded.certification, genres=excluded.genres,
       poster_path=excluded.poster_path, backdrop_path=excluded.backdrop_path,
       popularity=excluded.popularity, updated_at=excluded.updated_at`,
    itemId, full.overview ?? null, full.tagline ?? null, full.runtime ?? null,
    full.vote_average ?? null, null,
    JSON.stringify((full.genres ?? []).map((g) => g.name)),
    full.poster_path ?? null, full.backdrop_path ?? null, full.popularity ?? null,
    new Date().toISOString(),
  );

  // Series: keep the canonical year on the items row.
  run("UPDATE items SET year=COALESCE(year, ?) WHERE id=?", year, itemId);

  const img = await tmdb.imageConfig();
  run("DELETE FROM artwork WHERE item_id=?", itemId);
  await writeArtwork(itemId, "poster", full.poster_path, img);
  await writeArtwork(itemId, "backdrop", full.backdrop_path, img);

  run("DELETE FROM videos WHERE item_id=?", itemId);
  const trailer = bestTrailer(full);
  if (trailer) {
    q("INSERT INTO videos (item_id, provider, key, name, type, official, published_at) VALUES (?,?,?,?,?,?,?)").run(
      itemId, "youtube", trailer.key, trailer.name, trailer.type, trailer.official ? 1 : 0,
      trailer.published_at ?? null,
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
  if (tmdbType === "tv") await hydrateEpisodes(itemId, tmdbId, full.title ?? full.name ?? "", full);

  log.debug("tmdb", "metadata hydrated", { itemId, tmdbId, type: tmdbType });
}

/**
 * Resolve episode names, descriptions, runtimes, ratings, and stills from TMDB.
 */
export async function hydrateEpisodes(
  seriesItemId: number,
  tmdbId: number,
  seriesTitle: string,
  fullDetail?: TmdbDetail,
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
      episodes = await tmdb.season(tmdbId, seasonNumber);
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

  let episodes: tmdb.TmdbEpisode[];
  try {
    episodes = await tmdb.season(series.tmdb_id, seasonNumber);
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
      await hydrateEpisodes(Number(s.id), Number(s.tmdb_id), String(s.name));
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
  kind: "poster" | "backdrop" | "thumb",
  path: string | null | undefined,
  img: tmdb.ImageConfig,
): Promise<void> {
  if (!path) return;
  const size = kind === "backdrop" ? img.backdropSize : kind === "thumb" ? img.stillSize : img.posterSize;
  const url = img.baseUrl + size + path;
  q("INSERT INTO artwork (item_id, kind, source, url) VALUES (?,?,?,?)").run(itemId, kind, "tmdb", url);
}

/** Best trailer per PRD 5.7: Trailer type, official first, then newest. */
function bestTrailer(full: TmdbDetail) {
  const yt = (full.videos?.results ?? []).filter((v) => v.site === "YouTube");
  return yt.find((v) => v.type === "Trailer" && v.official)
    ?? yt.find((v) => v.type === "Trailer")
    ?? yt.find((v) => v.type === "Teaser" && v.official)
    ?? null;
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
