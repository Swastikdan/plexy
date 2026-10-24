-- 006 · Per-title adaptive stream preparation -------------------------------
-- Quality variants are opt-in per title and prepared before playback.

CREATE TABLE item_stream_settings (
  item_id INTEGER PRIMARY KEY REFERENCES items(id) ON DELETE CASCADE,
  qualities TEXT NOT NULL DEFAULT '[]',
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE hls_preparations (
  file_id INTEGER PRIMARY KEY REFERENCES media_files(id) ON DELETE CASCADE,
  source_mtime INTEGER NOT NULL,
  audio_index INTEGER NOT NULL DEFAULT 0,
  qualities TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'queued',
  error TEXT,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
