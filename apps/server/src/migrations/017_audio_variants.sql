-- 017 · Prepared audio-track variants ----------------------------------------
-- The primary prepared copy keeps the first audio track. Browsers cannot
-- switch audio tracks inside an MP4, so a viewer who selects another language
-- gets a second prepared copy that contains the same video packets and that
-- one audio track. Rows are created on demand; the source mtime keeps stale
-- copies from being served after a file changes.

CREATE TABLE IF NOT EXISTS media_audio_variants (
  file_id INTEGER NOT NULL REFERENCES media_files(id) ON DELETE CASCADE,
  audio_index INTEGER NOT NULL,
  source_mtime INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'none',   -- none | queued | running | done | failed
  progress REAL,
  eta_seconds INTEGER,
  path TEXT,
  size INTEGER,
  error TEXT,
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (file_id, audio_index)
);

CREATE INDEX IF NOT EXISTS media_audio_variants_status ON media_audio_variants(status);
