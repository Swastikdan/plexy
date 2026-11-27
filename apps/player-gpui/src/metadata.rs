//! Optional TMDB metadata and artwork for the local catalog, plus the
//! community IntroDB skip markers that need a matched IMDb id.
//!
//! Mirrors the Plexy server pipeline (`apps/server/src/tmdb.ts`,
//! `skip-segments.ts`) and the shared local-metadata fetch
//! (`packages/local-library/src/metadata.ts`):
//!
//! - Bearer auth with a read-access token the user pastes into Settings
//!   (`settings.tmdb_token`, or `PLEXY_TMDB_TOKEN` for development).
//! - SQLite response cache: 24 h for search, 7 d for details. Stale rows keep
//!   serving offline; only ancient search rows are pruned.
//! - ~1 request/second throttle and bounded retries on 429/5xx.
//! - Artwork downloaded once into the app data directory and never re-fetched
//!   while the file exists, so everything works offline after the first run.
//! - Manual matches win over automatic ones and survive rescans.
//!
//! Network is strictly opt-in: with no token the whole module is inert and
//! the catalog keeps working from filenames and sidecar artwork.

use std::io::Read;
use std::path::PathBuf;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Arc;
use std::time::Duration;

use anyhow::{anyhow, Result};
use parking_lot::Mutex;
use rusqlite::{Connection, OptionalExtension};
use serde_json::Value;

use crate::catalog::{CastMember, Catalog, SegmentKind, SegmentWindow, SkipSegments, TitleKey, TitleMeta};

const API_BASE: &str = "https://api.themoviedb.org/3";
const IMAGE_BASE: &str = "https://image.tmdb.org/t/p/original";
const SEARCH_TTL_MS: i64 = 24 * 3600_000;
const DETAIL_TTL_MS: i64 = 7 * 24 * 3600_000;
pub const MIN_GAP_MS: u64 = 1050;
const RETRYABLE: [u16; 6] = [418, 429, 500, 502, 503, 504];

const INTRODB_URL: &str = "https://api.introdb.app/segments";
const INTRODB_TIMEOUT_MS: u64 = 2500;

fn now_ms() -> i64 {
    std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_millis() as i64).unwrap_or(0)
}

/// `packages/local-library/src/metadata.ts` normalizedTitle: letters and
/// numbers only, lowercased.
pub fn normalized_title(s: &str) -> String {
    s.to_lowercase().chars().filter(|c| c.is_alphanumeric()).collect()
}

/// TMDB token: the Settings value first, then the environment for dev/tests.
pub fn token(catalog: &Catalog) -> Option<String> {
    std::env::var("PLEXY_TMDB_TOKEN").ok().filter(|t| !t.trim().is_empty()).or_else(|| catalog.setting("tmdb_token").filter(|t| !t.trim().is_empty()))
}

/// Checks a TMDB read-access token against `/configuration`.
pub fn verify_token(token: &str) -> std::result::Result<(), String> {
    let agent = ureq::AgentBuilder::new().timeout(Duration::from_secs(12)).build();
    match agent.get(&format!("{API_BASE}/configuration")).set("Authorization", &format!("Bearer {}", token.trim())).call() {
        Ok(_) => Ok(()),
        Err(ureq::Error::Status(401, _)) => Err("TMDB rejected this token. Use the API Read Access Token (v4).".into()),
        Err(ureq::Error::Status(code, _)) => Err(format!("TMDB answered {code}. Try again later.")),
        Err(_) => Err("Couldn't reach TMDB. Check your connection.".into()),
    }
}

// MARK: Client

pub struct Tmdb {
    agent: ureq::Agent,
    token: Option<String>,
    db: Arc<Mutex<Connection>>,
    last_request: AtomicU64,
}

impl Tmdb {
    pub fn new(catalog: &Catalog) -> Self {
        Self { agent: ureq::AgentBuilder::new().timeout(Duration::from_secs(12)).build(), token: token(catalog), db: catalog.db_handle(), last_request: AtomicU64::new(0) }
    }

    #[cfg(test)]
    fn with_db(db: Arc<Mutex<Connection>>) -> Self {
        Self { agent: ureq::AgentBuilder::new().timeout(Duration::from_secs(12)).build(), token: None, db, last_request: AtomicU64::new(0) }
    }

    pub fn has_token(&self) -> bool {
        self.token.is_some()
    }

    /// GET an api.themoviedb.org path with cache + throttle + retries. An
    /// offline failure falls back to a stale cached body when one exists.
    pub fn request(&self, path: &str, ttl_ms: i64) -> Result<Value> {
        let url = format!("{API_BASE}{path}");
        let key = cache_key(&url);
        if let Some(hit) = self.cache_get(&key, ttl_ms) {
            return Ok(hit);
        }
        match self.request_live(&url) {
            Ok(body) => {
                let value: Value = serde_json::from_str(&body)?;
                self.cache_put(&key, path, &body, ttl_ms);
                Ok(value)
            }
            Err(error) => self.cache_get_stale(&key).ok_or(error),
        }
    }    fn request_live(&self, url: &str) -> Result<String> {
        let token = self.token.clone().ok_or_else(|| anyhow!("no-token"))?;
        let mut body = None;
        for attempt in 0..=2u32 {
            let gap = (self.last_request.load(Ordering::Relaxed) + MIN_GAP_MS).saturating_sub(now_ms() as u64);
            if gap > 0 {
                std::thread::sleep(Duration::from_millis(gap));
            }
            self.last_request.store(now_ms() as u64, Ordering::Relaxed);
            match self.agent.get(url).set("Authorization", &format!("Bearer {token}")).set("accept", "application/json").call() {
                Ok(response) => {
                    body = Some(response.into_string()?);
                    break;
                }
                Err(ureq::Error::Status(code, response)) if RETRYABLE.contains(&code) => {
                    if attempt == 2 {
                        return Err(anyhow!("TMDB responded {code}"));
                    }
                    let retry_after = response.header("retry-after").and_then(|v| v.parse::<u64>().ok()).unwrap_or(60);
                    let backoff = if code == 429 { retry_after * 1000 } else { 500 * 2u64.pow(attempt) };
                    std::thread::sleep(Duration::from_millis(backoff.min(15_000)));
                }
                Err(ureq::Error::Status(code, _)) => return Err(anyhow!("TMDB responded {code}")),
                Err(error) => return Err(anyhow!(error.to_string())),
            }
        }
        body.ok_or_else(|| anyhow!("no response body"))
    }

    fn cache_get(&self, key: &u64, _ttl_ms: i64) -> Option<Value> {
        let db = self.db.lock();
        let row: Option<String> =
            db.query_row("SELECT body FROM tmdb_cache WHERE key = ?1 AND expires_at > ?2", rusqlite::params![key, now_ms()], |r| r.get::<_, String>(0)).optional().ok().flatten();
        row.and_then(|body| serde_json::from_str(&body).ok())
    }

    fn cache_get_stale(&self, key: &u64) -> Option<Value> {
        let db = self.db.lock();
        let row: Option<String> = db.query_row("SELECT body FROM tmdb_cache WHERE key = ?1", rusqlite::params![key], |r| r.get::<_, String>(0)).optional().ok().flatten();
        row.and_then(|body| serde_json::from_str(&body).ok())
    }

    fn cache_put(&self, key: &u64, endpoint: &str, body: &str, ttl_ms: i64) {
        let _ = self.db.lock().execute(
            "INSERT INTO tmdb_cache(key, endpoint, body, expires_at) VALUES (?1, ?2, ?3, ?4)
             ON CONFLICT(key) DO UPDATE SET body = excluded.body, endpoint = excluded.endpoint, expires_at = excluded.expires_at",
            rusqlite::params![key, endpoint, body, now_ms() + ttl_ms],
        );
    }

    /// Drop expired search rows; details stay forever for offline use.
    pub fn prune(&self) {
        let _ = self.db.lock().execute(
            "DELETE FROM tmdb_cache WHERE endpoint LIKE 'search/%' AND expires_at < ?1",
            rusqlite::params![now_ms() - 30 * 24 * 3600_000],
        );
    }

    /// Search results, trying with the year first, then without, then with the
    /// simplified title (PRD 5.4 fallback chain).
    pub fn search(&self, kind: &str, query: &str, year: Option<u32>) -> Result<Vec<Value>> {
        let mut attempts = Vec::new();
        let mut push = |query: &str, year: Option<u32>| {
            let year_param = year.map(|year| if kind == "tv" { format!("&first_air_date_year={year}") } else { format!("&year={year}") }).unwrap_or_default();
            attempts.push(format!("/search/{kind}?query={}&include_adult=false{year_param}", url_encode(query)));
        };
        push(query, year);
        push(query, None);
        let simplified = query.split([':', '-', '–']).next().unwrap_or(query).trim().to_string();
        if !simplified.is_empty() && !simplified.eq_ignore_ascii_case(query) {
            push(&simplified, year);
        }
        for path in attempts {
            let value = self.request(&path, SEARCH_TTL_MS)?;
            let results = value.get("results").and_then(|r| r.as_array()).cloned().unwrap_or_default();
            if !results.is_empty() {
                return Ok(results);
            }
        }
        Ok(Vec::new())
    }

    /// Combined details + credits + age ratings used by the enrichment pass.
    pub fn detail(&self, kind: &str, id: i64) -> Result<Value> {
        self.request(&format!("/{kind}/{id}?append_to_response=videos,credits,release_dates,content_ratings&language=en-US"), DETAIL_TTL_MS)
    }

    pub fn season(&self, id: i64, season: u32) -> Result<Value> {
        self.request(&format!("/tv/{id}/season/{season}?language=en-US"), DETAIL_TTL_MS)
    }

    pub fn external_imdb_id(&self, kind: &str, id: i64) -> Result<Option<String>> {
        let value = self.request(&format!("/{kind}/{id}/external_ids"), DETAIL_TTL_MS)?;
        Ok(value.get("imdb_id").and_then(|v| v.as_str()).map(str::to_string).filter(|id| id.starts_with("tt")))
    }

    /// Best transparent title logo: language-neutral first, then English, then
    /// the highest-voted logo of any language.
    pub fn logo_path(&self, kind: &str, id: i64) -> Option<String> {
        let value = self.request(&format!("/{kind}/{id}/images?include_image_language=en,null"), DETAIL_TTL_MS).ok()?;
        let logos = value.get("logos")?.as_array()?.clone();
        let score = |logo: &Value| -> i64 {
            let lang = logo.get("iso_639_1").and_then(|v| v.as_str()).unwrap_or("");
            let votes = (logo.get("vote_average").and_then(|v| v.as_f64()).unwrap_or(0.) * 1000.) as i64
                + logo.get("vote_count").and_then(|v| v.as_f64()).unwrap_or(0.) as i64;
            i64::from(lang.is_empty()) * 10_000_000 + i64::from(lang == "en") * 1_000_000 + votes
        };
        logos.iter().max_by_key(|logo| score(logo)).and_then(|logo| logo.get("file_path").and_then(|v| v.as_str()).map(str::to_string))
    }
}

/// FNV-1a: plenty for cache keys without another crate.
pub fn cache_key(url: &str) -> u64 {
    let mut hash: u64 = 0xcbf29ce484222325;
    for byte in url.bytes() {
        hash ^= byte as u64;
        hash = hash.wrapping_mul(0x100000001b3);
    }
    hash
}

fn url_encode(text: &str) -> String {
    let mut out = String::new();
    for byte in text.bytes() {
        match byte {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' => out.push(byte as char),
            other => out.push_str(&format!("%{other:02X}")),
        }
    }
    out
}

// MARK: Artwork files

/// Downloads a TMDB image path into the artwork cache and returns the local
/// file. Existing files are never re-fetched, so cached art works offline and
/// re-scans stay cheap.
pub fn fetch_image(catalog: &Catalog, tmdb: &Tmdb, path: &str) -> Option<PathBuf> {
    let file = catalog.artwork_cache_path(path)?;
    if file.exists() {
        return Some(file);
    }
    if let Some(parent) = file.parent() {
        let _ = std::fs::create_dir_all(parent);
    }
    let response = tmdb.agent.get(&format!("{IMAGE_BASE}{path}")).call().ok()?;
    let mut bytes = Vec::new();
    response.into_reader().read_to_end(&mut bytes).ok()?;
    if bytes.len() < 64 {
        return None;
    }
    // Write-then-rename so a cut-off download never poses as cached art.
    let partial = file.with_extension("part");
    std::fs::write(&partial, &bytes).ok()?;
    std::fs::rename(&partial, &file).ok()?;
    Some(file)
}

// MARK: Enrichment

/// The server matcher's exact-title shortcut: among identical normalised
/// titles, the best year agreement plus popularity prior wins; a parsed year
/// more than 2 off the winner means review, not a match.
pub fn pick_exact(exact: &[&Value], year: Option<u32>) -> Option<i64> {
    let candidate_year = |c: &Value| {
        ["release_date", "first_air_date"].iter().find_map(|k| c.get(*k).and_then(|v| v.as_str()).and_then(|d| d.get(..4)).and_then(|y| y.parse::<u32>().ok()))
    };
    let score = |c: &Value| {
        let year_score = match (year, candidate_year(c)) {
            (Some(a), Some(b)) => match a.abs_diff(b) {
                0 => 0.20,
                1 => 0.10,
                _ => 0.0,
            },
            _ => 0.06,
        };
        let popularity = c.get("popularity").and_then(|v| v.as_f64()).unwrap_or(0.0);
        year_score + ((1.0 + popularity).log10() / 3.0).min(1.0) * 0.10
    };
    let best = exact.iter().max_by(|a, b| score(a).total_cmp(&score(b)))?;
    if let (Some(a), Some(b)) = (year, candidate_year(best)) {
        if a.abs_diff(b) > 2 {
            return None;
        }
    }
    best.get("id").and_then(|v| v.as_i64())
}


pub enum EnrichOutcome {
    Matched,
    /// No exact candidate: parked for the manual-match flow.
    Review,
    /// No token configured — enrichment is inert.
    NoToken,
    /// TMDB is unreachable right now; try again later.
    Offline,
}

/// Enrich one title: manual match first, else the single exact name match,
/// else `Review`. Downloads artwork, stores `title_metadata`, and for shows
/// records episode stills and names per file.
pub fn enrich_title(catalog: &Catalog, tmdb: &Tmdb, key: &TitleKey, title: &str, year: Option<u32>, is_show: bool) -> EnrichOutcome {
    if !tmdb.has_token() {
        return EnrichOutcome::NoToken;
    }
    let kind = if is_show { "tv" } else { "movie" };

    let chosen = match catalog.manual_match(key) {
        Some((kind, id)) => Some((kind, id, true)),
        None => {
            let results = match tmdb.search(kind, title, year) {
                Ok(results) => results,
                Err(_) => return EnrichOutcome::Offline,
            };
            let needle = normalized_title(title);
            let exact: Vec<&Value> = results
                .iter()
                .filter(|r| {
                    [r.get("title"), r.get("name"), r.get("original_title"), r.get("original_name")]
                        .into_iter()
                        .flatten()
                        .filter_map(|v| v.as_str())
                        .any(|t| normalized_title(t) == needle)
                })
                .collect();
            match pick_exact(&exact, year) {
                Some(id) => Some((kind.to_string(), id, false)),
                None => {
                    catalog.record_match_status(key, "review");
                    return EnrichOutcome::Review;
                }
            }
        }
    };
    let Some((kind, id, manual)) = chosen else { return EnrichOutcome::Review };
    let detail = match tmdb.detail(&kind, id) {
        Ok(detail) => detail,
        Err(_) => return EnrichOutcome::Offline,
    };

    let poster = detail.get("poster_path").and_then(|v| v.as_str()).and_then(|p| fetch_image(catalog, tmdb, p));
    let backdrop = detail.get("backdrop_path").and_then(|v| v.as_str()).and_then(|p| fetch_image(catalog, tmdb, p));
    let logo = tmdb.logo_path(&kind, id).and_then(|p| fetch_image(catalog, tmdb, &p));

    let genres: Vec<String> = detail.get("genres").and_then(|v| v.as_array()).map(|list| list.iter().filter_map(|g| g.get("name").and_then(|v| v.as_str()).map(str::to_string)).collect()).unwrap_or_default();
    let cast: Vec<CastMember> = detail
        .pointer("/credits/cast")
        .and_then(|v| v.as_array())
        .map(|list| {
            list.iter()
                .take(12)
                .filter_map(|person| {
                    let name = person.get("name")?.as_str()?.to_string();
                    let role = person.get("character").and_then(|v| v.as_str()).unwrap_or_default().to_string();
                    let photo = person.get("profile_path").and_then(|v| v.as_str()).and_then(|p| fetch_image(catalog, tmdb, p));
                    Some(CastMember { name, role, photo })
                })
                .collect()
        })
        .unwrap_or_default();
    let imdb = tmdb.external_imdb_id(&kind, id).ok().flatten();
    let certification = certification_from(&detail, &kind);

    let name = detail
        .get(if kind == "tv" { "name" } else { "title" })
        .or_else(|| detail.get("original_name"))
        .and_then(|v| v.as_str())
        .unwrap_or(title)
        .to_string();
    let year_out = detail
        .get(if kind == "tv" { "first_air_date" } else { "release_date" })
        .and_then(|v| v.as_str())
        .and_then(|date| date.get(..4)?.parse::<u32>().ok())
        .or(year);

    catalog.store_title_meta(
        key,
        &TitleMeta {
            tmdb_id: id,
            kind: kind.clone(),
            name,
            overview: detail.get("overview").and_then(|v| v.as_str()).map(str::to_string).filter(|s| !s.is_empty()),
            year: year_out,
            rating: detail.get("vote_average").and_then(|v| v.as_f64()).filter(|r| *r > 0.),
            runtime: detail.get("runtime").and_then(|v| v.as_i64()).filter(|r| *r > 0).map(|r| r as u32),
            certification,
            genres,
            cast,
            poster,
            backdrop,
            logo,
            imdb_id: imdb,
            manual,
            matched: true,
        },
    );
    if is_show {
        store_episode_details(catalog, tmdb, key, id);
    }
    EnrichOutcome::Matched
}

fn certification_from(detail: &Value, kind: &str) -> Option<String> {
    let rows: Vec<(String, String)> = if kind == "tv" {
        detail.pointer("/content_ratings/results").and_then(|v| v.as_array()).map(|list| {
            list.iter()
                .filter_map(|row| {
                    let country = row.get("iso_3166_1")?.as_str()?.to_string();
                    let rating = row.get("rating")?.as_str()?.trim().to_string();
                    (!rating.is_empty()).then_some((country, rating))
                })
                .collect()
        })
    } else {
        detail.pointer("/release_dates/results").and_then(|v| v.as_array()).map(|list| {
            list.iter()
                .filter_map(|row| {
                    let country = row.get("iso_3166_1")?.as_str()?.to_string();
                    let dates = row.get("release_dates")?.as_array()?;
                    let rating = dates.iter().filter_map(|d| d.get("certification").and_then(|v| v.as_str())).find(|c| !c.trim().is_empty())?.to_string();
                    (!rating.is_empty()).then_some((country, rating))
                })
                .collect()
        })
    }
    .unwrap_or_default();
    rows.iter().find(|(country, _)| country == "US").or_else(|| rows.first()).map(|(_, rating)| rating.clone())
}

/// Episode names and stills for every local season of a matched show.
fn store_episode_details(catalog: &Catalog, tmdb: &Tmdb, key: &TitleKey, id: i64) {
    for (season, paths) in catalog.title_show_files(key) {
        if season == 0 {
            continue;
        }
        let Ok(episodes) = tmdb.season(id, season) else { continue };
        let Some(list) = episodes.get("episodes").and_then(|v| v.as_array()) else { continue };
        for (path, local_episode) in paths {
            let Some(local_episode) = local_episode else { continue };
            let Some(entry) = list.iter().find(|e| e.get("episode_number").and_then(|v| v.as_i64()) == Some(local_episode as i64)) else { continue };
            let still = entry.get("still_path").and_then(|v| v.as_str()).and_then(|p| fetch_image(catalog, tmdb, p)).map(|p| p.display().to_string());
            let name = entry.get("name").and_then(|v| v.as_str()).map(str::to_string);
            let overview = entry.get("overview").and_then(|v| v.as_str()).map(str::to_string).filter(|s| !s.is_empty());
            catalog.store_episode_meta(&path, still, name, overview);
        }
        std::thread::sleep(Duration::from_millis(MIN_GAP_MS));
    }
}

/// Enrich every title that has no stored metadata or whose last attempt is
/// stale. Called on a background thread after a scan or a token change.
pub fn enrich_missing(catalog: &Catalog) -> (usize, usize) {
    let Some(_) = token(catalog) else { return (0, 0) };
    let tmdb = Tmdb::new(catalog);
    let mut enriched = 0;
    let mut reviewed = 0;
    for target in catalog.titles_missing_metadata() {
        match enrich_title(catalog, &tmdb, &target.key, &target.title, target.year, target.is_show) {
            EnrichOutcome::Matched => enriched += 1,
            EnrichOutcome::Review => reviewed += 1,
            EnrichOutcome::Offline | EnrichOutcome::NoToken => break,
        }
        std::thread::sleep(Duration::from_millis(MIN_GAP_MS));
    }
    tmdb.prune();
    catalog.bump_metadata_epoch();
    (enriched, reviewed)
}

// MARK: Skip markers (IntroDB)

/// Fetch community markers for one file. `imdb` is the matched series or
/// movie IMDb id from TMDB. A 404 (nothing contributed yet) is an empty,
/// successful answer, exactly like the server's client.
pub fn fetch_markers(tmdb: &Tmdb, imdb: &str, season: Option<u32>, episode: Option<u32>, is_movie: bool) -> Result<SkipSegments> {
    let mut url = format!("{INTRODB_URL}?imdb_id={}", url_encode(imdb));
    if is_movie {
        url.push_str("&is_movie=true");
    } else {
        let (Some(season), Some(episode)) = (season, episode) else { return Ok(SkipSegments::default()) };
        url.push_str(&format!("&season={season}&episode={episode}"));
    }
    let response = tmdb
        .agent
        .get(&url)
        .timeout(Duration::from_millis(INTRODB_TIMEOUT_MS))
        .set("accept", "application/json")
        .call();
    match response {
        Ok(body) => {
            let value: Value = serde_json::from_str(&body.into_string()?)?;
            Ok(SkipSegments {
                intro: normalize_segment(value.get("intro"), None, SegmentKind::Intro),
                recap: normalize_segment(value.get("recap"), None, SegmentKind::Recap),
                outro: normalize_segment(value.get("outro"), None, SegmentKind::Outro),
            })
        }
        Err(ureq::Error::Status(404, _)) => Ok(SkipSegments::default()),
        Err(error) => Err(anyhow!(error.to_string())),
    }
}

/// Convert an IntroDB segment object to seconds, unclamped. Implausible
/// windows are rejected before they are ever stored; the file duration is
/// applied again at read time because another cut of the same episode may be
/// shorter.
pub fn normalize_segment(value: Option<&Value>, duration: Option<f64>, kind: SegmentKind) -> Option<SegmentWindow> {
    let value = value?;
    let read_seconds = |key_sec: &str, key_ms: &str| -> Option<f64> {
        if let Some(v) = value.get(key_sec).and_then(|v| v.as_f64()) {
            Some(v)
        } else {
            value.get(key_ms).and_then(|v| v.as_f64()).map(|v| v / 1000.)
        }
    };
    let start = read_seconds("start_sec", "start_ms")?;
    let end = read_seconds("end_sec", "end_ms")?;
    let confidence = value.get("confidence").and_then(|v| v.as_f64());
    let submission_count = value.get("submission_count").and_then(|v| v.as_i64());
    clamp_window(start, end, duration, kind, confidence, submission_count)
}

/// Port of `clampWindow` + `isPlausibleWindow` from skip-segments.ts.
pub fn clamp_window(start: f64, end: f64, duration: Option<f64>, kind: SegmentKind, confidence: Option<f64>, submission_count: Option<i64>) -> Option<SegmentWindow> {
    if !(start.is_finite() && end.is_finite()) || start < 0. || end <= start {
        return None;
    }
    let mut end = end;
    let known_duration = duration.filter(|d| *d > 0. && d.is_finite());
    if let Some(duration) = known_duration {
        // A marker that starts after the file ends, or overshoots it badly,
        // almost always belongs to a different cut.
        if start >= duration || end > duration + 15. {
            return None;
        }
        end = end.min(duration);
    }
    let length = end - start;
    const MIN_SEGMENT_SECONDS: f64 = 5.;
    const MAX_INTRO_SECONDS: f64 = 10. * 60.;
    const MAX_RECAP_SECONDS: f64 = 10. * 60.;
    const MAX_OUTRO_SECONDS: f64 = 30. * 60.;
    const MAX_INTRO_START_SECONDS: f64 = 20. * 60.;
    const MAX_RECAP_START_SECONDS: f64 = 15. * 60.;
    const MIN_OUTRO_START_SECONDS: f64 = 10. * 60.;
    let plausible = match kind {
        SegmentKind::Intro => length <= MAX_INTRO_SECONDS && start <= MAX_INTRO_START_SECONDS,
        SegmentKind::Recap => length <= MAX_RECAP_SECONDS && start <= MAX_RECAP_START_SECONDS,
        SegmentKind::Outro => {
            if length > MAX_OUTRO_SECONDS {
                false
            } else {
                // Credits sit at the end. With a known runtime, allow anything
                // past the midpoint; without one, fall back to the floor.
                let earliest = known_duration.map(|d| d / 2.).map(|mid| mid.min(MIN_OUTRO_START_SECONDS)).unwrap_or(MIN_OUTRO_START_SECONDS);
                start >= earliest
            }
        }
    };
    if !plausible || length < MIN_SEGMENT_SECONDS {
        return None;
    }
    Some(SegmentWindow { start, end, confidence, submission_count })
}

// MARK: Tests

#[cfg(test)]
mod tests {
    #[test]
    fn subtitle_results_are_validated_and_deduped() {
        assert!(subtitle_url_ok("https://subs5.strem.io/en/download/x"));
        assert!(subtitle_url_ok("https://subs.strem.io/x"));
        assert!(!subtitle_url_ok("https://evil.example/subs.strem.io/"));
        assert!(!subtitle_url_ok("http://subs5.strem.io/x"));
        let value = serde_json::json!({"subtitles": [
            {"id": "1", "url": "https://subs5.strem.io/a", "lang": "eng"},
            {"id": "1", "url": "https://subs5.strem.io/a", "lang": "eng"},
            {"id": "2", "url": "https://bad.example/b", "lang": "fre"},
            {"id": "3", "url": "https://subs.strem.io/c", "lang": "hin", "subtitleFileName": "c.srt"}
        ]});
        let parsed = parse_subtitles(&value).unwrap();
        assert_eq!(parsed.iter().map(|r| r.id.as_str()).collect::<Vec<_>>(), ["1", "3"]);
        assert_eq!(parsed[1].name, "c.srt");
        assert!(parse_subtitles(&serde_json::json!({})).is_err());
    }

    #[test]
    fn exact_title_prefers_year_then_popularity() {
        let old = serde_json::json!({"id": 1, "name": "Lupin", "first_air_date": "1971-10-24", "popularity": 30.0});
        let new = serde_json::json!({"id": 2, "name": "Lupin", "first_air_date": "2021-01-08", "popularity": 60.0});
        assert_eq!(pick_exact(&[&old, &new], None), Some(2));
        assert_eq!(pick_exact(&[&old, &new], Some(2021)), Some(2));
        assert_eq!(pick_exact(&[&old], Some(2021)), None);
        assert_eq!(pick_exact(&[], None), None);
    }

    use super::*;
    use crate::catalog::test_support;
    use std::path::Path;
    use std::sync::MutexGuard;

    /// A catalog plus the held env lock; dropping the pair is enough.
    type Guarded = (Catalog, MutexGuard<'static, ()>);

    fn catalog(name: &str) -> Guarded {
        let guard = test_support::lock();
        let base = std::env::temp_dir().join(format!("plexy-{name}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&base);
        std::fs::create_dir_all(base.join("data")).unwrap();
        std::env::set_var("PLEXY_PLAYER_DATA", base.join("data"));
        (Catalog::open().unwrap(), guard)
    }

    #[test]
    fn normalized_title_matches_local_library() {
        assert_eq!(normalized_title("Léon: The Professional"), "léontheprofessional");
        assert_eq!(normalized_title("Léon  The—Professional 2017!"), "léontheprofessional2017");
    }

    #[test]
    fn clamps_intro_recap_and_credits_windows() {
        // A plain intro is kept.
        let intro = clamp_window(2.0, 95.0, Some(2700.0), SegmentKind::Intro, Some(0.9), Some(4));
        assert_eq!(intro.map(|i| (i.start, i.end)), Some((2.0, 95.0)));
        // A 2:30 "credits" on a 152-minute film is nonsense and dropped.
        assert_eq!(clamp_window(150.0, 160.0, Some(9120.0), SegmentKind::Outro, None, None), None);
        // Credits starting past the midpoint are kept, and clamped to the file.
        let outro = clamp_window(8000.0, 9130.0, Some(9120.0), SegmentKind::Outro, None, None);
        assert_eq!(outro.map(|o| o.end), Some(9120.0));
        // A marker that overshoots the file by more than 15 s belongs to
        // another cut and is dropped rather than clamped.
        assert_eq!(clamp_window(8000.0, 9200.0, Some(9120.0), SegmentKind::Outro, None, None), None);
        // A marker that starts after the file ends belongs to another cut.
        assert_eq!(clamp_window(9300.0, 9400.0, Some(9120.0), SegmentKind::Outro, None, None), None);
        // Sub-five-second windows are noise.
        assert_eq!(clamp_window(10.0, 12.0, Some(2700.0), SegmentKind::Intro, None, None), None);
        // Without a duration, credits fall back to the 10-minute floor.
        assert_eq!(clamp_window(300.0, 320.0, None, SegmentKind::Outro, None, None), None);
        assert!(clamp_window(700.0, 720.0, None, SegmentKind::Outro, None, None).is_some());
    }

    #[test]
    fn reads_introdb_seconds_and_milliseconds() {
        let json: Value = serde_json::json!({ "start_sec": 1.5, "end_sec": 90.0, "confidence": 0.8, "submission_count": 3 });
        let window = normalize_segment(Some(&json), Some(1800.0), SegmentKind::Intro).unwrap();
        assert_eq!(window.start, 1.5);
        assert_eq!(window.end, 90.0);
        assert_eq!(window.confidence, Some(0.8));
        let ms: Value = serde_json::json!({ "start_ms": 1500, "end_ms": 90_000 });
        assert_eq!(normalize_segment(Some(&ms), Some(1800.0), SegmentKind::Intro).unwrap().end, 90.0);
        assert_eq!(normalize_segment(None, None, SegmentKind::Intro), None);
    }

    #[test]
    fn manual_matches_win_and_survive_rewrites() {
        let (catalog, _guard) = catalog("manual_matches");
        let key = TitleKey::Show("legion".into());
        catalog.set_manual_match(&key, "tv", 63250);
        assert_eq!(catalog.manual_match(&key), Some(("tv".into(), 63250)));
        let other = TitleKey::Movie("/tmp/Movie.mkv".into());
        assert_eq!(catalog.manual_match(&other), None);
        catalog.clear_manual_match(&key);
        assert_eq!(catalog.manual_match(&key), None);
    }

    #[test]
    fn title_metadata_round_trips() {
        let (catalog, _guard) = catalog("match_status");
        let key = TitleKey::Show("mindhunter".into());
        let row = TitleMeta {
            tmdb_id: 63351,
            kind: "tv".into(),
            name: "MINDHUNTER".into(),
            overview: Some("An agent in the FBI's Elite Serial Crime Unit…".into()),
            year: Some(2017),
            rating: Some(8.1),
            runtime: Some(61),
            certification: Some("TV-MA".into()),
            genres: vec!["Drama".into(), "Crime".into()],
            cast: vec![CastMember { name: "Jonathan Groff".into(), role: "Holden Ford".into(), photo: None }],
            poster: Some("artwork/poster.jpg".into()),
            backdrop: Some("artwork/backdrop.jpg".into()),
            logo: None,
            imdb_id: Some("tt4361256".into()),
            manual: false,
            matched: true,
        };
        catalog.store_title_meta(&key, &row);
        let stored = catalog.title_meta(&key).unwrap();
        assert_eq!(stored.name, "MINDHUNTER");
        assert_eq!(stored.year, Some(2017));
        assert_eq!(stored.rating, Some(8.1));
        assert_eq!(stored.genres, vec!["Drama".to_string(), "Crime".to_string()]);
        assert_eq!(stored.cast.len(), 1);
        assert_eq!(stored.imdb_id.as_deref(), Some("tt4361256"));
        assert!(!stored.manual);
        assert!(catalog.titles_missing_metadata().is_empty());
        let counts = catalog.genre_counts();
        assert_eq!(counts, vec![("Crime".into(), 1), ("Drama".into(), 1)]);
        assert_eq!(catalog.titles_with_genre("cri"), vec![key.encode()]);
        // Unmatched titles report nothing.
        assert_eq!(catalog.title_meta(&TitleKey::Movie("/x.mkv".into())), None);
    }

    #[test]
    fn match_status_cool_down_and_review() {
        let (catalog, _guard) = catalog("title_metadata");
        let key = TitleKey::Show("lupin".into());
        assert!(catalog.recently_attempted(&key, 30 * 60_000), "never attempted means eligible");
        catalog.record_match_status(&key, "review");
        assert!(!catalog.recently_attempted(&key, 30 * 60_000), "a fresh attempt cools down");
        assert_eq!(catalog.match_status(&key).map(|(s, _)| s), Some("review".into()));
    }

    #[test]
    fn skip_segments_round_trip_with_duration_clamp() {
        let (catalog, _guard) = catalog("skip_segments");
        let path = Path::new("/tmp/Show.S01E01.mkv");
        let segments = SkipSegments {
            intro: Some(SegmentWindow { start: 0.5, end: 88.0, confidence: None, submission_count: Some(2) }),
            recap: None,
            outro: Some(SegmentWindow { start: 2000.0, end: 2600.0, confidence: None, submission_count: None }),
        };
        catalog.store_segments(path, "tt1234567", &segments, "introdb");
        let read = catalog.stored_segments(path, Some(2500.0));
        assert_eq!(read.intro.unwrap().end, 88.0);
        // The outro overshoots this 2 500 s cut and is dropped at read time.
        assert_eq!(read.outro, None);
        let fresh = catalog.stored_segments(path, Some(2700.0));
        assert!(fresh.outro.is_some());
        assert!(catalog.skip_lookup(path).unwrap().1 > 0);
    }

    #[test]
    fn cache_keys_are_stable() {
        assert_eq!(cache_key("https://x/y"), cache_key("https://x/y"));
        assert_ne!(cache_key("https://x/y"), cache_key("https://x/z"));
    }
}

// MARK: Subtitle search (OpenSubtitles via the Stremio addon, like mobile)

#[derive(Clone, Debug, PartialEq)]
pub struct SubtitleResult {
    pub id: String,
    pub url: String,
    pub language: String,
    pub name: String,
}

const SUBTITLE_MAX_BYTES: usize = 2 * 1024 * 1024;

pub fn subtitle_url_ok(url: &str) -> bool {
    let Some(rest) = url.strip_prefix("https://subs") else { return false };
    let digits = rest.chars().take_while(char::is_ascii_digit).count();
    rest[digits..].starts_with(".strem.io/")
}

/// Parses the addon's `{ subtitles: [...] }`, keeping only valid, unique rows.
pub fn parse_subtitles(value: &Value) -> std::result::Result<Vec<SubtitleResult>, String> {
    let list = value.get("subtitles").and_then(|v| v.as_array()).ok_or("Unexpected response from OpenSubtitles.")?;
    let mut seen = std::collections::HashSet::new();
    let mut out = Vec::new();
    for entry in list {
        let (Some(id), Some(url), Some(lang)) = (entry.get("id").and_then(|v| v.as_str()), entry.get("url").and_then(|v| v.as_str()), entry.get("lang").and_then(|v| v.as_str())) else { continue };
        if !subtitle_url_ok(url) || !seen.insert(id.to_string()) {
            continue;
        }
        let name = entry.get("subtitleFileName").and_then(|v| v.as_str()).filter(|s| !s.is_empty()).map(str::to_string).unwrap_or_else(|| format!("Subtitle {id}"));
        out.push(SubtitleResult { id: id.into(), url: url.into(), language: lang.into(), name });
    }
    Ok(out)
}

pub fn search_subtitles(imdb: &str, episode: Option<(u32, u32)>) -> std::result::Result<Vec<SubtitleResult>, String> {
    if !imdb.starts_with("tt") || !imdb[2..].chars().all(|c| c.is_ascii_digit()) {
        return Err("No IMDb match was found for this title.".into());
    }
    let url = match episode {
        Some((s, e)) => format!("https://opensubtitles-v3.strem.io/subtitles/series/{imdb}:{s}:{e}.json"),
        None => format!("https://opensubtitles-v3.strem.io/subtitles/movie/{imdb}.json"),
    };
    let agent = ureq::AgentBuilder::new().timeout(Duration::from_secs(15)).build();
    let body = agent.get(&url).call().map_err(|_| "Couldn’t reach OpenSubtitles. Try again.".to_string())?.into_string().map_err(|_| "Couldn’t read OpenSubtitles' answer.".to_string())?;
    let value: Value = serde_json::from_str(&body).map_err(|_| "Unexpected response from OpenSubtitles.".to_string())?;
    parse_subtitles(&value)
}

/// Downloads a result next to the video as `{stem}.{lang}.srt` (or into the
/// app's data folder when that folder is read-only), so later scans import it.
pub fn download_subtitle(result: &SubtitleResult, video: &std::path::Path) -> std::result::Result<PathBuf, String> {
    if !subtitle_url_ok(&result.url) {
        return Err("Invalid subtitle download link.".into());
    }
    let agent = ureq::AgentBuilder::new().timeout(Duration::from_secs(20)).build();
    let response = agent.get(&result.url).call().map_err(|_| "Couldn’t download this subtitle.".to_string())?;
    let mut bytes = Vec::new();
    response.into_reader().take(SUBTITLE_MAX_BYTES as u64 + 1).read_to_end(&mut bytes).map_err(|_| "Couldn’t download this subtitle.".to_string())?;
    let text = String::from_utf8_lossy(&bytes);
    if bytes.len() > SUBTITLE_MAX_BYTES || !text.contains("-->") {
        return Err("This result isn’t a readable subtitle file.".into());
    }
    let stem = video.file_stem().map(|s| s.to_string_lossy().into_owned()).unwrap_or_else(|| "subtitle".into());
    let lang: String = result.language.chars().filter(|c| c.is_ascii_alphanumeric()).take(8).collect();
    let file = format!("{stem}.{lang}.srt");
    let beside = video.parent().map(|d| d.join(&file));
    if let Some(path) = beside.filter(|p| std::fs::write(p, &bytes).is_ok()) {
        return Ok(path);
    }
    let fallback = crate::catalog::data_dir().join("subtitles");
    let _ = std::fs::create_dir_all(&fallback);
    let path = fallback.join(file);
    std::fs::write(&path, &bytes).map_err(|_| "Couldn’t save the subtitle.".to_string())?;
    Ok(path)
}
