-- Legacy device credentials carry no account identity and cannot become admins.
CREATE TABLE users (
 id INTEGER PRIMARY KEY AUTOINCREMENT,
 username TEXT NOT NULL COLLATE NOCASE UNIQUE,
 password_hash TEXT NOT NULL,
 role TEXT NOT NULL CHECK(role IN ('admin','user')) DEFAULT 'user',
 disabled INTEGER NOT NULL DEFAULT 0,
 max_age INTEGER CHECK(max_age BETWEEN 0 AND 21),
 block_unrated INTEGER NOT NULL DEFAULT 1,
 created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
ALTER TABLE auth_devices ADD COLUMN user_id INTEGER REFERENCES users(id);
ALTER TABLE auth_devices ADD COLUMN expires_at TEXT;
UPDATE auth_devices SET revoked = 1;
ALTER TABLE auth_pairing ADD COLUMN user_id INTEGER REFERENCES users(id);
UPDATE auth_pairing SET used = 1;
CREATE TABLE server_setup (
 id INTEGER PRIMARY KEY CHECK(id=1),
 completed_at TEXT,
 step INTEGER NOT NULL DEFAULT 0
);
INSERT INTO server_setup(id) VALUES(1);
CREATE TABLE access_rules (
 id INTEGER PRIMARY KEY AUTOINCREMENT,
 user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 scope TEXT NOT NULL CHECK(scope IN ('library','folder','item')),
 target TEXT NOT NULL,
 allowed INTEGER NOT NULL CHECK(allowed IN (0,1)),
 UNIQUE(user_id,scope,target)
);
ALTER TABLE watch_state RENAME TO legacy_watch_state;
CREATE TABLE watch_state (
 user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 item_id INTEGER NOT NULL REFERENCES items(id) ON DELETE CASCADE,
 position_seconds REAL NOT NULL DEFAULT 0,
 duration_seconds REAL,
 played INTEGER NOT NULL DEFAULT 0,
 updated_at TEXT NOT NULL DEFAULT (datetime('now')),
 PRIMARY KEY(user_id,item_id)
);
CREATE INDEX watch_state_user_recent ON watch_state(user_id,played,updated_at DESC);
