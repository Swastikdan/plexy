//! `--self-test REPORT.json`: drives the real window through playback,
//! track switching, shortcuts, seek previews, resize and fullscreen, writes a
//! JSON report plus window screenshots next to it, then quits.
//!
//! Keystrokes go through GPUI's normal dispatch (`Window::dispatch_keystroke`),
//! so they exercise the same handlers a person pressing keys would.

use std::ffi::c_void;
use std::fmt::Write as _;
use std::path::PathBuf;
use std::time::{Duration, Instant};

use gpui::{px, size, AsyncWindowContext, Context, Keystroke, WeakEntity, Window};

use crate::app::PlayerView;

trait PairDefault<A: Default, B> {
    fn unwrap_or_default_pair(self) -> (A, B);
}

impl<A: Default> PairDefault<A, crate::library_ui::Screen> for anyhow::Result<(A, crate::library_ui::Screen)> {
    fn unwrap_or_default_pair(self) -> (A, crate::library_ui::Screen) {
        self.unwrap_or((A::default(), crate::library_ui::Screen::Home))
    }
}
use crate::mpv::{self, PlaybackState, TrackKind};

struct Report {
    checks: Vec<(String, bool, String)>,
    screenshots: Vec<String>,
}

impl Report {
    fn check(&mut self, name: &str, ok: bool, detail: impl Into<String>) {
        let detail = detail.into();
        eprintln!("[self-test] {} {name}: {detail}", if ok { "PASS" } else { "FAIL" });
        self.checks.push((name.into(), ok, detail));
    }

    fn json(&self) -> String {
        let escape = |s: &str| s.replace('\\', "\\\\").replace('"', "\\\"").replace('\n', "\\n");
        let mut out = String::from("{\n  \"passed\": ");
        let _ = write!(out, "{},\n  \"checks\": [\n", self.checks.iter().all(|(_, ok, _)| *ok));
        for (index, (name, ok, detail)) in self.checks.iter().enumerate() {
            let _ = write!(
                out,
                "    {{\"name\": \"{}\", \"ok\": {ok}, \"detail\": \"{}\"}}{}\n",
                escape(name),
                escape(detail),
                if index + 1 == self.checks.len() { "" } else { "," }
            );
        }
        out.push_str("  ],\n  \"screenshots\": [");
        out.push_str(&self.screenshots.iter().map(|s| format!("\"{}\"", escape(s))).collect::<Vec<_>>().join(", "));
        out.push_str("]\n}\n");
        out
    }
}

type Cx = AsyncWindowContext;

async fn sleep(cx: &mut Cx, ms: u64) {
    cx.background_executor().timer(Duration::from_millis(ms)).await;
}

fn state(this: &WeakEntity<PlayerView>, cx: &mut Cx) -> PlaybackState {
    this.update(cx, |view, _| view.player.snapshot()).unwrap_or_default()
}

fn get(this: &WeakEntity<PlayerView>, cx: &mut Cx, name: &str) -> Option<String> {
    this.update(cx, |view, _| view.player.get(name)).ok().flatten()
}

fn time_pos(this: &WeakEntity<PlayerView>, cx: &mut Cx) -> f64 {
    get(this, cx, "time-pos").and_then(|v| v.parse().ok()).unwrap_or(f64::NAN)
}

async fn wait_until(
    this: &WeakEntity<PlayerView>,
    cx: &mut Cx,
    timeout_ms: u64,
    mut predicate: impl FnMut(&PlaybackState) -> bool,
) -> bool {
    let started = Instant::now();
    while started.elapsed() < Duration::from_millis(timeout_ms) {
        if predicate(&state(this, cx)) {
            return true;
        }
        sleep(cx, 50).await;
    }
    false
}

async fn key(this: &WeakEntity<PlayerView>, cx: &mut Cx, keystroke: &str) {
    let keystroke = Keystroke::parse(keystroke).expect("keystroke");
    let _ = this;
    cx.update(|window, cx| {
        cx.activate(true);
        window.activate_window();
    })
    .ok();
    cx.update(|window, cx| {
        window.dispatch_keystroke(keystroke, cx);
    })
    .ok();
    sleep(cx, 350).await;
}

/// Clicks at window point (x, y) through the window's real NSEvent path,
/// so it goes through GPUI hit-testing exactly like a person's click.
async fn click(this: &WeakEntity<PlayerView>, cx: &mut Cx, x: f32, y: f32) {
    mouse_click(this, cx, x, y, false).await;
}

async fn mouse_click(this: &WeakEntity<PlayerView>, cx: &mut Cx, x: f32, y: f32, right: bool) {
    let Ok(view) = this.update(cx, |view, _| view.gpui_view) else { return };
    let (down, up) = if right { (3, 4) } else { (1, 2) };
    for (kind, wait) in [(0, 120u64), (down, 60), (up, 0)] {
        mpv::debug_mouse(view as *mut c_void, kind, x as f64, y as f64);
        sleep(cx, wait).await;
    }
    sleep(cx, 400).await;
}

/// Window-space centre of the transport's play button.
fn play_button_point(cx: &mut Cx) -> (f32, f32) {
    cx.update(|window, _| {
        let size = window.viewport_size();
        (f32::from(size.width) / 2.0, f32::from(size.height) - 18.0 - 32.0)
    })
    .unwrap_or((0.0, 0.0))
}

async fn screenshot(this: &WeakEntity<PlayerView>, cx: &mut Cx, dir: &PathBuf, name: &str, report: &mut Report) {
    // Region capture records whatever is on screen there, so the player
    // must be the frontmost window first.
    cx.update(|window, cx| {
        cx.activate(true);
        window.activate_window();
    })
    .ok();
    sleep(cx, 700).await;
    // Capture the window's screen rectangle: what a person would see,
    // including the libmpv surface beneath GPUI's layer.
    let frame = this.update(cx, |view, _| mpv::window_frame(view.gpui_view as *mut c_void)).ok().flatten();
    let path = dir.join(format!("{name}.png"));
    let Some([x, y, w, h]) = frame else {
        report.check(&format!("screenshot {name}"), false, "no window frame");
        return;
    };
    let status = std::process::Command::new("/usr/sbin/screencapture")
        .args(["-x", &format!("-R{x:.0},{y:.0},{w:.0},{h:.0}")])
        .arg(&path)
        .status();
    match status {
        Ok(status) if status.success() && path.exists() => report.screenshots.push(path.display().to_string()),
        other => report.check(&format!("screenshot {name}"), false, format!("{other:?}")),
    }
}

pub fn run(report_path: PathBuf, window: &mut Window, cx: &mut Context<PlayerView>) {
    cx.spawn_in(window, async move |this, cx| {
        let dir = report_path.parent().map(PathBuf::from).unwrap_or_default();
        let mut report = Report { checks: Vec::new(), screenshots: Vec::new() };

        // 1. Playback starts from the filesystem path.
        let loaded = wait_until(&this, cx, 15_000, |s| s.loaded && s.duration > 0.0).await;
        let s = state(&this, cx);
        report.check("loads local file", loaded, format!("duration {:.2}s, title {:?}", s.duration, s.title));
        let start = s.position;
        let playing = wait_until(&this, cx, 6_000, |s| s.position > start + 0.8).await;
        report.check("plays", playing, format!("position advanced to {:.2}s", state(&this, cx).position));

        // 1b. The on-screen play button pauses and resumes.
        let (px_, py_) = play_button_point(cx);
        // Let the chrome auto-hide first: the click must still land.
        sleep(cx, 3_200).await;
        let before = state(&this, cx).paused;
        click(&this, cx, px_, py_).await;
        let toggled = wait_until(&this, cx, 1_500, |s| s.paused != before).await;
        let paused_at = state(&this, cx).position;
        sleep(cx, 2_000).await;
        let paused = state(&this, cx);
        let icon_paused = this.update(cx, |view, _| view.state.paused).unwrap_or(before);
        report.check("play button stays paused", toggled && icon_paused && paused.paused && (paused.position - paused_at).abs() < 0.15,
            format!("paused {} at {:.2}s (started pause at {paused_at:.2}s)", paused.paused, paused.position));
        click(&this, cx, px_, py_).await;
        let back = wait_until(&this, cx, 1_500, |s| s.paused == before).await;
        let resumed_at = state(&this, cx).position;
        let advancing = wait_until(&this, cx, 3_000, |s| !s.paused && s.position > resumed_at + 0.8).await;
        report.check("play button resumes", back && advancing, format!("paused {}, position {:.2}s", state(&this, cx).paused, state(&this, cx).position));

        // Use the player menu's editor and verify the skip action and saved marker.
        let (middle, _) = play_button_point(cx);
        click(&this, cx, 2. * middle - 48., 63.).await;
        click(&this, cx, 2. * middle - 190., 305.).await;
        let editing = this.update(cx, |v, _| v.marker_editor.is_some()).unwrap_or(false);
        report.check("player menu opens Edit markers", editing, format!("open {editing}"));
        if editing {
            this.update(cx, |v, cx| {
                if let Some(editor) = &mut v.marker_editor {
                    editor.start = "0".into();
                    editor.end = "24".into();
                    cx.notify();
                }
            }).ok();
            screenshot(&this, cx, &dir, "marker-editor", &mut report).await;
            this.update(cx, |v, cx| v.save_marker(false, cx)).ok();
            let marker = this.update(cx, |v, _| {
                let Some(path) = &v.media else { return false };
                v.skip_action().is_some_and(|(label, end)| label == "Skip intro" && end == 24.)
                    && v.catalog.manual_segments(path).intro.is_some_and(|marker| marker.end == 24.)
            }).unwrap_or(false);
            report.check("manual intro marker persists and offers Skip intro", marker, format!("active {marker}"));
            screenshot(&this, cx, &dir, "skip-intro", &mut report).await;
            click(&this, cx, 2. * middle - 92., py_ + 1.).await;
            let skipped = wait_until(&this, cx, 1_500, |s| s.position >= 23.9).await;
            report.check("Skip intro seeks to marker end", skipped, format!("position {:.2}s", state(&this, cx).position));
        }
        this.update(cx, |v, cx| {
            if let Some(path) = &v.media {
                let _ = v.catalog.save_manual_segment(path, crate::catalog::SegmentKind::Intro, None);
                v.manual_segments = Default::default();
            }
            v.menu = None;
            cx.notify();
        }).ok();

        // 1c. An open menu closes on a press anywhere outside it, including
        // the header above it, and that press does not pause playback.
        this.update(cx, |view, cx| {
            view.toggle_menu_for_test(crate::app::Menu::More);
            cx.notify();
        })
        .ok();
        sleep(cx, 300).await;
        let paused_before = state(&this, cx).paused;
        let (w, _) = play_button_point(cx);
        click(&this, cx, w, 60.0).await;
        let closed = this.update(cx, |view, _| view.menu.is_none()).unwrap_or(false);
        report.check("menu closes on header press", closed && state(&this, cx).paused == paused_before, format!("menu closed {closed}, paused {}", state(&this, cx).paused));

        // 1d. The Up Next card's Play now opens the next episode even though
        // it sits over the (hidden) footer.
        let next = this.update(cx, |view, _| view.next_episode.clone()).ok().flatten();
        if let Some(next) = next {
            let duration = state(&this, cx).duration;
            this.update(cx, |view, _| {
                let _ = view.player.seek_to(duration - 40.0);
            })
            .ok();
            sleep(cx, 3_200).await;
            let (w, h) = cx.update(|window, _| {
                let size = window.viewport_size();
                (f32::from(size.width), f32::from(size.height))
            })
            .unwrap_or((0.0, 0.0));
            click(&this, cx, w - 178.0, h - 168.0).await;
            sleep(cx, 800).await;
            let now = this.update(cx, |view, _| view.media.clone()).ok().flatten();
            report.check("up next Play now opens next episode", now.as_ref() == Some(&next), format!("now {:?}", now.map(|p| p.display().to_string())));
            let _ = wait_until(&this, cx, 15_000, |s| s.loaded && s.duration > 0.0).await;
        }

        // 2. Tracks.
        let _ = wait_until(&this, cx, 3_000, |s| !s.tracks.is_empty()).await;
        let s = state(&this, cx);
        let audio: Vec<_> = s.tracks_of(TrackKind::Audio).cloned().collect();
        let subs: Vec<_> = s.tracks_of(TrackKind::Subtitle).cloned().collect();
        report.check(
            "track list",
            !audio.is_empty(),
            format!(
                "audio: [{}]; subtitles: [{}]",
                audio.iter().map(|t| format!("#{} {} ({})", t.id, t.label(), t.detail())).collect::<Vec<_>>().join(", "),
                subs.iter().map(|t| format!("#{} {} ({})", t.id, t.label(), t.detail())).collect::<Vec<_>>().join(", ")
            ),
        );

        for track in &audio {
            let id = track.id;
            this.update(cx, |view, _| view.player.select_audio(id)).ok();
            let before = state(&this, cx).position;
            let switched = wait_until(&this, cx, 2_000, |s| s.audio_id == Some(id)).await;
            let advancing = wait_until(&this, cx, 2_000, |s| s.position > before + 0.3).await;
            let lang = get(&this, cx, "current-tracks/audio/lang").unwrap_or_default();
            report.check(
                &format!("audio track #{id}"),
                switched && advancing,
                format!("aid={:?} lang={lang} still playing={advancing}", state(&this, cx).audio_id),
            );
        }

        // 3. Subtitles, embedded and sidecar: each must render text at a cue.
        this.update(cx, |view, _| view.player.set_paused(true)).ok();
        for track in &subs {
            let id = track.id;
            this.update(cx, |view, _| {
                let _ = view.player.select_subtitle(Some(id));
                let _ = view.player.seek_to(3.0);
            })
            .ok();
            let _ = wait_until(&this, cx, 2_000, |s| s.subtitle_id == Some(id)).await;
            sleep(cx, 500).await;
            let text = get(&this, cx, "sub-text").unwrap_or_default();
            report.check(
                &format!("subtitle #{id} {}", if track.external { "sidecar" } else { "embedded" }),
                !text.trim().is_empty(),
                format!("{} → {:?}", track.label(), text),
            );
        }

        // 4. Preview scrubbing never moves playback.
        this.update(cx, |view, _| {
            let _ = view.player.set_paused(true);
            let _ = view.player.seek_to(5.0);
        })
        .ok();
        sleep(cx, 700).await;
        let anchor = time_pos(&this, cx);
        let duration = state(&this, cx).duration;
        let mut shown = 0;
        for fraction in [0.1f32, 0.3, 0.5, 0.7, 0.9] {
            this.update(cx, |view, cx| {
                view.hover_fraction = Some(fraction);
                cx.notify();
            })
            .ok();
            let wanted = crate::preview::bucket(fraction as f64 * duration);
            let started = Instant::now();
            while started.elapsed() < Duration::from_secs(5) {
                let ready = this
                    .update(cx, |view, _| view.previews().is_some_and(|p| p.request(fraction as f64 * duration).is_some()))
                    .unwrap_or(false);
                if ready {
                    shown += 1;
                    break;
                }
                sleep(cx, 40).await;
            }
            let _ = wanted;
        }
        let after_hover = time_pos(&this, cx);
        report.check(
            "hover previews generated",
            shown == 5,
            format!(
                "{shown}/5 frames, {} decoded by the preview core, {} from the disk cache",
                this.update(cx, |v, _| v.previews().map(|p| p.generated()).unwrap_or(0)).unwrap_or(0),
                this.update(cx, |v, _| v.previews().map(|p| p.from_disk()).unwrap_or(0)).unwrap_or(0)
            ),
        );
        report.check(
            "hover previews leave position alone",
            (after_hover - anchor).abs() < 0.01,
            format!("time-pos {anchor:.3}s before, {after_hover:.3}s after"),
        );

        this.update(cx, |view, cx| {
            view.begin_scrub(0.2);
            cx.notify();
        })
        .ok();
        sleep(cx, 400).await;
        this.update(cx, |view, cx| {
            view.scrub_fraction = Some(0.75);
            view.hover_fraction = Some(0.75);
            cx.notify();
        })
        .ok();
        sleep(cx, 900).await;
        let during_drag = time_pos(&this, cx);
        report.check(
            "drag scrubbing leaves position alone until release",
            (during_drag - anchor).abs() < 0.01,
            format!("time-pos {during_drag:.3}s while preview shows {:.1}s", 0.75 * duration),
        );
        this.update(cx, |view, cx| {
            view.end_scrub();
            view.hover_fraction = None;
            cx.notify();
        })
        .ok();
        let target = 0.75 * duration;
        let started = Instant::now();
        let mut released = time_pos(&this, cx);
        while started.elapsed() < Duration::from_secs(3) && (released - target).abs() >= 1.0 {
            sleep(cx, 100).await;
            released = time_pos(&this, cx);
        }
        report.check(
            "release commits the seek",
            (released - 0.75 * duration).abs() < 1.0,
            format!("time-pos {released:.2}s, target {:.2}s", 0.75 * duration),
        );

        // 5. Shortcuts through real key dispatch.
        this.update(cx, |view, _| {
            let _ = view.player.seek_to(10.0);
        })
        .ok();
        sleep(cx, 500).await;
        let paused = state(&this, cx).paused;
        key(&this, cx, "space").await;
        report.check("Space toggles play", state(&this, cx).paused != paused, format!("paused {paused} → {}", state(&this, cx).paused));
        key(&this, cx, "k").await;
        report.check("K toggles play", state(&this, cx).paused == paused, format!("paused → {}", state(&this, cx).paused));
        let before = time_pos(&this, cx);
        key(&this, cx, "right").await;
        let after = time_pos(&this, cx);
        report.check("→ seeks +10s", (after - before - 10.0).abs() < 1.5, format!("{before:.2}s → {after:.2}s"));
        key(&this, cx, "j").await;
        let back = time_pos(&this, cx);
        report.check("J seeks −10s", (after - back - 10.0).abs() < 1.5, format!("{after:.2}s → {back:.2}s"));
        let volume = state(&this, cx).volume;
        key(&this, cx, "down").await;
        report.check("↓ lowers volume", state(&this, cx).volume < volume, format!("{volume} → {}", state(&this, cx).volume));
        key(&this, cx, "m").await;
        let muted = state(&this, cx).muted;
        key(&this, cx, "m").await;
        report.check("M toggles mute", muted && !state(&this, cx).muted, format!("muted {muted}"));
        if !subs.is_empty() {
            let sid = state(&this, cx).subtitle_id;
            key(&this, cx, "c").await;
            let toggled = state(&this, cx).subtitle_id;
            key(&this, cx, "c").await;
            report.check("C toggles subtitles", sid != toggled, format!("{sid:?} → {toggled:?} → {:?}", state(&this, cx).subtitle_id));
        }
        if audio.len() > 1 {
            let aid = state(&this, cx).audio_id;
            key(&this, cx, "a").await;
            report.check("A cycles audio", state(&this, cx).audio_id != aid, format!("{aid:?} → {:?}", state(&this, cx).audio_id));
        }
        key(&this, cx, "]").await;
        report.check("] raises speed", (state(&this, cx).speed - 1.25).abs() < 0.01, format!("{}", state(&this, cx).speed));
        key(&this, cx, "backspace").await;

        // 6. Controls over video through resize and fullscreen.
        if let Some(sub) = subs.first() {
            let id = sub.id;
            this.update(cx, |view, _| {
                let _ = view.player.select_subtitle(Some(id));
            })
            .ok();
        }
        this.update(cx, |view, cx| {
            let _ = view.player.seek_to(3.0);
            let _ = view.player.set_paused(false);
            view.pin_controls = true;
            view.hover_fraction = Some(0.42);
            cx.notify();
        })
        .ok();
        sleep(cx, 1200).await;
        screenshot(&this, cx, &dir, "1-windowed", &mut report).await;
        for (index, (w, h)) in [(820.0f32, 500.0f32), (1600., 920.)].into_iter().enumerate() {
            this.update_in(cx, |_, window, _| window.resize(size(px(w), px(h)))).ok();
            sleep(cx, 900).await;
            let bounds = this.update_in(cx, |_, window, _| window.bounds()).ok();
            let playing = {
                let p = state(&this, cx).position;
                wait_until(&this, cx, 1_500, |s| s.position > p + 0.2).await
            };
            report.check(
                &format!("resize to {w}×{h}"),
                playing,
                format!("window {:?}, still playing {playing}", bounds.map(|b| b.size)),
            );
            screenshot(&this, cx, &dir, &format!("{}-resized-{w}x{h}", index + 2), &mut report).await;
        }

        key(&this, cx, "f").await;
        let started = Instant::now();
        let mut fullscreen = false;
        while started.elapsed() < Duration::from_secs(5) && !fullscreen {
            sleep(cx, 200).await;
            fullscreen = this.update_in(cx, |_, window, _| window.is_fullscreen()).unwrap_or(false);
        }
        sleep(cx, 800).await;
        let p = state(&this, cx).position;
        let playing = wait_until(&this, cx, 1_500, |s| s.position > p + 0.2).await;
        report.check("F enters fullscreen", fullscreen && playing, format!("fullscreen {fullscreen}, playing {playing}"));
        screenshot(&this, cx, &dir, "4-fullscreen", &mut report).await;
        this.update(cx, |view, cx| {
            view.hover_fraction = None;
            view.menu = Some(crate::app::Menu::More);
            cx.notify();
        })
        .ok();
        screenshot(&this, cx, &dir, "5-fullscreen-audio-menu", &mut report).await;
        this.update(cx, |view, cx| {
            view.menu = Some(crate::app::Menu::Subtitles);
            cx.notify();
        })
        .ok();
        screenshot(&this, cx, &dir, "6-fullscreen-subtitle-menu", &mut report).await;
        this.update(cx, |view, cx| {
            view.menu = None;
            cx.notify();
        })
        .ok();
        key(&this, cx, "escape").await;
        sleep(cx, 2000).await;
        let windowed = !this.update_in(cx, |_, window, _| window.is_fullscreen()).unwrap_or(true);
        report.check("Escape leaves fullscreen", windowed, format!("windowed {windowed}"));

        // 7. Auto-hide after inactivity while playing.
        this.update(cx, |view, cx| {
            view.pin_controls = false;
            cx.notify();
        })
        .ok();
        sleep(cx, 3800).await;
        screenshot(&this, cx, &dir, "7-controls-hidden", &mut report).await;

        let _ = std::fs::write(&report_path, report.json());
        eprintln!("[self-test] report written to {}", report_path.display());
        cx.update(|_, cx| cx.quit()).ok();
    })
    .detach();
}

/// `--library-test DIR`: waits for the initial scan, screenshots each library
/// screen, plays the show's next-up episode with the settings menu and volume
/// popover open, closes back to Home and checks Continue Watching.
pub fn run_library(dir: PathBuf, window: &mut Window, cx: &mut Context<PlayerView>) {
    cx.spawn_in(window, async move |this, cx| {
        let mut report = Report { checks: Vec::new(), screenshots: Vec::new() };
        let started = Instant::now();
        while started.elapsed() < Duration::from_secs(20) {
            let ready = this.update(cx, |v, _| !v.catalog.status.lock().running && !v.items.is_empty()).unwrap_or(false);
            if ready {
                break;
            }
            sleep(cx, 200).await;
        }
        sleep(cx, 500).await;
        let (items, shows, libraries) = this.update(cx, |v, _| (v.items.len(), v.shows().len(), v.libraries.len())).unwrap_or_default();
        report.check("scan populates catalog", items > 0, format!("{libraries} libraries, {items} items, {shows} shows"));
        screenshot(&this, cx, &dir, "lib-1-home", &mut report).await;
        for (name, screen) in [
            ("lib-2-library", crate::library_ui::Screen::Library),
            ("lib-3-shows", crate::library_ui::Screen::Shows),
            ("lib-5-settings", crate::library_ui::Screen::Settings),
            ("lib-5b-libraries", crate::library_ui::Screen::Libraries),
        ] {
            this.update(cx, |v, cx| {
                v.screen = screen;
                cx.notify();
            })
            .ok();
            screenshot(&this, cx, &dir, name, &mut report).await;
        }
        this.update_in(cx, |v, window, cx| {
            v.screen = crate::library_ui::Screen::Settings;
            v.settings_section = crate::shell_ui::SettingsSection::Playback;
            window.resize(size(px(640.), px(390.)));
            cx.notify();
        }).ok();
        sleep(cx, 350).await;
        let quarter = cx.update(|window, _| window.viewport_size()).ok();
        report.check("quarter-screen window", quarter == Some(size(px(640.), px(390.))), format!("{quarter:?}"));
        click(&this, cx, 503., 350.).await;
        let subtitle_open = this.update(cx, |v, _| v.open_select == Some("subtitle_lang")).unwrap_or(false);
        report.check("subtitle dropdown opens with a stationary pointer", subtitle_open, format!("open {subtitle_open}"));
        screenshot(&this, cx, &dir, "lib-quarter-subtitle-menu", &mut report).await;
        click(&this, cx, 502., 74.).await;
        let selected = this.update(cx, |v, _| v.catalog.setting("subtitle_lang")).ok().flatten();
        report.check("subtitle menu selects a language", selected.as_deref() == Some("eng"), format!("{selected:?}"));
        this.update_in(cx, |v, window, cx| {
            v.open_select = None;
            window.resize(size(px(640.), px(760.)));
            cx.notify();
        }).ok();
        sleep(cx, 350).await;
        let half = cx.update(|window, _| window.viewport_size()).ok();
        report.check("half-screen window", half == Some(size(px(640.), px(760.))), format!("{half:?}"));
        click(&this, cx, 503., 503.).await;
        let audio_open = this.update(cx, |v, _| v.open_select == Some("audio_lang")).unwrap_or(false);
        report.check("audio dropdown opens with a stationary pointer", audio_open, format!("open {audio_open}"));
        screenshot(&this, cx, &dir, "lib-half-audio-menu", &mut report).await;
        this.update(cx, |v, cx| {
            v.open_select = None;
            v.screen = crate::library_ui::Screen::Libraries;
            cx.notify();
        }).ok();
        sleep(cx, 250).await;
        click(&this, cx, 468., 214.).await;
        let adding = this.update(cx, |v, _| v.add_library_open).unwrap_or(false);
        report.check("Add a Library opens the type picker", adding, format!("open {adding}"));
        screenshot(&this, cx, &dir, "lib-half-add-library", &mut report).await;
        this.update_in(cx, |v, window, cx| {
            v.add_library_open = false;
            v.screen = crate::library_ui::Screen::Settings;
            window.resize(size(px(1280.), px(390.)));
            cx.notify();
        }).ok();
        screenshot(&this, cx, &dir, "lib-horizontal-half-settings", &mut report).await;
        let horizontal = cx.update(|window, _| window.viewport_size()).ok();
        report.check("horizontal half-screen window", horizontal == Some(size(px(1280.), px(390.))), format!("{horizontal:?}"));

        this.update(cx, |v, cx| {
            v.settings_section = crate::shell_ui::SettingsSection::Updates;
            cx.notify();
        }).ok();
        sleep(cx, 300).await;
        click(&this, cx, 340., 319.).await;
        let started = Instant::now();
        let update_status = loop {
            use crate::updates::UpdateStatus;
            match this.update(cx, |v, _| v.update_status.clone()) {
                Ok(UpdateStatus::Current) => break Some("Up to date".to_string()),
                Ok(UpdateStatus::Available { version, .. }) => break Some(format!("Update available: {version}")),
                Ok(UpdateStatus::Failed) => break Some("Network error shown".into()),
                Ok(UpdateStatus::Checking) if started.elapsed() < Duration::from_secs(15) => sleep(cx, 150).await,
                _ => break None,
            }
        };
        report.check("Check for updates displays a result", update_status.is_some(), format!("{update_status:?}"));
        screenshot(&this, cx, &dir, "lib-settings-updates", &mut report).await;
        this.update_in(cx, |_, window, _| window.resize(size(px(1280.), px(760.)))).ok();

        let first_show = this.update(cx, |v, _| v.shows().first().map(|s| (s.key.clone(), s.next_up().map(|e| e.path.clone())))).ok().flatten();
        if let Some((show_key, next)) = first_show {
            this.update(cx, |v, cx| {
                v.screen = crate::library_ui::Screen::Show(show_key);
                cx.notify();
            })
            .ok();
            screenshot(&this, cx, &dir, "lib-4-show", &mut report).await;
            mouse_click(&this, cx, 120., 671., true).await;
            let episode_menu = this.update(cx, |v, _| v.episode_menu.as_ref().map(|(path, _)| path.clone())).ok().flatten();
            report.check("right-click opens the episode action menu", episode_menu.is_some(), format!("{episode_menu:?}"));
            screenshot(&this, cx, &dir, "lib-episode-context", &mut report).await;
            if let Some(episode) = episode_menu {
                click(&this, cx, 160., 646.).await;
                let watched = this.update(cx, |v, _| v.catalog.progress(&episode).is_some_and(|p| p.watched())).unwrap_or(false);
                report.check("episode menu marks watched", watched, format!("watched {watched}"));
                mouse_click(&this, cx, 120., 671., true).await;
                click(&this, cx, 160., 646.).await;
                let removed = this.update(cx, |v, _| v.catalog.progress(&episode).is_none()).unwrap_or(false);
                report.check("episode menu removes watched state", removed, format!("removed {removed}"));
            }
            key(&this, cx, "escape").await;
            if let Some(path) = next {
                this.update_in(cx, |v, window, cx| v.open(&path, window, cx)).ok();
                let loaded = wait_until(&this, cx, 10_000, |s| s.loaded && s.position > 1.5).await;
                let next = this.update(cx, |v, _| v.next_episode.clone()).ok().flatten();
                report.check("plays next-up from show page", loaded, format!("next episode: {next:?}"));
                this.update(cx, |v, cx| {
                    let _ = v.player.seek_to(40.0);
                    v.pin_controls = true;
                    v.menu = Some(crate::app::Menu::More);
                    cx.notify();
                })
                .ok();
                screenshot(&this, cx, &dir, "lib-6-player-settings", &mut report).await;
                this.update(cx, |v, cx| {
                    v.menu = None;
                    v.debug_open_volume();
                    cx.notify();
                })
                .ok();
                screenshot(&this, cx, &dir, "lib-7-player-volume", &mut report).await;
                this.update_in(cx, |v, window, cx| {
                    v.pin_controls = false;
                    v.close_media(window, cx);
                    v.screen = crate::library_ui::Screen::Home;
                })
                .ok();
                sleep(cx, 600).await;
                let resumable = this.update(cx, |v, _| v.items.iter().filter(|i| i.progress.is_some_and(|p| p.resumable())).count()).unwrap_or(0);
                report.check("Continue Watching after closing mid-episode", resumable > 0, format!("{resumable} resumable"));
                screenshot(&this, cx, &dir, "lib-8-home-continue", &mut report).await;
            }
        }
        // Search: open the page from the top bar, focus its field and type
        // through real key dispatch.
        this.update(cx, |v, cx| {
            v.screen = crate::library_ui::Screen::Search;
            cx.notify();
        })
        .ok();
        sleep(cx, 200).await;
        cx.update(|window, cx| {
            if let Some(view) = this.upgrade() {
                let focus = view.read(cx).search_focus.clone();
                window.focus(&focus);
            }
        })
        .ok();
        for key in ["s", "e", "c", "o", "n", "d"] {
            cx.update(|window, cx| {
                window.dispatch_keystroke(Keystroke::parse(key).unwrap(), cx);
            })
            .ok();
            sleep(cx, 60).await;
        }
        sleep(cx, 300).await;
        let (query, screen) = this.update(cx, |v, _| (v.search_query.clone(), v.screen.clone())).unwrap_or_default_pair();
        report.check("typing in search opens results", query == "second" && screen == crate::library_ui::Screen::Search, format!("query {query:?}, screen {screen:?}"));
        screenshot(&this, cx, &dir, "lib-9-search", &mut report).await;

        // Personal lists and a movie page.
        let movie = this.update(cx, |v, _| v.visible_movies().into_iter().find(|m| m.year.is_some()).map(|m| m.path)).ok().flatten();
        if let Some(path) = movie {
            this.update(cx, |v, cx| {
                let key = crate::catalog::TitleKey::Movie(path.clone());
                v.catalog.toggle_mark(&key, crate::catalog::Mark::Watchlist);
                v.catalog.set_rating(&key, 4);
                if let Some(id) = v.catalog.create_collection("Weekend Picks") {
                    v.catalog.toggle_in_collection(id, &key);
                }
                v.catalog.set_watched(&path, true);
                v.reload_catalog();
                v.screen = crate::library_ui::Screen::Movie(path.clone());
                cx.notify();
            })
            .ok();
            screenshot(&this, cx, &dir, "lib-10-movie", &mut report).await;
            let (watchlist, collections, history) = this
                .update(cx, |v, _| (v.personal.marked(crate::catalog::Mark::Watchlist).len(), v.personal.collections.len(), v.personal.history.len()))
                .unwrap_or_default();
            report.check("watchlist, collection, history persist", watchlist == 1 && collections == 1 && history >= 1, format!("watchlist {watchlist}, collections {collections}, history {history}"));
            for (name, screen) in [("lib-11-watchlist", crate::library_ui::Screen::Watchlist), ("lib-12-collections", crate::library_ui::Screen::Collections), ("lib-13-history", crate::library_ui::Screen::History)] {
                this.update(cx, |v, cx| {
                    v.screen = screen;
                    cx.notify();
                })
                .ok();
                screenshot(&this, cx, &dir, name, &mut report).await;
            }
        }
        let _ = std::fs::write(dir.join("library-report.json"), report.json());
        cx.update(|_, cx| cx.quit()).ok();
    })
    .detach();
}
