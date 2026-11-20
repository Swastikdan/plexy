/// Resolve the media file that backs an episode item.
///
/// Most episodes own exactly one `media_files` row. A file named
/// `S01E01-E02` is scanned once but covers two episode items, and only the
/// first one owns the file row. This module maps the sibling episode back to
/// the covering file so playback, next-up, and detail pages behave the same.
import { q, type Row } from "./db";

export interface EpisodeRange {
  season: number;
  start: number;
  end: number;
}

/** Parse the `episode_range` marker stored by the scanner (`S01E01-E02`). */
export function parseEpisodeRange(value: string | null | undefined): EpisodeRange | null {
  const match = /S(\d+)\s*E(\d+)(?:\s*[-–E]+\s*E?(\d+))?/i.exec(value ?? "");
  if (!match) return null;
  const start = Number(match[2]);
  const end = match[3] ? Number(match[3]) : start;
  return { season: Number(match[1]), start, end: Math.max(start, end) };
}

/** The item that owns a direct file row, or a covering multi-episode file. */
export function fileForEpisode(itemId: number): Row | null {
  const direct = q<Row>(
    `SELECT * FROM media_files
     WHERE item_id = ? AND unavailable = 0
     ORDER BY height DESC, size DESC, id DESC LIMIT 1`,
  ).get(itemId);
  if (direct) return direct;

  const episode = q<Row>(
    `SELECT parent_id, season_number, episode_number
     FROM items WHERE id = ? AND kind = 'episode'`,
  ).get(itemId);
  if (!episode || episode.parent_id == null || episode.season_number == null || episode.episode_number == null) {
    return null;
  }

  const season = Number(episode.season_number);
  const number = Number(episode.episode_number);
  const candidates = q<Row>(
    `SELECT f.* FROM media_files f
     JOIN items e ON e.id = f.item_id AND e.kind = 'episode'
     WHERE e.parent_id = ? AND e.season_number = ?
       AND f.episode_range IS NOT NULL AND f.unavailable = 0
     ORDER BY f.height DESC, f.size DESC, f.id DESC`,
  ).all(Number(episode.parent_id), season);

  for (const candidate of candidates) {
    const range = parseEpisodeRange(candidate.episode_range as string | null);
    if (range && range.season === season && range.start <= number && number <= range.end) {
      return candidate;
    }
  }
  return null;
}
