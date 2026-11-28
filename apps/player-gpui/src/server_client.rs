//! Client for an external Plexy Server.
//!
//! The stable Mac client keeps its own local catalog and treats the server as
//! an external source. Credentials live in Keychain; catalog rows are fetched
//! over the public API and converted into display items by the app shell.

use std::fmt;
use std::io::Read;
use std::time::Duration;

use anyhow::{anyhow, Result};
use serde::{de::DeserializeOwned, Deserialize, Serialize};
use serde_json::Value;
use security_framework::passwords::{
    delete_generic_password, get_generic_password, set_generic_password,
};

const SERVICE: &str = "com.plexy.client.server";
const ACCOUNT: &str = "active";

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct ServerUser {
    pub id: i64,
    pub username: String,
    #[serde(default)]
    pub role: String,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct ServerDevice {
    pub id: String,
    #[serde(default)]
    pub name: String,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct ServerSession {
    pub address: String,
    pub server_id: String,
    pub token: String,
    pub user: ServerUser,
    pub device: ServerDevice,
}

impl ServerSession {
    pub fn load() -> Option<Self> {
        let bytes = get_generic_password(SERVICE, ACCOUNT).ok()?;
        serde_json::from_slice(&bytes).ok()
    }

    pub fn save(&self) -> Result<()> {
        let bytes = serde_json::to_vec(self)?;
        set_generic_password(SERVICE, ACCOUNT, &bytes)
            .map_err(|error| anyhow!("Couldn’t save the server session in Keychain: {error}"))
    }

    pub fn clear() {
        let _ = delete_generic_password(SERVICE, ACCOUNT);
    }
}

#[derive(Clone, Debug, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct ServerWatch {
    #[serde(default)]
    pub position: f64,
    #[serde(default)]
    pub duration: Option<f64>,
    #[serde(default)]
    pub played: bool,
    #[serde(default)]
    pub percent: f64,
}

#[derive(Clone, Debug, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct ServerCard {
    #[serde(default)]
    pub id: i64,
    #[serde(default)]
    pub public_id: String,
    #[serde(default)]
    pub kind: String,
    #[serde(default)]
    pub name: String,
    #[serde(default)]
    pub year: Option<u32>,
    #[serde(default)]
    pub season_number: Option<u32>,
    #[serde(default)]
    pub episode_number: Option<u32>,
    #[serde(default)]
    pub file_id: Option<i64>,
    #[serde(default)]
    pub play_file_id: Option<i64>,
    #[serde(default)]
    pub parent_id: Option<i64>,
    #[serde(default)]
    pub parent_public_id: Option<String>,
    #[serde(default)]
    pub parent_title: Option<String>,
    #[serde(default)]
    pub poster: Option<String>,
    #[serde(default)]
    pub backdrop: Option<String>,
    #[serde(default)]
    pub logo: Option<String>,
    #[serde(default)]
    pub still: Option<String>,
    #[serde(default)]
    pub overview: Option<String>,
    #[serde(default)]
    pub rating: Option<f64>,
    #[serde(default)]
    pub runtime: Option<u32>,
    #[serde(default)]
    pub genres: Vec<String>,
    #[serde(default)]
    pub tmdb_id: Option<i64>,
    #[serde(default)]
    pub match_status: String,
    #[serde(default)]
    pub watch: Option<ServerWatch>,
    #[serde(default)]
    pub watchlist: bool,
    #[serde(default)]
    pub favorite: bool,
    #[serde(default)]
    pub hidden: bool,
    #[serde(default)]
    pub user_rating: Option<u8>,
    #[serde(default)]
    pub certification: Option<String>,
    #[serde(default)]
    pub play_subtitle: Option<String>,
    #[serde(default)]
    pub play_watch: Option<ServerWatch>,
}

impl ServerCard {
    pub fn is_episode(&self) -> bool {
        self.kind == "episode"
    }
    pub fn is_series(&self) -> bool {
        self.kind == "series"
    }
    pub fn is_movie(&self) -> bool {
        self.kind == "movie"
    }
    pub fn display_title(&self) -> String {
        self.parent_title
            .clone()
            .unwrap_or_else(|| self.name.clone())
    }
    pub fn label(&self) -> String {
        match (self.season_number, self.episode_number) {
            (Some(season), Some(episode)) => format!("S{season} E{episode}"),
            _ => self.year.map(|year| year.to_string()).unwrap_or_default(),
        }
    }
    pub fn progress(&self) -> Option<&ServerWatch> {
        self.watch.as_ref().or(self.play_watch.as_ref())
    }
}

#[derive(Clone, Debug, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct ServerRow {
    #[serde(default)]
    pub key: String,
    #[serde(default)]
    pub title: String,
    #[serde(default)]
    pub items: Vec<ServerCard>,
}

#[derive(Clone, Debug, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct ServerHome {
    #[serde(default)]
    pub featured: Option<ServerCard>,
    #[serde(default)]
    pub rows: Vec<ServerRow>,
}

#[derive(Clone, Debug, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct ServerItems {
    #[serde(default)]
    pub items: Vec<ServerCard>,
    #[serde(default)]
    pub total: i64,
}

#[derive(Clone, Debug, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct ServerSeason {
    #[serde(default)]
    pub id: i64,
    #[serde(default)]
    pub number: u32,
    #[serde(default)]
    pub name: String,
    #[serde(default)]
    pub poster: Option<String>,
}

#[derive(Clone, Debug, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct ServerMetadata {
    #[serde(default)]
    pub overview: Option<String>,
    #[serde(default)]
    pub tagline: Option<String>,
    #[serde(default)]
    pub runtime: Option<u32>,
    #[serde(default)]
    pub rating: Option<f64>,
    #[serde(default)]
    pub certification: Option<String>,
    #[serde(default)]
    pub genres: Vec<String>,
}

#[derive(Clone, Debug, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct ServerCast {
    #[serde(default)]
    pub id: i64,
    #[serde(default)]
    pub name: String,
    #[serde(default)]
    pub character: Option<String>,
    #[serde(default)]
    pub photo: Option<String>,
}

#[derive(Clone, Debug, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct ServerFile {
    #[serde(default)]
    pub file_id: i64,
    #[serde(default)]
    pub item_id: Option<i64>,
    #[serde(default)]
    pub duration: Option<f64>,
    #[serde(default)]
    pub size: i64,
    #[serde(default)]
    pub container: Option<String>,
    #[serde(default)]
    pub width: Option<u32>,
    #[serde(default)]
    pub height: Option<u32>,
    #[serde(default)]
    pub video_codec: Option<String>,
    #[serde(default)]
    pub audio: Vec<Value>,
}

#[derive(Clone, Debug, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct ServerDetail {
    #[serde(default)]
    pub item: ServerCard,
    #[serde(default)]
    pub logo: Option<String>,
    #[serde(default)]
    pub metadata: Option<ServerMetadata>,
    #[serde(default)]
    pub cast: Vec<ServerCast>,
    #[serde(default)]
    pub seasons: Option<Vec<ServerSeason>>,
    #[serde(default)]
    pub episodes: Option<Vec<ServerCard>>,
    #[serde(default)]
    pub file: Option<ServerFile>,
    #[serde(default)]
    pub tmdb_type: Option<String>,
    #[serde(default)]
    pub unmatched: bool,
    #[serde(default)]
    pub match_reason: Option<String>,
}

#[derive(Clone, Debug, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct ServerNext {
    #[serde(default)]
    pub file_id: i64,
    #[serde(default)]
    pub item_id: i64,
    #[serde(default)]
    pub title: String,
    #[serde(default)]
    pub subtitle: String,
    #[serde(default)]
    pub poster: Option<String>,
    #[serde(default)]
    pub season_number: Option<u32>,
    #[serde(default)]
    pub episode_number: Option<u32>,
}

#[derive(Clone, Debug, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct ServerTrack {
    #[serde(default)]
    pub track: String,
    #[serde(default)]
    pub kind: String,
    #[serde(default)]
    pub language: Option<String>,
    #[serde(default)]
    pub title: String,
    #[serde(default)]
    pub is_default: bool,
}

#[derive(Clone, Debug, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct ServerChapter {
    #[serde(default)]
    pub start: f64,
    #[serde(default)]
    pub end: f64,
    #[serde(default)]
    pub label: String,
}

#[derive(Clone, Debug, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct ServerPlay {
    #[serde(default)]
    pub path: String,
    #[serde(default)]
    pub reason: String,
    #[serde(default)]
    pub file_id: i64,
    #[serde(default)]
    pub item_id: Option<i64>,
    #[serde(default)]
    pub parent_item_id: Option<i64>,
    #[serde(default)]
    pub parent_public_id: Option<String>,
    #[serde(default)]
    pub title: Option<String>,
    #[serde(default)]
    pub subtitle: Option<String>,
    #[serde(default)]
    pub season_number: Option<u32>,
    #[serde(default)]
    pub episode_number: Option<u32>,
    #[serde(default)]
    pub duration: Option<f64>,
    #[serde(default)]
    pub next_file_id: Option<i64>,
    #[serde(default)]
    pub next: Option<ServerNext>,
    #[serde(default)]
    pub watch: Option<ServerWatch>,
    #[serde(default)]
    pub tracks: Vec<ServerTrack>,
    #[serde(default)]
    pub chapters: Vec<ServerChapter>,
    #[serde(default)]
    pub tmdb_id: Option<i64>,
    #[serde(default)]
    pub media_type: Option<String>,
}

#[derive(Clone, Debug, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ServerSkips {
    #[serde(default)]
    pub intro: Option<ServerSegment>,
    #[serde(default)]
    pub recap: Option<ServerSegment>,
    #[serde(default)]
    pub outro: Option<ServerSegment>,
}

#[derive(Clone, Debug, Default, Deserialize)]
pub struct ServerSegment {
    #[serde(default)]
    pub start: f64,
    #[serde(default)]
    pub end: f64,
}

#[derive(Debug)]
pub struct ServerError {
    pub message: String,
    pub status: Option<u16>,
    pub unauthorized: bool,
}

impl fmt::Display for ServerError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(&self.message)
    }
}
impl std::error::Error for ServerError {}

impl ServerError {
    fn network(message: impl Into<String>) -> Self {
        Self { message: message.into(), status: None, unauthorized: false }
    }
    fn status(status: u16, message: impl Into<String>) -> Self {
        Self {
            message: message.into(),
            status: Some(status),
            unauthorized: status == 401,
        }
    }
}

fn agent() -> ureq::Agent {
    ureq::AgentBuilder::new()
        .timeout_connect(Duration::from_secs(5))
        .timeout_read(Duration::from_secs(20))
        .timeout_write(Duration::from_secs(20))
        .build()
}

fn normalize_address(address: &str) -> Result<String> {
    let value = address.trim().trim_end_matches('/');
    if value.is_empty() {
        return Err(anyhow!("Enter the server address."));
    }
    if value.chars().any(char::is_whitespace) {
        return Err(anyhow!("The server address cannot contain spaces."));
    }
    if value.starts_with("http://") || value.starts_with("https://") {
        return Ok(value.to_string());
    }
    let local = value.starts_with("127.")
        || value.starts_with("localhost")
        || value.starts_with("[::1]");
    Ok(format!(
        "{}://{value}",
        if local { "http" } else { "https" }
    ))
}

fn read_error(response: ureq::Response) -> ServerError {
    let status = response.status();
    let message = response
        .into_json::<Value>()
        .ok()
        .and_then(|value| value["error"].as_str().map(str::to_owned))
        .unwrap_or_else(|| format!("The server returned HTTP {status}."));
    ServerError::status(status, message)
}

fn call_response<T: DeserializeOwned>(
    response: Result<ureq::Response, ureq::Error>,
) -> Result<T, ServerError> {
    match response {
        Ok(response) => response
            .into_json::<T>()
            .map_err(|error| ServerError::network(format!("Could not read the server response: {error}"))),
        Err(ureq::Error::Status(_, response)) => Err(read_error(response)),
        Err(ureq::Error::Transport(error)) => {
            Err(ServerError::network(format!("Could not reach the server: {error}")))
        }
    }
}

fn call<T: DeserializeOwned>(
    request: ureq::Request,
    unauthorized_hint: bool,
) -> Result<T, ServerError> {
    match request.call() {
        Ok(response) => response
            .into_json::<T>()
            .map_err(|error| ServerError::network(format!("Could not read the server response: {error}"))),
        Err(ureq::Error::Status(_, response)) => Err(read_error(response)),
        Err(ureq::Error::Transport(error)) => Err(ServerError::network(if unauthorized_hint {
            format!("Could not reach the server: {error}")
        } else {
            format!("Could not reach the server: {error}")
        })),
    }
}

pub fn probe(address: &str) -> Result<Value, ServerError> {
    let address = normalize_address(address).map_err(|error| ServerError::network(error.to_string()))?;
    let url = format!("{address}/api/server/status");
    call(agent().get(&url), false)
}

pub fn login(address: &str, username: &str, password: &str) -> Result<ServerSession, ServerError> {
    let address = normalize_address(address).map_err(|error| ServerError::network(error.to_string()))?;
    let url = format!("{address}/api/auth/login");
    let value: Value = call_response(
        agent().post(&url).send_json(serde_json::json!({
            "username": username,
            "password": password,
            "name": "Plexy for Mac"
        })),
    )?;
    session_from(address, value)
}

pub fn pair(address: &str, code: &str) -> Result<ServerSession, ServerError> {
    let address = normalize_address(address).map_err(|error| ServerError::network(error.to_string()))?;
    let url = format!("{address}/api/auth/pair");
    let value: Value = call_response(
        agent().post(&url).send_json(serde_json::json!({
            "code": code,
            "name": "Plexy for Mac"
        })),
    )?;
    session_from(address, value)
}

fn session_from(address: String, value: Value) -> Result<ServerSession, ServerError> {
    let token = value["token"]
        .as_str()
        .ok_or_else(|| ServerError::network("The server returned an incomplete sign-in response."))?;
    let user = value["user"]
        .as_object()
        .ok_or_else(|| ServerError::network("The server returned an incomplete account."))?;
    let device = value["device"]
        .as_object()
        .ok_or_else(|| ServerError::network("The server returned an incomplete device."))?;
    Ok(ServerSession {
        address,
        server_id: value["serverId"].as_str().unwrap_or_default().to_string(),
        token: token.to_string(),
        user: ServerUser {
            id: user["id"].as_i64().unwrap_or_default(),
            username: user["username"].as_str().unwrap_or_default().to_string(),
            role: user["role"].as_str().unwrap_or_default().to_string(),
        },
        device: ServerDevice {
            id: device["id"].as_str().unwrap_or_default().to_string(),
            name: device["name"].as_str().unwrap_or_default().to_string(),
        },
    })
}

#[derive(Clone)]
pub struct ServerClient {
    pub session: ServerSession,
    agent: ureq::Agent,
}

impl ServerClient {
    pub fn new(session: ServerSession) -> Self {
        Self { session, agent: agent() }
    }

    fn url(&self, path: &str) -> String {
        format!("{}{}", self.session.address, if path.starts_with('/') { path.to_string() } else { format!("/{path}") })
    }

    fn get<T: DeserializeOwned>(&self, path: &str) -> Result<T, ServerError> {
        let request = self
            .agent
            .get(&self.url(path))
            .set("Authorization", &format!("Bearer {}", self.session.token));
        call(request, true)
    }

    pub fn home(&self) -> Result<ServerHome, ServerError> {
        self.get("/api/home")
    }

    pub fn items(&self, kind: Option<&str>, offset: usize, limit: usize) -> Result<ServerItems, ServerError> {
        let mut path = format!("/api/items?offset={offset}&limit={limit}");
        if let Some(kind) = kind {
            path.push_str(&format!("&kind={kind}"));
        }
        self.get(&path)
    }

    pub fn detail(&self, id: &str) -> Result<ServerDetail, ServerError> {
        self.get(&format!("/api/items/{id}"))
    }

    pub fn play(&self, file_id: i64) -> Result<ServerPlay, ServerError> {
        self.get(&format!("/api/play/{file_id}?native=1"))
    }

    pub fn skips(&self, file_id: i64) -> Result<ServerSkips, ServerError> {
        self.get(&format!("/api/skip-segments/{file_id}"))
    }

    pub fn progress(&self, item_id: i64, position: f64, duration: Option<f64>, played: bool) -> Result<(), ServerError> {
        let request = self
            .agent
            .post(&self.url("/api/progress"))
            .set("Authorization", &format!("Bearer {}", self.session.token))
            .send_json(serde_json::json!({
                "itemId": item_id,
                "position": position,
                "duration": duration,
                "played": played
            }));
        let _: Value = call_response(request)?;
        Ok(())
    }

    pub fn watched(&self, item_id: i64, played: bool) -> Result<(), ServerError> {
        let request = self
            .agent
            .post(&self.url(&format!("/api/watch/{item_id}/played")))
            .set("Authorization", &format!("Bearer {}", self.session.token))
            .send_json(serde_json::json!({ "played": played }));
        let _: Value = call_response(request)?;
        Ok(())
    }

    pub fn image(&self, path: &str) -> Result<Vec<u8>, ServerError> {
        let url = if path.starts_with("http://") || path.starts_with("https://") {
            path.to_string()
        } else if path.starts_with('/') {
            format!("{}{}", self.session.address, path)
        } else {
            format!("{}/{}", self.session.address, path)
        };
        let response = self
            .agent
            .get(&url)
            .set("Authorization", &format!("Bearer {}", self.session.token))
            .call()
            .map_err(|error| match error {
                ureq::Error::Status(_, response) => read_error(response),
                ureq::Error::Transport(error) => ServerError::network(error.to_string()),
            })?;
        let mut bytes = Vec::new();
        response
            .into_reader()
            .read_to_end(&mut bytes)
            .map_err(|error| ServerError::network(error.to_string()))?;
        Ok(bytes)
    }

    pub fn stream_url(&self, file_id: i64) -> String {
        self.url(&format!("/api/stream/{file_id}/original"))
    }

    pub fn stream_headers(&self) -> Vec<(String, String)> {
        vec![("Authorization".into(), format!("Bearer {}", self.session.token))]
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::{Read, Write};
    use std::net::TcpListener;

    fn respond_once(body: &'static str) -> u16 {
        let listener = TcpListener::bind("127.0.0.1:0").expect("listener");
        let port = listener.local_addr().expect("address").port();
        std::thread::spawn(move || {
            let (mut stream, _) = listener.accept().expect("accept");
            let mut buffer = [0u8; 2048];
            let _ = stream.read(&mut buffer);
            let response = format!(
                "HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
                body.len(),
                body
            );
            let _ = stream.write_all(response.as_bytes());
        });
        port
    }

    #[test]
    fn normalizes_loopback_and_lan_addresses() {
        assert_eq!(
            normalize_address("127.0.0.1:8765").unwrap(),
            "http://127.0.0.1:8765"
        );
        assert_eq!(
            normalize_address("192.168.1.10:8766").unwrap(),
            "https://192.168.1.10:8766"
        );
        assert!(normalize_address("").is_err());
    }

    #[test]
    fn probe_reads_the_server_status() {
        let port = respond_once(
            r#"{"version":"1.0.0","serverId":"server-1","setupComplete":true,"ownerCreated":true}"#,
        );
        let status = probe(&format!("http://127.0.0.1:{port}")).expect("probe");
        assert_eq!(status["serverId"], "server-1");
    }

    #[test]
    fn login_response_becomes_a_storable_session() {
        let value = serde_json::json!({
            "token": "token-1",
            "serverId": "server-1",
            "user": { "id": 3, "username": "owner", "role": "admin" },
            "device": { "id": "device-1", "name": "Plexy for Mac" }
        });
        let session = session_from("http://127.0.0.1:8765".into(), value).expect("session");
        assert_eq!(session.token, "token-1");
        assert_eq!(session.server_id, "server-1");
        assert_eq!(session.user.username, "owner");
        assert_eq!(session.device.id, "device-1");
    }

    /// Manual end-to-end check against a running packaged server:
    /// `PLEXY_TEST_SERVER=http://127.0.0.1:8898 PLEXY_TEST_USER=owner
    ///  PLEXY_TEST_PASSWORD=... cargo test --locked server_live -- --ignored`
    #[test]
    #[ignore]
    fn live_server_round_trip() {
        let address = std::env::var("PLEXY_TEST_SERVER").expect("PLEXY_TEST_SERVER");
        let username = std::env::var("PLEXY_TEST_USER").expect("PLEXY_TEST_USER");
        let password = std::env::var("PLEXY_TEST_PASSWORD").expect("PLEXY_TEST_PASSWORD");
        let session = login(&address, &username, &password).expect("login");
        let client = ServerClient::new(session);
        let home = client.home().expect("home");
        let movies = client.items(Some("movie"), 0, 20).expect("movies");
        assert!(home.featured.is_some() || !home.rows.is_empty() || !movies.items.is_empty());
        if let Some(card) = movies.items.first().or(home.featured.as_ref()) {
            if let Some(file_id) = card.file_id {
                let play = client.play(file_id).expect("play");
                assert_eq!(play.file_id, file_id);
            }
        }
    }
}
