//! Local library catalog: libraries, folder roots, scanned files and watch
//! state in one SQLite database in the app's data directory.
//!
//! Scanning runs on a background thread and is incremental: unchanged files
//! (same size and mtime) are skipped, new ones are identified from their
//! names, and files that disappear from a *reachable* root are marked missing
//! rather than deleted. An unreachable root (an unplugged drive) leaves its
//! entries and watch state untouched.

use std::collections::{BTreeMap, HashSet};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Arc;
use std::time::{SystemTime, UNIX_EPOCH};

use anyhow::Result;
use parking_lot::Mutex;
use rusqlite::{params, Connection, OptionalExtension};

use crate::media::{self, Kind, Progress};

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum LibraryKind {
    Movies,
    Shows,
}

impl LibraryKind {
    fn as_str(self) -> &'static str {
        match self {
            Self::Movies => "movie",
            Self::Shows => "tv",
        }
    }
    fn parse(value: &str) -> Self {
        if value == "tv" { Self::Shows } else { Self::Movies }
    }
    pub fn label(self) -> &'static str {
        match self {
            Self::Movies => "Movies",
            Self::Shows => "TV Shows",
        }
    }
}

#[derive(Clone, Debug)]
pub struct Library {
    pub id: i64,
    pub name: String,
    pub kind: LibraryKind,
    pub auto_refresh: bool,
    pub roots: Vec<Root>,
    pub item_count: i64,
}

#[derive(Clone, Debug)]
pub struct Root {
    pub id: i64,
    pub path: PathBuf,
    pub available: bool,
}

#[derive(Clone, Debug, Default)]
pub struct Item {
    pub id: i64,
    pub library_id: i64,
    pub path: PathBuf,
    pub title: String,
    pub year: Option<u32>,
    pub season: Option<u32>,
    pub episode: Option<u32>,
    pub episode_title: Option<String>,
    pub poster: Option<PathBuf>,
    pub backdrop: Option<PathBuf>,
    pub added_at: i64,
    pub missing: bool,
    pub progress: Option<Progress>,
}

impl Item {
    pub fn show_key(&self) -> String {
        self.title.to_lowercase()
    }
    pub fn episode_label(&self) -> String {
        match (self.season, self.episode) {
            (Some(s), Some(e)) => match &self.episode_title {
                Some(name) => format!("S{s} E{e} · {name}"),
                None => format!("S{s} E{e}"),
            },
            _ => self.year.map(|y| y.to_string()).unwrap_or_default(),
        }
    }
    pub fn watched(&self) -> bool {
        self.progress.is_some_and(|p| p.watched())
    }
}

/// A series: every episode file with the same identified title.
#[derive(Clone, Debug)]
pub struct Show {
    pub key: String,
    pub title: String,
    pub poster: Option<PathBuf>,
    pub backdrop: Option<PathBuf>,
    pub seasons: BTreeMap<u32, Vec<Item>>,
    pub added_at: i64,
}

impl Show {
    pub fn episodes(&self) -> impl Iterator<Item = &Item> {
        self.seasons.values().flatten()
    }
    pub fn unwatched(&self) -> usize {
        self.episodes().filter(|e| !e.watched()).count()
    }
    /// The episode to play next: in-progress first, else the first unwatched.
    pub fn next_up(&self) -> Option<&Item> {
        self.episodes()
            .find(|e| e.progress.is_some_and(|p| p.resumable()))
            .or_else(|| self.episodes().find(|e| !e.watched()))
    }
}

#[derive(Clone, Debug, Default)]
pub struct ScanStatus {
    pub running: bool,
    pub library: Option<String>,
    pub scanned: usize,
    pub added: usize,
    pub current: Option<String>,
    pub errors: Vec<String>,
    pub finished_at: Option<i64>,
    pub generation: u64,
}

pub fn now() -> i64 {
    SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_secs() as i64).unwrap_or(0)
}

pub fn data_dir() -> PathBuf {
    std::env::var_os("PLEXY_PLAYER_DATA")
        .map(PathBuf::from)
        .or_else(|| std::env::var_os("HOME").map(|h| PathBuf::from(h).join("Library/Application Support/Plexy Player")))
        .unwrap_or_else(|| PathBuf::from("."))
}

fn progress_key(path: &Path) -> String {
    let size = std::fs::metadata(path).map(|m| m.len()).unwrap_or(0);
    format!("{}#{size}", path.display())
}

const POSTER_NAMES: [&str; 6] = ["poster", "folder", "cover", "show", "movie", "default"];
const IMAGE_EXTENSIONS: [&str; 4] = ["jpg", "jpeg", "png", "webp"];

/// Local artwork: `Movie.poster.jpg`, `Movie.jpg`, then `poster.jpg` /
/// `folder.jpg` in the file's folder or the show folder above a season.
const BACKDROP_NAMES: [&str; 4] = ["fanart", "backdrop", "background", "landscape"];

/// Wide artwork: `Movie-fanart.jpg`, then `fanart.jpg` / `backdrop.jpg` in
/// the file's folder or the show folder above a season.
fn find_backdrop(path: &Path) -> Option<PathBuf> {
    let stem = path.file_stem()?.to_string_lossy().into_owned();
    let dir = path.parent()?;
    for ext in IMAGE_EXTENSIONS {
        for name in BACKDROP_NAMES {
            let candidate = dir.join(format!("{stem}-{name}.{ext}"));
            if candidate.is_file() {
                return Some(candidate);
            }
        }
    }
    for folder in [Some(dir), dir.parent()].into_iter().flatten() {
        for name in BACKDROP_NAMES {
            for ext in IMAGE_EXTENSIONS {
                let candidate = folder.join(format!("{name}.{ext}"));
                if candidate.is_file() {
                    return Some(candidate);
                }
            }
        }
    }
    None
}

fn find_poster(path: &Path) -> Option<PathBuf> {
    let stem = path.file_stem()?.to_string_lossy().into_owned();
    let dir = path.parent()?;
    for ext in IMAGE_EXTENSIONS {
        for candidate in [dir.join(format!("{stem}-poster.{ext}")), dir.join(format!("{stem}.poster.{ext}")), dir.join(format!("{stem}.{ext}"))] {
            if candidate.is_file() {
                return Some(candidate);
            }
        }
    }
    for folder in [Some(dir), dir.parent()].into_iter().flatten() {
        for name in POSTER_NAMES {
            for ext in IMAGE_EXTENSIONS {
                let candidate = folder.join(format!("{name}.{ext}"));
                if candidate.is_file() {
                    return Some(candidate);
                }
            }
        }
    }
    None
}

#[derive(Clone)]
pub struct Catalog {
    db: Arc<Mutex<Connection>>,
    pub status: Arc<Mutex<ScanStatus>>,
    pub(crate) metadata_work: Arc<Mutex<()>>,
    /// Bumped when background metadata or marker work changes the database,
    /// so the UI can reload without polling the network.
    metadata_epoch: Arc<AtomicU64>,
}
impl Catalog {
    pub fn open() -> Result<Self> {
        let dir = data_dir();
        std::fs::create_dir_all(&dir)?;
        let db = Connection::open(dir.join("library.sqlite"))?;
        db.execute_batch(
            "PRAGMA journal_mode=WAL;
             PRAGMA foreign_keys=ON;
             CREATE TABLE IF NOT EXISTS libraries (
               id INTEGER PRIMARY KEY, name TEXT NOT NULL, kind TEXT NOT NULL,
               auto_refresh INTEGER NOT NULL DEFAULT 1, created_at INTEGER NOT NULL);
             CREATE TABLE IF NOT EXISTS roots (
               id INTEGER PRIMARY KEY, library_id INTEGER NOT NULL REFERENCES libraries(id) ON DELETE CASCADE,
               path TEXT NOT NULL, UNIQUE(library_id, path));
             CREATE TABLE IF NOT EXISTS items (
               id INTEGER PRIMARY KEY, library_id INTEGER NOT NULL REFERENCES libraries(id) ON DELETE CASCADE,
               root_id INTEGER NOT NULL REFERENCES roots(id) ON DELETE CASCADE,
               path TEXT NOT NULL UNIQUE, size INTEGER NOT NULL, mtime INTEGER NOT NULL,
               title TEXT NOT NULL, year INTEGER, season INTEGER, episode INTEGER, episode_title TEXT,
               poster TEXT, added_at INTEGER NOT NULL, missing INTEGER NOT NULL DEFAULT 0);
             CREATE INDEX IF NOT EXISTS items_library ON items(library_id);
             CREATE INDEX IF NOT EXISTS items_root ON items(root_id);
             CREATE TABLE IF NOT EXISTS progress (
               key TEXT PRIMARY KEY, path TEXT NOT NULL, position REAL NOT NULL, duration REAL NOT NULL,
               updated INTEGER NOT NULL);
             CREATE TABLE IF NOT EXISTS marks (
               title_key TEXT NOT NULL, kind TEXT NOT NULL, created_at INTEGER NOT NULL,
               PRIMARY KEY(title_key, kind));
             CREATE TABLE IF NOT EXISTS ratings (title_key TEXT PRIMARY KEY, rating INTEGER NOT NULL);
             CREATE TABLE IF NOT EXISTS collections (id INTEGER PRIMARY KEY, name TEXT NOT NULL, created_at INTEGER NOT NULL);
             CREATE TABLE IF NOT EXISTS collection_items (
               collection_id INTEGER NOT NULL REFERENCES collections(id) ON DELETE CASCADE,
               title_key TEXT NOT NULL, added_at INTEGER NOT NULL, PRIMARY KEY(collection_id, title_key));
             CREATE TABLE IF NOT EXISTS history (
               id INTEGER PRIMARY KEY, path TEXT NOT NULL, title TEXT NOT NULL, label TEXT NOT NULL,
               watched_at INTEGER NOT NULL);",
        )?;
        // Additive migrations for databases created by earlier builds.
        let _ = db.execute("ALTER TABLE items ADD COLUMN backdrop TEXT", []);
        db.execute_batch("CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);")?;
        db.execute_batch(
            "CREATE TABLE IF NOT EXISTS tmdb_cache (
               key INTEGER PRIMARY KEY, endpoint TEXT NOT NULL, body TEXT NOT NULL, expires_at INTEGER NOT NULL);
             CREATE TABLE IF NOT EXISTS title_metadata (
               title_key TEXT PRIMARY KEY, tmdb_id INTEGER NOT NULL, kind TEXT NOT NULL, name TEXT NOT NULL,
               overview TEXT, year INTEGER, rating REAL, runtime INTEGER, certification TEXT,
               genres TEXT NOT NULL DEFAULT '[]', cast_json TEXT NOT NULL DEFAULT '[]',
               poster_file TEXT, backdrop_file TEXT, logo_file TEXT, imdb_id TEXT,
               manual INTEGER NOT NULL DEFAULT 0, matched INTEGER NOT NULL DEFAULT 1, fetched_at INTEGER NOT NULL);
             CREATE TABLE IF NOT EXISTS episode_metadata (
               path TEXT PRIMARY KEY, still_file TEXT, name TEXT, overview TEXT);
             CREATE TABLE IF NOT EXISTS manual_matches (
               title_key TEXT PRIMARY KEY, kind TEXT NOT NULL, tmdb_id INTEGER NOT NULL, created_at INTEGER NOT NULL);
             CREATE TABLE IF NOT EXISTS match_status (
               title_key TEXT PRIMARY KEY, status TEXT NOT NULL, attempted_at INTEGER NOT NULL);
             CREATE TABLE IF NOT EXISTS skip_segments (
               path TEXT NOT NULL, kind TEXT NOT NULL, start_seconds REAL NOT NULL, end_seconds REAL NOT NULL,
               confidence REAL, submission_count INTEGER, source TEXT NOT NULL, updated_at INTEGER NOT NULL,
               PRIMARY KEY(path, kind));
             CREATE TABLE IF NOT EXISTS local_skip_segments (
               path TEXT NOT NULL, kind TEXT NOT NULL, start_seconds REAL NOT NULL, end_seconds REAL NOT NULL,
               PRIMARY KEY(path, kind));
             CREATE TABLE IF NOT EXISTS skip_lookups (
               path TEXT PRIMARY KEY, status TEXT NOT NULL, imdb_id TEXT, expires_at INTEGER NOT NULL);",
        )?;
        let catalog = Self { db: Arc::new(Mutex::new(db)), status: Arc::new(Mutex::new(ScanStatus::default())), metadata_work: Default::default(), metadata_epoch: Arc::new(AtomicU64::new(0)) };
        catalog.import_legacy_progress(&dir);
        Ok(catalog)
    }

    /// Keeps resume points recorded by the earlier per-file progress store.
    fn import_legacy_progress(&self, dir: &Path) {
        let legacy = dir.join("progress.tsv");
        let Ok(text) = std::fs::read_to_string(&legacy) else { return };
        let db = self.db.lock();
        for line in text.lines() {
            let parts: Vec<&str> = line.splitn(4, '\t').collect();
            if let [pos, dur, upd, key] = parts[..] {
                let path = key.rsplit_once('#').map(|(p, _)| p).unwrap_or(key);
                let _ = db.execute(
                    "INSERT OR IGNORE INTO progress(key, path, position, duration, updated) VALUES (?1, ?2, ?3, ?4, ?5)",
                    params![key, path, pos.parse::<f64>().unwrap_or(0.0), dur.parse::<f64>().unwrap_or(0.0), upd.parse::<i64>().unwrap_or(0)],
                );
            }
        }
        let _ = std::fs::rename(&legacy, legacy.with_extension("tsv.imported"));
    }

    // MARK: Watch state

    pub fn progress(&self, path: &Path) -> Option<Progress> {
        self.db
            .lock()
            .query_row(
                "SELECT position, duration, updated FROM progress WHERE key = ?1",
                params![progress_key(path)],
                |row| Ok(Progress { position: row.get(0)?, duration: row.get(1)?, updated: row.get::<_, i64>(2)? as u64 }),
            )
            .optional()
            .ok()
            .flatten()
    }

    pub fn record_progress(&self, path: &Path, position: f64, duration: f64) {
        if !(duration > 0.0 && position.is_finite()) {
            return;
        }
        let was_watched = self.progress(path).is_some_and(|p| p.watched());
        let now_watched = Progress { position, duration, updated: 0 }.watched();
        if now_watched && !was_watched {
            self.add_history(path);
        }
        let _ = self.db.lock().execute(
            "INSERT INTO progress(key, path, position, duration, updated) VALUES (?1, ?2, ?3, ?4, ?5)
             ON CONFLICT(key) DO UPDATE SET position = excluded.position, duration = excluded.duration, updated = excluded.updated",
            params![progress_key(path), path.display().to_string(), position, duration, now()],
        );
    }

    pub fn set_watched(&self, path: &Path, watched: bool) {
        let duration = self.progress(path).map(|p| p.duration).filter(|d| *d > 0.0).unwrap_or(1.0);
        if watched {
            self.record_progress(path, duration, duration);
        } else {
            let _ = self.db.lock().execute("DELETE FROM progress WHERE key = ?1", params![progress_key(path)]);
        }
    }

    // MARK: Libraries

    pub fn libraries(&self) -> Vec<Library> {
        let db = self.db.lock();
        let mut libraries: Vec<Library> = db
            .prepare("SELECT id, name, kind, auto_refresh, (SELECT COUNT(*) FROM items WHERE library_id = libraries.id AND missing = 0) FROM libraries ORDER BY id")
            .and_then(|mut stmt| {
                stmt.query_map([], |row| {
                    Ok(Library {
                        id: row.get(0)?,
                        name: row.get(1)?,
                        kind: LibraryKind::parse(&row.get::<_, String>(2)?),
                        auto_refresh: row.get::<_, i64>(3)? != 0,
                        roots: Vec::new(),
                        item_count: row.get(4)?,
                    })
                })?
                .collect()
            })
            .unwrap_or_default();
        for library in &mut libraries {
            library.roots = db
                .prepare("SELECT id, path FROM roots WHERE library_id = ?1 ORDER BY path")
                .and_then(|mut stmt| {
                    stmt.query_map(params![library.id], |row| {
                        let path = PathBuf::from(row.get::<_, String>(1)?);
                        Ok(Root { id: row.get(0)?, available: path.is_dir(), path })
                    })?
                    .collect()
                })
                .unwrap_or_default();
        }
        libraries
    }

    pub fn add_library(&self, kind: LibraryKind, folder: &Path) -> Result<i64> {
        self.add_library_with_folders(kind, &[folder])
    }

    pub fn add_library_with_folders(&self, kind: LibraryKind, folders: &[impl AsRef<Path>]) -> Result<i64> {
        let first = folders.first().ok_or_else(|| anyhow::anyhow!("Choose at least one folder"))?.as_ref();
        let name = first.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_else(|| kind.label().into());
        let mut db = self.db.lock();
        let transaction = db.transaction()?;
        transaction.execute("INSERT INTO libraries(name, kind, auto_refresh, created_at) VALUES (?1, ?2, 1, ?3)", params![name, kind.as_str(), now()])?;
        let id = transaction.last_insert_rowid();
        for folder in folders {
            transaction.execute(
                "INSERT OR IGNORE INTO roots(library_id, path) VALUES (?1, ?2)",
                params![id, folder.as_ref().display().to_string()],
            )?;
        }
        transaction.commit()?;
        Ok(id)
    }

    pub fn add_root(&self, library_id: i64, folder: &Path) -> Result<()> {
        self.db.lock().execute(
            "INSERT OR IGNORE INTO roots(library_id, path) VALUES (?1, ?2)",
            params![library_id, folder.display().to_string()],
        )?;
        Ok(())
    }

    /// Removes the folder from the library (and its catalog entries). Files
    /// on disk and watch progress are untouched.
    pub fn remove_root(&self, root_id: i64) {
        let _ = self.db.lock().execute("DELETE FROM roots WHERE id = ?1", params![root_id]);
    }

    pub fn remove_library(&self, library_id: i64) {
        let _ = self.db.lock().execute("DELETE FROM libraries WHERE id = ?1", params![library_id]);
    }

    pub fn set_auto_refresh(&self, library_id: i64, enabled: bool) {
        let _ = self.db.lock().execute("UPDATE libraries SET auto_refresh = ?2 WHERE id = ?1", params![library_id, enabled as i64]);
    }

    // MARK: Items

    pub fn items(&self) -> Vec<Item> {
        let db = self.db.lock();
        db.prepare(
            "SELECT i.id, i.library_id, i.path, i.title, i.year, i.season, i.episode, i.episode_title, i.poster, i.added_at, i.missing,
                    p.position, p.duration, p.updated, i.backdrop
             FROM items i LEFT JOIN progress p ON p.key = i.path || '#' || i.size
             ORDER BY i.title COLLATE NOCASE, i.season, i.episode, i.path",
        )
        .and_then(|mut stmt| {
            stmt.query_map([], |row| {
                let position: Option<f64> = row.get(11)?;
                Ok(Item {
                    id: row.get(0)?,
                    library_id: row.get(1)?,
                    path: PathBuf::from(row.get::<_, String>(2)?),
                    title: row.get(3)?,
                    year: row.get(4)?,
                    season: row.get(5)?,
                    episode: row.get(6)?,
                    episode_title: row.get(7)?,
                    poster: row.get::<_, Option<String>>(8)?.map(PathBuf::from),
                    backdrop: row.get::<_, Option<String>>(14)?.map(PathBuf::from),
                    added_at: row.get(9)?,
                    missing: row.get::<_, i64>(10)? != 0,
                    progress: position.map(|position| Progress {
                        position,
                        duration: row.get::<_, f64>(12).unwrap_or(0.0),
                        updated: row.get::<_, i64>(13).unwrap_or(0) as u64,
                    }),
                })
            })?
            .collect()
        })
        .unwrap_or_default()
    }

    // MARK: Scanning

    /// Scans every library (or one) on a background thread.
    /// `automatic` limits the scan to libraries with auto-refresh enabled.
    pub fn scan(&self, only: Option<i64>, automatic: bool) {
        {
            let mut status = self.status.lock();
            if status.running {
                return;
            }
            *status = ScanStatus { running: true, generation: status.generation, ..ScanStatus::default() };
        }
        let catalog = self.clone();
        let worker = std::thread::Builder::new()
            .name("plexy-scan".into())
            .spawn(move || {
                for library in catalog.libraries().into_iter().filter(|l| only.is_none_or(|id| id == l.id) && (!automatic || l.auto_refresh)) {
                    catalog.status.lock().library = Some(library.name.clone());
                    for root in &library.roots {
                        if let Err(error) = catalog.scan_root(&library, root) {
                            catalog.status.lock().errors.push(format!("{}: {error}", root.path.display()));
                        }
                    }
                }
                let mut status = catalog.status.lock();
                status.running = false;
                status.current = None;
                status.finished_at = Some(now());
                status.generation += 1;
            });
        if let Err(error) = worker {
            let mut status = self.status.lock();
            status.running = false;
            status.finished_at = Some(now());
            status.errors.push(error.to_string());
            status.generation += 1;
        }
    }

    fn scan_root(&self, library: &Library, root: &Root) -> Result<()> {
        if !root.path.is_dir() {
            anyhow::bail!("folder is not available; existing entries are kept");
        }
        let mut files = Vec::new();
        let mut stack = vec![root.path.clone()];
        while let Some(dir) = stack.pop() {
            for entry in std::fs::read_dir(&dir)? {
                let entry = entry?;
                let name = entry.file_name();
                let name = name.to_string_lossy();
                if name.starts_with('.') {
                    continue;
                }
                let kind = entry.file_type()?;
                let path = entry.path();
                if kind.is_dir() {
                    // Nested directory symlinks can lead outside the root or back into it.
                    if !matches!(name.to_lowercase().as_str(), "extras" | "featurettes" | "behind the scenes" | "sample" | "samples" | "trailers") {
                        stack.push(path);
                    }
                } else if (kind.is_file() || (kind.is_symlink() && path.is_file()))
                    && media::is_video(&path)
                    && !name.to_lowercase().contains("sample")
                {
                    files.push(path);
                }
            }
        }

        let known: std::collections::HashMap<String, (i64, i64)> = {
            let db = self.db.lock();
            let mut stmt = db.prepare("SELECT path, size, mtime FROM items WHERE root_id = ?1")?;
            let rows = stmt.query_map(params![root.id], |row| Ok((row.get::<_, String>(0)?, (row.get(1)?, row.get(2)?))))?;
            rows.filter_map(|r| r.ok()).collect()
        };
        let mut seen = HashSet::new();
        for path in files {
            let key = path.display().to_string();
            seen.insert(key.clone());
            {
                let mut status = self.status.lock();
                status.scanned += 1;
                status.current = path.file_name().map(|n| n.to_string_lossy().into_owned());
            }
            let Ok(meta) = std::fs::metadata(&path) else { continue };
            let size = meta.len() as i64;
            let mtime = meta.modified().ok().and_then(|t| t.duration_since(UNIX_EPOCH).ok()).map(|d| d.as_secs() as i64).unwrap_or(0);
            if known.get(&key) == Some(&(size, mtime)) {
                // Artwork can be added later without touching the video.
                let poster = find_poster(&path).map(|p| p.display().to_string());
                let backdrop = find_backdrop(&path).map(|p| p.display().to_string());
                self.db.lock().prepare_cached(
                    "UPDATE items SET missing = 0, poster = ?2, backdrop = ?3
                     WHERE path = ?1 AND (missing != 0 OR poster IS NOT ?2 OR backdrop IS NOT ?3)",
                )?.execute(params![key, poster, backdrop])?;
                continue;
            }
            let identity = media::identify(&path);
            let (year, season, episode, episode_title) = match identity.kind {
                Kind::Episode { season, episode, episode_title } => (None, Some(season), Some(episode), episode_title),
                Kind::Movie { year } => (year, None, None, None),
                Kind::Unknown => (None, None, None, None),
            };
            // In a TV library an unnumbered file stays playable as an extra
            // of its show; in a movie library numbering is ignored.
            let (season, episode) = if library.kind == LibraryKind::Movies { (None, None) } else { (season, episode) };
            let poster = find_poster(&path).map(|p| p.display().to_string());
            let backdrop = find_backdrop(&path).map(|p| p.display().to_string());
            let is_new = !known.contains_key(&key);
            self.db.lock().execute(
                "INSERT INTO items(library_id, root_id, path, size, mtime, title, year, season, episode, episode_title, poster, added_at, missing, backdrop)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, 0, ?13)
                 ON CONFLICT(path) DO UPDATE SET size = excluded.size, mtime = excluded.mtime, title = excluded.title, year = excluded.year,
                   season = excluded.season, episode = excluded.episode, episode_title = excluded.episode_title,
                   poster = excluded.poster, backdrop = excluded.backdrop, missing = 0",
                params![library.id, root.id, key, size, mtime, identity.title, year, season, episode, episode_title, poster, now(), backdrop],
            )?;
            if is_new {
                self.status.lock().added += 1;
            }
        }
        // Gone from a reachable root: keep the row (and its progress) but hide it.
        let db = self.db.lock();
        let mut mark_missing = db.prepare_cached("UPDATE items SET missing = 1 WHERE path = ?1 AND missing = 0")?;
        for path in known.keys().filter(|p| !seen.contains(*p)) {
            mark_missing.execute(params![path])?;
        }
        Ok(())
    }
}

/// What a personal mark applies to: a movie file or a whole show.
#[derive(Clone, Debug, PartialEq, Eq, Hash)]
pub enum TitleKey {
    Movie(PathBuf),
    Show(String),
}

/// One credited person: cast member or key crew.
#[derive(Clone, Debug, PartialEq)]
pub struct CastMember {
    pub name: String,
    pub role: String,
    pub photo: Option<PathBuf>,
}

/// Stored TMDB details for a movie or a whole show.
#[derive(Clone, Debug, PartialEq)]
pub struct TitleMeta {
    pub tmdb_id: i64,
    /// `"movie"` or `"tv"`.
    pub kind: String,
    pub name: String,
    pub overview: Option<String>,
    pub year: Option<u32>,
    /// Community rating out of 10.
    pub rating: Option<f64>,
    /// Minutes.
    pub runtime: Option<u32>,
    /// Age rating such as `TV-MA` or `R`.
    pub certification: Option<String>,
    pub genres: Vec<String>,
    pub cast: Vec<CastMember>,
    pub poster: Option<PathBuf>,
    pub backdrop: Option<PathBuf>,
    pub logo: Option<PathBuf>,
    pub imdb_id: Option<String>,
    /// Set by the manual-match flow and never second-guessed by search.
    pub manual: bool,
    pub matched: bool,
}

/// TMDB episode details for one local file.
#[derive(Clone, Debug, Default, PartialEq)]
pub struct EpisodeMeta {
    pub still: Option<PathBuf>,
    pub name: Option<String>,
    pub overview: Option<String>,
}

/// A title queued for the metadata pass.
#[derive(Clone, Debug)]
pub struct EnrichTarget {
    pub key: TitleKey,
    pub title: String,
    pub year: Option<u32>,
    pub is_show: bool,
}

/// Which community marker a window describes.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum SegmentKind {
    Intro,
    Recap,
    Outro,
}

impl SegmentKind {
    pub const ALL: [Self; 3] = [Self::Intro, Self::Recap, Self::Outro];

    pub fn label(self) -> &'static str {
        match self {
            Self::Intro => "intro",
            Self::Recap => "recap",
            Self::Outro => "credits",
        }
    }

    pub fn skip_label(self) -> &'static str {
        match self {
            Self::Intro => "Skip intro",
            Self::Recap => "Skip recap",
            Self::Outro => "Skip credits",
        }
    }
}

/// One skip window in seconds.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct SegmentWindow {
    pub start: f64,
    pub end: f64,
    pub confidence: Option<f64>,
    pub submission_count: Option<i64>,
}

/// Community skip markers for one file. `Default` is "checked, nothing found".
#[derive(Clone, Copy, Debug, Default, PartialEq)]
pub struct SkipSegments {
    pub intro: Option<SegmentWindow>,
    pub recap: Option<SegmentWindow>,
    pub outro: Option<SegmentWindow>,
}

impl SkipSegments {
    pub fn kind(self, kind: SegmentKind) -> Option<SegmentWindow> {
        match kind {
            SegmentKind::Intro => self.intro,
            SegmentKind::Recap => self.recap,
            SegmentKind::Outro => self.outro,
        }
    }

    pub fn set(&mut self, kind: SegmentKind, window: Option<SegmentWindow>) {
        match kind {
            SegmentKind::Intro => self.intro = window,
            SegmentKind::Recap => self.recap = window,
            SegmentKind::Outro => self.outro = window,
        }
    }

    /// The window the playhead is inside right now, if any.
    pub fn active(self, position: f64) -> Option<(SegmentKind, SegmentWindow)> {
        SegmentKind::ALL
            .into_iter()
            .find_map(|kind| self.kind(kind).filter(|w| position >= w.start && position < w.end).map(|w| (kind, w)))
    }
}

impl TitleKey {
    pub fn encode(&self) -> String {
        match self {
            Self::Movie(path) => format!("m:{}", path.display()),
            Self::Show(key) => format!("s:{key}"),
        }
    }
    pub fn decode(value: &str) -> Option<Self> {
        match value.split_at_checked(2)? {
            ("m:", rest) => Some(Self::Movie(PathBuf::from(rest))),
            ("s:", rest) => Some(Self::Show(rest.to_string())),
            _ => None,
        }
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Mark {
    Watchlist,
    Favorite,
    Hidden,
}

impl Mark {
    fn as_str(self) -> &'static str {
        match self {
            Self::Watchlist => "watchlist",
            Self::Favorite => "favorite",
            Self::Hidden => "hidden",
        }
    }
}

#[derive(Clone, Debug)]
pub struct Collection {
    pub id: i64,
    pub name: String,
    pub titles: Vec<TitleKey>,
}

#[derive(Clone, Debug)]
pub struct HistoryEntry {
    pub id: i64,
    pub path: PathBuf,
    pub title: String,
    pub label: String,
    pub watched_at: i64,
}

/// Personal state loaded in one go for rendering.
#[derive(Clone, Debug, Default)]
pub struct Personal {
    pub marks: HashSet<(String, &'static str)>,
    pub ratings: std::collections::HashMap<String, u8>,
    pub collections: Vec<Collection>,
    pub history: Vec<HistoryEntry>,
}

impl Personal {
    pub fn has(&self, key: &TitleKey, mark: Mark) -> bool {
        self.marks.contains(&(key.encode(), mark.as_str()))
    }
    pub fn rating(&self, key: &TitleKey) -> u8 {
        self.ratings.get(&key.encode()).copied().unwrap_or(0)
    }
    pub fn marked(&self, mark: Mark) -> Vec<TitleKey> {
        self.marks.iter().filter(|(_, m)| *m == mark.as_str()).filter_map(|(k, _)| TitleKey::decode(k)).collect()
    }
}

impl Catalog {
    pub fn setting(&self, key: &str) -> Option<String> {
        self.db.lock().query_row("SELECT value FROM settings WHERE key = ?1", params![key], |r| r.get(0)).optional().ok().flatten()
    }

    pub fn set_setting(&self, key: &str, value: &str) {
        let _ = self.db.lock().execute(
            "INSERT INTO settings(key, value) VALUES (?1, ?2) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
            params![key, value],
        );
    }

    // MARK: Metadata store

    /// Where an artwork download for a TMDB image path should live. TMDB
    /// paths are `/abcd1234….jpg`, so the file name alone is unique.
    pub fn artwork_cache_path(&self, image_path: &str) -> Option<PathBuf> {
        let name = image_path.strip_prefix('/')?;
        if name.is_empty() || !name.bytes().all(|b| b.is_ascii_alphanumeric() || matches!(b, b'.' | b'_' | b'-'))
            || !name.as_bytes()[0].is_ascii_alphanumeric()
        {
            return None;
        }
        Some(data_dir().join("artwork").join(name))
    }

    pub fn clear_tmdb_cache(&self) -> rusqlite::Result<usize> {
        self.db.lock().execute("DELETE FROM tmdb_cache", [])
    }

    pub fn tmdb_token(&self) -> Option<String> {
        crate::metadata::token(self)
    }

    pub fn set_tmdb_token(&self, token: &str) {
        self.set_setting("tmdb_token", token.trim());
        self.bump_metadata_epoch();
    }

    pub fn bump_metadata_epoch(&self) {
        self.metadata_epoch.fetch_add(1, Ordering::Relaxed);
    }

    pub fn metadata_epoch(&self) -> u64 {
        self.metadata_epoch.load(Ordering::Relaxed)
    }

    /// Handle for background workers that share the connection (the TMDB
    /// response cache lives in the same database).
    pub(crate) fn db_handle(&self) -> Arc<Mutex<Connection>> {
        self.db.clone()
    }

    pub fn store_title_meta(&self, key: &TitleKey, meta: &TitleMeta) {
        let cast = serde_json::to_string(
            &meta.cast.iter().map(|c| serde_json::json!({ "name": c.name, "role": c.role, "photo": c.photo.as_ref().map(|p| p.display().to_string()) })).collect::<Vec<_>>(),
        )
        .unwrap_or_default();
        let genres = serde_json::to_string(&meta.genres).unwrap_or_default();
        let _ = self.db.lock().execute(
            "INSERT INTO title_metadata(title_key, tmdb_id, kind, name, overview, year, rating, runtime, certification,
                                        genres, cast_json, poster_file, backdrop_file, logo_file, imdb_id, manual, matched, fetched_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16, ?17, ?18)
             ON CONFLICT(title_key) DO UPDATE SET
               tmdb_id = excluded.tmdb_id, kind = excluded.kind, name = excluded.name, overview = excluded.overview,
               year = excluded.year, rating = excluded.rating, runtime = excluded.runtime, certification = excluded.certification,
               genres = excluded.genres, cast_json = excluded.cast_json, poster_file = excluded.poster_file,
               backdrop_file = excluded.backdrop_file, logo_file = excluded.logo_file, imdb_id = excluded.imdb_id,
               manual = excluded.manual, matched = excluded.matched, fetched_at = excluded.fetched_at",
            params![
                key.encode(),
                meta.tmdb_id,
                meta.kind,
                meta.name,
                meta.overview,
                meta.year.map(|y| y as i64),
                meta.rating,
                meta.runtime.map(|r| r as i64),
                meta.certification,
                genres,
                cast,
                meta.poster.as_ref().map(|p| p.display().to_string()),
                meta.backdrop.as_ref().map(|p| p.display().to_string()),
                meta.logo.as_ref().map(|p| p.display().to_string()),
                meta.imdb_id,
                meta.manual as i64,
                meta.matched as i64,
                now(),
            ],
        );
        self.bump_metadata_epoch();
    }

    const TITLE_META_COLUMNS: &str = "tmdb_id, kind, name, overview, year, rating, runtime, certification, genres, cast_json,
                        poster_file, backdrop_file, logo_file, imdb_id, manual, matched";

    fn read_title_meta(r: &rusqlite::Row<'_>) -> rusqlite::Result<TitleMeta> {
        let cast_json: String = r.get(9)?;
        let cast: Vec<serde_json::Value> = serde_json::from_str(&cast_json).unwrap_or_default();
        Ok(TitleMeta {
            tmdb_id: r.get(0)?,
            kind: r.get(1)?,
            name: r.get(2)?,
            overview: r.get(3)?,
            year: r.get::<_, Option<i64>>(4)?.map(|y| y as u32),
            rating: r.get(5)?,
            runtime: r.get::<_, Option<i64>>(6)?.map(|v| v as u32),
            certification: r.get(7)?,
            genres: serde_json::from_str(&r.get::<_, String>(8).unwrap_or_default()).unwrap_or_default(),
            cast: cast
                .iter()
                .map(|c| CastMember {
                    name: c.get("name").and_then(|v| v.as_str()).unwrap_or_default().to_string(),
                    role: c.get("role").and_then(|v| v.as_str()).unwrap_or_default().to_string(),
                    photo: c.get("photo").and_then(|v| v.as_str()).map(PathBuf::from),
                })
                .collect(),
            poster: r.get::<_, Option<String>>(10)?.map(PathBuf::from),
            backdrop: r.get::<_, Option<String>>(11)?.map(PathBuf::from),
            logo: r.get::<_, Option<String>>(12)?.map(PathBuf::from),
            imdb_id: r.get(13)?,
            manual: r.get::<_, i64>(14)? != 0,
            matched: r.get::<_, i64>(15)? != 0,
        })
    }

    /// Cached metadata for a title, if any.
    pub fn title_meta(&self, key: &TitleKey) -> Option<TitleMeta> {
        let query = format!("SELECT {} FROM title_metadata WHERE title_key = ?1", Self::TITLE_META_COLUMNS);
        self.db.lock().prepare_cached(&query).ok()?
            .query_row(params![key.encode()], Self::read_title_meta)
            .optional().ok().flatten()
    }

    pub fn matched_title_metadata(&self, keys: &HashSet<TitleKey>) -> std::collections::HashMap<TitleKey, TitleMeta> {
        let db = self.db.lock();
        let query = format!("SELECT {}, title_key FROM title_metadata WHERE matched != 0", Self::TITLE_META_COLUMNS);
        let Ok(mut stmt) = db.prepare_cached(&query) else { return Default::default() };
        let Ok(mut rows) = stmt.query([]) else { return Default::default() };
        let mut metas = std::collections::HashMap::new();
        while let Ok(Some(row)) = rows.next() {
            let Some(key) = row.get::<_, String>(16).ok().and_then(|key| TitleKey::decode(&key)) else { continue };
            if keys.contains(&key) {
                if let Ok(meta) = Self::read_title_meta(row) {
                    metas.insert(key, meta);
                }
            }
        }
        metas
    }

    pub fn library_episode_metadata(&self) -> std::collections::HashMap<PathBuf, EpisodeMeta> {
        let db = self.db.lock();
        let Ok(mut stmt) = db.prepare_cached(
            "SELECT e.path, e.still_file, e.name, e.overview
             FROM episode_metadata e JOIN items i ON i.path = e.path
             WHERE i.season IS NOT NULL AND (e.still_file IS NOT NULL OR e.name IS NOT NULL)",
        ) else { return Default::default() };
        let Ok(rows) = stmt.query_map([], |row| {
            Ok((PathBuf::from(row.get::<_, String>(0)?), EpisodeMeta {
                still: row.get::<_, Option<String>>(1)?.map(PathBuf::from),
                name: row.get(2)?,
                overview: row.get(3)?,
            }))
        }) else { return Default::default() };
        rows.flatten().collect()
    }

    pub fn store_episode_meta(&self, path: &Path, still: Option<String>, name: Option<String>, overview: Option<String>) {
        let _ = self.db.lock().execute(
            "INSERT INTO episode_metadata(path, still_file, name, overview) VALUES (?1, ?2, ?3, ?4)
             ON CONFLICT(path) DO UPDATE SET still_file = COALESCE(excluded.still_file, still_file),
               name = COALESCE(excluded.name, name), overview = COALESCE(excluded.overview, overview)",
            params![path.display().to_string(), still, name, overview],
        );
    }

    /// Every local season of a show with its files: (season, [(path, episode)]).
    pub fn title_show_files(&self, key: &TitleKey) -> Vec<(u32, Vec<(PathBuf, Option<u32>)>)> {
        let TitleKey::Show(show) = key else { return Vec::new() };
        let mut seasons: BTreeMap<u32, Vec<(PathBuf, Option<u32>)>> = BTreeMap::new();
        for item in &self.items() {
            if item.missing || item.show_key() != *show || item.season.is_none() {
                continue;
            }
            seasons.entry(item.season.unwrap_or(0)).or_default().push((item.path.clone(), item.episode));
        }
        seasons.into_iter().collect()
    }

    // MARK: Matching

    pub fn manual_match(&self, key: &TitleKey) -> Option<(String, i64)> {
        self.db
            .lock()
            .query_row("SELECT kind, tmdb_id FROM manual_matches WHERE title_key = ?1", params![key.encode()], |r| Ok((r.get(0)?, r.get(1)?)))
            .optional()
            .ok()
            .flatten()
    }

    /// Record a corrected match and drop the derived metadata it replaces.
    pub fn set_manual_match(&self, key: &TitleKey, kind: &str, tmdb_id: i64) {
        let db = self.db.lock();
        let _ = db.execute(
            "INSERT INTO manual_matches(title_key, kind, tmdb_id, created_at) VALUES (?1, ?2, ?3, ?4)
             ON CONFLICT(title_key) DO UPDATE SET kind = excluded.kind, tmdb_id = excluded.tmdb_id, created_at = excluded.created_at",
            params![key.encode(), kind, tmdb_id, now()],
        );
        let _ = db.execute("DELETE FROM title_metadata WHERE title_key = ?1 AND manual = 0", params![key.encode()]);
        let _ = db.execute("DELETE FROM episode_metadata", []);
        drop(db);
        self.bump_metadata_epoch();
    }

    pub fn clear_manual_match(&self, key: &TitleKey) {
        let db = self.db.lock();
        let _ = db.execute("DELETE FROM manual_matches WHERE title_key = ?1", params![key.encode()]);
        let _ = db.execute("DELETE FROM title_metadata WHERE title_key = ?1", params![key.encode()]);
        drop(db);
        self.bump_metadata_epoch();
    }

    /// (status, attempted_at) of the last automatic identity attempt.
    pub fn match_status(&self, key: &TitleKey) -> Option<(String, i64)> {
        self.db
            .lock()
            .query_row("SELECT status, attempted_at FROM match_status WHERE title_key = ?1", params![key.encode()], |r| Ok((r.get(0)?, r.get(1)?)))
            .optional()
            .ok()
            .flatten()
    }

    pub fn record_match_status(&self, key: &TitleKey, status: &str) {
        let _ = self.db.lock().execute(
            "INSERT INTO match_status(title_key, status, attempted_at) VALUES (?1, ?2, ?3)
             ON CONFLICT(title_key) DO UPDATE SET status = excluded.status, attempted_at = excluded.attempted_at",
            params![key.encode(), status, now()],
        );
    }

    /// Whether the title may be attempted again: never-attempted, or the last
    /// attempt is older than `cooldown_ms` (review results cool down too so
    /// ambiguous titles do not hammer the search endpoint).
    pub fn recently_attempted(&self, key: &TitleKey, cooldown_ms: i64) -> bool {
        match self.match_status(key) {
            Some((_, at)) => now() * 1000 - at * 1000 > cooldown_ms,
            None => true,
        }
    }

    /// Titles that want metadata: no stored row, or a stale attempt. Shows
    /// first (their artwork covers every episode card), then movies.
    pub fn metadata_targets(&self, refresh_all: bool) -> Vec<EnrichTarget> {
        let items = self.items();
        let tv = self.tv_library_ids_pub();
        let mut seen: HashSet<String> = HashSet::new();
        let mut targets = Vec::new();
        let mut push = |key: TitleKey, title: String, year: Option<u32>, is_show: bool, targets: &mut Vec<EnrichTarget>| {
            if seen.contains(&key.encode()) {
                return;
            }
            seen.insert(key.encode());
            let needs = match self.title_meta(&key) {
                None => true,
                // Matched before artwork downloads worked: backfill the art.
                Some(meta) => meta.matched && (meta.poster.is_none() || meta.backdrop.is_none() || meta.logo.is_none()),
            };
            if refresh_all || (needs && self.recently_attempted(&key, 30 * 60_000)) {
                targets.push(EnrichTarget { key, title, year, is_show });
            }
        };
        for item in items.iter().filter(|i| !i.missing && tv.contains(&i.library_id) && i.season.is_some()) {
            push(TitleKey::Show(item.show_key()), item.title.clone(), None, true, &mut targets);
        }
        for item in items.iter().filter(|i| !i.missing && !tv.contains(&i.library_id)) {
            push(TitleKey::Movie(item.path.clone()), item.title.clone(), item.year, false, &mut targets);
        }
        targets
    }

    /// (genre, title count) across matched titles, best-attended first.
    pub fn genre_counts(&self) -> Vec<(String, usize)> {
        let db = self.db.lock();
        let mut counts: std::collections::HashMap<String, usize> = std::collections::HashMap::new();
        let Ok(mut stmt) = db.prepare("SELECT genres FROM title_metadata WHERE matched = 1") else { return Vec::new() };
        let Ok(rows) = stmt.query_map([], |r| r.get::<_, String>(0)) else { return Vec::new() };
        for row in rows.flatten() {
            for genre in serde_json::from_str::<Vec<String>>(&row).unwrap_or_default() {
                *counts.entry(genre).or_default() += 1;
            }
        }
        let mut list: Vec<(String, usize)> = counts.into_iter().collect();
        list.sort_by(|a, b| b.1.cmp(&a.1).then(a.0.cmp(&b.0)));
        list
    }

    /// Title keys whose metadata carries a genre matching the query.
    pub fn titles_with_genre(&self, genre: &str) -> Vec<String> {
        let needle = genre.to_lowercase();
        let db = self.db.lock();
        let Ok(mut stmt) = db.prepare("SELECT title_key, genres FROM title_metadata WHERE matched = 1") else { return Vec::new() };
        let Ok(rows) = stmt.query_map([], |r| Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?))) else { return Vec::new() };
        rows.flatten()
            .filter(|(_, genres)| serde_json::from_str::<Vec<String>>(genres).unwrap_or_default().iter().any(|g| g.to_lowercase().contains(&needle)))
            .map(|(key, _)| key)
            .collect()
    }

    /// Title keys whose metadata credits a person matching the query.
    pub fn titles_with_person(&self, person: &str) -> Vec<String> {
        let needle = person.to_lowercase();
        let db = self.db.lock();
        let Ok(mut stmt) = db.prepare("SELECT title_key, cast_json FROM title_metadata WHERE matched = 1") else { return Vec::new() };
        let Ok(rows) = stmt.query_map([], |r| Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?))) else { return Vec::new() };
        rows.flatten()
            .filter(|(_, cast)| {
                serde_json::from_str::<Vec<serde_json::Value>>(cast)
                    .unwrap_or_default()
                    .iter()
                    .any(|c| c.get("name").and_then(|v| v.as_str()).map(|n| n.to_lowercase().contains(&needle)).unwrap_or(false))
            })
            .map(|(key, _)| key)
            .collect()
    }

    // MARK: Skip markers

    pub fn store_segments(&self, path: &Path, imdb: &str, segments: &SkipSegments, source: &str) {
        let db = self.db.lock();
        let _ = db.execute("DELETE FROM skip_segments WHERE path = ?1", params![path.display().to_string()]);
        for (kind, window) in [("intro", &segments.intro), ("recap", &segments.recap), ("outro", &segments.outro)] {
            if let Some(window) = window {
                let _ = db.execute(
                    "INSERT INTO skip_segments(path, kind, start_seconds, end_seconds, confidence, submission_count, source, updated_at)
                     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
                    params![path.display().to_string(), kind, window.start, window.end, window.confidence, window.submission_count, source, now()],
                );
            }
        }
        let found = segments.intro.is_some() || segments.recap.is_some() || segments.outro.is_some();
        drop(db);
        self.record_skip_lookup(path, if found { "found" } else { "none" }, Some(imdb), if found { 30 * 24 * 3600 } else { 7 * 24 * 3600 });
    }

    /// Cached markers clamped against the current file duration.
    pub fn stored_segments(&self, path: &Path, duration: Option<f64>) -> SkipSegments {
        let db = self.db.lock();
        let Ok(mut stmt) = db.prepare("SELECT kind, start_seconds, end_seconds, confidence, submission_count FROM skip_segments WHERE path = ?1") else {
            return SkipSegments::default();
        };
        let Ok(rows) = stmt.query_map(params![path.display().to_string()], |r| {
            Ok((r.get::<_, String>(0)?, r.get::<_, f64>(1)?, r.get::<_, f64>(2)?, r.get::<_, Option<f64>>(3)?, r.get::<_, Option<i64>>(4)?))
        }) else {
            return SkipSegments::default();
        };
        let mut segments = SkipSegments::default();
        for (kind, start, end, confidence, submission_count) in rows.flatten() {
            let (kind, clamp_duration) = match kind.as_str() {
                "intro" => (SegmentKind::Intro, duration),
                "recap" => (SegmentKind::Recap, duration),
                "outro" => (SegmentKind::Outro, duration),
                _ => continue,
            };
            let window = crate::metadata::clamp_window(start, end, clamp_duration, kind, confidence, submission_count);
            match kind {
                SegmentKind::Intro => segments.intro = window,
                SegmentKind::Recap => segments.recap = window,
                SegmentKind::Outro => segments.outro = window,
            }
        }
        segments
    }

    pub fn manual_segments(&self, path: &Path) -> SkipSegments {
        let db = self.db.lock();
        let mut segments = SkipSegments::default();
        for kind in SegmentKind::ALL {
            let window = db.query_row(
                "SELECT start_seconds, end_seconds FROM local_skip_segments WHERE path = ?1 AND kind = ?2",
                params![path.display().to_string(), kind.label()],
                |row| Ok(SegmentWindow { start: row.get(0)?, end: row.get(1)?, confidence: None, submission_count: None }),
            ).ok();
            segments.set(kind, window);
        }
        segments
    }

    pub fn save_manual_segment(&self, path: &Path, kind: SegmentKind, window: Option<SegmentWindow>) -> rusqlite::Result<()> {
        let path = path.display().to_string();
        let db = self.db.lock();
        if let Some(window) = window {
            db.execute(
                "INSERT INTO local_skip_segments(path, kind, start_seconds, end_seconds) VALUES (?1, ?2, ?3, ?4)
                 ON CONFLICT(path, kind) DO UPDATE SET start_seconds = excluded.start_seconds, end_seconds = excluded.end_seconds",
                params![path, kind.label(), window.start, window.end],
            )?;
        } else {
            db.execute("DELETE FROM local_skip_segments WHERE path = ?1 AND kind = ?2", params![path, kind.label()])?;
        }
        Ok(())
    }

    pub fn skip_lookup(&self, path: &Path) -> Option<(String, i64)> {
        self.db
            .lock()
            .query_row("SELECT status, expires_at FROM skip_lookups WHERE path = ?1", params![path.display().to_string()], |r| Ok((r.get(0)?, r.get(1)?)))
            .optional()
            .ok()
            .flatten()
    }

    pub fn record_skip_lookup(&self, path: &Path, status: &str, imdb: Option<&str>, ttl_seconds: i64) {
        let _ = self.db.lock().execute(
            "INSERT INTO skip_lookups(path, status, imdb_id, expires_at) VALUES (?1, ?2, ?3, ?4)
             ON CONFLICT(path) DO UPDATE SET status = excluded.status, imdb_id = excluded.imdb_id, expires_at = excluded.expires_at",
            params![path.display().to_string(), status, imdb, now() + ttl_seconds],
        );
    }

    /// Playable files with a matched IMDb id but no fresh marker lookup:
    /// (path, imdb, season, episode, is_movie).
    pub fn paths_missing_markers(&self) -> Vec<(PathBuf, String, Option<u32>, Option<u32>, bool)> {
        let mut out = Vec::new();
        let tv = self.tv_library_ids_pub();
        for item in self.items().into_iter().filter(|i| !i.missing) {
            let is_show = tv.contains(&item.library_id);
            let key = if is_show && item.season.is_some() {
                TitleKey::Show(item.show_key())
            } else if !is_show {
                TitleKey::Movie(item.path.clone())
            } else {
                continue;
            };
            let Some(meta) = self.title_meta(&key) else { continue };
            let Some(imdb) = meta.imdb_id.clone() else { continue };
            let fresh = self.skip_lookup(&item.path).is_some_and(|(_, expires)| expires > now());
            if !fresh {
                out.push((item.path.clone(), imdb, item.season, item.episode, !is_show));
            }
        }
        out
    }

    fn tv_library_ids_pub(&self) -> HashSet<i64> {
        self.db
            .lock()
            .prepare("SELECT id FROM libraries WHERE kind = 'tv'")
            .and_then(|mut stmt| stmt.query_map([], |r| r.get::<_, i64>(0)).map(|rows| rows.flatten().collect()))
            .unwrap_or_default()
    }

    pub fn toggle_mark(&self, key: &TitleKey, mark: Mark) {
        let db = self.db.lock();
        let removed = db
            .execute("DELETE FROM marks WHERE title_key = ?1 AND kind = ?2", params![key.encode(), mark.as_str()])
            .unwrap_or(0);
        if removed == 0 {
            let _ = db.execute("INSERT INTO marks(title_key, kind, created_at) VALUES (?1, ?2, ?3)", params![key.encode(), mark.as_str(), now()]);
        }
    }

    /// 1–5 stars; setting the current rating again clears it.
    pub fn set_rating(&self, key: &TitleKey, rating: u8) {
        let db = self.db.lock();
        let current: Option<i64> = db
            .query_row("SELECT rating FROM ratings WHERE title_key = ?1", params![key.encode()], |r| r.get(0))
            .optional()
            .ok()
            .flatten();
        if current == Some(rating as i64) || rating == 0 {
            let _ = db.execute("DELETE FROM ratings WHERE title_key = ?1", params![key.encode()]);
        } else {
            let _ = db.execute(
                "INSERT INTO ratings(title_key, rating) VALUES (?1, ?2) ON CONFLICT(title_key) DO UPDATE SET rating = excluded.rating",
                params![key.encode(), rating as i64],
            );
        }
    }

    pub fn create_collection(&self, name: &str) -> Option<i64> {
        let name = name.trim();
        if name.is_empty() {
            return None;
        }
        let db = self.db.lock();
        db.execute("INSERT INTO collections(name, created_at) VALUES (?1, ?2)", params![name, now()]).ok()?;
        Some(db.last_insert_rowid())
    }

    pub fn delete_collection(&self, id: i64) {
        let _ = self.db.lock().execute("DELETE FROM collections WHERE id = ?1", params![id]);
    }

    pub fn toggle_in_collection(&self, id: i64, key: &TitleKey) {
        let db = self.db.lock();
        let removed = db
            .execute("DELETE FROM collection_items WHERE collection_id = ?1 AND title_key = ?2", params![id, key.encode()])
            .unwrap_or(0);
        if removed == 0 {
            let _ = db.execute(
                "INSERT INTO collection_items(collection_id, title_key, added_at) VALUES (?1, ?2, ?3)",
                params![id, key.encode(), now()],
            );
        }
    }

    fn add_history(&self, path: &Path) {
        let identity = media::identify(path);
        let label = identity.subtitle().unwrap_or_default();
        let _ = self.db.lock().execute(
            "INSERT INTO history(path, title, label, watched_at) VALUES (?1, ?2, ?3, ?4)",
            params![path.display().to_string(), identity.title, label, now()],
        );
    }

    pub fn remove_history(&self, id: i64) {
        let _ = self.db.lock().execute("DELETE FROM history WHERE id = ?1", params![id]);
    }

    pub fn personal(&self) -> Personal {
        let db = self.db.lock();
        let mut personal = Personal::default();
        if let Ok(mut stmt) = db.prepare("SELECT title_key, kind FROM marks") {
            if let Ok(rows) = stmt.query_map([], |r| Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?))) {
                for (key, kind) in rows.flatten() {
                    let kind = match kind.as_str() {
                        "watchlist" => "watchlist",
                        "favorite" => "favorite",
                        _ => "hidden",
                    };
                    personal.marks.insert((key, kind));
                }
            }
        }
        if let Ok(mut stmt) = db.prepare("SELECT title_key, rating FROM ratings") {
            if let Ok(rows) = stmt.query_map([], |r| Ok((r.get::<_, String>(0)?, r.get::<_, i64>(1)?))) {
                personal.ratings = rows.flatten().map(|(k, v)| (k, v as u8)).collect();
            }
        }
        if let Ok(mut stmt) = db.prepare("SELECT id, name FROM collections ORDER BY name COLLATE NOCASE") {
            if let Ok(rows) = stmt.query_map([], |r| Ok((r.get::<_, i64>(0)?, r.get::<_, String>(1)?))) {
                personal.collections = rows.flatten().map(|(id, name)| Collection { id, name, titles: Vec::new() }).collect();
            }
        }
        for collection in &mut personal.collections {
            if let Ok(mut stmt) = db.prepare("SELECT title_key FROM collection_items WHERE collection_id = ?1 ORDER BY added_at") {
                if let Ok(rows) = stmt.query_map(params![collection.id], |r| r.get::<_, String>(0)) {
                    collection.titles = rows.flatten().filter_map(|k| TitleKey::decode(&k)).collect();
                }
            }
        }
        if let Ok(mut stmt) = db.prepare("SELECT id, path, title, label, watched_at FROM history ORDER BY watched_at DESC, id DESC LIMIT 500") {
            if let Ok(rows) = stmt.query_map([], |r| {
                Ok(HistoryEntry {
                    id: r.get(0)?,
                    path: PathBuf::from(r.get::<_, String>(1)?),
                    title: r.get(2)?,
                    label: r.get(3)?,
                    watched_at: r.get(4)?,
                })
            }) {
                personal.history = rows.flatten().collect();
            }
        }
        personal
    }
}

/// Groups TV library items into shows.
pub fn shows(items: &[Item], tv_libraries: &HashSet<i64>) -> Vec<Show> {
    let mut map: BTreeMap<String, Show> = BTreeMap::new();
    for item in items.iter().filter(|i| tv_libraries.contains(&i.library_id) && !i.missing) {
        let show = map.entry(item.show_key()).or_insert_with(|| Show {
            key: item.show_key(),
            title: item.title.clone(),
            poster: None,
            backdrop: None,
            seasons: BTreeMap::new(),
            added_at: 0,
        });
        if show.poster.is_none() {
            show.poster = item.poster.clone();
        }
        if show.backdrop.is_none() {
            show.backdrop = item.backdrop.clone();
        }
        show.added_at = show.added_at.max(item.added_at);
        show.seasons.entry(item.season.unwrap_or(0)).or_default().push(item.clone());
    }
    map.into_values().collect()
}

#[cfg(test)]
pub(crate) mod test_support {
    use std::sync::{Mutex, MutexGuard};

    /// Catalogs read `PLEXY_PLAYER_DATA`, which is process-global, so tests
    /// that set it run one at a time.
    static LOCK: Mutex<()> = Mutex::new(());

    pub fn lock() -> MutexGuard<'static, ()> {
        LOCK.lock().unwrap_or_else(|e| e.into_inner())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn scans_groups_and_keeps_state_when_root_disappears() {
        let _guard = crate::catalog::test_support::lock();
        let base = std::env::temp_dir().join(format!("plexy-catalog-{}", std::process::id()));
        let tv = base.join("TV/Test Show/Season 1");
        std::fs::create_dir_all(&tv).unwrap();
        std::fs::create_dir_all(base.join("data")).unwrap();
        std::os::unix::fs::symlink(base.join("TV"), tv.join("directory-loop")).unwrap();
        for name in ["Test.Show.S01E01.Pilot.mkv", "Test.Show.S01E02.Second.mkv", "Test.Show.S01E01.Pilot.sample.mkv"] {
            std::fs::write(tv.join(name), name).unwrap();
        }
        std::env::set_var("PLEXY_PLAYER_DATA", base.join("data"));
        let catalog = Catalog::open().unwrap();
        let roots = [base.join("TV"), base.join("TV Archive")];
        std::fs::create_dir_all(&roots[1]).unwrap();
        let id = catalog.add_library_with_folders(LibraryKind::Shows, &roots).unwrap();
        let libraries = catalog.libraries();
        assert_eq!(libraries.len(), 1);
        assert_eq!(libraries[0].roots.iter().map(|root| root.path.clone()).collect::<Vec<_>>(), roots);
        catalog.scan(None, false);
        while catalog.status.lock().running {
            std::thread::sleep(std::time::Duration::from_millis(20));
        }
        let items = catalog.items();
        assert_eq!(items.len(), 2, "sample files are skipped");
        let shows = shows(&items, &[id].into_iter().collect());
        assert_eq!(shows.len(), 1);
        assert_eq!(shows[0].title, "Test Show");
        assert_eq!(shows[0].next_up().unwrap().episode, Some(1));

        catalog.set_watched(&tv.join("Test.Show.S01E01.Pilot.mkv"), true);
        let shows = super::shows(&catalog.items(), &[id].into_iter().collect());
        assert_eq!(shows[0].next_up().unwrap().episode, Some(2));

        // Unplug the root: a rescan keeps entries and watch state.
        std::fs::rename(base.join("TV"), base.join("TV-away")).unwrap();
        catalog.scan(None, false);
        while catalog.status.lock().running {
            std::thread::sleep(std::time::Duration::from_millis(20));
        }
        assert_eq!(catalog.items().iter().filter(|i| !i.missing).count(), 2);
        assert!(!catalog.status.lock().errors.is_empty());
        std::fs::rename(base.join("TV-away"), base.join("TV")).unwrap();
        catalog.scan(None, false);
        while catalog.status.lock().running {
            std::thread::sleep(std::time::Duration::from_millis(20));
        }
        assert_eq!(catalog.items().len(), 2, "no duplicates after reconnect");
        assert!(catalog.items().iter().any(|i| i.watched()));

        // Personal state: marks toggle, ratings clear on repeat, collections,
        // and history from finishing an episode.
        let show = TitleKey::Show("test show".into());
        catalog.toggle_mark(&show, Mark::Watchlist);
        catalog.toggle_mark(&show, Mark::Favorite);
        catalog.toggle_mark(&show, Mark::Favorite);
        catalog.set_rating(&show, 4);
        let collection = catalog.create_collection("Weekend").unwrap();
        catalog.toggle_in_collection(collection, &show);
        let personal = catalog.personal();
        assert!(personal.has(&show, Mark::Watchlist));
        assert!(!personal.has(&show, Mark::Favorite));
        assert_eq!(personal.rating(&show), 4);
        assert_eq!(personal.collections[0].titles, vec![show.clone()]);
        assert_eq!(personal.history.len(), 1, "marking watched records history");
        assert_eq!(personal.history[0].label, "S1 E1 Pilot");
        catalog.remove_history(personal.history[0].id);
        catalog.set_rating(&show, 4);
        let personal = catalog.personal();
        assert!(personal.history.is_empty());
        assert_eq!(personal.rating(&show), 0);
        std::fs::remove_dir_all(base).unwrap();
    }
}
