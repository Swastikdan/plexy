PRAGMA journal_mode=WAL;
PRAGMA foreign_keys=ON;
CREATE TABLE IF NOT EXISTS schema_meta (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS titles (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL CHECK (kind IN ('movie','show')),
  name TEXT NOT NULL,
  sort_name TEXT,
  year INTEGER,
  overview TEXT,
  runtime INTEGER,                 -- seconds
  rating REAL,
  tmdb_id INTEGER,
  imdb_id TEXT,
  poster_path TEXT,                -- app:/cache/artwork/...
  backdrop_path TEXT,
  logo_path TEXT,
  metadata_json TEXT,              -- raw TMDB payload for fields not modeled
  added_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS media (
  id TEXT PRIMARY KEY,
  title_id TEXT NOT NULL REFERENCES titles(id) ON DELETE CASCADE,
  season INTEGER,
  episode INTEGER,
  path TEXT NOT NULL UNIQUE,       -- virtual path
  container TEXT,                  -- mkv, mp4, ...
  video_codec TEXT,
  width INTEGER,
  height INTEGER,
  hdr TEXT,                        -- sdr | hdr10 | hlg | dv
  duration REAL,
  size INTEGER,
  mtime INTEGER,
  status TEXT NOT NULL DEFAULT 'ready'
    CHECK (status IN ('ready','needs_conversion','converting','failed','missing')),
  original_path TEXT,              -- where it came from, for audit
  added_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS streams (
  id TEXT PRIMARY KEY,
  media_id TEXT NOT NULL REFERENCES media(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind IN ('video','audio','subtitle')),
  stream_index INTEGER NOT NULL,
  codec TEXT,
  language TEXT,
  title TEXT,
  channels INTEGER,
  width INTEGER,
  height INTEGER,
  is_default INTEGER NOT NULL DEFAULT 0,
  is_forced INTEGER NOT NULL DEFAULT 0,
  is_text_subtitle INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS progress (
  media_id TEXT PRIMARY KEY REFERENCES media(id) ON DELETE CASCADE,
  position REAL NOT NULL DEFAULT 0,
  duration REAL,
  watched INTEGER NOT NULL DEFAULT 0,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS jobs (
  id TEXT PRIMARY KEY,
  media_id TEXT,
  kind TEXT NOT NULL CHECK (kind IN ('scan','probe','import','convert')),
  state TEXT NOT NULL CHECK (state IN ('queued','running','verifying','done','failed','canceled','interrupted')),
  progress REAL NOT NULL DEFAULT 0,
  input_path TEXT,
  output_path TEXT,
  error TEXT,
  started_at INTEGER,
  updated_at INTEGER
);

CREATE TABLE IF NOT EXISTS artwork (
  key TEXT PRIMARY KEY,            -- tmdb:movie:123:poster
  path TEXT NOT NULL,
  url TEXT,
  fetched_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_titles_name ON titles(name);
CREATE INDEX IF NOT EXISTS idx_media_title ON media(title_id);
CREATE INDEX IF NOT EXISTS idx_streams_media ON streams(media_id);
CREATE INDEX IF NOT EXISTS idx_progress_updated ON progress(updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_jobs_state ON jobs(state);
