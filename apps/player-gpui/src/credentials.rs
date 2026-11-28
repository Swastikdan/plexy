use std::path::Path;

use anyhow::{Context, Result};
use parking_lot::Mutex;
use rusqlite::{Connection, OptionalExtension};
use security_framework::passwords::{get_generic_password, set_generic_password};

const SERVICE: &str = "com.plexy.beta.tmdb";
const ITEM_NOT_FOUND: i32 = -25300;

pub struct Credentials {
    account: String,
    work: Mutex<()>,
    token: Mutex<Option<String>>,
}

impl Credentials {
    pub fn new(profile: &Path) -> Self {
        let profile = profile
            .canonicalize()
            .unwrap_or_else(|_| profile.to_owned());
        Self {
            account: profile
                .as_os_str()
                .as_encoded_bytes()
                .escape_ascii()
                .to_string(),
            work: Mutex::default(),
            token: Mutex::default(),
        }
    }

    pub fn token(&self) -> Option<String> {
        self.token.lock().clone()
    }

    pub fn load(&self, database: &Path) -> Result<()> {
        let _work = self.work.lock();
        let db = Connection::open(database)?;
        let token = match get_generic_password(SERVICE, &self.account) {
            Ok(password) => Some(
                String::from_utf8(password).context("The TMDB token in Keychain is invalid.")?,
            ),
            Err(error) if error.code() == ITEM_NOT_FOUND => None,
            Err(error) => return Err(error).context("Couldn’t read the TMDB token from Keychain."),
        };
        self.migrate(&db, token, |token| self.write(token))
    }

    fn migrate(
        &self,
        db: &Connection,
        mut token: Option<String>,
        write: impl FnOnce(&str) -> Result<()>,
    ) -> Result<()> {
        let legacy: Option<String> = db
            .query_row(
                "SELECT value FROM settings WHERE key = 'tmdb_token'",
                [],
                |row| row.get(0),
            )
            .optional()?;
        if let Some(legacy) = legacy
            .as_deref()
            .map(str::trim)
            .filter(|value| !value.is_empty())
        {
            if token.is_none() {
                write(legacy)?;
                token = Some(legacy.to_owned());
            }
        }
        *self.token.lock() = token;
        if legacy.is_some() || self.token.lock().is_some() {
            remove_legacy_token(db)?;
        }
        Ok(())
    }

    pub fn save(&self, token: &str, database: &Path) -> Result<()> {
        let _work = self.work.lock();
        self.write(token)?;
        *self.token.lock() = Some(token.to_owned());
        let db = Connection::open(database)?;
        remove_legacy_token(&db)
    }

    fn write(&self, token: &str) -> Result<()> {
        set_generic_password(SERVICE, &self.account, token.as_bytes())
            .context("Couldn’t save the TMDB token in Keychain.")
    }
}

fn remove_legacy_token(db: &Connection) -> Result<()> {
    db.pragma_update(None, "secure_delete", true)?;
    db.execute_batch(
        "BEGIN IMMEDIATE;
         INSERT OR IGNORE INTO settings(key, value)
            SELECT 'tmdb_legacy_checkpoint_pending', 'yes'
            FROM settings WHERE key = 'tmdb_token';
         DELETE FROM settings WHERE key = 'tmdb_token';
         COMMIT;",
    )?;
    let pending = db.query_row(
        "SELECT EXISTS (SELECT 1 FROM settings WHERE key = 'tmdb_legacy_checkpoint_pending')",
        [],
        |row| row.get::<_, bool>(0),
    )?;
    if pending {
        let (busy, _, _): (i64, i64, i64) =
            db.query_row("PRAGMA wal_checkpoint(TRUNCATE)", [], |row| {
                Ok((row.get(0)?, row.get(1)?, row.get(2)?))
            })?;
        anyhow::ensure!(busy == 0, "The previous SQLite journal is busy. Close any other Plexy instance to finish clearing it.");
        db.execute(
            "DELETE FROM settings WHERE key = 'tmdb_legacy_checkpoint_pending'",
            [],
        )?;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn legacy_token_is_deleted_only_after_a_successful_keychain_write() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("library.sqlite");
        let db = Connection::open(&path).unwrap();
        db.execute_batch(
            "PRAGMA journal_mode = WAL;
            CREATE TABLE settings(key TEXT PRIMARY KEY, value TEXT NOT NULL);
            INSERT INTO settings VALUES ('tmdb_token', 'legacy-token-for-test');",
        )
        .unwrap();
        let credentials = Credentials::new(dir.path());

        assert!(credentials
            .migrate(&db, None, |_| anyhow::bail!("Keychain unavailable"))
            .is_err());
        assert_eq!(
            db.query_row("SELECT COUNT(*) FROM settings", [], |row| row
                .get::<_, u32>(0))
                .unwrap(),
            1
        );
        assert!(credentials.token().is_none());

        credentials
            .migrate(&db, None, |token| {
                assert_eq!(token, "legacy-token-for-test");
                Ok(())
            })
            .unwrap();
        assert_eq!(
            credentials.token().as_deref(),
            Some("legacy-token-for-test")
        );
        assert_eq!(
            db.query_row("SELECT COUNT(*) FROM settings", [], |row| row
                .get::<_, u32>(0))
                .unwrap(),
            0
        );
        for file in [&path, &path.with_extension("sqlite-wal")] {
            let bytes = std::fs::read(file).unwrap_or_default();
            assert!(!bytes
                .windows(21)
                .any(|bytes| bytes == b"legacy-token-for-test"));
        }
    }
}
