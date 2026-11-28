//! First-launch imports for the two stable Mac apps.
//!
//! Plexy imports the Electron/server library and the owner's watch state into
//! its native catalog while leaving the server store in place for hosting.
//! Plexy Local copies the Plexy Beta catalog into its own data directory.

use std::collections::HashMap;
use std::path::PathBuf;

use anyhow::{Context as _, Result};
use rusqlite::{Connection, OpenFlags, OptionalExtension};

use crate::catalog::{Catalog, LibraryKind, Mark, TitleKey};
use crate::variant::{self, AppVariant};

#[derive(Clone, Debug)]
struct SourceItem {
    kind: String,
    name: String,
    parent_id: Option<i64>,
    path: Option<PathBuf>,
}

pub fn run(catalog: &Catalog) -> Result<Option<String>> {
    let variant = variant::current();
    let outcome = match variant {
        AppVariant::Plexy => migrate_electron(catalog),
        AppVariant::Local => migrate_beta(catalog),
        AppVariant::Beta => Ok(None),
    };
    if let Ok(Some(message)) = &outcome {
        catalog.set_setting("last_migration", message);
    }
    outcome
}

fn app_support(name: &str) -> Option<PathBuf> {
    std::env::var_os("HOME").map(|home| {
        PathBuf::from(home)
            .join("Library")
            .join("Application Support")
            .join(name)
    })
}

fn migrate_beta(catalog: &Catalog) -> Result<Option<String>> {
    if !catalog.libraries().is_empty() || catalog.setting("migrated_from_beta").is_some() {
        return Ok(None);
    }
    let Some(source) = app_support("Plexy Player").map(|dir| dir.join("library.sqlite")) else {
        return Ok(None);
    };
    if !source.is_file() {
        return Ok(None);
    }
    catalog
        .import_beta_database(&source)
        .with_context(|| format!("import {}", source.display()))?;
    catalog.set_setting("migrated_from_beta", &crate::catalog::now().to_string());
    catalog.set_setting("migrated_from", "Plexy Beta");
    Ok(Some(
        "Imported the Plexy Beta library and watch state.".into(),
    ))
}

fn migrate_electron(catalog: &Catalog) -> Result<Option<String>> {
    if !catalog.libraries().is_empty() || catalog.setting("migrated_from_electron").is_some() {
        return Ok(None);
    }
    let Some(source) = app_support("Plexy").map(|dir| dir.join("library.sqlite")) else {
        return Ok(None);
    };
    if !source.is_file() {
        return Ok(None);
    }
    let source_db = Connection::open_with_flags(&source, OpenFlags::SQLITE_OPEN_READ_ONLY)
        .with_context(|| format!("open {}", source.display()))?;
    if !has_table(&source_db, "libraries") {
        return Ok(None);
    }

    let mut imported_libraries = 0usize;
    let libraries = {
        let mut statement = source_db.prepare("SELECT id, name, type FROM libraries")?;
        let rows = statement
            .query_map([], |row| {
                Ok((
                    row.get::<_, i64>(0)?,
                    row.get::<_, String>(1)?,
                    row.get::<_, String>(2)?,
                ))
            })?
            .collect::<rusqlite::Result<Vec<_>>>()?;
        rows
    };
    for (source_id, name, kind) in libraries {
        let roots = {
            let mut statement =
                source_db.prepare("SELECT path FROM library_paths WHERE library_id = ?1")?;
            let paths = statement
                .query_map([source_id], |row| row.get::<_, String>(0))?
                .collect::<rusqlite::Result<Vec<_>>>()?;
            paths.into_iter().map(PathBuf::from).collect::<Vec<_>>()
        };
        if roots.is_empty() {
            continue;
        }
        let kind = if kind == "tv" {
            LibraryKind::Shows
        } else {
            LibraryKind::Movies
        };
        if let Ok(id) = catalog.add_library_with_folders(kind, &roots) {
            catalog.rename_library(id, &name);
            imported_libraries += 1;
        }
    }

    let items = source_items(&source_db)?;
    import_watch_state(&source_db, catalog, &items)?;
    import_flags(&source_db, catalog, &items)?;
    import_collections(&source_db, catalog, &items)?;

    catalog.set_setting("migrated_from_electron", &crate::catalog::now().to_string());
    catalog.set_setting("migrated_from", "Plexy");
    if imported_libraries > 0 {
        catalog.scan(None, false);
    }
    Ok(Some(format!(
        "Imported {imported_libraries} libraries and the owner's watch state from Plexy."
    )))
}

fn has_table(db: &Connection, table: &str) -> bool {
    db.query_row(
        "SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?1",
        [table],
        |_| Ok(()),
    )
    .optional()
    .ok()
    .flatten()
    .is_some()
}

fn source_items(db: &Connection) -> Result<HashMap<i64, SourceItem>> {
    let mut out = HashMap::new();
    if !has_table(db, "items") {
        return Ok(out);
    }
    let mut statement = db.prepare(
        "SELECT i.id, i.kind, i.name, i.parent_id,
                (SELECT f.path FROM media_files f
                 WHERE f.item_id = i.id AND f.unavailable = 0
                 ORDER BY f.id DESC LIMIT 1)
         FROM items i",
    )?;
    let rows = statement.query_map([], |row| {
        Ok((
            row.get::<_, i64>(0)?,
            SourceItem {
                kind: row.get(1)?,
                name: row.get(2)?,
                parent_id: row.get(3)?,
                path: row.get::<_, Option<String>>(4)?.map(PathBuf::from),
            },
        ))
    })?;
    for row in rows {
        let (id, item) = row?;
        out.insert(id, item);
    }
    Ok(out)
}

fn owner_id(db: &Connection) -> Option<i64> {
    if !has_table(db, "users") {
        return None;
    }
    db.query_row(
        "SELECT id FROM users WHERE role = 'admin' ORDER BY id LIMIT 1",
        [],
        |row| row.get(0),
    )
    .optional()
    .ok()
    .flatten()
}

fn title_key(item: &SourceItem, items: &HashMap<i64, SourceItem>) -> Option<TitleKey> {
    match item.kind.as_str() {
        "movie" => item.path.clone().map(TitleKey::Movie),
        "series" => Some(TitleKey::Show(item.name.to_lowercase())),
        "episode" | "season" => {
            let parent = item.parent_id.and_then(|id| items.get(&id))?;
            Some(TitleKey::Show(parent.name.to_lowercase()))
        }
        _ => None,
    }
}

fn import_watch_state(
    db: &Connection,
    catalog: &Catalog,
    items: &HashMap<i64, SourceItem>,
) -> Result<()> {
    if !has_table(db, "watch_state") {
        return Ok(());
    }
    let Some(owner) = owner_id(db) else {
        return Ok(());
    };
    let mut statement = db.prepare(
        "SELECT item_id, position_seconds, duration_seconds, played
         FROM watch_state WHERE user_id = ?1",
    )?;
    let rows = statement.query_map([owner], |row| {
        Ok((
            row.get::<_, i64>(0)?,
            row.get::<_, f64>(1)?,
            row.get::<_, Option<f64>>(2)?,
            row.get::<_, i64>(3)? != 0,
        ))
    })?;
    for row in rows {
        let (id, position, duration, played) = row?;
        let Some(path) = items.get(&id).and_then(|item| item.path.as_ref()) else {
            continue;
        };
        if !path.is_file() {
            continue;
        }
        let duration = duration.unwrap_or(0.0);
        if played && duration > 0.0 {
            catalog.record_progress(path, duration, duration);
        } else if position > 0.0 {
            catalog.record_progress(path, position, duration.max(position));
        }
    }
    Ok(())
}

fn import_flags(
    db: &Connection,
    catalog: &Catalog,
    items: &HashMap<i64, SourceItem>,
) -> Result<()> {
    if !has_table(db, "user_item_flags") {
        return Ok(());
    }
    let Some(owner) = owner_id(db) else {
        return Ok(());
    };
    let mut statement = db.prepare(
        "SELECT item_id, watchlist, favorite, hidden, rating
         FROM user_item_flags WHERE user_id = ?1",
    )?;
    let rows = statement.query_map([owner], |row| {
        Ok((
            row.get::<_, i64>(0)?,
            row.get::<_, i64>(1)? != 0,
            row.get::<_, i64>(2)? != 0,
            row.get::<_, i64>(3)? != 0,
            row.get::<_, Option<i64>>(4)?,
        ))
    })?;
    for row in rows {
        let (id, watchlist, favorite, hidden, rating) = row?;
        let Some(item) = items.get(&id) else {
            continue;
        };
        let Some(key) = title_key(item, items) else {
            continue;
        };
        if watchlist {
            catalog.toggle_mark(&key, Mark::Watchlist);
        }
        if favorite {
            catalog.toggle_mark(&key, Mark::Favorite);
        }
        if hidden {
            catalog.toggle_mark(&key, Mark::Hidden);
        }
        if let Some(rating) = rating.filter(|value| (1..=5).contains(value)) {
            catalog.set_rating(&key, rating as u8);
        }
    }
    Ok(())
}

fn import_collections(
    db: &Connection,
    catalog: &Catalog,
    items: &HashMap<i64, SourceItem>,
) -> Result<()> {
    if !has_table(db, "collections") {
        return Ok(());
    }
    let collections = {
        let mut statement = db.prepare("SELECT id, name FROM collections")?;
        let rows = statement
            .query_map([], |row| {
                Ok((row.get::<_, i64>(0)?, row.get::<_, String>(1)?))
            })?
            .collect::<rusqlite::Result<Vec<_>>>()?;
        rows
    };
    let mut mapped = HashMap::new();
    for (source_id, name) in collections {
        if let Some(id) = catalog.create_collection(&name) {
            mapped.insert(source_id, id);
        }
    }
    if !has_table(db, "collection_items") {
        return Ok(());
    }
    let mut statement = db.prepare("SELECT collection_id, item_id FROM collection_items")?;
    let rows = statement.query_map([], |row| {
        Ok((row.get::<_, i64>(0)?, row.get::<_, i64>(1)?))
    })?;
    for row in rows {
        let (collection_id, item_id) = row?;
        let Some(collection) = mapped.get(&collection_id) else {
            continue;
        };
        let Some(item) = items.get(&item_id) else {
            continue;
        };
        let Some(key) = title_key(item, items) else {
            continue;
        };
        catalog.toggle_in_collection(*collection, &key);
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn episode_and_series_flags_share_the_show_key() {
        let mut items = HashMap::new();
        items.insert(
            1,
            SourceItem {
                kind: "series".into(),
                name: "The Bear".into(),
                parent_id: None,
                path: None,
            },
        );
        items.insert(
            2,
            SourceItem {
                kind: "episode".into(),
                name: "System".into(),
                parent_id: Some(1),
                path: Some(PathBuf::from("/tv/The Bear/S01E01.mkv")),
            },
        );
        let key = title_key(items.get(&2).unwrap(), &items).unwrap();
        assert_eq!(key, TitleKey::Show("the bear".into()));
    }

    #[test]
    fn beta_import_copies_libraries_progress_and_marks() {
        let source_dir = tempfile::tempdir().unwrap();
        let source = Catalog::open_in(source_dir.path().to_path_buf()).unwrap();
        let media = tempfile::tempdir().unwrap();
        let file = media.path().join("Movie.mkv");
        std::fs::write(&file, b"data").unwrap();
        let id = source.add_library(LibraryKind::Movies, media.path()).unwrap();
        source.rename_library(id, "Beta Movies");
        source.record_progress(&file, 12.0, 100.0);
        source.toggle_mark(&TitleKey::Movie(file.clone()), Mark::Watchlist);
        drop(source);

        let destination_dir = tempfile::tempdir().unwrap();
        let destination = Catalog::open_in(destination_dir.path().to_path_buf()).unwrap();
        destination
            .import_beta_database(&source_dir.path().join("library.sqlite"))
            .unwrap();
        let libraries = destination.libraries();
        assert_eq!(libraries.len(), 1);
        assert_eq!(libraries[0].name, "Beta Movies");
        assert!(destination.progress(&file).is_some());
        assert!(destination
            .personal()
            .has(&TitleKey::Movie(file), Mark::Watchlist));
    }

    #[test]
    fn movie_flags_use_the_media_path() {
        let mut items = HashMap::new();
        items.insert(
            1,
            SourceItem {
                kind: "movie".into(),
                name: "Arrival".into(),
                parent_id: None,
                path: Some(PathBuf::from("/movies/Arrival.mkv")),
            },
        );
        let key = title_key(items.get(&1).unwrap(), &items).unwrap();
        assert_eq!(key, TitleKey::Movie(PathBuf::from("/movies/Arrival.mkv")));
    }
}
