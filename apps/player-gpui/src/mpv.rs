//! The Rust-callable player interface that replaces the Electron bridge.
//!
//! Electron's renderer talked to libmpv through `@plexy/desktop-bridge` IPC,
//! the main process and an N-API module. Here the UI holds a [`Player`] and a
//! [`Preview`] directly: a handful of typed methods over the C ABI in
//! `native/plexy_mpv.mm`, and a [`PlaybackState`] snapshot that libmpv's event
//! thread keeps current.

use std::ffi::{c_char, c_int, c_void, CStr, CString};
use std::path::{Path, PathBuf};
use std::sync::Arc;

use anyhow::{anyhow, bail, Result};
use parking_lot::Mutex;

#[repr(C)]
struct RawPlayer {
    _private: [u8; 0],
}
#[repr(C)]
struct RawPreview {
    _private: [u8; 0],
}

type EventFn = extern "C" fn(*mut c_void, c_int, *const c_char, *const c_char, f64);

extern "C" {
    fn plexy_player_create(
        libmpv: *const c_char,
        callback: EventFn,
        context: *mut c_void,
        error: *mut c_char,
        error_len: usize,
    ) -> *mut RawPlayer;
    fn plexy_player_attach(player: *mut RawPlayer, gpui_view: *mut c_void) -> c_int;
    fn plexy_player_load(player: *mut RawPlayer, path: *const c_char, start: f64) -> c_int;
    fn plexy_player_command(player: *mut RawPlayer, args: *const *const c_char) -> c_int;
    fn plexy_player_set_property(player: *mut RawPlayer, name: *const c_char, value: *const c_char) -> c_int;
    fn plexy_player_get_property(player: *mut RawPlayer, name: *const c_char) -> *mut c_char;
    fn plexy_player_destroy(player: *mut RawPlayer);
    fn plexy_free(value: *mut c_char);
    fn plexy_error_string(code: c_int) -> *const c_char;
    fn plexy_hide_cursor_until_moved();
    fn plexy_window_frame(gpui_view: *mut c_void, out: *mut f64) -> c_int;
    fn plexy_set_app_icon(bytes: *const u8, len: usize);

    fn plexy_preview_create(
        libmpv: *const c_char,
        path: *const c_char,
        error: *mut c_char,
        error_len: usize,
    ) -> *mut RawPreview;
    fn plexy_preview_frame(
        preview: *mut RawPreview,
        seconds: f64,
        width: c_int,
        height: c_int,
        stride: c_int,
        pixels: *mut c_void,
    ) -> c_int;
    fn plexy_preview_get_property(preview: *mut RawPreview, name: *const c_char) -> *mut c_char;
    fn plexy_preview_destroy(preview: *mut RawPreview);
}

fn mpv_error(code: c_int) -> anyhow::Error {
    let text = unsafe { CStr::from_ptr(plexy_error_string(code)) };
    anyhow!("libmpv: {}", text.to_string_lossy())
}

fn check(code: c_int) -> Result<()> {
    if code < 0 {
        Err(mpv_error(code))
    } else {
        Ok(())
    }
}

fn cstring(value: &str) -> CString {
    CString::new(value.replace('\0', "")).expect("nul bytes removed")
}

/// Finds libmpv the same way the Electron app does: an explicit override, the
/// copy bundled in the app, then Homebrew.
pub fn find_libmpv() -> Result<PathBuf> {
    let mut candidates = Vec::new();
    if let Ok(path) = std::env::var("PLEXY_LIBMPV") {
        candidates.push(PathBuf::from(path));
    }
    if let Ok(exe) = std::env::current_exe() {
        if let Some(contents) = exe.parent().and_then(Path::parent) {
            candidates.push(contents.join("Resources/bin/mpv-libs/libmpv.2.dylib"));
            candidates.push(contents.join("Frameworks/libmpv.2.dylib"));
        }
    }
    candidates.push("/opt/homebrew/opt/mpv/lib/libmpv.2.dylib".into());
    candidates.push("/opt/homebrew/lib/libmpv.2.dylib".into());
    candidates
        .into_iter()
        .find(|path| path.exists())
        .ok_or_else(|| anyhow!("libmpv was not found. Install it with `brew install mpv` or set PLEXY_LIBMPV."))
}

/// Accepts only an existing regular file and returns its absolute path. URLs
/// never reach libmpv, which keeps the player strictly local.
pub fn local_media_path(path: &Path) -> Result<PathBuf> {
    let absolute = std::fs::canonicalize(path).map_err(|error| anyhow!("{}: {error}", path.display()))?;
    if !absolute.is_file() {
        bail!("{} is not a file", absolute.display());
    }
    Ok(absolute)
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum TrackKind {
    Video,
    Audio,
    Subtitle,
}

#[derive(Clone, Debug)]
pub struct Track {
    pub id: i64,
    pub kind: TrackKind,
    pub title: Option<String>,
    pub lang: Option<String>,
    pub codec: Option<String>,
    pub channels: Option<String>,
    pub external: bool,
    pub forced: bool,
}

impl Track {
    /// "English · AAC 5.1", "Japanese · Commentary", "Sidecar · English (SRT)".
    pub fn label(&self) -> String {
        let language = self.lang.as_deref().map(language_name);
        let mut parts: Vec<String> = Vec::new();
        match (&self.title, language) {
            (Some(title), Some(lang)) if !title.eq_ignore_ascii_case(&lang) => {
                parts.push(lang);
                parts.push(title.clone());
            }
            (Some(title), _) => parts.push(title.clone()),
            (None, Some(lang)) => parts.push(lang),
            (None, None) => parts.push(format!("Track {}", self.id)),
        }
        parts.join(" · ")
    }

    pub fn detail(&self) -> String {
        let mut parts = Vec::new();
        if let Some(codec) = &self.codec {
            parts.push(codec_name(codec));
        }
        if let Some(channels) = &self.channels {
            parts.push(channels.clone());
        }
        if self.external {
            parts.push("Sidecar".into());
        }
        if self.forced {
            parts.push("Forced".into());
        }
        parts.join(" · ")
    }
}

fn codec_name(codec: &str) -> String {
    match codec {
        "subrip" => "SRT".into(),
        "ass" | "ssa" => "ASS".into(),
        "mov_text" => "TX3G".into(),
        "webvtt" => "WebVTT".into(),
        "hdmv_pgs_subtitle" => "PGS".into(),
        "dvd_subtitle" => "VobSub".into(),
        "eac3" => "E-AC-3".into(),
        other => other.to_uppercase(),
    }
}

pub fn language_name(code: &str) -> String {
    match code.to_ascii_lowercase().as_str() {
        "en" | "eng" => "English",
        "ja" | "jpn" => "Japanese",
        "es" | "spa" => "Spanish",
        "fr" | "fre" | "fra" => "French",
        "de" | "ger" | "deu" => "German",
        "it" | "ita" => "Italian",
        "pt" | "por" => "Portuguese",
        "ko" | "kor" => "Korean",
        "zh" | "chi" | "zho" => "Chinese",
        "hi" | "hin" => "Hindi",
        "ru" | "rus" => "Russian",
        "und" => "Unknown",
        _ => return code.to_string(),
    }
    .to_string()
}

#[derive(Clone, Debug)]
pub struct Chapter {
    pub title: String,
    pub time: f64,
}

/// What the UI renders. Written by libmpv's event thread, read by GPUI.
#[derive(Clone, Debug)]
pub struct PlaybackState {
    pub position: f64,
    pub duration: f64,
    pub buffered: f64,
    pub paused: bool,
    pub buffering: bool,
    pub ended: bool,
    pub volume: f64,
    pub muted: bool,
    pub speed: f64,
    pub audio_id: Option<i64>,
    pub subtitle_id: Option<i64>,
    pub subtitle_delay: f64,
    pub subtitle_position: f64,
    pub title: Option<String>,
    pub tracks: Vec<Track>,
    pub chapters: Vec<Chapter>,
    pub loaded: bool,
    pub error: Option<String>,
    /// Bumped on every change so the UI can skip identical frames.
    pub revision: u64,
    tracks_dirty: bool,
    chapters_dirty: bool,
}

impl Default for PlaybackState {
    fn default() -> Self {
        Self {
            position: 0.0,
            duration: 0.0,
            buffered: 0.0,
            paused: true,
            buffering: false,
            ended: false,
            volume: 100.0,
            muted: false,
            speed: 1.0,
            audio_id: None,
            subtitle_id: None,
            subtitle_delay: 0.0,
            subtitle_position: 100.0,
            title: None,
            tracks: Vec::new(),
            chapters: Vec::new(),
            loaded: false,
            error: None,
            revision: 0,
            tracks_dirty: false,
            chapters_dirty: false,
        }
    }
}

impl PlaybackState {
    pub fn tracks_of(&self, kind: TrackKind) -> impl Iterator<Item = &Track> {
        self.tracks.iter().filter(move |track| track.kind == kind)
    }
}

type Shared = Arc<Mutex<PlaybackState>>;

extern "C" fn on_event(context: *mut c_void, kind: c_int, name: *const c_char, text: *const c_char, number: f64) {
    // SAFETY: `context` is the `Arc` leaked in `Player::new` and reclaimed in
    // `Drop` only after the native event thread has been joined.
    let state = unsafe { &*(context as *const Mutex<PlaybackState>) };
    let name = unsafe { CStr::from_ptr(name) }.to_string_lossy();
    let text = unsafe { CStr::from_ptr(text) }.to_string_lossy();
    let mut state = state.lock();
    state.revision += 1;
    match (kind, name.as_ref()) {
        (1, "time-pos") => state.position = number,
        (1, "duration") => state.duration = number,
        (1, "demuxer-cache-time") => state.buffered = number,
        (1, "volume") => state.volume = number,
        (1, "speed") => state.speed = number,
        (1, "sub-delay") => state.subtitle_delay = number,
        (1, "sub-pos") => state.subtitle_position = number,
        (2, "pause") => state.paused = number != 0.0,
        (2, "paused-for-cache") => state.buffering = number != 0.0,
        (2, "mute") => state.muted = number != 0.0,
        (2, "eof-reached") => state.ended = number != 0.0,
        (3, "aid") => state.audio_id = Some(number as i64),
        (3, "sid") => state.subtitle_id = Some(number as i64),
        // "no"/"auto" cannot be read as an integer: libmpv reports no value.
        (4, "changed:aid") => state.audio_id = None,
        (4, "changed:sid") => state.subtitle_id = None,
        (6, "media-title") => state.title = Some(text.into_owned()),
        (4, "loaded") => {
            state.loaded = true;
            state.ended = false;
            state.error = None;
        }
        (4, "ended") => state.ended = true,
        (4, "changed:track-list") => state.tracks_dirty = true,
        (4, "changed:chapter-list") => state.chapters_dirty = true,
        (5, _) => state.error = Some(text.into_owned()),
        _ => {}
    }
}

/// The playback core. Every method is cheap and non-blocking except where
/// libmpv itself blocks briefly on a command.
pub struct Player {
    raw: *mut RawPlayer,
    state: Shared,
    context: *const Mutex<PlaybackState>,
}

// libmpv's client API is thread-safe; the AppKit pieces are main-thread-only
// and are only reached through `attach`, which checks.
unsafe impl Send for Player {}
unsafe impl Sync for Player {}

impl Player {
    pub fn new(libmpv: &Path) -> Result<Self> {
        let state: Shared = Arc::new(Mutex::new(PlaybackState::default()));
        let context = Arc::into_raw(state.clone());
        let lib = cstring(&libmpv.to_string_lossy());
        let mut error = [0 as c_char; 512];
        let raw = unsafe { plexy_player_create(lib.as_ptr(), on_event, context as *mut c_void, error.as_mut_ptr(), error.len()) };
        if raw.is_null() {
            unsafe { drop(Arc::from_raw(context)) };
            let message = unsafe { CStr::from_ptr(error.as_ptr()) }.to_string_lossy().into_owned();
            bail!(message);
        }
        Ok(Self { raw, state, context })
    }

    /// Places the video surface under `gpui_view` (the window's GPUI NSView).
    pub fn attach(&self, gpui_view: *mut c_void) -> Result<()> {
        match unsafe { plexy_player_attach(self.raw, gpui_view) } {
            0 => Ok(()),
            code => bail!("Could not attach the video surface ({code})"),
        }
    }

    pub fn load(&self, path: &Path, start: f64) -> Result<()> {
        let path = local_media_path(path)?;
        {
            let mut state = self.state.lock();
            *state = PlaybackState { revision: state.revision + 1, ..PlaybackState::default() };
        }
        let path = cstring(&path.to_string_lossy());
        check(unsafe { plexy_player_load(self.raw, path.as_ptr(), start) })
    }

    /// A snapshot for rendering. Track and chapter lists are re-read lazily
    /// after libmpv reports that they changed.
    pub fn snapshot(&self) -> PlaybackState {
        let (tracks_dirty, chapters_dirty) = {
            let state = self.state.lock();
            (state.tracks_dirty, state.chapters_dirty)
        };
        if tracks_dirty {
            let tracks = self.read_tracks();
            let mut state = self.state.lock();
            state.tracks = tracks;
            state.tracks_dirty = false;
            state.revision += 1;
        }
        if chapters_dirty {
            let chapters = self.read_chapters();
            let mut state = self.state.lock();
            state.chapters = chapters;
            state.chapters_dirty = false;
            state.revision += 1;
        }
        self.state.lock().clone()
    }

    pub fn command(&self, args: &[&str]) -> Result<()> {
        let owned: Vec<CString> = args.iter().map(|arg| cstring(arg)).collect();
        let mut pointers: Vec<*const c_char> = owned.iter().map(|arg| arg.as_ptr()).collect();
        pointers.push(std::ptr::null());
        check(unsafe { plexy_player_command(self.raw, pointers.as_ptr()) })
    }

    pub fn set(&self, name: &str, value: &str) -> Result<()> {
        let (name, value) = (cstring(name), cstring(value));
        check(unsafe { plexy_player_set_property(self.raw, name.as_ptr(), value.as_ptr()) })
    }

    pub fn get(&self, name: &str) -> Option<String> {
        let name = cstring(name);
        let raw = unsafe { plexy_player_get_property(self.raw, name.as_ptr()) };
        if raw.is_null() {
            return None;
        }
        let value = unsafe { CStr::from_ptr(raw) }.to_string_lossy().into_owned();
        unsafe { plexy_free(raw) };
        Some(value)
    }

    // Typed playback commands (the same set the Electron bridge exposed).

    pub fn set_paused(&self, paused: bool) -> Result<()> {
        self.set("pause", if paused { "yes" } else { "no" })
    }
    pub fn toggle_pause(&self) -> Result<()> {
        let state = self.state.lock().clone();
        if state.ended {
            self.seek_to(0.0)?;
            return self.set_paused(false);
        }
        self.set_paused(!state.paused)
    }
    pub fn seek_to(&self, seconds: f64) -> Result<()> {
        self.command(&["seek", &format!("{:.3}", seconds.max(0.0)), "absolute+exact"])
    }
    pub fn seek_by(&self, delta: f64) -> Result<()> {
        let state = self.state.lock().clone();
        let mut target = state.position + delta;
        if state.duration > 0.0 {
            target = target.min(state.duration);
        }
        self.seek_to(target.max(0.0))
    }
    pub fn set_volume(&self, volume: f64) -> Result<()> {
        self.set("volume", &format!("{:.0}", volume.clamp(0.0, 100.0)))
    }
    pub fn set_muted(&self, muted: bool) -> Result<()> {
        self.set("mute", if muted { "yes" } else { "no" })
    }
    pub fn set_speed(&self, speed: f64) -> Result<()> {
        self.set("speed", &format!("{speed:.2}"))
    }
    pub fn select_audio(&self, id: i64) -> Result<()> {
        self.set("aid", &id.to_string())
    }
    pub fn select_subtitle(&self, id: Option<i64>) -> Result<()> {
        match id {
            Some(id) => self.set("sid", &id.to_string()),
            None => self.set("sid", "no"),
        }
    }
    pub fn add_subtitle(&self, path: &Path) -> Result<()> {
        let path = local_media_path(path)?;
        self.command(&["sub-add", &path.to_string_lossy(), "select"])
    }
    pub fn set_subtitle_delay(&self, seconds: f64) -> Result<()> {
        self.set("sub-delay", &format!("{seconds:.3}"))
    }
    pub fn set_subtitle_position(&self, percent: f64) -> Result<()> {
        self.set("sub-pos", &format!("{:.0}", percent.clamp(0.0, 150.0)))
    }

    fn read_tracks(&self) -> Vec<Track> {
        let count: usize = self.get("track-list/count").and_then(|v| v.parse().ok()).unwrap_or(0);
        (0..count)
            .filter_map(|index| {
                let field = |name: &str| self.get(&format!("track-list/{index}/{name}")).filter(|v| !v.is_empty());
                let kind = match field("type")?.as_str() {
                    "video" => TrackKind::Video,
                    "audio" => TrackKind::Audio,
                    "sub" => TrackKind::Subtitle,
                    _ => return None,
                };
                if kind == TrackKind::Video && field("albumart").as_deref() == Some("yes") {
                    return None;
                }
                Some(Track {
                    id: field("id")?.parse().ok()?,
                    kind,
                    // Sidecar files get their file name as a title; the
                    // language and "Sidecar" detail say more.
                    title: field("title").filter(|title| {
                        field("external").as_deref() != Some("yes") || !title.contains('.')
                    }),
                    lang: field("lang"),
                    codec: field("codec"),
                    channels: field("demux-channel-count").and_then(|n| n.parse::<u32>().ok()).map(|count| {
                        match count {
                            1 => "Mono".into(),
                            2 => "Stereo".into(),
                            6 => "5.1".into(),
                            8 => "7.1".into(),
                            n => format!("{n} ch"),
                        }
                    }),
                    external: field("external").as_deref() == Some("yes"),
                    forced: field("forced").as_deref() == Some("yes"),
                })
            })
            .collect()
    }

    fn read_chapters(&self) -> Vec<Chapter> {
        let count: usize = self.get("chapter-list/count").and_then(|v| v.parse().ok()).unwrap_or(0);
        (0..count)
            .filter_map(|index| {
                let time = self.get(&format!("chapter-list/{index}/time"))?.parse().ok()?;
                let title = self
                    .get(&format!("chapter-list/{index}/title"))
                    .filter(|t| !t.is_empty())
                    .unwrap_or_else(|| format!("Chapter {}", index + 1));
                Some(Chapter { title, time })
            })
            .collect()
    }
}

impl Drop for Player {
    fn drop(&mut self) {
        unsafe {
            plexy_player_destroy(self.raw);
            drop(Arc::from_raw(self.context));
        }
    }
}

/// The window frame as (x, y, width, height) in top-left screen points.
pub fn window_frame(gpui_view: *mut c_void) -> Option<[f64; 4]> {
    let mut out = [0.0; 4];
    (unsafe { plexy_window_frame(gpui_view, out.as_mut_ptr()) } == 0).then_some(out)
}

pub fn hide_cursor_until_moved() {
    unsafe { plexy_hide_cursor_until_moved() }
}

/// A preview frame: BGRA pixels, alpha forced opaque.
#[derive(Clone)]
pub struct PreviewFrame {
    pub seconds: f64,
    pub width: u32,
    pub height: u32,
    pub bgra: Vec<u8>,
}

/// Headless preview core over the same file. Independent of [`Player`]:
/// it has its own demuxer and decoder and never touches playback state.
pub struct Preview {
    raw: *mut RawPreview,
    width: u32,
    height: u32,
}

unsafe impl Send for Preview {}

impl Preview {
    /// Opens `path` for previews whose longest side is `max_side` pixels.
    pub fn open(libmpv: &Path, path: &Path, max_side: u32) -> Result<Self> {
        let path = local_media_path(path)?;
        let lib = cstring(&libmpv.to_string_lossy());
        let media = cstring(&path.to_string_lossy());
        let mut error = [0 as c_char; 512];
        let raw = unsafe { plexy_preview_create(lib.as_ptr(), media.as_ptr(), error.as_mut_ptr(), error.len()) };
        if raw.is_null() {
            let message = unsafe { CStr::from_ptr(error.as_ptr()) }.to_string_lossy().into_owned();
            bail!(message);
        }
        let mut preview = Self { raw, width: max_side, height: max_side * 9 / 16 };
        // The first frame loads the file; afterwards the video size is known.
        let _ = preview.frame(0.0);
        let dimension = |name: &str| {
            let name = cstring(name);
            let raw = unsafe { plexy_preview_get_property(preview.raw, name.as_ptr()) };
            if raw.is_null() {
                return None;
            }
            let value = unsafe { CStr::from_ptr(raw) }.to_string_lossy().parse::<f64>().ok();
            unsafe { plexy_free(raw) };
            value
        };
        if let (Some(w), Some(h)) = (dimension("video-params/dw"), dimension("video-params/dh")) {
            if w > 0.0 && h > 0.0 {
                let scale = max_side as f64 / w.max(h);
                preview.width = ((w * scale).round() as u32).max(2) & !1;
                preview.height = ((h * scale).round() as u32).max(2) & !1;
            }
        }
        Ok(preview)
    }

    pub fn frame(&mut self, seconds: f64) -> Result<PreviewFrame> {
        let stride = self.width as usize * 4;
        let mut pixels = vec![0u8; stride * self.height as usize];
        check(unsafe {
            plexy_preview_frame(
                self.raw,
                seconds,
                self.width as c_int,
                self.height as c_int,
                stride as c_int,
                pixels.as_mut_ptr() as *mut c_void,
            )
        })?;
        for alpha in pixels.iter_mut().skip(3).step_by(4) {
            *alpha = 255;
        }
        Ok(PreviewFrame { seconds, width: self.width, height: self.height, bgra: pixels })
    }
}

impl Drop for Preview {
    fn drop(&mut self) {
        unsafe { plexy_preview_destroy(self.raw) }
    }
}

/// Shows Plexy's app icon in the Dock when running an unbundled binary.
pub fn set_app_icon() {
    static ICON: &[u8] = include_bytes!(concat!(env!("CARGO_MANIFEST_DIR"), "/../../build/icon.png"));
    unsafe { plexy_set_app_icon(ICON.as_ptr(), ICON.len()) }
}
