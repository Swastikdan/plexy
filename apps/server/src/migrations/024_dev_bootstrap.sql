-- One-shot marker for the explicit --dev-admin bootstrap.
--
-- The bootstrap only ever creates an account; it never resets one. This row
-- makes that guarantee survive restarts: once a dev admin has been created,
-- deleting the account or passing the flag again does not recreate it. Only a
-- Bun dev server on loopback may write here (see main.ts); packaged, desktop
-- and production servers refuse the flag before reaching this table.
CREATE TABLE IF NOT EXISTS dev_bootstrap (
  id INTEGER PRIMARY KEY CHECK(id = 1),
  user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
