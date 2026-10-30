-- 012 · Community skip markers -----------------------------------------------
-- IntroDB returns intro, recap, and end-credits windows for an episode (or a
-- movie's credits). Markers are cached so the player never waits on a live
-- lookup during playback and so scans can hydrate a whole library in advance.
-- The lookup row records "checked, nothing found" too; otherwise every episode
-- without community data would be re-fetched on every play.

CREATE TABLE skip_segments (
  item_id INTEGER NOT NULL REFERENCES items(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind IN ('intro', 'recap', 'outro')),
  start_seconds REAL NOT NULL,
  end_seconds REAL NOT NULL,
  confidence REAL,
  submission_count INTEGER,
  source TEXT NOT NULL DEFAULT 'introdb',
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (item_id, kind)
);
CREATE INDEX skip_segments_item ON skip_segments(item_id);

CREATE TABLE skip_segment_lookups (
  item_id INTEGER PRIMARY KEY REFERENCES items(id) ON DELETE CASCADE,
  source TEXT NOT NULL DEFAULT 'introdb',
  imdb_id TEXT,
  -- found: markers stored | none: checked, no markers | error: retry soon
  status TEXT NOT NULL DEFAULT 'none' CHECK (status IN ('found', 'none', 'error')),
  fetched_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);
CREATE INDEX skip_segment_lookups_expiry ON skip_segment_lookups(expires_at);
