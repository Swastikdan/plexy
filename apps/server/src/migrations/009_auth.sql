-- Device authentication.
--
-- Plexy used to trust "the request came from 127.0.0.1" for everything. Once
-- the server can live on a home box or a VPS, remote clients need a credential.
-- Only the SHA-256 hash of a token is stored, never the token itself, so a copy
-- of library.sqlite cannot be replayed as a login.
--
-- This migration is intentionally additive: replacing the .app (or moving the
-- database to a new release) must keep existing libraries, watch state, and
-- paired devices intact.

CREATE TABLE IF NOT EXISTS auth_devices (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  -- Stable identifier supplied by the desktop app, so relaunches rotate the
  -- token instead of growing the device list forever. NULL for browser pairs.
  device_id TEXT UNIQUE,
  name TEXT NOT NULL DEFAULT 'Device',
  token_hash TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  last_seen TEXT,
  revoked INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_auth_devices_token ON auth_devices(token_hash);

-- Short-lived, single-use codes shown by the owner and typed on a new device.
CREATE TABLE IF NOT EXISTS auth_pairing (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  code_hash TEXT NOT NULL,
  label TEXT NOT NULL DEFAULT 'Device',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  expires_at TEXT NOT NULL,
  used INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_auth_pairing_code ON auth_pairing(code_hash);
