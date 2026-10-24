-- 004 · Trickplay (scrub preview) cache --------------------------------------
-- One row per media file. Frames are extracted once, in a child process, every
-- `interval` seconds at 160×90 and cached as JPEGs under the data directory.
-- `source_mtime` invalidates the cache automatically when the source changes.
CREATE TABLE IF NOT EXISTS trickplay (
  file_id INTEGER PRIMARY KEY REFERENCES media_files(id) ON DELETE CASCADE,
  source_mtime INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'none',     -- none | queued | running | done | failed
  interval REAL NOT NULL DEFAULT 10,
  frame_count INTEGER,
  width INTEGER NOT NULL DEFAULT 160,
  height INTEGER NOT NULL DEFAULT 90,
  duration REAL,
  error TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS trickplay_status ON trickplay(status);
