-- 020 · Per-user library flags -----------------------------------------------
-- Watchlist, favorites, ratings, and hidden titles belong to the account, not
-- to a browser tab. One row per user/item keeps reads cheap and lets every
-- client share the same state.

CREATE TABLE IF NOT EXISTS user_item_flags (
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  item_id INTEGER NOT NULL REFERENCES items(id) ON DELETE CASCADE,
  watchlist INTEGER NOT NULL DEFAULT 0,
  favorite INTEGER NOT NULL DEFAULT 0,
  hidden INTEGER NOT NULL DEFAULT 0,
  rating INTEGER CHECK (rating IS NULL OR rating BETWEEN 1 AND 5),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (user_id, item_id)
);

CREATE INDEX IF NOT EXISTS user_item_flags_watchlist
  ON user_item_flags(user_id, watchlist, updated_at DESC);
CREATE INDEX IF NOT EXISTS user_item_flags_favorite
  ON user_item_flags(user_id, favorite, updated_at DESC);
CREATE INDEX IF NOT EXISTS user_item_flags_hidden
  ON user_item_flags(user_id, hidden);
