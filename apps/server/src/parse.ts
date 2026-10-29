/// File-name parser (PRD 5.3 / 5.4 step 2).
///
/// Turns on-disk paths into `{ title, year, season, episode, explicitId }`
/// regardless of spacing style (`S01E02`, `s1e2`, `1x02`, `S01E01-E02`).
/// Emits explicit ID tags before any cleaning so `[tmdbid-123]` always wins
/// and never leaks into the search query.
import { basename, dirname, extname, join, relative } from "node:path";

export type LibraryType = "movies" | "tv" | "anime";

export interface Parsed {
  title: string;
  year: number | null;
  season: number | null;
  episode: number | null;
  /** Last episode when a file covers `S01E01-E02`. */
  episodeEnd: number | null;
  /** TMDB id from a bracket tag or NFO, when present. */
  explicitId: number | null;
  /** True when `Season 00` / `Specials`. */
  isSpecial: boolean;
}

/** Containers Plexy accepts per PRD 5.2. */
export const VIDEO_EXTENSIONS = new Set([
  ".mkv", ".mp4", ".m4v", ".webm", ".avi", ".mov", ".ts",
]);

/** Folder names that mark extra content, never a separate title (PRD 5.2). */
export const EXTRA_FOLDER =
  /^(sample|extras?|featurettes?|behind[ ._-]the[ ._-]scenes?|trailers?)$/i;

/** Sidecar subtitle bases are matched with the same stem as the video. */
export const SUBSIDARY_EXTENSIONS = new Set([".srt", ".vtt"]);

const NOISE =
  /\b(2160p|1080p|1080i|720p|480p|4k|uhd|bluray|blu-?ray|bdrip|brrip|web-?dl|webrip|web|hdtv|dvdrip|dvd|x264|x265|h\.?264|h\.?265|hevc|av1|aac|ac3|eac3|dts(?:-hd)?(?:-?ma)?|truehd|atmos|ddp?\d(?:\.\d)?|5\s?1|7\s?1|2\s?0|hdr(?:10)?(?:\+)?|dolby|vision|remux|proper|repack|extended|unrated|remastered|improved|internal|amzn|nf|atvp|hmax|dsnp|max|pcm|flac|true|dual(\s?audio)?|multi(\s?subs)?[^ ]*|hq|10bit|8bit)\b/gi;

/** Lowercase a latin title and drop leading articles for sort/search keys. */
export function normalizeTitle(t: string): string {
  return t.toLowerCase().replace(/[^a-z0-9 ]+/g, " ").replace(/^(the|a|an)\s+/i, "").replace(/\s+/g, " ").trim();
}

/** Strip dot/underscore separators, release noise, resolution tags, groups. */
export function cleanName(raw: string): string {
  let s = raw.replace(/[._]+/g, " ");
  s = s.replace(NOISE, " ");
  // Bracketed non-ID tags like (2010) are kept by callers; drop colliding ones.
  s = s.replace(/\[(?:\w+\s*[=:\-]\s*\w+)\]/g, " ");
  s = s.replace(/\((?:[^)]*(?:1080p|720p|2160p|x26[45]|hevc|web|bluray)[^)]*)\)/gi, " ");
  s = s.replace(/-{1,2}\s*[^-()]*$/g, " "); // trailing release-group after a dash
  return s.replace(/\s+/g, " ").trim();
}

/** Extract a tmdb tag from `[tmdbid-123]`, `[tmdbid=123]`, `{tmdb-123}`. */
export function extractExplicitId(text: string): number | null {
  const m = text.match(/[[{]tmdb(?:id)?\s*[=:\-]\s*(\d+)[\]}]/i);
  return m ? Number(m[1]) : null;
}

/** Year token `(1995)` or a bare 4-digit year after the title. */
function extractYear(text: string): number | null {
  const m = text.match(/\(?((?:19|20)\d{2})\)?(?=\s|$)/);
  if (!m) return null;
  const y = Number(m[1]);
  return y >= 1900 && y <= new Date().getUTCFullYear() + 1 ? y : null;
}

/** `S01E02`, `s1e2`, `1x02`, `101` (absolute in a season folder) and ranges. */
function extractEpisode(text: string): { season: number; episode: number; episodeEnd: number | null } | null {
  let m = text.match(/\bS(\d{1,2})\s*[._\s]*E(\d{1,3})(?:\s*[-–E]+\s*E?(\d{1,3}))?/i);
  if (m) return { season: Number(m[1]), episode: Number(m[2]), episodeEnd: m[3] ? Number(m[3]) : null };
  m = text.match(/\b(\d{1,2})x(\d{1,3})\b/i);
  if (m) return { season: Number(m[1]), episode: Number(m[2]), episodeEnd: null };
  return null;
}

/** `Season 01`-style segment matcher shared by parser + folder key. */
export const SEASON_FOLDER = /^(?:s\d{1,2}|season[\s._-]*\d+|specials)$/i;

/** Parse the path of one video file. */
export function parsePath(path: string, type: LibraryType, libraryRoots: string[]): Parsed {
  const explicitId = extractExplicitId(path);
  const file = basename(path, extname(path));

  // Which root the file belongs to decides the folder path we inspect.
  const root = libraryRoots.find((r) => path.startsWith(r)) ?? dirname(dirname(path));
  const rel = relative(root, path);
  const segments = rel.split(/[/\\]/).filter(Boolean);

  if (type !== "movies") return parseTvPath(segments, file, explicitId, basename(root));
  return parseMoviePath(segments, file, explicitId);
}

/**
 * TV layout: Series (Year)/Season 01/File S01E02. `Season 00` and `Specials`
 * mark specials. The series folder wins for title/year; the file supplies the
 * season + episode numbers. When the file sits directly in the library root
 * (no series folder), the root folder name is the series title.
 */
function parseTvPath(segments: string[], file: string, explicitId: number | null, rootName: string): Parsed {
  const seasonIdx = segments.findIndex((s) => SEASON_FOLDER.test(s.trim()));
  const isSpecial = seasonIdx >= 0 && /specials|^season[\s._-]*0{1,2}$/i.test(segments[seasonIdx] ?? "");

  // Where the series title comes from, highest priority first:
  // the season's parent folder → the file's own folder → the library root.
  const seriesSeg = seasonIdx > 0
    ? segments[seasonIdx - 1]
    : segments.length > 1
      ? segments[0]
      : rootName;
  const seriesYear = extractYear(seriesSeg ?? "");
  // Series folders often end in "S01" or "Season 1"; it's not part of the title.
  const seriesTitle = cleanName((seriesSeg ?? file).replace(/\(\d{4}\)/g, ""))
    .replace(/[\s._-]+(?:S\d{1,2}|Season[\s._-]*\d{1,2})$/i, "");

  const ep = extractEpisode(file) ?? extractEpisode(segments[seasonIdx] ?? "");
  return {
    title: seriesTitle || file,
    year: seriesYear,
    season: ep?.season ?? (isSpecial ? 0 : null),
    episode: ep?.episode ?? null,
    episodeEnd: ep?.episodeEnd ?? null,
    explicitId,
    isSpecial,
  };
}

/** Movie layout: use the parent folder when present, else the file name. */
function parseMoviePath(segments: string[], file: string, explicitId: number | null): Parsed {
  // Deepest non-file folder that is not an extras folder.
  const folder = [...segments.slice(0, -1)].reverse()
    .find((s) => !EXTRA_FOLDER.test(s)) ?? "";
  const source = folder || file.replace(/\.[a-z]{2,4}$/i, "");
  const year = extractYear(source);
  const title = cleanName(source.replace(/\(\d{4}\)/g, ""));
  return {
    title: title || file,
    year,
    season: null,
    episode: null,
    episodeEnd: null,
    explicitId,
    isSpecial: false,
  };
}

/** Key that groups files belonging to one movie folder. */
export function movieFolderKey(path: string, libraryRoots: string[]): string {
  const root = libraryRoots.find((r) => path.startsWith(r)) ?? dirname(dirname(path));
  const rel = relative(root, path);
  const segments = rel.split(/[/\\]/).filter(Boolean);
  const folder = segments.slice(0, -1);
  const hasExtras = folder.length > 0 && EXTRA_FOLDER.test(folder[folder.length - 1]!);
  const trimmed = hasExtras ? folder.slice(0, -1) : folder;
  // path.join() with no segments returns ".", which made every movie stored
  // directly in a library root collide into one catalog item. Use the file
  // stem as its stable key in that layout; files in a named folder still
  // group together as alternate versions of the same title.
  return trimmed.length ? join(...trimmed) : basename(path, extname(path));
}

/**
 * Key that groups files belonging to one TV series. For `Series/Season 01/f.mkv`
 * that is `Series`; for files directly in the root it is the root itself.
 */
export function tvSeriesFolderKey(path: string, libraryRoots: string[]): string {
  const root = libraryRoots.find((r) => path.startsWith(r)) ?? dirname(dirname(path));
  const rel = relative(root, path);
  const segments = rel.split(/[/\\]/).filter(Boolean);
  if (segments.length === 1) return join(root); // file directly in the root
  const dir = segments.slice(0, -1);
  if (dir.length && SEASON_FOLDER.test(dir[dir.length - 1]!.trim())) {
    dir.pop(); // key on the series folder, not the season folder
    if (dir.length === 0) return join(root);
  }
  return join(...dir) || join(root);
}
