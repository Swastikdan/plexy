//! Local media identification and watch progress.
//!
//! Identification works offline from the file name (and folder name for
//! "Season 1" style layouts): `Show.Name.S01E02.Episode.Title.1080p...mkv`,
//! `Show Name - 1x02 - Title.mp4`, `Movie Title (2019).mkv`.
//!
//! Progress is a small tab-separated file in Application Support, keyed by
//! the canonical path and size. It never touches the media folder.

use std::path::{Path, PathBuf};
use std::sync::OnceLock;

use regex::Regex;

pub const VIDEO_EXTENSIONS: [&str; 12] = ["mkv", "mp4", "m4v", "mov", "avi", "webm", "ts", "m2ts", "wmv", "flv", "mpg", "mpeg"];

#[derive(Clone, Debug, PartialEq)]
pub enum Kind {
    Episode { season: u32, episode: u32, episode_title: Option<String> },
    Movie { year: Option<u32> },
    Unknown,
}

#[derive(Clone, Debug)]
pub struct Identity {
    pub title: String,
    pub kind: Kind,
}

impl Identity {
    /// Second line under the title: "S1 E1 Welcome to Margrave" or "2019".
    pub fn subtitle(&self) -> Option<String> {
        match &self.kind {
            Kind::Episode { season, episode, episode_title } => Some(match episode_title {
                Some(name) => format!("S{season} E{episode} {name}"),
                None => format!("S{season} E{episode}"),
            }),
            Kind::Movie { year: Some(year) } => Some(year.to_string()),
            _ => None,
        }
    }
}

fn episode_re() -> &'static Regex {
    static RE: OnceLock<Regex> = OnceLock::new();
    RE.get_or_init(|| Regex::new(r"(?i)(?:^|[\s._\-\[(])s(\d{1,2})[\s._\-]?e(\d{1,3})|(?:^|[\s._\-])(\d{1,2})x(\d{2,3})(?:[\s._\-]|$)").unwrap())
}

fn year_re() -> &'static Regex {
    static RE: OnceLock<Regex> = OnceLock::new();
    RE.get_or_init(|| Regex::new(r"[\s._(\[](19\d{2}|20\d{2})(?:[\s._)\]]|$)").unwrap())
}

fn junk_re() -> &'static Regex {
    static RE: OnceLock<Regex> = OnceLock::new();
    RE.get_or_init(|| {
        Regex::new(
            r"(?i)[\s._\-\[(](?:2160p|1080p|720p|576p|480p|4k|uhd|hdr\d*|dv|10bit|8bit|x26[45]|h\.?26[45]|hevc|avc|av1|web[\s._-]?dl|webrip|web|bluray|blu-ray|brrip|bdrip|hdtv|dvdrip|remux|proper|repack|amzn|nf|dsnp|hmax|atvp|aac\d?|ac3|eac3|ddp?\d?|dts|atmos|truehd|multi|dual|msubs?|esubs?|hindi|english|french|subbed|dubbed)(?:[\s._\-\])]|$).*$",
        )
        .unwrap()
    })
}

fn clean(text: &str) -> String {
    let text = text.replace(['.', '_'], " ");
    let text = text.trim_matches(|c: char| c == '-' || c == ' ' || c == '[' || c == '(' || c.is_whitespace());
    text.split_whitespace().collect::<Vec<_>>().join(" ")
}

fn strip_junk(text: &str) -> String {
    let padded = format!(" {text}");
    clean(&junk_re().replace(&padded, ""))
}

pub fn identify(path: &Path) -> Identity {
    let stem = path.file_stem().map(|s| s.to_string_lossy().into_owned()).unwrap_or_default();
    // Release-group suffixes in brackets add nothing.
    let stem = Regex::new(r"\[[^\]]*\]").unwrap().replace_all(&stem, " ").into_owned();

    if let Some(caps) = episode_re().captures(&stem) {
        let (season, episode) = match (caps.get(1), caps.get(2), caps.get(3), caps.get(4)) {
            (Some(s), Some(e), _, _) | (_, _, Some(s), Some(e)) => (s.as_str().parse().unwrap_or(1), e.as_str().parse().unwrap_or(1)),
            _ => (1, 1),
        };
        let whole = caps.get(0).unwrap();
        let mut title = strip_junk(&stem[..whole.start()]);
        if title.is_empty() {
            // "Season 1/01 - Pilot.mkv": take the show from the folders.
            title = path
                .ancestors()
                .skip(1)
                .filter_map(|dir| dir.file_name().map(|n| n.to_string_lossy().into_owned()))
                .find(|name| !name.to_lowercase().starts_with("season"))
                .map(|name| strip_junk(&name))
                .unwrap_or_default();
        }
        let rest = strip_junk(&stem[whole.end()..]);
        let rest = rest.trim_start_matches(|c: char| c == '-' || c.is_whitespace()).to_string();
        let episode_title = (!rest.is_empty() && !rest.chars().all(|c| c.is_ascii_digit())).then_some(rest);
        return Identity { title: strip_year(&title), kind: Kind::Episode { season, episode, episode_title } };
    }

    if let Some(caps) = year_re().captures(&stem) {
        let year = caps.get(1).unwrap();
        let title = strip_junk(&stem[..year.start()]);
        if !title.is_empty() {
            return Identity { title, kind: Kind::Movie { year: year.as_str().parse().ok() } };
        }
    }
    let title = strip_junk(&stem);
    Identity { title: if title.is_empty() { stem } else { title }, kind: Kind::Unknown }
}

fn strip_year(title: &str) -> String {
    let padded = format!("{title} ");
    let stripped = clean(&year_re().replace(&padded, " "));
    if stripped.is_empty() { title.to_string() } else { stripped }
}

pub fn is_video(path: &Path) -> bool {
    path.extension()
        .and_then(|e| e.to_str())
        .is_some_and(|e| VIDEO_EXTENSIONS.contains(&e.to_ascii_lowercase().as_str()))
}

/// The next episode of the same show in the same folder (or a sibling
/// "Season N+1" folder), by season and episode number.
pub fn next_episode(path: &Path) -> Option<PathBuf> {
    let current = identify(path);
    let Kind::Episode { season, episode, .. } = current.kind else { return None };
    let dir = path.parent()?;
    let mut candidates: Vec<(u32, u32, PathBuf)> = Vec::new();
    let mut scan = |folder: &Path| {
        if let Ok(entries) = std::fs::read_dir(folder) {
            for entry in entries.flatten() {
                let candidate = entry.path();
                if !is_video(&candidate) || candidate == path {
                    continue;
                }
                let id = identify(&candidate);
                if let Kind::Episode { season: s, episode: e, .. } = id.kind {
                    if id.title.eq_ignore_ascii_case(&current.title) && (s, e) > (season, episode) {
                        candidates.push((s, e, candidate));
                    }
                }
            }
        }
    };
    scan(dir);
    if let Some(parent) = dir.parent() {
        if dir.file_name().is_some_and(|n| n.to_string_lossy().to_lowercase().starts_with("season")) {
            if let Ok(entries) = std::fs::read_dir(parent) {
                for entry in entries.flatten() {
                    if entry.path().is_dir() && entry.path() != dir {
                        scan(&entry.path());
                    }
                }
            }
        }
    }
    candidates.sort_by_key(|(s, e, _)| (*s, *e));
    candidates.into_iter().next().map(|(_, _, p)| p)
}

// MARK: - Watch progress

#[derive(Clone, Copy, Debug, Default)]
pub struct Progress {
    pub position: f64,
    pub duration: f64,
    pub updated: u64,
}

impl Progress {
    pub fn fraction(&self) -> f64 {
        if self.duration > 0.0 { (self.position / self.duration).clamp(0.0, 1.0) } else { 0.0 }
    }
    /// Finished: past 92%, or within the credits (last two minutes) of
    /// anything longer than twenty minutes.
    pub fn watched(&self) -> bool {
        self.duration > 0.0 && (self.fraction() >= 0.92 || (self.duration > 1200.0 && self.duration - self.position < 120.0))
    }
    /// Worth offering to resume.
    pub fn resumable(&self) -> bool {
        self.position >= 30.0 && !self.watched()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn identifies_scene_episode() {
        let id = identify(Path::new("/m/Reacher.S01E01.Welcome.to.Margrave.1080p.AMZN.WEB-DL.mkv"));
        assert_eq!(id.title, "Reacher");
        assert_eq!(id.subtitle().unwrap(), "S1 E1 Welcome to Margrave");
    }

    #[test]
    fn identifies_episode_without_name() {
        let id = identify(Path::new("/m/Lupin.S01E01.1080p.10Bit.Hindi.English.French.Msubs.MoviesMod.org.mkv"));
        assert_eq!(id.title, "Lupin");
        assert_eq!(id.subtitle().unwrap(), "S1 E1");
    }

    #[test]
    fn identifies_x_style_and_movie() {
        let id = identify(Path::new("/m/The Office - 2x05 - Halloween.mp4"));
        assert_eq!((id.title.as_str(), id.subtitle().unwrap().as_str()), ("The Office", "S2 E5 Halloween"));
        let movie = identify(Path::new("/m/Knives.Out.2019.2160p.BluRay.x265.mkv"));
        assert_eq!((movie.title.as_str(), movie.kind), ("Knives Out", Kind::Movie { year: Some(2019) }));
    }

    #[test]
    fn finds_next_episode() {
        let dir = std::env::temp_dir().join(format!("plexy-next-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        for name in ["Show.S01E01.mkv", "Show.S01E02.mkv", "Show.S01E10.mkv", "Other.S01E02.mkv"] {
            std::fs::write(dir.join(name), b"").unwrap();
        }
        assert_eq!(next_episode(&dir.join("Show.S01E01.mkv")), Some(dir.join("Show.S01E02.mkv")));
        assert_eq!(next_episode(&dir.join("Show.S01E02.mkv")), Some(dir.join("Show.S01E10.mkv")));
        assert_eq!(next_episode(&dir.join("Show.S01E10.mkv")), None);
        std::fs::remove_dir_all(dir).unwrap();
    }
}
