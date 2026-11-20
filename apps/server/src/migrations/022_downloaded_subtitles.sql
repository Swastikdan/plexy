-- 022 · Downloaded subtitles ------------------------------------------------
-- Web/native clients can search OpenSubtitles and save the chosen track on the
-- server. The file lives in the subtitle cache; the row lets track discovery
-- list it alongside embedded and sidecar tracks.

CREATE TABLE IF NOT EXISTS downloaded_subtitles (
  file_id INTEGER NOT NULL REFERENCES media_files(id) ON DELETE CASCADE,
  track TEXT NOT NULL,
  language TEXT,
  title TEXT NOT NULL,
  path TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (file_id, track)
);
