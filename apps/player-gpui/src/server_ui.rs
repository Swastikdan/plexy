//! UI state and display-item conversion for an external Plexy Server.

use std::collections::HashMap;
use std::hash::{Hash, Hasher};
use std::path::{Path, PathBuf};

use gpui_kit::component::input::InputState;
use gpui_kit::Entity;

use crate::catalog::{Item, ItemKind, ItemSource, ServerRef};
use crate::media::Progress;
use crate::server_client::{
    ServerCard, ServerClient, ServerDetail, ServerHome, ServerPlay, ServerSession, ServerWatch,
};

pub const SERVER_MOVIE_LIBRARY: i64 = -100;
pub const SERVER_TV_LIBRARY: i64 = -101;
pub const SOURCE_ALL: u8 = 0;
pub const SOURCE_LOCAL: u8 = 1;
pub const SOURCE_SERVER: u8 = 2;

pub struct ServerInputs {
    pub address: Entity<InputState>,
    pub code: Entity<InputState>,
    pub username: Entity<InputState>,
    pub password: Entity<InputState>,
}

pub struct ServerState {
    pub client: Option<ServerClient>,
    pub status: String,
    pub error: Option<String>,
    pub address: String,
    pub code: String,
    pub username: String,
    pub password: String,
    pub auth_mode: u8,
    pub busy: bool,
    pub home: Option<ServerHome>,
    pub cards: Vec<ServerCard>,
    pub episodes: HashMap<String, Vec<ServerCard>>,
    pub filter: u8,
    pub artwork: HashMap<String, PathBuf>,
    pub inputs: Option<ServerInputs>,
}

impl Default for ServerState {
    fn default() -> Self {
        Self::new()
    }
}

impl ServerState {
    pub fn new() -> Self {
        let saved = if cfg!(test) { None } else { ServerSession::load() };
        let (client, address, status) = match saved {
            Some(session) => {
                let address = session.address.clone();
                (
                    Some(ServerClient::new(session)),
                    address,
                    "Saved server · checking…".into(),
                )
            }
            None => (None, "http://127.0.0.1:8765".into(), "Not connected".into()),
        };
        Self {
            client,
            status,
            error: None,
            address,
            code: String::new(),
            username: String::new(),
            password: String::new(),
            auth_mode: 0,
            busy: false,
            home: None,
            cards: Vec::new(),
            episodes: HashMap::new(),
            filter: SOURCE_ALL,
            artwork: HashMap::new(),
            inputs: None,
        }
    }

    pub fn connected(&self) -> bool {
        self.client.is_some()
    }

    pub fn source_label(&self, filter: u8) -> &'static str {
        match filter {
            SOURCE_LOCAL => "This Mac",
            SOURCE_SERVER => "Plexy Server",
            _ => "All",
        }
    }
}

pub fn file_path(server_id: &str, file_id: i64) -> PathBuf {
    PathBuf::from(format!("server://{server_id}/file/{file_id}"))
}

pub fn series_path(server_id: &str, public_id: &str) -> PathBuf {
    PathBuf::from(format!("server://{server_id}/series/{public_id}"))
}

pub fn card_path(server_id: &str, card: &ServerCard) -> PathBuf {
    if card.is_series() {
        return series_path(server_id, &card.public_id);
    }
    let kind = if card.is_episode() { "episode" } else { "movie" };
    let file_id = card.file_id.or(card.play_file_id).unwrap_or_default();
    PathBuf::from(format!(
        "server://{server_id}/{kind}/{}/{}",
        card.public_id, file_id
    ))
}

pub fn parse_server_path(path: &Path) -> Option<ServerRef> {
    let value = path.to_string_lossy();
    let rest = value.strip_prefix("server://")?;
    let mut parts = rest.split('/');
    let server_id = parts.next()?.to_string();
    let kind = parts.next()?.to_string();
    if kind == "file" {
        let file_id = parts.next()?.parse::<i64>().ok()?;
        return Some(ServerRef {
            server_id,
            public_id: String::new(),
            file_id: Some(file_id),
            item_id: None,
            kind,
        });
    }
    let public_id = parts.next()?.to_string();
    let file_id = parts.next().and_then(|value| value.parse::<i64>().ok());
    Some(ServerRef {
        server_id,
        public_id,
        file_id,
        item_id: None,
        kind,
    })
}

pub fn progress_of(watch: Option<&ServerWatch>) -> Option<Progress> {
    let watch = watch?;
    Some(Progress {
        position: watch.position,
        duration: watch.duration.unwrap_or(0.0),
        updated: 0,
    })
}

pub fn card_to_item(
    server_id: &str,
    card: &ServerCard,
    artwork: &HashMap<String, PathBuf>,
) -> Item {
    let is_tv = card.is_series() || card.is_episode();
    let poster = card
        .poster
        .as_ref()
        .and_then(|url| artwork.get(url))
        .cloned();
    let backdrop = card
        .backdrop
        .as_ref()
        .and_then(|url| artwork.get(url))
        .cloned();
    Item {
        id: card.id,
        library_id: if is_tv { SERVER_TV_LIBRARY } else { SERVER_MOVIE_LIBRARY },
        path: card_path(server_id, card),
        title: card.display_title(),
        year: card.year,
        season: card.season_number,
        episode: card.episode_number,
        episode_title: if card.is_episode() {
            Some(card.name.clone())
        } else {
            None
        },
        poster,
        backdrop,
        added_at: 0,
        missing: false,
        progress: progress_of(card.progress()),
        kind: if card.is_series() {
            ItemKind::Series
        } else {
            ItemKind::Playable
        },
        source: ItemSource::Server(ServerRef {
            server_id: server_id.to_string(),
            public_id: card.public_id.clone(),
            file_id: card.file_id.or(card.play_file_id),
            item_id: Some(card.id),
            kind: card.kind.clone(),
        }),
    }
}

pub fn detail_episode_items(
    server_id: &str,
    detail: &ServerDetail,
    artwork: &HashMap<String, PathBuf>,
) -> Vec<Item> {
    detail
        .episodes
        .as_ref()
        .map(|episodes| {
            episodes
                .iter()
                .map(|card| card_to_item(server_id, card, artwork))
                .collect()
        })
        .unwrap_or_default()
}

pub fn dedupe_cards(cards: Vec<ServerCard>) -> Vec<ServerCard> {
    let mut seen = std::collections::HashSet::new();
    cards
        .into_iter()
        .filter(|card| {
            if card.public_id.is_empty() {
                return true;
            }
            seen.insert(card.public_id.clone())
        })
        .collect()
}

#[derive(Clone)]
pub struct RemotePlayback {
    pub client: ServerClient,
    pub play: ServerPlay,
    pub item_id: i64,
    pub file_id: i64,
}

pub fn fetch_catalog(
    client: &ServerClient,
) -> Result<(ServerHome, Vec<ServerCard>), crate::server_client::ServerError> {
    let home = client.home()?;
    let movies = client.items(Some("movie"), 0, 500)?;
    let series = client.items(Some("series"), 0, 500)?;
    let mut cards = Vec::new();
    if let Some(featured) = home.featured.clone() {
        cards.push(featured);
    }
    for row in &home.rows {
        cards.extend(row.items.clone());
    }
    cards.extend(movies.items);
    cards.extend(series.items);
    Ok((home, dedupe_cards(cards)))
}

pub fn segment_window(value: Option<super::server_client::ServerSegment>) -> Option<crate::catalog::SegmentWindow> {
    value.and_then(|segment| {
        (segment.end > segment.start)
            .then_some(crate::catalog::SegmentWindow { start: segment.start, end: segment.end, confidence: None, submission_count: None })
    })
}

pub fn skip_segments(value: super::server_client::ServerSkips) -> crate::catalog::SkipSegments {
    crate::catalog::SkipSegments {
        intro: segment_window(value.intro),
        recap: segment_window(value.recap),
        outro: segment_window(value.outro),
    }
}

/// Caches one server image beside the native catalog. The server requires the
/// device token, so the client fetches the bytes and the UI decodes a local file.
pub fn download_artwork(
    client: &ServerClient,
    url: &str,
    directory: &Path,
    cache: &mut HashMap<String, PathBuf>,
) -> Option<PathBuf> {
    if let Some(path) = cache.get(url) {
        if path.is_file() {
            return Some(path.clone());
        }
    }
    let mut hasher = std::collections::hash_map::DefaultHasher::new();
    url.hash(&mut hasher);
    let name = format!("{:016x}.img", hasher.finish());
    let path = directory.join(name);
    if !path.is_file() {
        let bytes = client.image(url).ok()?;
        if bytes.is_empty() {
            return None;
        }
        std::fs::create_dir_all(directory).ok()?;
        std::fs::write(&path, bytes).ok()?;
    }
    cache.insert(url.to_string(), path.clone());
    Some(path)
}

pub fn download_catalog_art(
    client: &ServerClient,
    cards: &[ServerCard],
    cache: &mut HashMap<String, PathBuf>,
) -> usize {
    let directory = crate::catalog::data_dir().join("server-artwork");
    let mut urls = Vec::new();
    for card in cards {
        for url in [card.poster.as_ref(), card.backdrop.as_ref()].into_iter().flatten() {
            if !urls.iter().any(|existing| existing == url) {
                urls.push(url.clone());
            }
        }
    }
    urls.truncate(80);
    let before = cache.len();
    for url in urls {
        let _ = download_artwork(client, &url, &directory, cache);
    }
    cache.len().saturating_sub(before)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn server_paths_round_trip() {
        let path = PathBuf::from("server://server-1/episode/abc/42");
        let parsed = parse_server_path(&path).expect("server path");
        assert_eq!(parsed.server_id, "server-1");
        assert_eq!(parsed.kind, "episode");
        assert_eq!(parsed.public_id, "abc");
        assert_eq!(parsed.file_id, Some(42));
        assert_eq!(file_path("server-1", 42), PathBuf::from("server://server-1/file/42"));
        let file = parse_server_path(&file_path("server-1", 42)).expect("file path");
        assert_eq!(file.kind, "file");
        assert_eq!(file.file_id, Some(42));
    }

    #[test]
    fn server_cards_become_display_items() {
        let card: ServerCard = serde_json::from_str(
            r#"{
                "id": 7,
                "publicId": "card-7",
                "kind": "movie",
                "name": "Arrival",
                "year": 2016,
                "fileId": 11,
                "watch": { "position": 30.0, "duration": 6000.0, "played": false, "percent": 1 }
            }"#,
        )
        .expect("server card");
        let item = card_to_item("server-1", &card, &HashMap::new());
        assert_eq!(item.title, "Arrival");
        assert_eq!(item.library_id, SERVER_MOVIE_LIBRARY);
        assert!(item.source.is_server());
        assert_eq!(item.source.server().and_then(|server| server.file_id), Some(11));
        assert_eq!(item.progress.map(|progress| progress.position), Some(30.0));
    }
}
