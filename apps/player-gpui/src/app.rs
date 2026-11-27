//! The player window: GPUI chrome drawn over the libmpv surface.
//!
//! Layout and behaviour follow the web player's cinema controls
//! (apps/web/src/components/videojs/video/layout/controls.tsx): a full-width
//! seek line with thumbnail previews, transport and time on the left,
//! utilities on the right, a gradient backdrop, and auto-hiding chrome.

use std::cell::Cell;
use std::path::{Path, PathBuf};
use std::rc::Rc;
use std::sync::Arc;
use std::time::{Duration, Instant};

use gpui::{
    canvas, div, img, linear_color_stop, linear_gradient, point, prelude::*, px, rgba, size, svg, App, Bounds,
    ClickEvent, Context, ExternalPaths, FocusHandle, Hsla, KeyDownEvent, KeyUpEvent, MouseButton, MouseDownEvent,
    MouseMoveEvent, MouseUpEvent, PathPromptOptions, Pixels, Point, RenderImage, ScrollWheelEvent, SharedString,
    Window,
};
use image::{Frame, RgbaImage};

use crate::catalog::{Catalog, Item, Library, Personal, TitleKey};
use crate::personal_ui::{Sort, WatchFilter};
use crate::library_ui::Screen;
use crate::media::{self, Identity};
use crate::mpv::{self, PlaybackState, Player, TrackKind};
use crate::theme;
use crate::preview::{self, PreviewService};

const HIDE_AFTER: Duration = Duration::from_millis(2600);
const SUBTITLE_EXTENSIONS: [&str; 6] = ["srt", "ass", "ssa", "vtt", "sub", "sup"];
const PREVIEW_WIDTH: f32 = 208.0;

#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum Menu {
    Audio,
    Subtitles,
    Speed,
    Chapters,
    /// Online subtitle search for the open file.
    SubtitleSearch,
    /// Subtitle size, look, sync and position.
    SubtitleStyle,
    /// The Settings root: rows that drill into the pages above.
    More,
}

/// Online subtitle search state, written by worker threads.
#[derive(Clone, Default)]
pub struct SubSearch {
    pub file: Option<PathBuf>,
    pub loading: bool,
    pub error: Option<String>,
    pub results: Vec<crate::metadata::SubtitleResult>,
    pub language: Option<String>,
    /// A finished download waiting for the UI thread to load it into mpv.
    pub ready: Option<PathBuf>,
    pub downloading: Option<String>,
}

#[derive(Clone)]
struct Osd {
    icon: &'static str,
    text: SharedString,
    at: Instant,
}

#[derive(Clone, Copy)]
struct HeldSeek {
    key: char,
    started: Instant,
}

/// Seconds the "Playing next" card waits before autoplay.
const AUTOPLAY_COUNTDOWN: Duration = Duration::from_secs(8);

pub struct PlayerView {
    pub player: Player,
    libmpv: Option<PathBuf>,
    pub media: Option<PathBuf>,
    previews: Option<PreviewService>,
    pub state: PlaybackState,
    focus: FocusHandle,
    pub gpui_view: usize,

    last_activity: Instant,
    controls_opacity: f32,
    cursor_hidden: bool,
    subs_raised: bool,
    pub menu: Option<Menu>,
    over_controls: bool,
    volume_hover: bool,
    volume_hover_until: Option<Instant>,
    dragging_volume: bool,
    osd: Option<Osd>,
    held_seek: Option<HeldSeek>,
    last_subtitle: Option<i64>,

    seek_bounds: Rc<Cell<Bounds<Pixels>>>,
    volume_bounds: Rc<Cell<Bounds<Pixels>>>,
    /// Pointer position over the seek bar as a fraction of the duration.
    pub hover_fraction: Option<f32>,
    /// Set while the seek thumb is being dragged. Playback is only moved when
    /// the drag ends; until then the preview shows where it would land.
    pub scrub_fraction: Option<f32>,
    preview_image: Option<(i64, Arc<RenderImage>)>,
    retired_images: Vec<Arc<RenderImage>>,
    /// Keeps the chrome up regardless of activity (self-test screenshots).
    pub pin_controls: bool,
    pub identity: Option<Identity>,
    pub next_episode: Option<PathBuf>,
    pub catalog: Catalog,
    pub screen: Screen,
    pub libraries: Vec<Library>,
    pub items: Vec<Item>,
    pub personal: Personal,
    pub search_query: String,
    pub search_focus: FocusHandle,
    pub collection_draft: String,
    pub collection_focus: FocusHandle,
    pub collection_picker: bool,
    pub collection_target: Option<TitleKey>,
    pub sort: Sort,
    pub watch_filter: WatchFilter,
    pub hero_index: usize,
    pub hero_paused: bool,
    pub hero_since: Instant,
    pub hero_prev: Option<usize>,
    pub shell_scroll: gpui::ScrollHandle,
    pub metas: std::collections::HashMap<TitleKey, crate::catalog::TitleMeta>,
    pub token_draft: String,
    pub token_focus: FocusHandle,
    /// (ok, message) from the last token check; written by a worker thread.
    pub token_status: Arc<parking_lot::Mutex<(bool, String)>>,
    token_seen: String,
    /// IntroDB markers for the open file; filled at open and by the lookup thread.
    pub segments: Arc<parking_lot::Mutex<Option<(PathBuf, crate::catalog::SkipSegments)>>>,
    /// Autoplay countdown start once the episode ends; `None` when idle.
    pub autoplay_at: Option<Instant>,
    pub autoplay_cancelled: bool,
    /// The window was already fullscreen when playback started (from the
    /// library), so closing the player keeps it fullscreen.
    fullscreen_before_play: bool,
    pub last_screen: std::cell::RefCell<Option<Screen>>,
    pub sub_search: Arc<parking_lot::Mutex<SubSearch>>,
    autoplay_fired: bool,
    pub episode_metas: std::collections::HashMap<PathBuf, crate::catalog::EpisodeMeta>,
    metadata_epoch: u64,
    pub settings_section: crate::shell_ui::SettingsSection,
    pub selected_season: Option<u32>,
    pub open_select: Option<&'static str>,
    pub hovered_card: Option<SharedString>,
    pub left_card: Option<SharedString>,
    scan_progress: (u64, usize, bool),
    last_auto_scan: Instant,
    last_saved: Instant,
    last_saved_position: Option<f64>,
    was_paused: bool,
    sub_was_busy: bool,
    autoplay_enabled: bool,
    observed_segments: crate::catalog::SkipSegments,
}

impl PlayerView {
    pub fn new(gpui_view: usize, catalog: Catalog, cx: &mut Context<Self>) -> Self {
        let mut view = Self {
            player: Player::default(),
            libmpv: None,
            media: None,
            previews: None,
            state: PlaybackState::default(),
            focus: cx.focus_handle(),
            gpui_view,
            last_activity: Instant::now(),
            controls_opacity: 1.0,
            cursor_hidden: false,
            subs_raised: false,
            menu: None,
            over_controls: false,
            volume_hover: false,
            volume_hover_until: None,
            dragging_volume: false,
            osd: None,
            held_seek: None,
            last_subtitle: None,
            seek_bounds: Rc::new(Cell::new(Bounds::default())),
            volume_bounds: Rc::new(Cell::new(Bounds::default())),
            hover_fraction: None,
            scrub_fraction: None,
            preview_image: None,
            retired_images: Vec::new(),
            pin_controls: false,
            identity: None,
            next_episode: None,
            catalog: catalog.clone(),
            screen: Screen::from_env(),
            libraries: Vec::new(),
            items: Vec::new(),
            personal: Personal::default(),
            search_query: std::env::var("PLEXY_SCREEN").ok().and_then(|s| s.strip_prefix("search:").map(str::to_string)).unwrap_or_default(),
            search_focus: cx.focus_handle(),
            collection_draft: String::new(),
            collection_focus: cx.focus_handle(),
            collection_picker: false,
            collection_target: None,
            sort: Sort::Added,
            watch_filter: WatchFilter::All,
            hero_index: 0,
            hero_paused: false,
            hero_since: Instant::now(),
            hero_prev: None,
            shell_scroll: gpui::ScrollHandle::new(),
            metas: Default::default(),
            episode_metas: Default::default(),
            token_draft: String::new(),
            token_seen: String::new(),
            segments: Default::default(),
            autoplay_at: None,
            autoplay_cancelled: false,
            fullscreen_before_play: false,
            last_screen: Default::default(),
            sub_search: Default::default(),
            autoplay_fired: false,
            token_focus: cx.focus_handle(),
            token_status: Default::default(),
            metadata_epoch: catalog.metadata_epoch(),
            settings_section: if std::env::var("PLEXY_SCREEN").as_deref() == Ok("appearance") { crate::shell_ui::SettingsSection::Appearance } else { crate::shell_ui::SettingsSection::Playback },
            selected_season: None,
            open_select: None,
            hovered_card: None,
            left_card: None,
            scan_progress: (0, 0, false),
            last_auto_scan: Instant::now(),
            last_saved: Instant::now(),
            last_saved_position: None,
            was_paused: true,
            sub_was_busy: false,
            autoplay_enabled: false,
            observed_segments: Default::default(),
        };
        view.reload_catalog();
        view
    }

    pub fn focus_handle(&self) -> &FocusHandle {
        &self.focus
    }

    pub fn previews(&self) -> Option<&PreviewService> {
        self.previews.as_ref()
    }

    /// Opens a local file: playback and the independent preview core.
    pub fn open(&mut self, path: &Path, window: &mut Window, cx: &mut Context<Self>) {
        self.open_at(path, None, window, cx);
    }

    /// Opens at `start` seconds, or at the saved resume point when `None`.
    pub fn open_at(&mut self, path: &Path, start: Option<f64>, window: &mut Window, cx: &mut Context<Self>) {
        if self.media.is_none() {
            self.fullscreen_before_play = window.is_fullscreen();
        }
        self.save_progress();
        let resolved = match mpv::local_media_path(path).and_then(|path| {
            if self.libmpv.is_none() {
                let libmpv = mpv::find_libmpv()?;
                self.player.initialize(&libmpv, self.gpui_view as *mut _)?;
                self.libmpv = Some(libmpv);
            }
            Ok(path)
        }) {
            Ok(path) => path,
            Err(error) => {
                self.state.error = Some(error.to_string());
                cx.notify();
                return;
            }
        };
        // Resume where this file was left, unless it was finished.
        let saved = self
            .catalog
            .progress(&resolved)
            .filter(|p| p.resumable())
            .map(|p| (p.position - 3.0).max(0.0))
            .unwrap_or(0.0);
        let start = start.unwrap_or(saved);
        // Playback preferences from Settings.
        let pref = |key: &str| self.catalog.setting(key).filter(|v| !v.is_empty());
        let _ = self.player.set("alang", &pref("audio_lang").unwrap_or_else(|| "auto".into()));
        let _ = self.player.set("slang", &pref("subtitle_lang").unwrap_or_else(|| "auto".into()));
        self.apply_subtitle_style();
        let _ = self.player.set("sid", if pref("subtitles_on").as_deref() == Some("no") { "no" } else { "auto" });
        match self.player.load(&resolved, start) {
            Ok(()) => {
                let path = resolved;
                let identity = media::identify(&path);
                window.set_window_title(&identity.title);
                self.next_episode = self.catalog_next(&path).or_else(|| media::next_episode(&path));
                self.identity = Some(identity);
                self.autoplay_at = None;
                self.autoplay_cancelled = false;
                self.autoplay_fired = false;
                self.autoplay_enabled = self.setting_on("autoplay");
                self.sub_search = Default::default();
                self.sub_was_busy = false;
                self.was_paused = true;
                self.last_saved = Instant::now();
                self.last_saved_position = None;
                self.state = self.player.snapshot();
                self.load_segments(&path);
                if start > 0.0 {
                    self.flash("play", format!("Resuming from {}", format_time(start)));
                }
                self.previews = Some(PreviewService::new(self.libmpv.clone().expect("initialized playback"), &path));
                self.media = Some(path);
                self.retire_preview();
                self.menu = None;
                self.last_subtitle = None;
                self.poke();
            }
            Err(error) => self.state.error = Some(error.to_string()),
        }
        cx.notify();
    }

    pub fn setting_on(&self, key: &str) -> bool {
        self.catalog.setting(key).as_deref() == Some("on")
    }

    /// Cached IntroDB markers for `path`, plus a background lookup when the
    /// cache is missing or expired (needs a matched IMDb id).
    fn load_segments(&mut self, path: &Path) {
        self.segments = Default::default();
        if !self.setting_on("skip_markers") {
            return;
        }
        *self.segments.lock() = Some((path.to_path_buf(), self.catalog.stored_segments(path, None)));
        let fresh = self.catalog.skip_lookup(path).is_some_and(|(_, expires)| expires > crate::catalog::now());
        if fresh {
            return;
        }
        let Some(item) = self.items.iter().find(|i| i.path == path).cloned() else { return };
        let is_movie = !self.tv_library_ids().contains(&item.library_id);
        let key = if is_movie { TitleKey::Movie(item.path.clone()) } else { TitleKey::Show(item.show_key()) };
        let Some(imdb) = self.metas.get(&key).and_then(|m| m.imdb_id.clone()) else { return };
        let (catalog, slot, path) = (self.catalog.clone(), self.segments.clone(), path.to_path_buf());
        std::thread::spawn(move || {
            let tmdb = crate::metadata::Tmdb::new(&catalog);
            match crate::metadata::fetch_markers(&tmdb, &imdb, item.season, item.episode, is_movie) {
                Ok(segments) => {
                    let found = segments != Default::default();
                    catalog.store_segments(&path, &imdb, &segments, "introdb");
                    catalog.record_skip_lookup(&path, if found { "found" } else { "none" }, Some(&imdb), if found { 30 * 86400 } else { 3 * 86400 });
                    let mut slot = slot.lock();
                    if slot.as_ref().is_some_and(|(p, _)| p == &path) {
                        *slot = Some((path, segments));
                    }
                }
                Err(_) => catalog.record_skip_lookup(&path, "error", Some(&imdb), 3600),
            }
        });
    }

    /// The skip action for the playhead: IntroDB marker first, else an
    /// intro chapter. Returns (label, seek target).
    pub fn skip_action(&self) -> Option<(String, f64)> {
        let position = self.state.position;
        if let Some((_, segments)) = self.segments.lock().as_ref() {
            if let Some((kind, window)) = segments.active(position) {
                let end = if self.state.duration > 0.0 { window.end.min(self.state.duration) } else { window.end };
                return Some((format!("Skip {}", kind.label()), end));
            }
        }
        self.intro_end().map(|end| ("Skip intro".to_string(), end))
    }

    /// Starts an OpenSubtitles search for the open file (needs its IMDb id).
    fn start_subtitle_search(&mut self, cx: &mut Context<Self>) {
        let Some(path) = self.media.clone() else { return };
        {
            let current = self.sub_search.lock();
            if current.file.as_ref() == Some(&path) && (current.loading || !current.results.is_empty()) {
                return;
            }
        }
        let item = self.items.iter().find(|i| i.path == path).cloned();
        let is_movie = item.as_ref().is_none_or(|i| !self.tv_library_ids().contains(&i.library_id));
        let key = item.as_ref().map(|i| if is_movie { TitleKey::Movie(i.path.clone()) } else { TitleKey::Show(i.show_key()) });
        let imdb = key.and_then(|k| self.metas.get(&k)).and_then(|m| m.imdb_id.clone());
        let mut state = SubSearch { file: Some(path.clone()), language: self.catalog.setting("subtitle_lang").filter(|l| !l.is_empty()), ..Default::default() };
        let Some(imdb) = imdb else {
            state.error = Some("Identify this title first: connect TMDB in Settings → Metadata.".into());
            *self.sub_search.lock() = state;
            cx.notify();
            return;
        };
        let episode = if is_movie { None } else { item.as_ref().and_then(|i| Some((i.season?, i.episode?))) };
        if !is_movie && episode.is_none() {
            state.error = Some("Identify the season and episode before searching for subtitles.".into());
            *self.sub_search.lock() = state;
            cx.notify();
            return;
        }
        state.loading = true;
        self.sub_was_busy = true;
        *self.sub_search.lock() = state;
        let slot = self.sub_search.clone();
        std::thread::spawn(move || {
            let result = crate::metadata::search_subtitles(&imdb, episode);
            let mut s = slot.lock();
            if s.file.as_ref() != Some(&path) {
                return;
            }
            s.loading = false;
            match result {
                Ok(results) if results.is_empty() => s.error = Some("No subtitles found for this title.".into()),
                Ok(results) => {
                    // Keep the preferred language only when results exist for it.
                    if s.language.as_ref().is_some_and(|l| !results.iter().any(|r| &r.language == l)) {
                        s.language = None;
                    }
                    s.results = results;
                }
                Err(e) => s.error = Some(e),
            }
        });
        cx.notify();
    }

    fn download_subtitle_result(&mut self, result: crate::metadata::SubtitleResult, cx: &mut Context<Self>) {
        let Some(video) = self.media.clone() else { return };
        let slot = self.sub_search.clone();
        {
            let mut state = slot.lock();
            if state.file.as_ref() != Some(&video) || state.downloading.is_some() {
                return;
            }
            state.downloading = Some(result.id.clone());
        }
        self.sub_was_busy = true;
        std::thread::spawn(move || {
            let outcome = crate::metadata::download_subtitle(&result, &video);
            let mut s = slot.lock();
            s.downloading = None;
            match outcome {
                Ok(path) => s.ready = Some(path),
                Err(e) => s.error = Some(e),
            }
        });
        cx.notify();
    }

    /// Records the current position for the open file.
    pub fn save_progress(&mut self) {
        let Some(path) = self.media.as_ref() else { return };
        let state = self.player.snapshot();
        if state.loaded && state.duration > 0.0 {
            let position = if state.ended { state.duration } else { state.position };
            if self.last_saved_position != Some(position) {
                self.catalog.record_progress(path, position, state.duration);
                self.last_saved_position = Some(position);
            }
        }
        self.last_saved = Instant::now();
    }

    /// Back to the start screen, keeping the watch position.
    pub fn close_media(&mut self, window: &mut Window, cx: &mut Context<Self>) {
        self.save_progress();
        let _ = self.player.command(&["stop"]);
        self.media = None;
        self.previews = None;
        self.sub_search = Default::default();
        self.sub_was_busy = false;
        self.segments = Default::default();
        self.state = PlaybackState::default();
        self.identity = None;
        self.next_episode = None;
        self.menu = None;
        self.retire_preview();
        // Only undo fullscreen the player itself entered.
        if window.is_fullscreen() && !self.fullscreen_before_play {
            window.toggle_fullscreen();
        }
        window.set_window_title("Plexy");
        self.reload_catalog();
        cx.notify();
    }

    pub fn play_next(&mut self, window: &mut Window, cx: &mut Context<Self>) {
        if let Some(next) = self.next_episode.clone() {
            self.open(&next, window, cx);
        }
    }

    /// The chapter the playhead is in when it is an intro/opening.
    fn intro_end(&self) -> Option<f64> {
        let chapters = &self.state.chapters;
        let index = chapters.iter().rposition(|c| c.time <= self.state.position + 0.1)?;
        let title = chapters[index].title.to_lowercase();
        let is_intro = ["intro", "opening", " op", "recap"].iter().any(|word| title.contains(word.trim()))
            && !title.contains("outro");
        is_intro.then(|| chapters.get(index + 1).map(|c| c.time).unwrap_or(self.state.duration))
    }

    pub fn prompt_open(&mut self, window: &mut Window, cx: &mut Context<Self>) {
        let paths = cx.prompt_for_paths(PathPromptOptions {
            files: true,
            directories: false,
            multiple: false,
            prompt: Some("Open".into()),
        });
        cx.spawn_in(window, async move |this, cx| {
            if let Ok(Ok(Some(paths))) = paths.await {
                if let Some(path) = paths.into_iter().next() {
                    this.update_in(cx, |view, window, cx| view.open(&path, window, cx)).ok();
                }
            }
        })
        .detach();
    }

    fn prompt_subtitle(&mut self, window: &mut Window, cx: &mut Context<Self>) {
        let paths = cx.prompt_for_paths(PathPromptOptions {
            files: true,
            directories: false,
            multiple: false,
            prompt: Some("Add Subtitles".into()),
        });
        cx.spawn_in(window, async move |this, cx| {
            if let Ok(Ok(Some(paths))) = paths.await {
                if let Some(path) = paths.into_iter().next() {
                    this.update(cx, |view, cx| view.add_subtitle(&path, cx)).ok();
                }
            }
        })
        .detach();
    }

    pub fn add_subtitle(&mut self, path: &Path, cx: &mut Context<Self>) {
        match self.player.add_subtitle(path) {
            Ok(()) => self.flash("subtitles", format!("Added {}", display_name(path))),
            Err(error) => self.flash("subtitles", error.to_string()),
        }
        cx.notify();
    }

    /// Called ~30 times a second: pull playback state, animate the chrome,
    /// resolve preview frames.
    pub fn tick(&mut self, window: &mut Window, cx: &mut Context<Self>) {
        let previous_revision = self.state.revision;
        let mut overlay_changed = false;
        if self.media.is_some() {
            let state = self.player.snapshot();
            let just_ended = state.ended && !self.state.ended;
            overlay_changed = self.state.buffering != state.buffering
                || self.state.ended != state.ended
                || self.state.error != state.error
                || (self.next_episode.is_some() && near_episode_end(&self.state) != near_episode_end(&state));
            self.state = state;
            if self.state.loaded {
                let paused_now = self.state.paused || self.state.ended;
                let position = if self.state.ended { self.state.duration } else { self.state.position };
                if just_ended || (paused_now && !self.was_paused)
                    || (self.last_saved_position != Some(position)
                        && self.last_saved.elapsed() > Duration::from_secs(5))
                {
                    self.save_progress();
                }
                self.was_paused = paused_now;
            }
        }
        if let Some(id) = self.state.subtitle_id {
            self.last_subtitle = Some(id);
        }

        let visible = self.controls_wanted();
        let target = if visible { 1.0 } else { 0.0 };
        let step = if visible { 0.25 } else { 0.12 };
        let old_opacity = self.controls_opacity;
        self.controls_opacity += (target - self.controls_opacity).clamp(-step, step);
        // Lift subtitles above the transport while the chrome is showing.
        let raise = visible && self.media.is_some();
        if raise != self.subs_raised {
            self.subs_raised = raise;
            let _ = self.player.set("sub-margin-y", if raise { "150" } else { "34" });
        }
        if !visible && !self.cursor_hidden && self.media.is_some() {
            mpv::hide_cursor_until_moved();
            self.cursor_hidden = true;
        }

        if !self.volume_hover && self.volume_hover_until.is_some_and(|t| Instant::now() > t) {
            self.volume_hover_until = None;
            overlay_changed = true;
        }
        // Library refresh: pick up finished scans, auto-refresh every 15 min.
        let scan_progress = {
            let status = self.catalog.status.lock();
            (status.generation, status.scanned, status.running)
        };
        let scan_finished = scan_progress.0 != self.scan_progress.0;
        let scan_changed = std::mem::replace(&mut self.scan_progress, scan_progress) != scan_progress;
        if self.last_auto_scan.elapsed() > Duration::from_secs(15 * 60) {
            self.last_auto_scan = Instant::now();
            self.start_auto_scan();
        }
        let epoch = self.catalog.metadata_epoch();
        let meta_changed = epoch != self.metadata_epoch;
        self.metadata_epoch = epoch;
        if scan_finished || meta_changed {
            self.reload_catalog();
        }
        if scan_finished && self.catalog.tmdb_token().is_some() {
            let catalog = self.catalog.clone();
            std::thread::spawn(move || {
                crate::metadata::enrich_missing(&catalog);
            });
        }
        let token_changed = {
            let status = self.token_status.lock();
            let changed = status.1 != self.token_seen;
            if changed {
                self.token_seen = status.1.clone();
            }
            changed
        };
        let (sub_ready, sub_busy) = {
            let mut s = self.sub_search.lock();
            (s.ready.take(), s.loading || s.downloading.is_some())
        };
        if let Some(path) = sub_ready {
            self.add_subtitle(&path, cx);
            self.menu = Some(Menu::Subtitles);
        }
        overlay_changed |= std::mem::replace(&mut self.sub_was_busy, sub_busy) != sub_busy;
        let segments = self.segments.lock().as_ref().map(|(_, segments)| *segments).unwrap_or_default();
        overlay_changed |= std::mem::replace(&mut self.observed_segments, segments) != segments;
        let mut autoplay_tick = false;
        if self.media.is_some() && self.state.ended && self.next_episode.is_some() && self.autoplay_enabled && !self.autoplay_fired && !self.autoplay_cancelled {
            let started = *self.autoplay_at.get_or_insert_with(Instant::now);
            autoplay_tick = true;
            if started.elapsed() >= AUTOPLAY_COUNTDOWN {
                self.autoplay_fired = true;
                self.autoplay_at = None;
                self.play_next(window, cx);
            }
        }
        let hero_changed = self.media.is_none() && self.tick_hero();
        if let Some(osd) = &self.osd {
            let age = osd.at.elapsed();
            if age > Duration::from_millis(900) {
                self.osd = None;
                overlay_changed = true;
            } else if age < Duration::from_millis(250) || age >= Duration::from_millis(600) {
                overlay_changed = true;
            }
        }

        let previous_preview = self.preview_image.as_ref().map(|(key, _)| *key);
        self.update_preview_image(window);
        overlay_changed |= previous_preview != self.preview_image.as_ref().map(|(key, _)| *key);
        for image in self.retired_images.drain(..) {
            window.drop_image(image).ok();
        }
        // Input handlers redraw directly. The timer only redraws for visible
        // playback changes, animation, or background work that changed the UI.
        let playback_changed = self.media.is_some()
            && (old_opacity != self.controls_opacity
                || (self.controls_opacity > 0.0 && previous_revision != self.state.revision));
        if playback_changed || overlay_changed || scan_changed || hero_changed
            || meta_changed || token_changed || autoplay_tick
        {
            cx.notify();
        }
    }

    fn start_auto_scan(&self) {
        if self.libraries.iter().any(|library| library.auto_refresh && !library.roots.is_empty()) {
            self.catalog.scan(None, true);
        }
    }

    fn controls_wanted(&self) -> bool {
        self.media.is_none()
            || self.pin_controls
            || self.state.paused
            || self.state.ended
            || self.menu.is_some()
            || self.over_controls
            || self.scrub_fraction.is_some()
            || self.dragging_volume
            || self.volume_hover
            || self.last_activity.elapsed() < HIDE_AFTER
    }

    fn poke(&mut self) {
        self.last_activity = Instant::now();
        self.cursor_hidden = false;
    }

    fn flash(&mut self, icon: &'static str, text: impl Into<SharedString>) {
        self.osd = Some(Osd { icon, text: text.into(), at: Instant::now() });
    }

    fn preview_seconds(&self) -> Option<f64> {
        let fraction = self.scrub_fraction.or(self.hover_fraction)?;
        (self.state.duration > 0.0).then(|| fraction as f64 * self.state.duration)
    }

    fn update_preview_image(&mut self, _window: &mut Window) {
        let (Some(seconds), Some(previews)) = (self.preview_seconds(), self.previews.as_ref()) else {
            return;
        };
        let wanted = preview::bucket(seconds);
        if self.preview_image.as_ref().is_some_and(|(key, _)| *key == wanted) {
            return;
        }
        let frame = previews.request(seconds).or_else(|| previews.nearest(seconds));
        let Some(frame) = frame else { return };
        let key = preview::bucket(frame.seconds);
        if self.preview_image.as_ref().is_some_and(|(current, _)| *current == key) {
            return;
        }
        let Some(buffer) = RgbaImage::from_raw(frame.width, frame.height, frame.bgra.clone()) else {
            return;
        };
        // RenderImage expects BGRA, which is what the preview core produces.
        let image = Arc::new(RenderImage::new(vec![Frame::new(buffer)]));
        self.retire_preview();
        self.preview_image = Some((key, image));
    }

    fn retire_preview(&mut self) {
        if let Some((_, image)) = self.preview_image.take() {
            self.retired_images.push(image);
        }
    }

    // MARK: Commands

    fn toggle_pause(&mut self) {
        let _ = self.player.toggle_pause();
        let paused = !self.state.paused || self.state.ended;
        self.flash(if paused { "pause" } else { "play" }, "");
    }

    fn seek_by(&mut self, delta: f64) {
        let _ = self.player.seek_by(delta);
        let icon = if delta < 0.0 { "back" } else { "forward" };
        self.flash(icon, format!("{}{}s", if delta < 0.0 { "−" } else { "+" }, delta.abs().round()));
    }

    fn change_volume(&mut self, delta: f64) {
        let volume = (self.state.volume + delta).clamp(0.0, 100.0);
        let _ = self.player.set_volume(volume);
        if self.state.muted {
            let _ = self.player.set_muted(false);
        }
        self.flash(volume_icon(volume, false), format!("{volume:.0}%"));
    }

    fn toggle_mute(&mut self) {
        let muted = !self.state.muted;
        let _ = self.player.set_muted(muted);
        self.flash(volume_icon(self.state.volume, muted), if muted { "Muted" } else { "Unmuted" });
    }

    fn toggle_subtitles(&mut self) {
        if self.state.subtitle_id.is_some() {
            let _ = self.player.select_subtitle(None);
            self.flash("subtitles", "Subtitles off");
            return;
        }
        let subtitles: Vec<_> = self.state.tracks_of(TrackKind::Subtitle).cloned().collect();
        let choice = self
            .last_subtitle
            .and_then(|id| subtitles.iter().find(|track| track.id == id))
            .or_else(|| subtitles.first());
        match choice {
            Some(track) => {
                let _ = self.player.select_subtitle(Some(track.id));
                self.flash("subtitles-on", track.label());
            }
            None => self.flash("subtitles", "No subtitles"),
        }
    }

    fn cycle(&mut self, kind: TrackKind) {
        let tracks: Vec<_> = self.state.tracks_of(kind).cloned().collect();
        if tracks.is_empty() {
            return;
        }
        let current = if kind == TrackKind::Audio { self.state.audio_id } else { self.state.subtitle_id };
        let index = current.and_then(|id| tracks.iter().position(|t| t.id == id));
        let next = match (kind, index) {
            (TrackKind::Subtitle, Some(i)) if i + 1 == tracks.len() => None,
            (_, Some(i)) => Some(&tracks[(i + 1) % tracks.len()]),
            (_, None) => tracks.first(),
        };
        match (kind, next) {
            (TrackKind::Audio, Some(track)) => {
                let _ = self.player.select_audio(track.id);
                self.flash("audio", track.label());
            }
            (_, Some(track)) => {
                let _ = self.player.select_subtitle(Some(track.id));
                self.flash("subtitles-on", track.label());
            }
            (_, None) => {
                let _ = self.player.select_subtitle(None);
                self.flash("subtitles", "Subtitles off");
            }
        }
    }

    fn set_speed(&mut self, speed: f64) {
        let speed = speed.clamp(0.25, 4.0);
        let _ = self.player.set_speed(speed);
        self.flash("speed", format!("{}×", trim_number(speed)));
    }

    fn nudge_subtitle_delay(&mut self, delta: f64) {
        let delay = ((self.state.subtitle_delay + delta) * 10.0).round() / 10.0;
        let _ = self.player.set_subtitle_delay(delay);
        self.flash("subtitles", format!("Subtitle delay {}", signed_seconds(delay)));
    }

    fn nudge_subtitle_position(&mut self, delta: f64) {
        let position = (self.state.subtitle_position + delta).clamp(50.0, 100.0);
        let _ = self.player.set_subtitle_position(position);
        self.flash("subtitles", format!("Subtitle position {position:.0}%"));
    }

    fn sub_style_index(&self, key: &str, default: usize) -> usize {
        self.catalog.setting(key).and_then(|v| v.parse().ok()).unwrap_or(default)
    }

    /// Pushes the saved subtitle size and preset to mpv.
    pub fn apply_subtitle_style(&self) {
        let scale = SUB_SIZES.get(self.sub_style_index("sub_size", 2)).map(|s| s.0).unwrap_or(1.0);
        let _ = self.player.set("sub-scale", &scale.to_string());
        let props: &[(&str, &str)] = match self.sub_style_index("sub_preset", 0) {
            1 => &[("sub-color", "#FF111111"), ("sub-border-style", "opaque-box"), ("sub-border-color", "#E6A6A6A6"), ("sub-border-size", "3"), ("sub-shadow-offset", "0")],
            2 => &[("sub-color", "#FFF5E100"), ("sub-border-style", "opaque-box"), ("sub-border-color", "#FF000000"), ("sub-border-size", "3"), ("sub-shadow-offset", "0")],
            3 => &[("sub-color", "#FFFFFFFF"), ("sub-border-style", "outline-and-shadow"), ("sub-border-size", "0"), ("sub-shadow-offset", "2"), ("sub-shadow-color", "#C0000000")],
            _ => &[("sub-color", "#FFFFFFFF"), ("sub-border-style", "outline-and-shadow"), ("sub-border-color", "#FF000000"), ("sub-border-size", "2.5"), ("sub-shadow-offset", "0")],
        };
        for (name, value) in props {
            let _ = self.player.set(name, value);
        }
    }

    fn toggle_menu(&mut self, menu: Menu) {
        self.menu = if self.menu == Some(menu) { None } else { Some(menu) };
        self.poke();
    }

    // MARK: Input

    fn on_key_down(&mut self, event: &KeyDownEvent, window: &mut Window, cx: &mut Context<Self>) {
        let keystroke = &event.keystroke;
        let modifiers = keystroke.modifiers;
        if modifiers.platform || modifiers.control || modifiers.alt {
            return;
        }
        self.poke();
        let key = keystroke.key.as_str();
        if self.media.is_none() {
            if key == "enter" || key == "space" {
                self.prompt_open(window, cx);
            }
            return;
        }

        // Arrow/J/L seeking: 10 s per tap; holding accelerates exactly like
        // the web player (1, 2, 4, 8 s steps, then 30 s for local files).
        let seek = match key {
            "right" | "l" => Some(('r', 1.0)),
            "left" | "j" => Some(('l', -1.0)),
            _ => None,
        };
        if let Some((id, direction)) = seek {
            match self.held_seek {
                Some(held) if event.is_held && held.key == id => {
                    let elapsed = held.started.elapsed().as_millis();
                    let step = match elapsed {
                        0..350 => 1.0,
                        350..800 => 2.0,
                        800..1400 => 4.0,
                        1400..2200 => 8.0,
                        _ => 30.0,
                    };
                    self.seek_by(direction * step);
                }
                _ => {
                    self.held_seek = Some(HeldSeek { key: id, started: Instant::now() });
                    self.seek_by(direction * 10.0);
                }
            }
            cx.stop_propagation();
            cx.notify();
            return;
        }

        if event.is_held && !matches!(key, "up" | "down" | "." | ",") {
            return;
        }
        match key {
            "space" | "k" => self.toggle_pause(),
            "up" => self.change_volume(5.0),
            "down" => self.change_volume(-5.0),
            "m" => self.toggle_mute(),
            "f" => window.toggle_fullscreen(),
            "c" => self.toggle_subtitles(),
            "a" => self.cycle(TrackKind::Audio),
            "s" => self.cycle(TrackKind::Subtitle),
            "[" => self.set_speed(self.state.speed - 0.25),
            "]" => self.set_speed(self.state.speed + 0.25),
            "backspace" | "=" => self.set_speed(1.0),
            "z" => self.nudge_subtitle_delay(-0.1),
            "x" => self.nudge_subtitle_delay(0.1),
            "," if self.state.paused => {
                let _ = self.player.command(&["frame-back-step"]);
            }
            "." if self.state.paused => {
                let _ = self.player.command(&["frame-step"]);
            }
            "home" => {
                let _ = self.player.seek_to(0.0);
            }
            "end" if self.state.duration > 0.0 => {
                let _ = self.player.seek_to((self.state.duration - 1.0).max(0.0));
            }
            "escape" => {
                if self.menu.take().is_none() && window.is_fullscreen() {
                    window.toggle_fullscreen();
                }
            }
            digit if digit.len() == 1 && digit.as_bytes()[0].is_ascii_digit() => {
                let fraction = (digit.as_bytes()[0] - b'0') as f64 / 10.0;
                if self.state.duration > 0.0 {
                    let _ = self.player.seek_to(self.state.duration * fraction);
                    self.flash("forward", format_time(self.state.duration * fraction));
                }
            }
            _ => return,
        }
        cx.stop_propagation();
        cx.notify();
    }

    fn on_key_up(&mut self, event: &KeyUpEvent, _: &mut Window, _: &mut Context<Self>) {
        let id = match event.keystroke.key.as_str() {
            "right" | "l" => 'r',
            "left" | "j" => 'l',
            _ => return,
        };
        if self.held_seek.is_some_and(|held| held.key == id) {
            self.held_seek = None;
        }
    }

    fn fraction_at(bounds: Bounds<Pixels>, position: Point<Pixels>) -> f32 {
        let width = f32::from(bounds.size.width);
        if width <= 0.0 {
            return 0.0;
        }
        ((f32::from(position.x) - f32::from(bounds.origin.x)) / width).clamp(0.0, 1.0)
    }

    fn on_mouse_move(&mut self, event: &MouseMoveEvent, _: &mut Window, cx: &mut Context<Self>) {
        if self.media.is_none() {
            return;
        }
        self.poke();
        let seek = self.seek_bounds.get();
        if self.scrub_fraction.is_some() {
            self.scrub_fraction = Some(Self::fraction_at(seek, event.position));
        }
        // A generous vertical hit area keeps the preview up while the
        // pointer drifts just off the thin line.
        let hit = Bounds { origin: point(seek.origin.x, seek.origin.y - px(6.)), size: size(seek.size.width, seek.size.height + px(12.)) };
        self.hover_fraction = (hit.contains(&event.position) || self.scrub_fraction.is_some())
            .then(|| Self::fraction_at(seek, event.position));
        if self.dragging_volume {
            self.set_volume_from(event.position);
        }
        cx.notify();
    }

    pub fn begin_scrub(&mut self, fraction: f32) {
        self.scrub_fraction = Some(fraction);
        self.hover_fraction = Some(fraction);
    }

    pub fn end_scrub(&mut self) {
        if let Some(fraction) = self.scrub_fraction.take() {
            if self.state.duration > 0.0 {
                let target = fraction as f64 * self.state.duration;
                let _ = self.player.seek_to(target);
                self.state.position = target;
            }
        }
    }

    fn on_mouse_up(&mut self, _: &MouseUpEvent, _: &mut Window, cx: &mut Context<Self>) {
        self.end_scrub();
        self.dragging_volume = false;
        cx.notify();
    }

    fn set_volume_from(&mut self, position: Point<Pixels>) {
        let bounds = self.volume_bounds.get();
        let height = f32::from(bounds.size.height).max(1.0);
        let fraction = (1.0 - (f32::from(position.y) - f32::from(bounds.origin.y)) / height).clamp(0.0, 1.0);
        let volume = (fraction * 100.0).round() as f64;
        let _ = self.player.set_volume(volume);
        if self.state.muted && volume > 0.0 {
            let _ = self.player.set_muted(false);
        }
        self.state.volume = volume;
    }

    fn on_drop_paths(&mut self, paths: &ExternalPaths, window: &mut Window, cx: &mut Context<Self>) {
        for path in paths.paths() {
            let is_subtitle = path
                .extension()
                .and_then(|ext| ext.to_str())
                .is_some_and(|ext| SUBTITLE_EXTENSIONS.contains(&ext.to_ascii_lowercase().as_str()));
            if is_subtitle && self.media.is_some() {
                self.add_subtitle(path, cx);
            } else if !is_subtitle {
                self.open(path, window, cx);
                break;
            }
        }
    }
}

// MARK: - Rendering

fn white(alpha: f32) -> Hsla {
    Hsla { h: 0., s: 0., l: 1., a: alpha }
}

/// The player's menu surface: near-black with a cool tint, over video.
fn panel_bg() -> Hsla {
    rgba(0x0d131cf5).into()
}

/// Subtitle sizes: mpv `sub-scale` and the "Aa" preview size.
const SUB_SIZES: [(f64, f32); 5] = [(0.7, 15.), (0.85, 19.), (1.0, 24.), (1.2, 29.), (1.45, 34.)];

fn black(alpha: f32) -> Hsla {
    Hsla { h: 0., s: 0., l: 0., a: alpha }
}


fn icon(name: &str, size_px: f32, color: Hsla) -> impl IntoElement {
    svg().path(format!("icons/{name}.svg")).size(px(size_px)).text_color(color)
}

fn volume_icon(volume: f64, muted: bool) -> &'static str {
    if muted || volume <= 0.0 {
        "mute"
    } else if volume < 50.0 {
        "volume-low"
    } else {
        "volume"
    }
}

pub fn format_time(seconds: f64) -> String {
    let total = if seconds.is_finite() { seconds.max(0.0).floor() as u64 } else { 0 };
    let (h, m, s) = (total / 3600, (total % 3600) / 60, total % 60);
    if h > 0 {
        format!("{h}:{m:02}:{s:02}")
    } else {
        format!("{m}:{s:02}")
    }
}

fn trim_number(value: f64) -> String {
    let text = format!("{value:.2}");
    text.trim_end_matches('0').trim_end_matches('.').to_string()
}

fn signed_seconds(value: f64) -> String {
    if value.abs() < 0.05 {
        "0.0s".into()
    } else {
        format!("{}{:.1}s", if value > 0.0 { "+" } else { "−" }, value.abs())
    }
}

fn display_name(path: &Path) -> String {
    path.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_else(|| path.display().to_string())
}

impl PlayerView {
    fn render_seek_bar(&self, cx: &mut Context<Self>) -> impl IntoElement {
        let duration = self.state.duration.max(0.0);
        let progress = if duration > 0.0 { (self.state.position / duration).clamp(0.0, 1.0) as f32 } else { 0.0 };
        let buffered = if duration > 0.0 { (self.state.buffered / duration).clamp(0.0, 1.0) as f32 } else { 0.0 };
        let shown = self.scrub_fraction.unwrap_or(progress);
        let engaged = self.hover_fraction.is_some() || self.scrub_fraction.is_some();
        let track_height = if engaged { 6. } else { 3. };
        let bounds_cell = self.seek_bounds.clone();

        let chapter_marks = self
            .state
            .chapters
            .iter()
            .filter(|chapter| chapter.time > 0.5 && duration > 0.0)
            .map(|chapter| {
                div()
                    .absolute()
                    .top_0()
                    .bottom_0()
                    .left(gpui::relative((chapter.time / duration) as f32))
                    .w(px(3.))
                    .bg(black(0.85))
            })
            .collect::<Vec<_>>();

        div()
            .id("seek-bar")
            .relative()
            .h(px(26.))
            .w_full()
            .flex()
            .items_center()
            .cursor_pointer()
            .child(
                canvas(move |bounds, _, _| bounds_cell.set(bounds), |_, _, _, _| {})
                    .absolute()
                    .size_full(),
            )
            .child(
                div()
                    .relative()
                    .w_full()
                    .h(px(track_height))
                    .rounded_full()
                    .overflow_hidden()
                    .bg(white(0.22))
                    .child(div().absolute().top_0().bottom_0().left_0().w(gpui::relative(buffered)).bg(white(0.28)))
                    .when_some(self.hover_fraction.filter(|_| self.scrub_fraction.is_none()), |el, hover| {
                        el.child(
                            div()
                                .absolute()
                                .top_0()
                                .bottom_0()
                                .left(gpui::relative(hover.min(shown)))
                                .w(gpui::relative((hover - shown).abs()))
                                .bg(white(0.35)),
                        )
                    })
                    .child(div().absolute().top_0().bottom_0().left_0().w(gpui::relative(shown)).bg(white(0.97)))
                    .children(chapter_marks),
            )
            .child(
                div()
                    .absolute()
                    .top(px(13. - 7.))
                    .left(gpui::relative(shown))
                    .ml(px(-7.))
                    .size(px(14.))
                    .rounded_full()
                    .bg(white(1.0))
                    .shadow_md()
                    .opacity(if engaged { 1.0 } else { 0.0 }),
            )
            .on_mouse_down(
                MouseButton::Left,
                cx.listener(|this, event: &MouseDownEvent, _, cx| {
                    cx.stop_propagation();
                    let fraction = Self::fraction_at(this.seek_bounds.get(), event.position);
                    this.begin_scrub(fraction);
                    cx.notify();
                }),
            )
    }

    fn render_preview(&self) -> Option<impl IntoElement> {
        let seconds = self.preview_seconds()?;
        let seek = self.seek_bounds.get();
        let width = f32::from(seek.size.width);
        if width <= 0.0 {
            return None;
        }
        let fraction = self.scrub_fraction.or(self.hover_fraction)?;
        let aspect = self
            .preview_image
            .as_ref()
            .map(|(_, image)| {
                let s = image.size(0);
                s.height.0 as f32 / s.width.0.max(1) as f32
            })
            .unwrap_or(9.0 / 16.0);
        let height = PREVIEW_WIDTH * aspect;
        let center = fraction * width;
        let left = (center - PREVIEW_WIDTH / 2.0).clamp(0.0, (width - PREVIEW_WIDTH).max(0.0));
        let chapter = self
            .state
            .chapters
            .iter()
            .rev()
            .find(|chapter| chapter.time <= seconds)
            .map(|chapter| chapter.title.clone());
        let image = self.preview_image.as_ref().map(|(_, image)| image.clone());

        Some(
            div()
                .absolute()
                .left(px(left))
                .bottom(px(30.))
                .w(px(PREVIEW_WIDTH))
                .flex()
                .flex_col()
                .items_center()
                .gap(px(6.))
                .child(
                    div()
                        .w(px(PREVIEW_WIDTH))
                        .h(px(height))
                        .rounded(px(10.))
                        .overflow_hidden()
                        .bg(black(0.85))
                        .border_1()
                        .border_color(white(0.16))
                        .shadow_lg()
                        .when_some(image, |el, image| el.child(img(image).size_full()))
                        .when(self.preview_image.is_none(), |el| {
                            el.flex().items_center().justify_center().child(
                                div().text_xs().text_color(white(0.5)).child(
                                    if self.previews.as_ref().and_then(|p| p.failure()).is_some() {
                                        "No preview"
                                    } else {
                                        "Loading…"
                                    },
                                ),
                            )
                        }),
                )
                .child(
                    div()
                        .flex()
                        .gap(px(6.))
                        .px(px(8.))
                        .py(px(3.))
                        .rounded(px(6.))
                        .bg(black(0.7))
                        .text_sm()
                        .font_weight(gpui::FontWeight::SEMIBOLD)
                        .text_color(white(0.95))
                        .when_some(chapter, |el, title| el.child(div().text_color(white(0.65)).child(title)))
                        .child(format_time(seconds)),
                ),
        )
    }

    fn set_volume_hover(&mut self, hovered: bool) {
        self.volume_hover = hovered;
        // A short grace period lets the pointer cross the gap between the
        // speaker button and the popover below it.
        self.volume_hover_until = (!hovered).then(|| Instant::now() + Duration::from_millis(280));
    }

    /// Self-test hook: show the volume popover as if hovered.
    pub fn debug_open_volume(&mut self) {
        self.volume_hover = true;
    }

    fn volume_open(&self) -> bool {
        self.volume_hover || self.dragging_volume || self.volume_hover_until.is_some()
    }

    /// Speaker button with a vertical slider that drops down beneath it.
    fn render_volume(&self, cx: &mut Context<Self>) -> impl IntoElement {
        let level = if self.state.muted { 0.0 } else { (self.state.volume as f32 / 100.0).clamp(0.0, 1.0) };
        let open = self.volume_open();
        let bounds_cell = self.volume_bounds.clone();
        div()
            .relative()
            .child(
                self.icon_button("mute", volume_icon(self.state.volume, self.state.muted), 22., open, cx, |this, _, _| this.toggle_mute())
                    .on_hover(cx.listener(|this, hovered: &bool, _, cx| {
                        this.set_volume_hover(*hovered);
                        cx.notify();
                    })),
            )
            .when(open, |el| {
                el.child(
                    div()
                        .id("volume-popover")
                        .absolute()
                        .top(px(46.))
                        .left(px(-2.))
                        .w(px(44.))
                        .h(px(232.))
                        .py(px(14.))
                        .rounded(px(theme::RADIUS_LG))
                        .bg(panel_bg())
                        .flex()
                        .justify_center()
                        .cursor_pointer()
                        .on_hover(cx.listener(|this, hovered: &bool, _, cx| {
                            this.set_volume_hover(*hovered);
                            cx.notify();
                        }))
                        .on_mouse_down(
                            MouseButton::Left,
                            cx.listener(|this, event: &MouseDownEvent, _, cx| {
                                cx.stop_propagation();
                                this.dragging_volume = true;
                                this.set_volume_from(event.position);
                                cx.notify();
                            }),
                        )
                        .on_scroll_wheel(cx.listener(|this, event: &ScrollWheelEvent, _, cx| {
                            cx.stop_propagation();
                            let delta = f32::from(event.delta.pixel_delta(px(16.)).y);
                            if delta.abs() > 0.5 {
                                this.change_volume(if delta > 0.0 { 2.0 } else { -2.0 });
                                cx.notify();
                            }
                        }))
                        .child(
                            div()
                                .relative()
                                .w(px(4.))
                                .h_full()
                                .rounded_full()
                                .bg(white(0.22))
                                .child(canvas(move |bounds, _, _| bounds_cell.set(bounds), |_, _, _, _| {}).absolute().size_full())
                                .child(div().absolute().left_0().right_0().bottom_0().h(gpui::relative(level)).rounded_full().bg(theme::foreground()))
                                .child(
                                    div()
                                        .absolute()
                                        .left(px(-5.))
                                        .bottom(gpui::relative(level))
                                        .mb(px(-7.))
                                        .size(px(14.))
                                        .rounded_full()
                                        .bg(theme::foreground()),
                                ),
                        ),
                )
            })
    }

    /// A radio row: white highlight on hover, blue radio when selected.
    fn menu_row(
        &self,
        id: impl Into<gpui::ElementId>,
        label: String,
        detail: String,
        selected: bool,
        cx: &mut Context<Self>,
        on_click: impl Fn(&mut Self, &mut Window, &mut Context<Self>) + 'static,
    ) -> impl IntoElement {
        let blue: Hsla = rgba(0x1a98ffff).into();
        div()
            .id(id.into())
            .group("menu-row")
            .flex()
            .items_center()
            .gap(px(14.))
            .px(px(14.))
            .py(px(10.))
            .rounded(px(8.))
            .cursor_pointer()
            .hover(|style| style.bg(white(0.97)))
            .on_click(cx.listener(move |this, _, window, cx| {
                cx.stop_propagation();
                on_click(this, window, cx);
                cx.notify();
            }))
            .child(
                div()
                    .size(px(20.))
                    .flex_none()
                    .rounded_full()
                    .border_2()
                    .border_color(if selected { blue } else { white(0.92) })
                    .group_hover("menu-row", |s| s.border_color(if selected { blue } else { black(0.9) }))
                    .flex()
                    .items_center()
                    .justify_center()
                    .when(selected, |el| el.child(div().size(px(10.)).rounded_full().bg(blue))),
            )
            .child(
                div()
                    .flex()
                    .flex_col()
                    .gap(px(2.))
                    .min_w_0()
                    .child(
                        div()
                            .text_size(px(16.))
                            .font_weight(gpui::FontWeight::SEMIBOLD)
                            .text_color(white(0.96))
                            .group_hover("menu-row", |s| s.text_color(black(0.92)))
                            .truncate()
                            .child(label),
                    )
                    .when(!detail.is_empty(), |el| el.child(div().text_size(px(12.)).text_color(white(0.55)).group_hover("menu-row", |s| s.text_color(black(0.55))).truncate().child(detail))),
            )
    }

    fn stepper(
        &self,
        id: &'static str,
        label: &'static str,
        value: String,
        cx: &mut Context<Self>,
        minus: impl Fn(&mut Self) + 'static,
        plus: impl Fn(&mut Self) + 'static,
    ) -> impl IntoElement {
        let small = |id: String, name: &'static str| {
            div()
                .id(SharedString::from(id))
                .size(px(26.))
                .flex()
                .items_center()
                .justify_center()
                .rounded_full()
                .cursor_pointer()
                .bg(white(0.08))
                .hover(|style| style.bg(white(0.18)))
                .child(icon(name, 14., white(0.9)))
        };
        div()
            .flex()
            .items_center()
            .justify_between()
            .px(px(10.))
            .py(px(5.))
            .child(div().text_sm().text_color(white(0.75)).child(label))
            .child(
                div()
                    .flex()
                    .items_center()
                    .gap(px(8.))
                    .child(small(format!("{id}-minus"), "minus").on_click(cx.listener(move |this, _, _, cx| {
                        cx.stop_propagation();
                        minus(this);
                        cx.notify();
                    })))
                    .child(div().w(px(52.)).text_center().text_sm().text_color(white(0.95)).child(value))
                    .child(small(format!("{id}-plus"), "plus").on_click(cx.listener(move |this, _, _, cx| {
                        cx.stop_propagation();
                        plus(this);
                        cx.notify();
                    }))),
            )
    }

    fn settings_row(
        &self,
        id: &'static str,
        icon_name: &'static str,
        label: &'static str,
        value: String,
        cx: &mut Context<Self>,
        page: Menu,
    ) -> impl IntoElement {
        div()
            .id(id)
            .group("settings-row")
            .flex()
            .items_center()
            .gap(px(14.))
            .px(px(14.))
            .py(px(12.))
            .rounded(px(8.))
            .cursor_pointer()
            .hover(|style| style.bg(white(0.97)))
            .on_click(cx.listener(move |this, _, _, cx| {
                cx.stop_propagation();
                this.menu = Some(page);
                cx.notify();
            }))
            .child(svg().path(format!("icons/{icon_name}.svg")).size(px(22.)).text_color(white(0.96)).group_hover("settings-row", |s| s.text_color(black(0.92))))
            .child(div().flex_1().text_size(px(17.)).font_weight(gpui::FontWeight::BOLD).text_color(white(0.96)).group_hover("settings-row", |s| s.text_color(black(0.92))).child(label))
            .child(div().text_size(px(17.)).text_color(white(0.55)).group_hover("settings-row", |s| s.text_color(black(0.55))).child(value))
            .child(svg().path("icons/chevron-right.svg").size(px(16.)).text_color(white(0.55)).group_hover("settings-row", |s| s.text_color(black(0.55))))
    }

    fn render_menu(&self, menu: Menu, cx: &mut Context<Self>) -> impl IntoElement {
        let divider = || div().mx(px(14.)).my(px(10.)).h(px(1.)).bg(white(0.16));
        let title = match menu {
            Menu::More => "Settings",
            Menu::Audio => "Audio",
            Menu::Subtitles => "Subtitles",
            Menu::Speed => "Speed",
            Menu::Chapters => "Chapters",
            Menu::SubtitleSearch => "Search subtitles",
            Menu::SubtitleStyle => "Subtitles Settings",
        };
        let header = div()
            .relative()
            .h(px(48.))
            .flex()
            .items_center()
            .justify_center()
            .child(div().text_size(px(17.)).font_weight(gpui::FontWeight::BOLD).text_color(white(0.96)).child(title))
            .when(menu != Menu::More && menu != Menu::Speed, |el| {
                el.child(
                    div()
                        .id("menu-back")
                        .absolute()
                        .left(px(4.))
                        .size(px(36.))
                        .flex()
                        .items_center()
                        .justify_center()
                        .rounded_full()
                        .cursor_pointer()
                        .hover(|style| style.bg(white(0.1)))
                        .on_click(cx.listener(|this, _, _, cx| {
                            cx.stop_propagation();
                            this.menu = Some(if this.menu == Some(Menu::SubtitleStyle) || this.menu == Some(Menu::SubtitleSearch) { Menu::Subtitles } else { Menu::More });
                            cx.notify();
                        }))
                        .child(icon("chevron-left", 20., white(0.96))),
                )
            });

        let mut panel = div()
            .id("menu")
            .absolute()
            .right(px(28.))
            .top(px(92.))
            .w(px(if menu == Menu::Speed { 440. } else { 400. }))
            .max_h(px(560.))
            .overflow_y_scroll()
            .p(px(10.))
            .rounded(px(14.))
            .bg(panel_bg())
            .shadow_lg()
            .on_mouse_down(MouseButton::Left, |_, _, cx| cx.stop_propagation())
            .on_scroll_wheel(|_: &ScrollWheelEvent, _, cx| cx.stop_propagation())
            .flex()
            .flex_col()
            .child(header);

        let track_label = |kind: TrackKind, id: Option<i64>| {
            id.and_then(|id| self.state.tracks_of(kind).find(|t| t.id == id))
                .map(|t| t.lang.as_deref().map(mpv::language_name).unwrap_or_else(|| t.label()))
        };

        match menu {
            Menu::More => {
                panel = panel
                    .child(self.settings_row(
                        "set-subtitles",
                        "subtitles",
                        "Subtitles",
                        track_label(TrackKind::Subtitle, self.state.subtitle_id).unwrap_or_else(|| "Off".into()),
                        cx,
                        Menu::Subtitles,
                    ))
                    .child(self.settings_row(
                        "set-audio",
                        "audio",
                        "Audio",
                        track_label(TrackKind::Audio, self.state.audio_id).unwrap_or_else(|| "—".into()),
                        cx,
                        Menu::Audio,
                    ))
                    .child(divider())
                    .child(self.settings_row("set-speed", "speed", "Speed", format!("{}x", trim_number(self.state.speed)), cx, Menu::Speed));
                if !self.state.chapters.is_empty() {
                    let current = self
                        .state
                        .chapters
                        .iter()
                        .rposition(|c| c.time <= self.state.position + 0.25)
                        .map(|i| self.state.chapters[i].title.clone())
                        .unwrap_or_default();
                    panel = panel.child(self.settings_row("set-chapters", "chapters", "Chapters", current, cx, Menu::Chapters));
                }
            }
            Menu::Audio => {
                for track in self.state.tracks_of(TrackKind::Audio).cloned().collect::<Vec<_>>() {
                    let id = track.id;
                    panel = panel.child(self.menu_row(
                        SharedString::from(format!("audio-{id}")),
                        track.label(),
                        track.detail(),
                        self.state.audio_id == Some(id),
                        cx,
                        move |this, _, _| {
                            let _ = this.player.select_audio(id);
                        },
                    ));
                }
            }
            Menu::Subtitles => {
                panel = panel.child(self.menu_row("sub-off", "Off".into(), String::new(), self.state.subtitle_id.is_none(), cx, |this, _, _| {
                    let _ = this.player.select_subtitle(None);
                }));
                for track in self.state.tracks_of(TrackKind::Subtitle).cloned().collect::<Vec<_>>() {
                    let id = track.id;
                    panel = panel.child(self.menu_row(
                        SharedString::from(format!("sub-{id}")),
                        track.label(),
                        track.detail(),
                        self.state.subtitle_id == Some(id),
                        cx,
                        move |this, _, _| {
                            let _ = this.player.select_subtitle(Some(id));
                        },
                    ));
                }
                panel = panel
                    .child(self.menu_row("sub-add", "Add subtitle file…".into(), "SRT, ASS, VTT".into(), false, cx, |this, window, cx| {
                        this.menu = None;
                        this.prompt_subtitle(window, cx);
                    }))
                    .child(self.menu_row("sub-search", "Search subtitles…".into(), "OpenSubtitles".into(), false, cx, |this, _, cx| {
                        this.menu = Some(Menu::SubtitleSearch);
                        this.start_subtitle_search(cx);
                    }))
                    .child(divider())
                    .child(self.settings_row("set-sub-style", "cog", "Subtitles Settings", String::new(), cx, Menu::SubtitleStyle));
            }
            Menu::SubtitleStyle => {
                let size = self.sub_style_index("sub_size", 2);
                let preset = self.sub_style_index("sub_preset", 0);
                let label = |text: &'static str| div().px(px(14.)).pt(px(6.)).pb(px(10.)).text_size(px(17.)).font_weight(gpui::FontWeight::BOLD).text_color(white(0.96)).child(text);
                let sizes = div().px(px(14.)).flex().items_end().gap(px(16.)).children(SUB_SIZES.iter().enumerate().map(|(i, (_, font))| {
                    div()
                        .id(SharedString::from(format!("sub-size-{i}")))
                        .cursor_pointer()
                        .text_size(px(*font))
                        .font_weight(gpui::FontWeight::MEDIUM)
                        .text_color(if i == size { white(0.97) } else { white(0.4) })
                        .hover(|s| s.text_color(white(0.8)))
                        .on_click(cx.listener(move |this, _, _, cx| {
                            cx.stop_propagation();
                            this.catalog.set_setting("sub_size", &i.to_string());
                            this.apply_subtitle_style();
                            cx.notify();
                        }))
                        .child("Aa")
                }));
                let tile = |i: usize, cx: &mut Context<Self>| {
                    let selected = i == preset;
                    let (bg, fg, slash) = match i {
                        0 => (rgba(0x00000000).into(), white(1.), false),
                        1 => (white(0.55), black(0.9), true),
                        2 => (black(1.), rgba(0xf5e100ff).into(), false),
                        _ => (rgba(0x00000000).into(), white(1.), true),
                    };
                    div()
                        .id(SharedString::from(format!("sub-preset-{i}")))
                        .relative()
                        .size(px(56.))
                        .rounded(px(8.))
                        .cursor_pointer()
                        .bg(bg)
                        .border_2()
                        .border_color(if selected { white(0.97) } else { rgba(0x00000000).into() })
                        .hover(|s| s.border_color(white(0.5)))
                        .flex()
                        .items_center()
                        .justify_center()
                        .on_click(cx.listener(move |this, _, _, cx| {
                            cx.stop_propagation();
                            this.catalog.set_setting("sub_preset", &i.to_string());
                            this.apply_subtitle_style();
                            cx.notify();
                        }))
                        .child(div().text_size(px(22.)).font_weight(gpui::FontWeight::MEDIUM).text_color(fg).child("Aa"))
                        .when(slash, |el| el.child(div().absolute().left(px(26.)).top(px(-4.)).w(px(1.5)).h(px(60.)).bg(white(0.7)).opacity(0.6)))
                        .when(selected, |el| el.child(div().absolute().top(px(-7.)).right(px(-7.)).size(px(18.)).rounded_full().bg(white(1.)).flex().items_center().justify_center().child(icon("check", 11., black(1.)))))
                };
                panel = panel
                    .child(label("Size"))
                    .child(sizes)
                    .child(divider())
                    .child(label("Presets"))
                    .child(div().px(px(14.)).pt(px(4.)).flex().gap(px(16.)).children((0..4).map(|i| tile(i, cx))))
                    .child(divider())
                    .child(self.stepper(
                        "sub-delay",
                        "Sync",
                        signed_seconds(self.state.subtitle_delay),
                        cx,
                        |this| this.nudge_subtitle_delay(-0.1),
                        |this| this.nudge_subtitle_delay(0.1),
                    ))
                    .child(self.stepper(
                        "sub-pos",
                        "Position",
                        format!("{:.0}%", self.state.subtitle_position),
                        cx,
                        |this| this.nudge_subtitle_position(-5.0),
                        |this| this.nudge_subtitle_position(5.0),
                    ));
            }
            Menu::SubtitleSearch => {
                let s = self.sub_search.lock().clone();
                if s.loading {
                    panel = panel.child(div().p(px(18.)).flex().items_center().gap(px(10.)).text_size(px(14.)).text_color(theme::muted()).child(gpui::AnimationExt::with_animation(div().child(icon("spinner", 18., theme::muted())), "sub-spin", gpui::Animation::new(Duration::from_millis(900)).repeat(), |el, t| el.opacity(0.4 + 0.6 * (t * std::f32::consts::PI).sin()))).child("Searching OpenSubtitles…"));
                }
                if let Some(error) = &s.error {
                    panel = panel.child(div().p(px(14.)).text_size(px(13.)).text_color(theme::danger()).child(error.clone()));
                }
                if !s.results.is_empty() {
                    let mut langs: Vec<String> = s.results.iter().map(|r| r.language.clone()).collect();
                    langs.sort();
                    langs.dedup();
                    let chip = |id: SharedString, label: String, active: bool, value: Option<String>| {
                        div()
                            .id(id)
                            .h(px(28.))
                            .px(px(11.))
                            .flex()
                            .items_center()
                            .rounded_full()
                            .cursor_pointer()
                            .text_size(px(12.))
                            .font_weight(gpui::FontWeight::SEMIBOLD)
                            .bg(if active { theme::foreground() } else { theme::default() })
                            .text_color(if active { theme::background() } else { theme::foreground() })
                            .on_click(cx.listener(move |this, _, _, cx| {
                                cx.stop_propagation();
                                this.sub_search.lock().language = value.clone();
                                cx.notify();
                            }))
                            .child(label)
                    };
                    panel = panel.child(
                        div()
                            .px(px(8.))
                            .pb(px(8.))
                            .flex()
                            .flex_wrap()
                            .gap(px(6.))
                            .child(chip("sub-lang-all".into(), "All".into(), s.language.is_none(), None))
                            .children(langs.into_iter().map(|l| chip(SharedString::from(format!("sub-lang-{l}")), mpv::language_name(&l), s.language.as_deref() == Some(l.as_str()), Some(l)))),
                    );
                    for result in s.results.iter().filter(|r| s.language.as_ref().is_none_or(|l| &r.language == l)).take(60).cloned() {
                        let busy = s.downloading.as_deref() == Some(result.id.as_str());
                        let detail = if busy { "Downloading…".to_string() } else { mpv::language_name(&result.language) };
                        panel = panel.child(self.menu_row(SharedString::from(format!("sub-result-{}", result.id)), result.name.clone(), detail, false, cx, move |this, _, cx| {
                            this.download_subtitle_result(result.clone(), cx);
                        }));
                    }
                }
            }
            Menu::Speed => {
                panel = panel.child(div().px(px(4.)).pb(px(4.)).flex().gap(px(8.)).children([0.75, 1.0, 1.25, 1.5, 2.0].into_iter().map(|speed: f64| {
                    let selected = (self.state.speed - speed).abs() < 0.01;
                    div()
                        .id(SharedString::from(format!("speed-{speed}")))
                        .relative()
                        .flex_1()
                        .h(px(44.))
                        .rounded(px(8.))
                        .cursor_pointer()
                        .bg(white(0.08))
                        .border_2()
                        .border_color(if selected { white(0.97) } else { rgba(0x00000000).into() })
                        .hover(|s| s.bg(white(0.16)))
                        .flex()
                        .items_center()
                        .justify_center()
                        .text_size(px(15.))
                        .font_weight(gpui::FontWeight::SEMIBOLD)
                        .text_color(white(0.96))
                        .on_click(cx.listener(move |this, _, _, cx| {
                            cx.stop_propagation();
                            this.set_speed(speed);
                            cx.notify();
                        }))
                        .child(format!("{}x", trim_number(speed)))
                        .when(selected, |el| el.child(div().absolute().top(px(-7.)).right(px(-7.)).size(px(17.)).rounded_full().bg(white(1.)).flex().items_center().justify_center().child(icon("check", 10., black(1.)))))
                })));
            }
            Menu::Chapters => {
                let current = self.state.chapters.iter().rposition(|c| c.time <= self.state.position + 0.25);
                for (index, chapter) in self.state.chapters.iter().enumerate() {
                    let time = chapter.time;
                    panel = panel.child(self.menu_row(
                        SharedString::from(format!("chapter-{index}")),
                        chapter.title.clone(),
                        format_time(time),
                        current == Some(index),
                        cx,
                        move |this, _, _| {
                            let _ = this.player.seek_to(time);
                        },
                    ));
                }
            }
        }
        panel
    }

    fn render_osd(&self) -> Option<impl IntoElement> {
        let osd = self.osd.clone()?;
        let age = osd.at.elapsed().as_secs_f32();
        let opacity = if age < 0.6 { 1.0 } else { (1.0 - (age - 0.6) / 0.3).max(0.0) };
        let scale = 1.0 + (0.12 * (1.0 - (age / 0.25).min(1.0)));
        Some(
            div().absolute().inset_0().flex().items_center().justify_center().child(
                div()
                    .flex()
                    .flex_col()
                    .items_center()
                    .gap(px(8.))
                    .opacity(opacity)
                    .child(
                        div()
                            .size(px(72. * scale))
                            .rounded_full()
                            .bg(black(0.55))
                            .flex()
                            .items_center()
                            .justify_center()
                            .child(icon(osd.icon, 32. * scale, white(1.0))),
                    )
                    .when(!osd.text.is_empty(), |el| {
                        el.child(
                            div()
                                .px(px(12.))
                                .py(px(4.))
                                .rounded_full()
                                .bg(black(0.55))
                                .text_sm()
                                .font_weight(gpui::FontWeight::SEMIBOLD)
                                .text_color(white(0.95))
                                .child(osd.text),
                        )
                    }),
            ),
        )
    }

    fn icon_button(
        &self,
        id: &'static str,
        icon_name: &'static str,
        size_px: f32,
        active: bool,
        cx: &mut Context<Self>,
        on_click: impl Fn(&mut Self, &mut Window, &mut Context<Self>) + 'static,
    ) -> gpui::Stateful<gpui::Div> {
        div()
            .id(id)
            .size(px(size_px + 18.))
            .flex()
            .items_center()
            .justify_center()
            .rounded_full()
            .cursor_pointer()
            .when(active, |el| el.bg(white(0.16)))
            .hover(|style| style.bg(white(0.12)))
            .active(|style| style.bg(white(0.2)))
            .on_click(cx.listener(move |this, _, window, cx| {
                cx.stop_propagation();
                this.poke();
                on_click(this, window, cx);
                cx.notify();
            }))
            .relative()
            .child(icon(icon_name, size_px, white(0.95)))
            // The web player labels its seek buttons with the step.
            .when(icon_name == "back" || icon_name == "forward", |el| {
                el.child(
                    div()
                        .absolute()
                        .inset_0()
                        .flex()
                        .items_center()
                        .justify_center()
                        .text_size(px(size_px * 0.32))
                        .font_weight(gpui::FontWeight::BOLD)
                        .text_color(white(0.95))
                        .child("10"),
                )
            })
    }

    /// Top: close + title/episode on the left, utilities on the right.
    fn render_header(&self, window: &Window, cx: &mut Context<Self>) -> impl IntoElement {
        let identity = self.identity.clone();
        let title = identity
            .as_ref()
            .map(|i| i.title.clone())
            .or_else(|| self.state.title.clone())
            .unwrap_or_default();
        let subtitle = identity.as_ref().and_then(|i| i.subtitle());
        let menu = self.menu;
        let fullscreen = window.is_fullscreen();
        // Leave room for the traffic lights when windowed.
        let top = if fullscreen { 28. } else { 44. };

        div()
            .absolute()
            .top_0()
            .left_0()
            .right_0()
            .pt(px(top))
            .pb(px(70.))
            .px(px(28.))
            .bg(linear_gradient(180., linear_color_stop(black(0.75), 0.), linear_color_stop(black(0.0), 1.)))
            .flex()
            .items_start()
            .justify_between()
            .on_mouse_down(MouseButton::Left, |_, _, cx| cx.stop_propagation())
            .child(
                div()
                    .flex()
                    .items_start()
                    .gap(px(14.))
                    .min_w_0()
                    .child(self.icon_button("close", "close", 24., false, cx, |this, window, cx| this.close_media(window, cx)))
                    .child(
                        div()
                            .flex()
                            .flex_col()
                            .gap(px(6.))
                            .pt(px(2.))
                            .min_w_0()
                            .child(
                                div()
                                    .text_size(px(30.))
                                    .line_height(px(36.))
                                    .font_weight(gpui::FontWeight::BOLD)
                                    .text_color(white(1.0))
                                    .truncate()
                                    .child(title),
                            )
                            .when_some(subtitle, |el, subtitle| {
                                el.child(div().text_size(px(18.)).font_weight(gpui::FontWeight::MEDIUM).text_color(white(0.92)).truncate().child(subtitle))
                            }),
                    ),
            )
            .child(
                div()
                    .flex()
                    .items_center()
                    .gap(px(6.))
                    .flex_none()
                    .child(self.icon_button(
                        "subtitles",
                        if self.state.subtitle_id.is_some() { "subtitles-on" } else { "subtitles" },
                        22.,
                        menu == Some(Menu::Subtitles),
                        cx,
                        |this, _, _| this.toggle_menu(Menu::Subtitles),
                    ))
                    .child(self.render_volume(cx))
                    .child(self.icon_button(
                        "fullscreen",
                        if fullscreen { "fullscreen-exit" } else { "fullscreen" },
                        22.,
                        false,
                        cx,
                        |_, window, _| window.toggle_fullscreen(),
                    ))
                    .child(
                        div()
                            .id("speed")
                            .h(px(40.))
                            .min_w(px(40.))
                            .px(px(8.))
                            .flex()
                            .items_center()
                            .justify_center()
                            .rounded_full()
                            .cursor_pointer()
                            .text_size(px(18.))
                            .font_weight(gpui::FontWeight::MEDIUM)
                            .text_color(white(0.95))
                            .when(menu == Some(Menu::Speed), |el| el.bg(white(0.16)))
                            .hover(|style| style.bg(white(0.12)))
                            .on_click(cx.listener(|this, _, _, cx| {
                                cx.stop_propagation();
                                this.toggle_menu(Menu::Speed);
                                cx.notify();
                            }))
                            .child(format!("{}x", trim_number(self.state.speed))),
                    )
                    .child(self.icon_button("more", "more", 22., menu == Some(Menu::More), cx, |this, _, _| this.toggle_menu(Menu::More))),
            )
    }

    /// Bottom: time · seek line · duration, centred transport, and the
    /// "Up next" card: a preview in the last minute, and the autoplay
    /// countdown (Cancel / Play now) once the episode ends.
    fn render_up_next(&self, cx: &mut Context<Self>) -> Option<impl IntoElement> {
        let next = self.next_episode.clone()?;
        let state = &self.state;
        if !(near_episode_end(state) || state.ended) || self.autoplay_cancelled && state.ended {
            return None;
        }
        let item = self.items.iter().find(|i| i.path == next);
        let em = self.episode_metas.get(&next);
        let still = em.and_then(|m| m.still.clone()).or_else(|| item.and_then(|i| i.backdrop.clone().or(i.poster.clone())));
        let code = item.and_then(|i| i.episode).map(|e| format!("Episode {e}")).unwrap_or_else(|| "Next episode".into());
        let name = em.and_then(|m| m.name.clone()).or_else(|| item.and_then(|i| i.episode_title.clone()));
        let countdown = self.autoplay_at.map(|at| AUTOPLAY_COUNTDOWN.saturating_sub(at.elapsed()).as_secs_f32().ceil() as u32);
        let button = |id: &'static str, label: &'static str, primary: bool| {
            div()
                .id(id)
                .h(px(32.))
                .px(px(14.))
                .flex()
                .items_center()
                .rounded(px(theme::RADIUS))
                .cursor_pointer()
                .text_size(px(13.))
                .font_weight(gpui::FontWeight::SEMIBOLD)
                .when(primary, |el| el.bg(white(0.97)).text_color(black(0.95)).hover(|s| s.bg(white(0.85))))
                .when(!primary, |el| el.bg(rgba(0x262626e6)).text_color(white(0.97)).hover(|s| s.bg(rgba(0x3a3a3af0))))
                .child(label)
        };
        Some(
            div()
                .absolute()
                .right(px(28.))
                .bottom(px(150.))
                .w(px(340.))
                .p(px(10.))
                .flex()
                .gap(px(12.))
                .rounded(px(14.))
                .bg(rgba(0x141414f0))
                .border_1()
                .border_color(white(0.12))
                .on_mouse_down(MouseButton::Left, |_, _, cx| cx.stop_propagation())
                .child(
                    div()
                        .relative()
                        .w(px(128.))
                        .h(px(72.))
                        .flex_none()
                        .rounded(px(8.))
                        .overflow_hidden()
                        .bg(white(0.08))
                        .when_some(still, |el, p| el.child(crate::assets::artwork_cover(p, 8.))),
                )
                .child(
                    div()
                        .flex_1()
                        .min_w_0()
                        .flex()
                        .flex_col()
                        .gap(px(4.))
                        .child(div().text_size(px(11.)).text_color(white(0.6)).child(match countdown {
                            Some(n) => format!("Playing next in {n}s"),
                            None => "Up next".into(),
                        }))
                        .child(div().text_size(px(14.)).font_weight(gpui::FontWeight::SEMIBOLD).text_color(white(0.97)).truncate().child(match name {
                            Some(n) => format!("{code} · {n}"),
                            None => code,
                        }))
                        .child(
                            div()
                                .pt(px(4.))
                                .flex()
                                .gap(px(8.))
                                .child(button("up-next-play", "Play now", true).on_click(cx.listener(|this, _, window, cx| {
                                    cx.stop_propagation();
                                    this.autoplay_fired = true;
                                    this.play_next(window, cx);
                                })))
                                .when(countdown.is_some(), |el| {
                                    el.child(button("up-next-cancel", "Cancel", false).on_click(cx.listener(|this, _, _, cx| {
                                        cx.stop_propagation();
                                        this.autoplay_cancelled = true;
                                        this.autoplay_at = None;
                                        cx.notify();
                                    })))
                                }),
                        ),
                ),
        )
    }

    /// Next Episode / Skip Intro actions on the right.
    fn render_footer(&self, cx: &mut Context<Self>) -> impl IntoElement {
        let state = &self.state;
        let shown = self.scrub_fraction.map(|f| f as f64 * state.duration).unwrap_or(state.position);
        let playing = !(state.paused || state.ended);
        let time = |text: String| {
            div().flex_none().min_w(px(58.)).text_size(px(18.)).font_weight(gpui::FontWeight::SEMIBOLD).text_color(white(0.96)).child(text)
        };
        let action = |id: &'static str, label: &'static str, primary: bool| {
            div()
                .id(id)
                .h(px(38.))
                .px(px(16.))
                .flex()
                .items_center()
                .rounded(px(theme::RADIUS))
                .cursor_pointer()
                .text_size(px(16.))
                .font_weight(gpui::FontWeight::SEMIBOLD)
                .when(primary, |el| el.bg(white(0.97)).text_color(black(0.95)).hover(|s| s.bg(white(0.85))))
                .when(!primary, |el| el.bg(rgba(0x262626e6)).text_color(white(0.97)).hover(|s| s.bg(rgba(0x3a3a3af0))))
                .child(label)
        };
        let skip = self.skip_action();
        let next = self.next_episode.is_some();

        div()
            .id("footer")
            .absolute()
            .left_0()
            .right_0()
            .bottom_0()
            .pt(px(110.))
            .px(px(28.))
            .pb(px(18.))
            .bg(linear_gradient(180., linear_color_stop(black(0.0), 0.), linear_color_stop(black(0.8), 1.)))
            .on_hover(cx.listener(|this, hovered: &bool, _, cx| {
                this.over_controls = *hovered;
                cx.notify();
            }))
            .on_mouse_down(MouseButton::Left, |_, _, cx| cx.stop_propagation())
            .on_click(|_, _, cx| cx.stop_propagation())
            .flex()
            .flex_col()
            .gap(px(10.))
            .child(
                div()
                    .flex()
                    .items_center()
                    .gap(px(18.))
                    .child(time(format_time(shown)))
                    .child(div().relative().flex_1().child(self.render_seek_bar(cx)).children(self.render_preview()))
                    .child(time(format_time(state.duration))),
            )
            .child(
                div()
                    .relative()
                    .h(px(64.))
                    .flex()
                    .items_center()
                    .justify_center()
                    .child(
                        div()
                            .flex()
                            .items_center()
                            .gap(px(28.))
                            .child(self.icon_button("back", "back", 28., false, cx, |this, _, _| this.seek_by(-10.0)))
                            .child(
                                div()
                                    .id("play")
                                    .size(px(64.))
                                    .flex()
                                    .items_center()
                                    .justify_center()
                                    .rounded_full()
                                    .cursor_pointer()
                                    .bg(rgba(0x2b2b2bd9))
                                    .hover(|style| style.bg(rgba(0x404040e6)))
                                    .active(|style| style.bg(rgba(0x555555f0)))
                                    .on_click(cx.listener(|this, _, _, cx| {
                                        cx.stop_propagation();
                                        this.poke();
                                        this.toggle_pause();
                                        cx.notify();
                                    }))
                                    .child(icon(if playing { "pause" } else { "play" }, 30., white(1.0))),
                            )
                            .child(self.icon_button("forward", "forward", 28., false, cx, |this, _, _| this.seek_by(10.0))),
                    )
                    .child(
                        div()
                            .absolute()
                            .right_0()
                            .top_0()
                            .bottom_0()
                            .flex()
                            .items_center()
                            .gap(px(12.))
                            .when(next, |el| {
                                el.child(action("next", "Next Episode", false).on_click(cx.listener(|this, _, window, cx| {
                                    cx.stop_propagation();
                                    this.play_next(window, cx);
                                })))
                            })
                            .when_some(skip, |el, (label, end)| {
                                el.child(action("skip-intro", "", true).child(label).on_click(cx.listener(move |this, _, _, cx| {
                                    cx.stop_propagation();
                                    let _ = this.player.seek_to(end);
                                    cx.notify();
                                })))
                            }),
                    ),
            )
    }
}

impl Render for PlayerView {
    fn render(&mut self, window: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
        let has_media = self.media.is_some();
        let opacity = self.controls_opacity;
        // Light, dark or follow macOS; playback always stays dark.
        let light = match self.catalog.setting("theme").as_deref() {
            Some("light") => true,
            Some("system") => matches!(window.appearance(), gpui::WindowAppearance::Light | gpui::WindowAppearance::VibrantLight),
            _ => false,
        };
        theme::set_light(light && !has_media);
        self.take_dropdown_dismiss();

        div()
            .id("player")
            .track_focus(&self.focus)
            .key_context("Player")
            .size_full()
            .relative()
            .overflow_hidden()
            .font_family("Archivo")
            // No background: the libmpv surface underneath shows through.
            .on_key_down(cx.listener(Self::on_key_down))
            .on_key_up(cx.listener(Self::on_key_up))
            .on_mouse_move(cx.listener(Self::on_mouse_move))
            .on_mouse_up(MouseButton::Left, cx.listener(Self::on_mouse_up))
            .on_mouse_up_out(MouseButton::Left, cx.listener(Self::on_mouse_up))
            .on_drop(cx.listener(|this, paths: &ExternalPaths, window, cx| this.on_drop_paths(paths, window, cx)))
            .on_scroll_wheel(cx.listener(|this, event: &ScrollWheelEvent, _, cx| {
                if this.media.is_none() {
                    return;
                }
                let delta = f32::from(event.delta.pixel_delta(px(16.)).y);
                if delta.abs() > 0.5 {
                    this.poke();
                    this.change_volume(if delta > 0.0 { 2.0 } else { -2.0 });
                    cx.notify();
                }
            }))
            .when(!has_media, |el| el.child(self.render_shell(window, cx)))
            .when(has_media, |el| {
                el.child(
                    // Click the picture to play/pause, double-click for fullscreen.
                    div()
                        .id("surface")
                        .absolute()
                        .inset_0()
                        .on_click(cx.listener(|this, event: &ClickEvent, window, cx| {
                            if this.menu.take().is_some() {
                                cx.notify();
                                return;
                            }
                            match event.click_count() {
                                1 => this.toggle_pause(),
                                2 => {
                                    this.toggle_pause();
                                    this.osd = None;
                                    window.toggle_fullscreen();
                                }
                                _ => {}
                            }
                            cx.notify();
                        })),
                )
                .when(self.state.buffering, |el| {
                    el.child(
                        div().absolute().inset_0().flex().items_center().justify_center().child(
                            div().px(px(14.)).py(px(6.)).rounded_full().bg(black(0.6)).text_sm().text_color(white(0.9)).child("Buffering…"),
                        ),
                    )
                })
                .children(self.render_osd())
                .children(self.render_up_next(cx))
                .child(div().absolute().inset_0().opacity(opacity).child(self.render_header(window, cx)).child(self.render_footer(cx)))
                .when_some(self.menu.filter(|_| opacity > 0.5), |el, menu| el.child(self.render_menu(menu, cx)))
            })
            .when_some(self.state.error.clone(), |el, error| {
                el.child(
                    div().absolute().top(px(44.)).left_0().right_0().flex().justify_center().child(
                        div()
                            .max_w(px(520.))
                            .px(px(16.))
                            .py(px(10.))
                            .rounded(px(12.))
                            .bg(rgba(0x3a1414f0))
                            .border_1()
                            .border_color(rgba(0xff6b6b55))
                            .text_sm()
                            .text_color(white(0.95))
                            .child(error),
                    ),
                )
            })
    }
}

fn near_episode_end(state: &PlaybackState) -> bool {
    state.duration > 120.0 && state.duration - state.position <= 60.0
}

pub fn start_ticking(window: &mut Window, cx: &mut Context<PlayerView>) {
    cx.observe_window_appearance(window, |_, _, cx| cx.notify()).detach();
    cx.spawn_in(window, async move |this, cx| {
        cx.background_executor().timer(Duration::from_millis(200)).await;
        if this.update(cx, |view, _| view.start_auto_scan()).is_err() {
            return;
        }
        loop {
            let Ok(next_delay) = this.update_in(cx, |view, window, cx| {
                view.tick(window, cx);
                if view.media.is_some() {
                    Duration::from_millis(33)
                } else {
                    Duration::from_millis(250)
                }
            }) else { break };
            cx.background_executor().timer(next_delay).await;
        }
    })
    .detach();
}

impl gpui::Focusable for PlayerView {
    fn focus_handle(&self, _: &App) -> FocusHandle {
        self.focus.clone()
    }
}
