-- 002 · Prepared playback cache ------------------------------------------------
-- Files that are not directly playable (or whose MP4 metadata sits at the end of
-- the file) are prepared in the background into a fast-start MP4. The original
-- file is never modified or deleted; `optimized_path` points at Plexy's cache.
--
-- `optimized_mtime` stores the source file's mtime at the time of preparation,
-- so a changed source automatically invalidates the cached copy.

ALTER TABLE media_files ADD COLUMN optimized_path TEXT;
ALTER TABLE media_files ADD COLUMN optimized_mode TEXT;       -- remux | transcode
ALTER TABLE media_files ADD COLUMN optimized_status TEXT NOT NULL DEFAULT 'none';
                                                              -- none | queued | running | done | failed | skipped
ALTER TABLE media_files ADD COLUMN optimized_size INTEGER;
ALTER TABLE media_files ADD COLUMN optimized_error TEXT;
ALTER TABLE media_files ADD COLUMN optimized_at TEXT;
ALTER TABLE media_files ADD COLUMN optimized_mtime INTEGER;
ALTER TABLE media_files ADD COLUMN optimized_progress REAL;

CREATE INDEX media_files_optimize ON media_files(optimized_status);

-- Extracted embedded subtitle tracks, cached as WebVTT so the player can load
-- them instantly instead of re-reading the video container on every request.
CREATE TABLE IF NOT EXISTS subtitle_cache (
  file_id INTEGER NOT NULL REFERENCES media_files(id) ON DELETE CASCADE,
  track_index INTEGER NOT NULL,
  path TEXT NOT NULL,
  source_mtime INTEGER NOT NULL,
  bytes INTEGER NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (file_id, track_index)
);

-- Speeds up home rows and library grids on large libraries.
CREATE INDEX IF NOT EXISTS items_kind_added ON items(kind, added_at DESC);
CREATE INDEX IF NOT EXISTS items_library_kind ON items(library_id, kind);
CREATE INDEX IF NOT EXISTS watch_state_recent ON watch_state(played, updated_at DESC);
CREATE INDEX IF NOT EXISTS media_files_item_available ON media_files(item_id, unavailable, id DESC);
