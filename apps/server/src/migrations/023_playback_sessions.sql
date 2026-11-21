-- 023 · Playback sessions ---------------------------------------------------
-- One row tracks a device's current/last playback for the admin dashboard.
-- The progress heartbeat keeps it fresh; the admin can stop a live session and
-- the player acknowledges the stop on its next progress report.

CREATE TABLE IF NOT EXISTS playback_sessions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  device_id INTEGER REFERENCES auth_devices(id) ON DELETE SET NULL,
  item_id INTEGER REFERENCES items(id) ON DELETE CASCADE,
  file_id INTEGER REFERENCES media_files(id) ON DELETE SET NULL,
  position_seconds REAL NOT NULL DEFAULT 0,
  duration_seconds REAL,
  paused INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'playing', -- playing | paused | stopped | ended
  stop_requested INTEGER NOT NULL DEFAULT 0,
  client TEXT,
  ip TEXT,
  started_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS playback_sessions_recent
  ON playback_sessions(updated_at DESC);
CREATE INDEX IF NOT EXISTS playback_sessions_user
  ON playback_sessions(user_id, updated_at DESC);
CREATE INDEX IF NOT EXISTS playback_sessions_device
  ON playback_sessions(device_id, updated_at DESC);
