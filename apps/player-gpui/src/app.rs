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
const SPEEDS: [f64; 7] = [0.5, 0.75, 1.0, 1.25, 1.5, 1.75, 2.0];
const SUBTITLE_EXTENSIONS: [&str; 6] = ["srt", "ass", "ssa", "vtt", "sub", "sup"];
const PREVIEW_WIDTH: f32 = 208.0;

#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum Menu {
    Audio,
    Subtitles,
    Speed,
    Chapters,
    /// The Settings root: rows that drill into the pages above.
    More,
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

pub struct PlayerView {
    pub player: Arc<Player>,
    libmpv: PathBuf,
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
    pub settings_section: crate::shell_ui::SettingsSection,
    pub title_menu: bool,
    pub selected_season: Option<u32>,
    pub open_select: Option<&'static str>,
    scan_generation: u64,
    last_auto_scan: Instant,
    last_saved: Instant,
    was_paused: bool,
}

impl PlayerView {
    pub fn new(player: Arc<Player>, libmpv: PathBuf, gpui_view: usize, catalog: Catalog, cx: &mut Context<Self>) -> Self {
        catalog.scan(None, true);
        Self {
            player,
            libmpv,
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
            screen: Screen::Home,
            libraries: catalog.libraries(),
            items: catalog.items(),
            personal: catalog.personal(),
            search_query: String::new(),
            search_focus: cx.focus_handle(),
            collection_draft: String::new(),
            collection_focus: cx.focus_handle(),
            collection_picker: false,
            collection_target: None,
            sort: Sort::Title,
            watch_filter: WatchFilter::All,
            hero_index: 0,
            hero_paused: false,
            hero_since: Instant::now(),
            settings_section: crate::shell_ui::SettingsSection::Playback,
            title_menu: false,
            selected_season: None,
            open_select: None,
            scan_generation: 0,
            last_auto_scan: Instant::now(),
            last_saved: Instant::now(),
            was_paused: true,
        }
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
        self.save_progress();
        let resolved = mpv::local_media_path(path).unwrap_or_else(|_| path.to_path_buf());
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
        let _ = self.player.set("sid", if pref("subtitles_on").as_deref() == Some("no") { "no" } else { "auto" });
        match self.player.load(path, start) {
            Ok(()) => {
                let path = resolved;
                let identity = media::identify(&path);
                window.set_window_title(&identity.title);
                self.next_episode = self.catalog_next(&path).or_else(|| media::next_episode(&path));
                self.identity = Some(identity);
                if start > 0.0 {
                    self.flash("play", format!("Resuming from {}", format_time(start)));
                }
                self.previews = Some(PreviewService::start(self.libmpv.clone(), &path));
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

    /// Records the current position for the open file.
    pub fn save_progress(&mut self) {
        let Some(path) = self.media.clone() else { return };
        let state = self.player.snapshot();
        if state.duration > 0.0 {
            let position = if state.ended { state.duration } else { state.position };
            self.catalog.record_progress(&path, position, state.duration);
        }
        self.last_saved = Instant::now();
    }

    /// Back to the start screen, keeping the watch position.
    pub fn close_media(&mut self, window: &mut Window, cx: &mut Context<Self>) {
        self.save_progress();
        let _ = self.player.command(&["stop"]);
        self.media = None;
        self.previews = None;
        self.identity = None;
        self.next_episode = None;
        self.menu = None;
        self.retire_preview();
        if window.is_fullscreen() {
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
        self.state = self.player.snapshot();
        if self.media.is_some() && self.state.loaded {
            let paused_now = self.state.paused || self.state.ended;
            if (paused_now && !self.was_paused) || self.last_saved.elapsed() > Duration::from_secs(5) {
                self.save_progress();
            }
            self.was_paused = paused_now;
        }
        if let Some(id) = self.state.subtitle_id {
            self.last_subtitle = Some(id);
        }

        let visible = self.controls_wanted();
        let target = if visible { 1.0 } else { 0.0 };
        let step = if visible { 0.25 } else { 0.12 };
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
        }
        // Library refresh: pick up finished scans, auto-refresh every 15 min.
        let generation = self.catalog.status.lock().generation;
        if generation != self.scan_generation {
            self.scan_generation = generation;
            self.reload_catalog();
        }
        if self.last_auto_scan.elapsed() > Duration::from_secs(15 * 60) {
            self.last_auto_scan = Instant::now();
            self.catalog.scan(None, true);
        }
        self.tick_hero();
        if let Some(osd) = &self.osd {
            if osd.at.elapsed() > Duration::from_millis(900) {
                self.osd = None;
            }
        }

        self.update_preview_image(window);
        for image in self.retired_images.drain(..) {
            window.drop_image(image).ok();
        }
        cx.notify();
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

fn black(alpha: f32) -> Hsla {
    Hsla { h: 0., s: 0., l: 0., a: alpha }
}

/// Plexy's accent: the web app's warm amber.
fn accent() -> Hsla {
    rgba(0xf5b83dff).into()
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
                        .bg(theme::overlay().opacity(0.94))
                        .border_1()
                        .border_color(theme::border())
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

    fn menu_row(
        &self,
        id: impl Into<gpui::ElementId>,
        label: String,
        detail: String,
        selected: bool,
        cx: &mut Context<Self>,
        on_click: impl Fn(&mut Self, &mut Window, &mut Context<Self>) + 'static,
    ) -> impl IntoElement {
        div()
            .id(id.into())
            .flex()
            .items_center()
            .gap(px(10.))
            .px(px(10.))
            .py(px(7.))
            .rounded(px(8.))
            .cursor_pointer()
            .hover(|style| style.bg(white(0.1)))
            .on_click(cx.listener(move |this, _, window, cx| {
                cx.stop_propagation();
                on_click(this, window, cx);
                cx.notify();
            }))
            .child(
                div()
                    .size(px(16.))
                    .flex_none()
                    .when(selected, |el| el.child(icon("check", 16., accent()))),
            )
            .child(
                div()
                    .flex()
                    .flex_col()
                    .min_w_0()
                    .child(
                        div()
                            .text_sm()
                            .text_color(if selected { white(1.0) } else { white(0.85) })
                            .font_weight(if selected { gpui::FontWeight::SEMIBOLD } else { gpui::FontWeight::NORMAL })
                            .child(label),
                    )
                    .when(!detail.is_empty(), |el| el.child(div().text_xs().text_color(white(0.5)).child(detail))),
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
            .flex()
            .items_center()
            .gap(px(14.))
            .px(px(14.))
            .py(px(12.))
            .rounded(px(theme::RADIUS))
            .cursor_pointer()
            .hover(|style| style.bg(theme::default_soft()))
            .on_click(cx.listener(move |this, _, _, cx| {
                cx.stop_propagation();
                this.menu = Some(page);
                cx.notify();
            }))
            .child(icon(icon_name, 22., theme::foreground()))
            .child(div().flex_1().text_size(px(17.)).font_weight(gpui::FontWeight::BOLD).text_color(theme::foreground()).child(label))
            .child(div().text_size(px(17.)).text_color(theme::muted()).child(value))
            .child(icon("chevron-right", 16., theme::muted()))
    }

    fn render_menu(&self, menu: Menu, cx: &mut Context<Self>) -> impl IntoElement {
        let divider = || div().mx(px(14.)).my(px(8.)).h(px(1.)).bg(theme::separator());
        let title = match menu {
            Menu::More => "Settings",
            Menu::Audio => "Audio",
            Menu::Subtitles => "Subtitles",
            Menu::Speed => "Speed",
            Menu::Chapters => "Chapters",
        };
        let header = div()
            .relative()
            .h(px(48.))
            .flex()
            .items_center()
            .justify_center()
            .child(div().text_size(px(17.)).font_weight(gpui::FontWeight::BOLD).text_color(theme::foreground()).child(title))
            .when(menu != Menu::More, |el| {
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
                        .hover(|style| style.bg(theme::default_soft()))
                        .on_click(cx.listener(|this, _, _, cx| {
                            cx.stop_propagation();
                            this.menu = Some(Menu::More);
                            cx.notify();
                        }))
                        .child(icon("chevron-left", 18., theme::foreground())),
                )
            });

        let mut panel = div()
            .id("menu")
            .absolute()
            .right(px(28.))
            .top(px(96.))
            .w(px(420.))
            .max_h(px(520.))
            .overflow_y_scroll()
            .p(px(10.))
            .rounded(px(theme::RADIUS_XL))
            .bg(theme::overlay().opacity(0.96))
            .border_1()
            .border_color(theme::border())
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
            Menu::Speed => {
                for speed in SPEEDS {
                    panel = panel.child(self.menu_row(
                        SharedString::from(format!("speed-{speed}")),
                        if speed == 1.0 { "Normal".into() } else { format!("{}x", trim_number(speed)) },
                        String::new(),
                        (self.state.speed - speed).abs() < 0.01,
                        cx,
                        move |this, _, _| this.set_speed(speed),
                    ));
                }
            }
            Menu::Chapters => {
                let current = self.state.chapters.iter().rposition(|c| c.time <= self.state.position + 0.25);
                for (index, chapter) in self.state.chapters.clone().into_iter().enumerate() {
                    let time = chapter.time;
                    panel = panel.child(self.menu_row(
                        SharedString::from(format!("chapter-{index}")),
                        chapter.title,
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
        let intro_end = self.intro_end();
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
                            .when_some(intro_end, |el, end| {
                                el.child(action("skip-intro", "Skip Intro", true).on_click(cx.listener(move |this, _, _, cx| {
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

        div()
            .id("player")
            .track_focus(&self.focus)
            .key_context("Player")
            .size_full()
            .relative()
            .overflow_hidden()
            .font_family(".SystemUIFont")
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

pub fn start_ticking(window: &mut Window, cx: &mut Context<PlayerView>) {
    cx.spawn_in(window, async move |this, cx| loop {
        cx.background_executor().timer(Duration::from_millis(33)).await;
        if this.update_in(cx, |view, window, cx| view.tick(window, cx)).is_err() {
            break;
        }
    })
    .detach();
}

impl gpui::Focusable for PlayerView {
    fn focus_handle(&self, _: &App) -> FocusHandle {
        self.focus.clone()
    }
}
