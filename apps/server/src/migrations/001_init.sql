-- 001 · Initial Plexy schema ----------------------------------------------------
-- One migration file per numbered step. Migrations run inside a transaction and
-- are recorded in `schema_migrations` so restarts skip already-applied files.

PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;

-- Applied migration bookkeeping (read by the migration runner; `file` stores
-- the filename so re-applied migrations are named in the table itself).
CREATE TABLE IF NOT EXISTS schema_migrations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  file TEXT NOT NULL UNIQUE,
  applied TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Libraries: name + type + per-library options (PRD 5.2).
CREATE TABLE libraries (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  type TEXT NOT NULL CHECK (type IN ('movies', 'tv')),
  language TEXT NOT NULL DEFAULT 'en-US',
  options TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Root folders attached to a library. A library may have several roots.
CREATE TABLE library_paths (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  library_id INTEGER NOT NULL REFERENCES libraries(id) ON DELETE CASCADE,
  path TEXT NOT NULL UNIQUE
);

-- Catalog items: movie | series | season | episode.
-- Defined before media_files because files link to the item they belong to.
CREATE TABLE items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  library_id INTEGER NOT NULL REFERENCES libraries(id) ON DELETE CASCADE,
  parent_id INTEGER REFERENCES items(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind IN ('movie', 'series', 'season', 'episode')),
  folder_key TEXT,                      -- dedupe key inside the library (folder path for movies/series)
  name TEXT NOT NULL,
  sort_title TEXT NOT NULL,             -- lowercased, articles dropped, for sorting
  year INTEGER,
  season_number INTEGER,
  episode_number INTEGER,
  -- match state. status: matched | review | unmatched.
  -- matched_by: id-tag | nfo | search | manual. locked manual matches survive rescans.
  tmdb_type TEXT CHECK (tmdb_type IN ('movie', 'tv')),
  tmdb_id INTEGER,
  match_status TEXT NOT NULL DEFAULT 'unmatched',
  score REAL,
  matched_by TEXT,
  locked INTEGER NOT NULL DEFAULT 0,
  reason TEXT,
  added_at TEXT NOT NULL DEFAULT (datetime('now')),
  refreshed_at TEXT
);
CREATE UNIQUE INDEX items_folder ON items(library_id, kind, folder_key)
  WHERE folder_key IS NOT NULL;
CREATE INDEX items_parent ON items(parent_id);
CREATE INDEX items_match ON items(match_status);
CREATE UNIQUE INDEX items_series_episode
  ON items(parent_id, season_number, episode_number) WHERE kind = 'episode';
CREATE INDEX items_sort ON items(kind, sort_title);

-- Fetched TMDB essentials (PRD 5.5 M list).
CREATE TABLE item_metadata (
  item_id INTEGER PRIMARY KEY REFERENCES items(id) ON DELETE CASCADE,
  overview TEXT,
  tagline TEXT,
  runtime INTEGER,
  rating REAL,
  certification TEXT,
  genres TEXT,                          -- JSON array of strings
  poster_path TEXT,                     -- TMDB relative path, null for local artwork
  backdrop_path TEXT,
  popularity REAL,
  updated_at TEXT
);

-- Cast and crew (directors shown in the detail header).
CREATE TABLE people (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tmdb_id INTEGER UNIQUE,
  name TEXT NOT NULL,
  profile_path TEXT
);
CREATE TABLE item_people (
  item_id INTEGER NOT NULL REFERENCES items(id) ON DELETE CASCADE,
  person_id INTEGER NOT NULL REFERENCES people(id) ON DELETE CASCADE,
  character_name TEXT,                  -- character for cast, job/NULL for crew
  department TEXT,                      -- 'cast' | 'crew'
  ord INTEGER NOT NULL,
  PRIMARY KEY (item_id, person_id, ord)
);
CREATE INDEX item_people_item ON item_people(item_id);

-- Files found on disk. Probe facts are stored flat per PRD 5.6. `audio_json`,
-- `subtitles_json` and `chapters_json` hold structured tracks as JSON arrays;
-- the rest is normalized because it is queried or displayed directly.
CREATE TABLE media_files (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  library_id INTEGER NOT NULL REFERENCES libraries(id) ON DELETE CASCADE,
  path TEXT NOT NULL UNIQUE,
  folder_key TEXT NOT NULL,             -- directory relative to its root; groups movie files
  size INTEGER NOT NULL,
  mtime INTEGER NOT NULL,
  unavailable INTEGER NOT NULL DEFAULT 0,
  -- probe facts (null until probed)
  container TEXT,
  duration REAL,
  bitrate REAL,
  video_codec TEXT,
  video_profile TEXT,
  video_bit_depth INTEGER,
  width INTEGER,
  height INTEGER,
  fps REAL,
  hdr TEXT,
  audio_json TEXT,                      -- [{ codec, channels, channelLayout, language, default }]
  subtitles_json TEXT,                  -- [{ type, codec, language, title, embedded }]
  chapters_json TEXT,                   -- [{ start, end, label }]
  -- analysis pipeline state: pending | probed | analysis_failed
  analysis_status TEXT NOT NULL DEFAULT 'pending',
  analysis_error TEXT,
  probed_at TEXT,
  item_id INTEGER REFERENCES items(id) ON DELETE SET NULL,
  episode_range TEXT                    -- e.g. "S01E01-E02" when a file covers two episodes
);
CREATE INDEX media_files_item ON media_files(item_id);
CREATE INDEX media_files_library ON media_files(library_id);

-- Artwork records. `url` is the full remote URL; artwork is proxied through
-- /api/images/:id so browser responses stay cacheable without exposing config.
CREATE TABLE artwork (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  item_id INTEGER NOT NULL REFERENCES items(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind IN ('poster', 'backdrop', 'logo', 'thumb')),
  source TEXT NOT NULL DEFAULT 'tmdb',
  url TEXT NOT NULL,
  language TEXT
);
CREATE INDEX artwork_item ON artwork(item_id, kind);

-- Trailers (TMDB YouTube keys or local -trailer files referencing a media_file).
CREATE TABLE videos (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  item_id INTEGER NOT NULL REFERENCES items(id) ON DELETE CASCADE,
  provider TEXT NOT NULL DEFAULT 'youtube',
  key TEXT NOT NULL,
  name TEXT NOT NULL,
  type TEXT NOT NULL DEFAULT 'Trailer',
  official INTEGER NOT NULL DEFAULT 0,
  published_at TEXT
);
CREATE INDEX videos_item ON videos(item_id);

-- Top three candidates kept for items that land in the review queue.
CREATE TABLE match_candidates (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  item_id INTEGER NOT NULL REFERENCES items(id) ON DELETE CASCADE,
  tmdb_id INTEGER NOT NULL,
  tmdb_type TEXT NOT NULL,
  title TEXT NOT NULL,
  year INTEGER,
  poster_path TEXT,
  score REAL NOT NULL,
  reason TEXT NOT NULL,
  position INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX match_candidates_item ON match_candidates(item_id);

-- One installation-wide watch state (PRD 5.8).
CREATE TABLE watch_state (
  item_id INTEGER PRIMARY KEY REFERENCES items(id) ON DELETE CASCADE,
  position_seconds REAL NOT NULL DEFAULT 0,
  duration_seconds REAL,
  played INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Scan job records shown in the admin dashboard and SSE progress.
CREATE TABLE scans (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  library_ids TEXT NOT NULL DEFAULT '[]',
  status TEXT NOT NULL DEFAULT 'running', -- running | done | failed
  files_seen INTEGER NOT NULL DEFAULT 0,
  files_updated INTEGER NOT NULL DEFAULT 0,
  issues INTEGER NOT NULL DEFAULT 0,
  error TEXT,
  started_at TEXT NOT NULL DEFAULT (datetime('now')),
  finished_at TEXT
);

-- Generic key/value settings that are safe to persist (secrets live in config).
CREATE TABLE settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

-- TMDB HTTP cache (PRD 5.5).
CREATE TABLE tmdb_cache (
  key TEXT PRIMARY KEY,                 -- sha1 of the full request URL
  endpoint TEXT NOT NULL,               -- human/label endpoint for logging
  body TEXT NOT NULL,
  expires_at INTEGER NOT NULL,          -- unix ms
  saved_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX tmdb_cache_expiry ON tmdb_cache(expires_at);

-- Numbered migrations applied after 001 go here as new files.
