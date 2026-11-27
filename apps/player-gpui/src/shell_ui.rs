//! The Plexy shell from the web app's layout: top navigation, the Home hero
//! carousel and rows, the Library page, title hero pages with the episodes
//! panel, and Settings. Metadata the web app fetches online (genres, cast,
//! community ratings, logos) has no local source yet, so those slots show
//! what the catalog knows: libraries, file details and your own rating.

use std::path::PathBuf;
use std::time::{Duration, Instant};

use gpui::{div, ease_out_quint, img, Animation, AnimationExt, linear_color_stop, linear_gradient, prelude::*, px, AnyElement, Context, Hsla, ObjectFit, SharedString, Window};

use crate::app::{format_time, PlayerView};
use crate::catalog::{Item, Mark, TitleKey};
use crate::library_ui::Screen;
use crate::mpv::language_name;
use crate::personal_ui::{Sort, TitleView, WatchFilter};
use crate::theme;
use crate::ui::icon::{icon, Icon};
use crate::ui::motion::{Easing, MotionSpec, TweenExt};

/// Left inset of the hero copy and dots, clear of the 40px prev arrow.
const HERO_GUTTER: f32 = 76.;
pub const PAGE_X: f32 = 24.;
const HERO_INTERVAL: Duration = Duration::from_secs(8);
pub const LANGUAGES: [(&str, &str); 34] = [
    ("", "Default"),
    ("eng", "English"),
    ("hin", "Hindi"),
    ("ara", "Arabic"),
    ("ben", "Bengali"),
    ("chi", "Chinese"),
    ("cze", "Czech"),
    ("dan", "Danish"),
    ("dut", "Dutch"),
    ("fin", "Finnish"),
    ("fre", "French"),
    ("ger", "German"),
    ("gre", "Greek"),
    ("heb", "Hebrew"),
    ("hun", "Hungarian"),
    ("ind", "Indonesian"),
    ("ita", "Italian"),
    ("jpn", "Japanese"),
    ("kor", "Korean"),
    ("mal", "Malayalam"),
    ("mar", "Marathi"),
    ("nor", "Norwegian"),
    ("pol", "Polish"),
    ("por", "Portuguese"),
    ("rum", "Romanian"),
    ("rus", "Russian"),
    ("spa", "Spanish"),
    ("swe", "Swedish"),
    ("tam", "Tamil"),
    ("tel", "Telugu"),
    ("tha", "Thai"),
    ("tur", "Turkish"),
    ("ukr", "Ukrainian"),
    ("vie", "Vietnamese"),
];

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum SettingsSection {
    Playback,
    Libraries,
    Appearance,
    Metadata,
}

/// A featured title in the Home carousel.
#[derive(Clone)]
pub struct Hero {
    pub key: TitleKey,
    pub title: String,
    pub meta: Vec<String>,
    pub image: Option<PathBuf>,
    pub play: PathBuf,
    pub resume: bool,
    pub genres: Vec<String>,
    pub logo: Option<PathBuf>,
}

fn with_alpha(color: Hsla, a: f32) -> Hsla {
    Hsla { a, ..color }
}

fn white(a: f32) -> Hsla {
    with_alpha(theme::foreground(), a)
}

fn black(a: f32) -> Hsla {
    with_alpha(theme::background(), a)
}

static NAV_OVER: std::sync::atomic::AtomicBool = std::sync::atomic::AtomicBool::new(false);

/// True while the top bar floats transparent over hero artwork.
fn nav_over() -> bool {
    NAV_OVER.load(std::sync::atomic::Ordering::Relaxed)
}

/// Nav ink: white over artwork, the theme's foreground elsewhere.
fn nav_ink(a: f32) -> Hsla {
    if nav_over() { snow(a) } else { with_alpha(theme::foreground(), a) }
}

/// Fixed white and black for copy and scrims over artwork, which stay dark
/// in both themes.
fn snow(a: f32) -> Hsla {
    gpui::hsla(0., 0., 1., a)
}

fn ink(a: f32) -> Hsla {
    gpui::hsla(0., 0., 0.02, a)
}

fn h1(text: impl Into<SharedString>) -> impl IntoElement {
    div().text_size(px(32.)).line_height(px(37.)).font_weight(gpui::FontWeight::BOLD).text_color(theme::foreground()).child(text.into())
}

fn h2(text: impl Into<SharedString>) -> impl IntoElement {
    div().text_size(px(22.)).font_weight(gpui::FontWeight::BOLD).text_color(theme::foreground()).child(text.into())
}

fn dot_join(parts: Vec<String>) -> String {
    parts.into_iter().filter(|p| !p.is_empty()).collect::<Vec<_>>().join("  ·  ")
}

/// Cover image that fills its box, or a tinted placeholder.
fn cover(image: Option<PathBuf>) -> impl IntoElement {
    cover_r(image, 0.)
}

/// `cover` with rounded image corners: GPUI images don't clip to a parent's radius.
fn cover_r(image: Option<PathBuf>, radius: f32) -> impl IntoElement {
    div()
        .rounded(px(radius))
        .absolute()
        .inset_0()
        .bg(theme::surface_secondary())
        .when_some(image, |el, path| el.child(crate::assets::artwork_cover(path, radius)))
        .when(radius > 0., |el| el.child(crate::ui::artwork::corner_mask(radius, theme::background())))
}

/// `hero-copy-in`: rise 12px and fade in over 700ms, staggered 60ms per child.
fn rise(child: AnyElement, scope: impl std::fmt::Display, n: usize) -> impl IntoElement {
    let delay = Duration::from_millis(60 * n as u64).max(Duration::from_millis(1));
    div().relative().child(child).with_animations(
        SharedString::from(format!("copy-{scope}-{n}")),
        vec![Animation::new(delay).with_easing(|_| 0.), Animation::new(Duration::from_millis(700)).with_easing(ease_out_quint())],
        |el, step, t| {
            let t = if step == 0 { 0. } else { t };
            el.opacity(t).top(px(12. * (1. - t)))
        },
    )
}

/// Rendered width of a single line of Archivo text.
fn text_width(window: &Window, text: &str, size: f32, weight: gpui::FontWeight) -> f32 {
    let font = gpui::Font { weight, ..gpui::font("Archivo") };
    let run = gpui::TextRun { len: text.len(), font, color: theme::foreground(), background_color: None, underline: None, strikethrough: None };
    f32::from(window.text_system().shape_line(SharedString::from(text.to_string()), px(size), &[run], None).width)
}

/// Paints `color` over the corners outside a circle, so a `Cover` image (whose
/// radii GPUI applies to the overflowing image rect) reads as a clean circle.
pub fn circle_mask(size: f32, color: Hsla) -> impl IntoElement {
    gpui::canvas(
        |_, _, _| (),
        move |bounds, _, window, _| {
            let o = bounds.origin;
            let r = size / 2.;
            let c = gpui::point(o.x + px(r), o.y + px(r));
            for (cx_, cy_, start) in [(0., 0., 0.5f32), (size, 0., 0.75), (size, size, 0.0), (0., size, 0.25)] {
                let mut b = gpui::PathBuilder::fill();
                b.move_to(gpui::point(o.x + px(cx_), o.y + px(cy_)));
                for step in 0..=12 {
                    let a = (start + 0.25 * step as f32 / 12.) * std::f32::consts::TAU;
                    b.line_to(gpui::point(c.x + px((r + 0.3) * a.cos()), c.y + px((r + 0.3) * a.sin())));
                }
                b.close();
                if let Ok(path) = b.build() {
                    window.paint_path(path, color);
                }
            }
        },
    )
    .absolute()
    .inset_0()
    .size(px(size))
}

/// The one empty state used across the app: icon tile, title, copy, action.
pub fn empty_state(icon_name: Icon, title: &str, body: &str, action: Option<AnyElement>) -> impl IntoElement {
    div()
        .w_full()
        .py(px(88.))
        .flex()
        .flex_col()
        .items_center()
        .gap(px(8.))
        .child(
            div()
                .size(px(60.))
                .mb(px(14.))
                .rounded(px(18.))
                .bg(theme::surface_secondary())
                .border_1()
                .border_color(theme::border())
                .flex()
                .items_center()
                .justify_center()
                .child(icon(icon_name, 26., theme::muted())),
        )
        .child(div().text_size(px(19.)).font_weight(gpui::FontWeight::BOLD).text_color(theme::foreground()).child(title.to_string()))
        .child(div().max_w(px(420.)).text_size(px(14.)).line_height(px(21.)).text_color(theme::muted()).text_center().child(body.to_string()))
        .children(action.map(|a| div().pt(px(16.)).child(a)))
}

/// A floating menu anchored under its trigger, painted above everything.
static DROPDOWN_DISMISSED: std::sync::atomic::AtomicBool = std::sync::atomic::AtomicBool::new(false);
static DROPDOWN_CLOSED: std::sync::Mutex<Option<(&'static str, Instant)>> = std::sync::Mutex::new(None);

static DROPDOWN_TRIGGER: std::sync::Mutex<Option<(gpui::Bounds<gpui::Pixels>, gpui::Size<gpui::Pixels>)>> = std::sync::Mutex::new(None);

/// Place inside the trigger (or its wrapper): measures that parent, then
/// opens the menu below it, or above when there is no room, and aligns it to
/// the trigger's left edge, or its right edge near the window's right side.
pub fn dropdown(items: Vec<AnyElement>, width: f32) -> impl IntoElement {
    let est_h = (items.len() as f32 * crate::ui::menu::ROW_HEIGHT
        + items.len().saturating_sub(1) as f32 * 2.
        + 2. * crate::ui::menu::PANEL_PADDING)
        .min(340.);
    let measured = *DROPDOWN_TRIGGER.lock().unwrap();
    let menu = crate::ui::menu::panel(crate::ui::menu::MenuTone::App)
        .id("dropdown")
        .occlude()
        .on_mouse_down_out(|_, window, _| {
            DROPDOWN_DISMISSED.store(true, std::sync::atomic::Ordering::Relaxed);
            window.refresh();
        })
        .w(px(width))
        .max_h(px(340.))
        .overflow_y_scroll()
        .children(items)
        .with_animation("dropdown-in", Animation::new(Duration::from_millis(140)).with_easing(ease_out_quint()), |el, t| el.opacity(t));
    div()
        .absolute()
        .inset_0()
        .child(
            gpui::canvas(
                |bounds, window, _| {
                    let next = Some((bounds, window.viewport_size()));
                    let mut slot = DROPDOWN_TRIGGER.lock().unwrap();
                    if *slot != next {
                        *slot = next;
                        window.refresh();
                    }
                },
                |_, _, _, _| {},
            )
            .absolute()
            .inset_0(),
        )
        .when_some(measured, move |el, (b, win)| {
            const GAP: f32 = 6.;
            const EDGE: f32 = 8.;
            let (left, right, top, bottom) = (f32::from(b.origin.x), f32::from(b.origin.x + b.size.width), f32::from(b.origin.y), f32::from(b.origin.y + b.size.height));
            let (win_w, win_h) = (f32::from(win.width), f32::from(win.height));
            let below_fits = bottom + GAP + est_h <= win_h - EDGE;
            let above = !below_fits && top - GAP - est_h >= EDGE || (!below_fits && top > win_h - bottom);
            let align_right = left + width > win_w - EDGE && right - width >= EDGE;
            let x = if align_right { right } else { left.max(EDGE) };
            let y = if above { top - GAP } else { bottom + GAP };
            let corner = match (above, align_right) {
                (false, false) => gpui::Corner::TopLeft,
                (false, true) => gpui::Corner::TopRight,
                (true, false) => gpui::Corner::BottomLeft,
                (true, true) => gpui::Corner::BottomRight,
            };
            el.child(gpui::deferred(gpui::anchored().position(gpui::point(px(x), px(y))).anchor(corner).snap_to_window_with_margin(px(EDGE)).child(menu)).with_priority(1))
        })
}

impl PlayerView {
    /// Card art that grows 3% while hovered and eases back when the pointer
    /// leaves, without moving the cards around it. The fixed-size frame clips
    /// the growth; the caller keeps badges, progress and hover layers outside
    /// this layer so only the artwork moves.
    pub fn lift(&self, key: SharedString, w: f32, h: f32, radius: f32, tone: crate::ui::artwork::FrameTone, art: gpui::Div, cx: &mut Context<Self>) -> AnyElement {
        let hovered = self.hovered_card.as_ref() == Some(&key);
        let place = move |el: gpui::Div, t: f32| {
            let (dw, dh) = (w * 0.015 * t, h * 0.015 * t);
            el.absolute().left(px(-dw)).top(px(-dh)).w(px(w + 2. * dw)).h(px(h + 2. * dh))
        };
        let art = art.with_tween(
            SharedString::from(format!("lift-{key}")),
            if hovered { 1. } else { 0. },
            MotionSpec::new(Duration::from_millis(220), Duration::ZERO, Easing::Standard),
            move |el, t| place(el, t),
        );
        let k = key.clone();
        div()
            .id(gpui::ElementId::Name(SharedString::from(format!("lift-{key}"))))
            .relative()
            .flex_none()
            .w(px(w))
            .h(px(h))
            .on_hover(cx.listener(move |this, over: &bool, _, cx| {
                if *over {
                    if this.hovered_card.as_ref() != Some(&k) {
                        this.hovered_card = Some(k.clone());
                        cx.notify();
                    }
                } else if this.hovered_card.as_ref() == Some(&k) {
                    this.hovered_card = None;
                    cx.notify();
                }
            }))
            .child(
                crate::ui::artwork::framed(radius, tone, art)
                    .w(px(w))
                    .h(px(h)),
            )
            .into_any_element()
    }

    /// Closes an open dropdown after a click outside it. Called from render.
    pub fn take_dropdown_dismiss(&mut self) {
        if DROPDOWN_DISMISSED.swap(false, std::sync::atomic::Ordering::Relaxed) {
            if let Some(key) = self.open_select.take() {
                *DROPDOWN_CLOSED.lock().unwrap() = Some((key, Instant::now()));
            }
        }
    }

    /// Opens or closes dropdown `key`. A click on the trigger of a menu that
    /// the same mouse-down just dismissed keeps it closed.
    pub fn toggle_select(&mut self, key: &'static str) {
        let just_closed = DROPDOWN_CLOSED.lock().unwrap().is_some_and(|(k, at)| k == key && at.elapsed() < Duration::from_millis(350));
        self.open_select = if self.open_select == Some(key) || just_closed { None } else { Some(key) };
        // Re-measure the new trigger before showing its menu.
        *DROPDOWN_TRIGGER.lock().unwrap() = None;
    }
}

/// One row of a `dropdown`.
pub fn menu_item(id: impl Into<SharedString>, icon_name: Option<crate::ui::icon::Icon>, label: impl Into<SharedString>, selected: bool) -> crate::ui::menu::MenuRow {
    let row = crate::ui::menu::MenuRow::action(id, label).selected(selected);
    match icon_name {
        Some(icon) => row.icon(icon),
        None => row,
    }
}

fn genre_chip(name: String) -> impl IntoElement {
    div().h(px(28.)).px(px(12.)).flex().items_center().rounded_full().border_1().border_color(snow(0.16)).bg(ink(0.35)).text_size(px(11.)).font_weight(gpui::FontWeight::SEMIBOLD).text_color(snow(0.88)).child(name)
}

/// Bottom of a hero into the page. Dark pages take a long fade; a light page
/// gets a dark shadow band first, then a short dissolve, so the art never
/// turns into a grey wash.
fn hero_fade() -> impl IntoElement {
    let bg = theme::background();
    if theme::is_light() {
        div()
            .absolute()
            .inset_0()
            .child(div().absolute().inset_0().bg(linear_gradient(180., linear_color_stop(ink(0.0), 0.35), linear_color_stop(ink(0.55), 0.82))))
            .child(div().absolute().left_0().right_0().bottom_0().h(px(90.)).bg(linear_gradient(180., linear_color_stop(with_alpha(bg, 0.), 0.), linear_color_stop(bg, 1.))))
    } else {
        div().absolute().inset_0().bg(linear_gradient(180., linear_color_stop(ink(0.0), 0.5), linear_color_stop(bg, 1.)))
    }
}

fn badge(text: impl Into<SharedString>) -> impl IntoElement {
    div()
        .px(px(6.))
        .py(px(2.))
        .rounded(px(theme::RADIUS))
        .bg(ink(0.72))
        .text_size(px(10.))
        .font_weight(gpui::FontWeight::SEMIBOLD)
        .text_color(snow(1.))
        .child(text.into())
}

impl PlayerView {
    // MARK: Building blocks

    pub fn pill_button(&self, id: impl Into<SharedString>, icon_name: Option<Icon>, label: impl Into<SharedString>, primary: bool) -> gpui::Stateful<gpui::Div> {
        div()
            .id(gpui::ElementId::Name(id.into()))
            .h(px(42.))
            .px(px(21.))
            .flex()
            .items_center()
            .gap(px(8.))
            .rounded_full()
            .cursor_pointer()
            .text_size(px(14.))
            .font_weight(gpui::FontWeight::SEMIBOLD)
            .when(primary, |el| el.bg(theme::accent()).text_color(theme::accent_foreground()).hover(|s| s.opacity(0.9)))
            .when(!primary, |el| el.bg(ink(0.45)).border_1().border_color(snow(0.18)).text_color(snow(1.)).hover(|s| s.bg(snow(0.12))))
            .when_some(icon_name, |el, name| el.child(icon(name, 18., if primary { theme::accent_foreground() } else { snow(1.) })))
            .child(label.into())
    }

    pub fn circle_button(&self, id: impl Into<SharedString>, icon_name: Icon, active: bool) -> gpui::Stateful<gpui::Div> {
        div()
            .id(gpui::ElementId::Name(id.into()))
            .size(px(42.))
            .flex()
            .items_center()
            .justify_center()
            .rounded_full()
            .cursor_pointer()
            .border_1()
            .border_color(snow(0.18))
            .bg(if active { with_alpha(theme::accent(), 0.25) } else { ink(0.45) })
            .hover(|s| s.bg(snow(0.12)))
            .child(icon(icon_name, 20., if active { theme::accent() } else { snow(1.) }))
    }

    fn see_all(&self, id: &'static str, screen: Screen, cx: &mut Context<Self>) -> impl IntoElement {
        div()
            .id(id)
            .h(px(30.))
            .px(px(13.))
            .flex()
            .items_center()
            .gap(px(5.))
            .rounded_full()
            .cursor_pointer()
            .border_1()
            .border_color(theme::border())
            .text_size(px(11.))
            .font_weight(gpui::FontWeight::SEMIBOLD)
            .text_color(theme::foreground())
            .hover(|s| s.bg(theme::default()))
            .on_click(cx.listener(move |this, _, _, cx| {
                this.screen = screen.clone();
                cx.notify();
            }))
            .child("See all")
            .child(icon(Icon::ArrowRight, 14., theme::foreground()))
    }

    pub fn shell_section(&self, title: &str, action: Option<AnyElement>, body: impl IntoElement) -> impl IntoElement {
        self.section(title, action, body)
    }

    pub fn see_all_link(&self, id: &'static str, screen: Screen, cx: &mut Context<Self>) -> AnyElement {
        self.see_all(id, screen, cx).into_any_element()
    }

    fn section(&self, title: &str, action: Option<AnyElement>, body: impl IntoElement) -> impl IntoElement {
        div()
            .flex()
            .flex_col()
            .gap(px(18.))
            .child(div().flex().items_center().justify_between().child(h2(title.to_string())).children(action))
            .child(body)
    }

    // MARK: Top navigation

    fn nav_icon(&self, id: &'static str, icon_name: Icon, label: &'static str, screen: Screen, window: &Window, cx: &mut Context<Self>) -> impl IntoElement {
        let active = match (&self.screen, &screen) {
            (Screen::Movies | Screen::Shows | Screen::Movie(_) | Screen::Show(_) | Screen::Genre(_), Screen::Library) => true,
            (Screen::Watchlist | Screen::Favorites | Screen::Hidden, Screen::Collections) => true,
            (a, b) => a == b,
        };
        let label_w = text_width(window, label, 13., gpui::FontWeight::SEMIBOLD).ceil() + 1.;
        div()
            .id(id)
            .h(px(34.))
            .px(px(12.))
            .flex()
            .items_center()
            .gap(px(6.))
            .rounded_full()
            .cursor_pointer()
            .when(active, |el| el.bg(nav_ink(0.12)))
            .hover(move |s| s.bg(nav_ink(if active { 0.16 } else { 0.07 })))
            .on_click(cx.listener(move |this, _, _, cx| {
                this.screen = screen.clone();
                cx.notify();
            }))
            .child(icon(icon_name, 18., nav_ink(if active { 1. } else { 0.82 })))
            .when(active, |el| {
                // The label slides open over 200ms instead of snapping the
                // whole nav sideways.
                el.child(
                    div()
                        .overflow_hidden()
                        .whitespace_nowrap()
                        .text_size(px(13.))
                        .font_weight(gpui::FontWeight::SEMIBOLD)
                        .text_color(nav_ink(1.))
                        .child(label)
                        .with_animation(SharedString::from(format!("nav-label-{id}")), Animation::new(Duration::from_millis(200)).with_easing(ease_out_quint()), move |el, t| el.w(px(label_w * t)).opacity(t)),
                )
            })
    }

    fn round_icon(&self, id: &'static str, icon_name: Icon, active: bool, cx: &mut Context<Self>, screen: Screen) -> impl IntoElement {
        div()
            .id(id)
            .size(px(37.))
            .flex()
            .items_center()
            .justify_center()
            .rounded_full()
            .cursor_pointer()
            .bg(nav_ink(0.1))
            .when(active, |el| el.border_2().border_color(theme::accent()))
            .hover(|s| s.bg(nav_ink(0.18)))
            .on_click(cx.listener(move |this, _, _, cx| {
                this.screen = screen.clone();
                cx.notify();
            }))
            .child(icon(icon_name, 20., nav_ink(1.)))
    }

    fn page_title(&self) -> Option<String> {
        Some(match &self.screen {
            Screen::Home => return None,
            Screen::Library | Screen::Movies | Screen::Shows => "Library".into(),
            Screen::Movie(path) => self.items.iter().find(|i| &i.path == path).map(|i| i.title.clone()).unwrap_or_default(),
            Screen::Show(key) => self.shows().into_iter().find(|s| &s.key == key).map(|s| s.title).unwrap_or_default(),
            Screen::Search => "Search".into(),
            Screen::Genre(g) => g.clone(),
            Screen::Watchlist => "Watchlist".into(),
            Screen::Favorites => "Favorites".into(),
            Screen::Hidden => "Hidden".into(),
            Screen::Collections => "Collections".into(),
            Screen::History => "History".into(),
            Screen::Libraries | Screen::Settings => "Settings".into(),
        })
    }

    fn render_top_nav(&self, window: &Window, cx: &mut Context<Self>) -> gpui::Div {
        // Room for the traffic lights while windowed.
        let left_inset = if window.is_fullscreen() { 0. } else { 64. };
        let title = self.page_title();
        div()
            .h(px(67.))
            .flex_none()
            .px(px(38.))
            .flex()
            .items_center()
            .gap(px(19.))
            .border_b_1()
            .border_color(theme::separator())
            .bg(black(0.92))
            .child(
                div()
                    .w(px(220. + left_inset))
                    .pl(px(left_inset))
                    .flex_none()
                    .flex()
                    .items_center()
                    .gap(px(10.))
                    .min_w_0()
                    .child(match title.clone() {
                        None => img("icons/plexy-logo.svg").w(px(26.)).h(px(28.)).into_any_element(),
                        Some(_) => div()
                            .id("nav-back")
                            .size(px(26.))
                            .flex()
                            .items_center()
                            .justify_center()
                            .rounded_full()
                            .cursor_pointer()
                            .hover(|s| s.bg(nav_ink(0.12)))
                            .on_click(cx.listener(|this, _, _, cx| {
                                this.go_back();
                                cx.notify();
                            }))
                            .child(icon(Icon::ArrowLeft, 20., nav_ink(1.)))
                            .into_any_element(),
                    })
                    .child(div().text_size(px(17.)).font_weight(gpui::FontWeight::BOLD).text_color(nav_ink(1.)).truncate().child(title.unwrap_or_else(|| "Plexy".into()))),
            )
            .child(
                div()
                    .flex()
                    .items_center()
                    .gap(px(3.))
                    .child(self.nav_icon("top-home", Icon::Home, "Home", Screen::Home, window, cx))
                    .child(self.nav_icon("top-library", Icon::Library, "Library", Screen::Library, window, cx))
                    .child(self.nav_icon("top-collections", Icon::FolderHeart, "Collections", Screen::Collections, window, cx))
                    .child(self.nav_icon("top-history", Icon::Clock, "History", Screen::History, window, cx)),
            )
            .child(div().flex_1())
            .child(
                div()
                    .flex()
                    .gap(px(8.))
                    .child(self.round_icon("top-search", Icon::Search, self.screen == Screen::Search, cx, Screen::Search))
                    .child(self.round_icon("top-settings", Icon::Settings, self.screen == Screen::Settings, cx, Screen::Settings)),
            )
    }

    fn go_back(&mut self) {
        self.screen = match &self.screen {
            Screen::Movie(_) | Screen::Show(_) | Screen::Movies | Screen::Shows | Screen::Genre(_) => Screen::Library,
            _ => Screen::Home,
        };
    }

    // MARK: Home

    pub fn heroes(&self) -> Vec<Hero> {
        let mut heroes: Vec<Hero> = Vec::new();
        let mut resuming: Vec<&Item> = self.items.iter().filter(|i| !i.missing && i.progress.is_some_and(|p| p.resumable())).collect();
        resuming.sort_by_key(|i| std::cmp::Reverse(i.progress.map(|p| p.updated).unwrap_or(0)));
        let tv = self.tv_library_ids();
        for item in resuming {
            let key = if tv.contains(&item.library_id) { TitleKey::Show(item.show_key()) } else { TitleKey::Movie(item.path.clone()) };
            if self.hidden(&key) || heroes.iter().any(|h| h.key == key) {
                continue;
            }
            let code = match (item.season, item.episode) {
                (Some(s), Some(e)) => format!("S{s:02}E{e:02}"),
                _ => String::new(),
            };
            heroes.push(Hero {
                key,
                title: item.title.clone(),
                meta: vec![code, item.year.map(|y| y.to_string()).unwrap_or_default(), if item.season.is_some() { "Series".into() } else { "Movie".into() }],
                image: item.backdrop.clone().or(item.poster.clone()),
                play: item.path.clone(),
                resume: true,
                genres: Vec::new(),
                logo: None,
            });
        }
        let mut recent: Vec<Hero> = Vec::new();
        for show in self.visible_shows() {
            if let Some(next) = show.next_up() {
                recent.push(Hero {
                    key: TitleKey::Show(show.key.clone()),
                    title: show.title.clone(),
                    meta: vec![format!("{} episodes", show.episodes().count()), "Series".into()],
                    image: show.backdrop.clone().or(show.poster.clone()),
                    play: next.path.clone(),
                    resume: false,
                    genres: Vec::new(),
                    logo: None,
                });
            }
        }
        for movie in self.visible_movies() {
            if !movie.watched() {
                recent.push(Hero {
                    key: TitleKey::Movie(movie.path.clone()),
                    title: movie.title.clone(),
                    meta: vec![movie.year.map(|y| y.to_string()).unwrap_or_default(), "Movie".into()],
                    image: movie.backdrop.clone().or(movie.poster.clone()),
                    play: movie.path.clone(),
                    resume: false,
                    genres: Vec::new(),
                    logo: None,
                });
            }
        }
        for hero in recent {
            if heroes.len() >= 5 {
                break;
            }
            if !heroes.iter().any(|h| h.key == hero.key) {
                heroes.push(hero);
            }
        }
        for hero in &mut heroes {
            if let Some(meta) = self.metas.get(&hero.key) {
                hero.genres = meta.genres.iter().take(3).cloned().collect();
                hero.logo = meta.logo.clone();
                if meta.backdrop.is_some() {
                    hero.image = meta.backdrop.clone();
                }
                let kind = hero.meta.last().cloned().unwrap_or_default();
                let code = if hero.resume { hero.meta.first().cloned().unwrap_or_default() } else { String::new() };
                hero.meta = vec![
                    code,
                    meta.year.map(|y| y.to_string()).unwrap_or_default(),
                    meta.rating.filter(|r| *r > 0.0).map(|r| format!("★ {r:.1}")).unwrap_or_default(),
                    kind,
                ];
            }
        }
        heroes
    }

    /// Advances the carousel; called from the UI tick.
    pub fn tick_hero(&mut self) -> bool {
        if self.screen != Screen::Home || self.hero_paused || self.hero_since.elapsed() <= HERO_INTERVAL {
            return false;
        }
        let count = self.heroes().len().max(1);
        let previous = self.hero_index;
        self.hero_prev = Some(previous);
        self.hero_index = (previous + 1) % count;
        self.hero_since = Instant::now();
        self.hero_index != previous
    }

    fn render_hero(&self, cx: &mut Context<Self>) -> Option<impl IntoElement> {
        let heroes = self.heroes();
        let hero_h = self.hero_height();
        let count = heroes.len();
        let index = self.hero_index % count.max(1);
        let hero = heroes.get(index)?.clone();
        let previous = self.hero_prev.filter(|p| *p != index && *p < count).and_then(|p| heroes.get(p).cloned());
        let in_watchlist = self.personal.has(&hero.key, Mark::Watchlist);
        let (play, details, mark) = (hero.play.clone(), hero.key.clone(), hero.key.clone());
        let go = |this: &mut Self, to: usize| {
            if to != this.hero_index {
                this.hero_prev = Some(this.hero_index);
                this.hero_index = to;
            }
            this.hero_since = Instant::now();
        };
        let arrow = |id: &'static str, name: Icon, step: isize| {
            div()
                .id(id)
                .size(px(40.))
                .rounded_full()
                .flex()
                .items_center()
                .justify_center()
                .cursor_pointer()
                .bg(ink(0.25))
                .border_1()
                .border_color(snow(0.15))
                .hover(|s| s.bg(ink(0.55)))
                .on_click(cx.listener(move |this, _, _, cx| {
                    let count = this.heroes().len().max(1) as isize;
                    let to = ((this.hero_index as isize + step).rem_euclid(count)) as usize;
                    go(this, to);
                    cx.notify();
                }))
                .child(icon(name, 22., snow(0.85)))
        };
        // hero-copy-in: each child rises 12px and fades in over 700ms with a
        // 60ms stagger, keyed by slide so it replays on every change.
        let rise = move |child: AnyElement, n: usize| {
            let delay = Duration::from_millis(60 * n as u64);
            div().relative().child(child).with_animations(
                SharedString::from(format!("hero-copy-{index}-{n}")),
                vec![Animation::new(delay.max(Duration::from_millis(1))).with_easing(|_| 0.), Animation::new(Duration::from_millis(700)).with_easing(ease_out_quint())],
                |el, step, t| {
                    let t = if step == 0 { 0. } else { t };
                    el.opacity(t).top(px(12. * (1. - t)))
                },
            )
        };
        let mut copy: Vec<AnyElement> = Vec::new();
        if !hero.genres.is_empty() {
            copy.push(
                div()
                    .flex()
                    .gap(px(8.))
                    .children(hero.genres.iter().map(|g| {
                        div().h(px(28.)).px(px(12.)).flex().items_center().rounded_full().border_1().border_color(snow(0.16)).bg(ink(0.35)).text_size(px(11.)).font_weight(gpui::FontWeight::SEMIBOLD).text_color(snow(0.88)).child(g.clone())
                    }))
                    .into_any_element(),
            );
        }
        copy.push(match hero.logo.clone() {
            Some(logo) => div().h(px(120.)).max_w(px(448.)).py(px(4.)).flex().items_end().child(crate::assets::artwork_image(logo).h_full().max_w(px(448.)).object_fit(ObjectFit::Contain)).into_any_element(),
            None => div().max_w(px(640.)).text_size(px(60.)).line_height(px(58.)).font_weight(gpui::FontWeight::BLACK).text_color(snow(1.)).child(hero.title.to_uppercase()).into_any_element(),
        });
        copy.push(
            div()
                .flex()
                .items_center()
                .gap(px(9.))
                .text_size(px(13.))
                .font_weight(gpui::FontWeight::MEDIUM)
                .text_color(snow(0.72))
                .children(hero.meta.iter().filter(|m| !m.is_empty()).enumerate().map(|(i, m)| {
                    let bold = i == 0 && hero.resume;
                    let star = m.starts_with('★');
                    div()
                        .flex()
                        .items_center()
                        .gap(px(9.))
                        .when(i > 0, |el| el.child(div().size(px(3.)).rounded_full().bg(snow(0.36))))
                        .child(if star {
                            div().flex().gap(px(4.)).child(div().text_color(theme::warning()).child("★")).child(div().font_weight(gpui::FontWeight::SEMIBOLD).text_color(snow(1.)).child(m.trim_start_matches('★').trim().to_string()))
                        } else {
                            div().when(bold, |el| el.font_weight(gpui::FontWeight::SEMIBOLD).text_color(snow(1.))).child(m.clone())
                        })
                }))
                .into_any_element(),
        );
        copy.push(
            div()
                .pt(px(10.))
                .flex()
                .gap(px(10.))
                .child(
                    self.pill_button("hero-play", Some(Icon::Play), if hero.resume { "Continue watching" } else { "Play" }, true)
                        .h(px(44.))
                        .px(px(22.))
                        .on_click(cx.listener(move |this, _, window, cx| this.play_item(play.clone(), window, cx))),
                )
                .child(self.pill_button("hero-details", None, "Details", false).h(px(44.)).on_click(cx.listener(move |this, _, _, cx| this.open_title(&details, cx))))
                .child(self.circle_button("hero-bookmark", Icon::Bookmark, in_watchlist).size(px(44.)).on_click(cx.listener(move |this, _, _, cx| {
                    this.catalog.toggle_mark(&mark, Mark::Watchlist);
                    this.reload_catalog();
                    cx.notify();
                })))
                .into_any_element(),
        );
        let dots = (count > 1).then(|| {
                div()
                    .absolute()
                    .left(px(HERO_GUTTER))
                    .bottom(px(30.))
                    .flex()
                    .items_center()
                    .gap(px(8.))
                    .child(
                        div()
                            .id("hero-pause")
                            .mr(px(4.))
                            .size(px(28.))
                            .rounded_full()
                            .flex()
                            .items_center()
                            .justify_center()
                            .cursor_pointer()
                            .border_1()
                            .border_color(snow(0.15))
                            .bg(ink(0.3))
                            .hover(|s| s.bg(ink(0.55)))
                            .on_click(cx.listener(|this, _, _, cx| {
                                this.hero_paused = !this.hero_paused;
                                this.hero_since = Instant::now();
                                cx.notify();
                            }))
                            .child(icon(if self.hero_paused { Icon::Play } else { Icon::Pause }, 12., snow(0.8))),
                    )
                    .children((0..count).map(|i| {
                        let active = i == index;
                        let was_active = self.hero_prev == Some(i);
                        // Dot width eases 300ms between 8 (dot) and 20 (pill).
                        div()
                            .id(SharedString::from(format!("hero-dot-{i}")))
                            .h(px(6.))
                            .rounded_full()
                            .cursor_pointer()
                            .bg(if active { snow(1.) } else { snow(0.4) })
                            .on_click(cx.listener(move |this, _, _, cx| {
                                go(this, i);
                                cx.notify();
                            }))
                            .with_animation(SharedString::from(format!("hero-dot-{i}-{index}")), Animation::new(Duration::from_millis(300)).with_easing(ease_out_quint()), move |el, t| {
                                let w = if active { 8. + 12. * t } else if was_active { 20. - 12. * t } else { 8. };
                                el.w(px(w))
                            })
                    }))
        });
        let copy: Vec<_> = copy.into_iter().enumerate().map(|(n, c)| rise(c, n)).collect();
        Some(
            div()
                .relative()
                .w_full()
                .h(px(hero_h))
                .overflow_hidden()
                .bg(theme::background())
                .when_some(previous.map(|p| p.image), |el, image| el.child(cover(image)))
                // Crossfade: the incoming slide fades in over the outgoing one.
                .child(
                    div().absolute().inset_0().child(cover(hero.image.clone())).with_animation(
                        SharedString::from(format!("hero-crossfade-{index}")),
                        Animation::new(Duration::from_millis(700)).with_easing(ease_out_quint()),
                        |el, t| el.opacity(t),
                    ),
                )
                // `.hero-scrim`: left-to-right legibility wash, a light top
                // band under the nav and a deep fade into the page.
                .child(div().absolute().inset_0().bg(linear_gradient(90., linear_color_stop(ink(0.78), 0.), linear_color_stop(ink(0.0), 0.62))))
                .child(div().absolute().left_0().right_0().top_0().h(px(150.)).bg(linear_gradient(180., linear_color_stop(ink(0.5), 0.), linear_color_stop(ink(0.0), 1.))))
                .child(hero_fade())
                .child(div().absolute().left(px(HERO_GUTTER)).right(px(HERO_GUTTER)).bottom(px(88.)).max_w(px(704.)).flex().flex_col().gap(px(16.)).children(copy))
                .children(dots)
                .when(count > 1, |el| {
                    el.child(div().absolute().left(px(14.)).top(px(hero_h / 2. - 20.)).child(arrow("hero-prev", Icon::ChevronLeft, -1)))
                        .child(div().absolute().right(px(14.)).top(px(hero_h / 2. - 20.)).child(arrow("hero-next", Icon::ChevronRight, 1)))
                }),
        )
    }

    /// `h-[clamp(30rem,68vh,52rem)]` from the web hero.
    pub fn hero_height(&self) -> f32 {
        let h = f32::from(self.shell_scroll.bounds().size.height);
        (if h > 100. { h } else { 760. } * 0.68).clamp(480., 832.)
    }

    /// Usable page width (window minus page gutters), for responsive rows.
    pub fn page_width(&self) -> f32 {
        let w = f32::from(self.shell_scroll.bounds().size.width);
        (if w > 100. { w } else { 1280. }) - 2. * PAGE_X
    }

    /// Landscape card width: ~4.3 cards per row like the web app.
    pub fn wide_card_width(&self) -> f32 {
        ((self.page_width() - 3. * 20.) / 4.15).clamp(220., 460.)
    }

    /// Landscape Continue Watching card with episode and remaining badges.
    pub fn continue_card(&self, item: &Item, cx: &mut Context<Self>) -> impl IntoElement {
        let path = item.path.clone();
        let progress = item.progress.unwrap_or_default();
        let name = item.episode_title.clone().unwrap_or_else(|| item.title.clone());
        let subtitle = if item.season.is_some() { item.title.clone() } else { item.year.map(|y| y.to_string()).unwrap_or_default() };
        let w = self.wide_card_width();
        div()
            .id(SharedString::from(format!("cw-{}", item.id)))
            .relative()
            .w(px(w))
            .h(px(w * 0.56))
            .flex_none()
            .rounded(px(14.))
            .overflow_hidden()
            .border_1()
            .border_color(snow(0.1))
            .cursor_pointer()
            .hover(|s| s.border_color(snow(0.28)))
            .on_click(cx.listener(move |this, _, window, cx| this.play_item(path.clone(), window, cx)))
            .child(cover_r(self.card_art(item), 13.))
            .child(div().absolute().inset_0().rounded(px(13.)).bg(linear_gradient(180., linear_color_stop(ink(0.0), 0.5), linear_color_stop(ink(0.8), 1.))))
            .when_some(item.episode, |el, e| el.child(div().absolute().top(px(10.)).left(px(10.)).child(badge(format!("E{e}")))))
            .when(progress.duration > 0.0, |el| el.child(div().absolute().top(px(10.)).right(px(10.)).child(badge(format_time(progress.duration - progress.position)))))
            .child(
                div()
                    .absolute()
                    .left(px(10.))
                    .right(px(10.))
                    .bottom(px(10.))
                    .flex()
                    .items_end()
                    .gap(px(8.))
                    .child(
                        div()
                            .flex_1()
                            .min_w_0()
                            .flex()
                            .flex_col()
                            .gap(px(2.))
                            .child(div().text_size(px(14.)).font_weight(gpui::FontWeight::SEMIBOLD).text_color(snow(1.)).truncate().child(name))
                            .child(div().text_size(px(11.)).text_color(snow(0.6)).truncate().child(subtitle)),
                    )
                    .child(progress_ring(progress.fraction())),
            )
    }

    /// Landscape episode card for Search and History: still, play on hover,
    /// show name, `S1 E2 · Title`, and an optional trailing caption.
    pub fn episode_tile(&self, id: SharedString, item: &Item, width: f32, caption: Option<String>, action: Option<AnyElement>, cx: &mut Context<Self>, on_click: impl Fn(&mut Self, &mut Window, &mut Context<Self>) + 'static) -> gpui::Stateful<gpui::Div> {
        let h = width * 0.5625;
        let progress = item.progress.filter(|p| p.position > 0.0 && p.duration > 0.0 && !item.watched());
        let name = self.episode_metas.get(&item.path).and_then(|e| e.name.clone()).or(item.episode_title.clone());
        let code = match (item.season, item.episode) {
            (Some(s), Some(e)) => format!("S{s} E{e}"),
            _ => item.year.map(|y| y.to_string()).unwrap_or_default(),
        };
        let line = match name {
            Some(n) if !code.is_empty() => format!("{code} · {n}"),
            Some(n) => n,
            None => code,
        };
        let group = id.clone();
        div()
            .id(id)
            .group(group.clone())
            .w(px(width))
            .flex_none()
            .flex()
            .flex_col()
            .gap(px(10.))
            .cursor_pointer()
            .on_click(cx.listener(move |this, _, window, cx| on_click(this, window, cx)))
            .child(
                div()
                    .relative()
                    .w(px(width))
                    .h(px(h))
                    .child(self.lift(
                        group.clone(),
                        width,
                        h,
                        theme::RADIUS_LG,
                        crate::ui::artwork::FrameTone::Page,
                        div().child(cover_r(self.card_art(item), theme::RADIUS_LG)),
                        cx,
                    ))
                    .child(
                        div()
                            .absolute()
                            .inset_0()
                            .rounded(px(theme::RADIUS_LG))
                            .flex()
                            .items_center()
                            .justify_center()
                            .bg(ink(0.35))
                            .opacity(0.)
                            .group_hover(group.clone(), |s| s.opacity(1.))
                            .child(div().size(px(44.)).rounded_full().bg(snow(0.92)).flex().items_center().justify_center().child(icon(Icon::Play, 20., ink(1.)))),
                    )
                    .when_some(progress, |el, p| {
                        el.child(div().absolute().left(px(10.)).right(px(10.)).bottom(px(10.)).h(px(4.)).rounded_full().bg(snow(0.3)).child(div().h_full().rounded_full().w(gpui::relative(p.fraction() as f32)).bg(snow(1.))))
                    })
                    .children(action.map(|a| div().absolute().top(px(8.)).right(px(8.)).opacity(0.).group_hover(group.clone(), |s| s.opacity(1.)).child(a)))
                    .child(crate::ui::artwork::hover_veil(group.clone(), theme::RADIUS_LG)),
            )
            .child(
                div()
                    .flex()
                    .items_baseline()
                    .gap(px(8.))
                    .child(div().flex_1().min_w_0().text_size(px(15.)).font_weight(gpui::FontWeight::SEMIBOLD).text_color(theme::foreground()).truncate().group_hover(group.clone(), |s| s.text_color(theme::accent())).child(item.title.clone()))
                    .children(caption.map(|c| div().flex_none().text_size(px(12.)).text_color(theme::muted()).child(c))),
            )
            .child(div().text_size(px(13.)).text_color(theme::muted()).truncate().child(line))
    }

    /// Width for a four-up grid of landscape tiles.
    pub fn tile_width(&self) -> f32 {
        ((self.page_width() - 3. * 20.) / 4.).max(200.)
    }

    /// Landscape art for an item: episode still, then TMDB backdrop, then
    /// local sidecar art, then TMDB poster.
    pub fn card_art(&self, item: &Item) -> Option<PathBuf> {
        let key = if item.season.is_some() { TitleKey::Show(item.show_key()) } else { TitleKey::Movie(item.path.clone()) };
        let meta = self.metas.get(&key);
        self.episode_metas
            .get(&item.path)
            .and_then(|e| e.still.clone())
            .or_else(|| meta.and_then(|m| m.backdrop.clone()))
            .or_else(|| item.backdrop.clone())
            .or_else(|| self.shows().into_iter().find(|s| s.key == item.show_key()).and_then(|s| s.backdrop))
            .or_else(|| meta.and_then(|m| m.poster.clone()))
            .or_else(|| item.poster.clone())
    }

    /// A TMDB genre's titles as their own page.
    pub fn render_genre_page(&self, genre: &str, cx: &mut Context<Self>) -> AnyElement {
        let titles: Vec<TitleView> = self
            .visible_shows()
            .iter()
            .map(TitleView::from_show)
            .chain(self.visible_movies().iter().map(TitleView::from_movie))
            .filter(|t| self.metas.get(&t.key).is_some_and(|m| m.genres.iter().any(|g| g == genre)))
            .collect();
        let titles = self.sort_and_filter(titles);
        let backdrop = titles.iter().find_map(|t| self.metas.get(&t.key).and_then(|m| m.backdrop.clone()));
        let count = titles.len();
        div()
            .flex()
            .flex_col()
            .child(
                div()
                    .relative()
                    .h(px(300.))
                    .overflow_hidden()
                    .child(cover(backdrop))
                    .child(div().absolute().inset_0().bg(linear_gradient(90., linear_color_stop(ink(0.85), 0.), linear_color_stop(ink(0.2), 0.8))))
                    .child(div().absolute().inset_0().bg(linear_gradient(180., linear_color_stop(ink(0.3), 0.), linear_color_stop(theme::background(), 1.))))
                    .child(
                        div()
                            .absolute()
                            .left(px(PAGE_X))
                            .bottom(px(28.))
                            .flex()
                            .flex_col()
                            .gap(px(8.))
                            .child(div().text_size(px(12.)).font_weight(gpui::FontWeight::SEMIBOLD).text_color(snow(0.6)).child("GENRE"))
                            .child(div().text_size(px(48.)).line_height(px(50.)).font_weight(gpui::FontWeight::BLACK).text_color(snow(1.)).child(genre.to_string()))
                            .child(div().text_size(px(14.)).text_color(snow(0.7)).child(format!("{count} title{} in your library", if count == 1 { "" } else { "s" }))),
                    ),
            )
            .child(
                div().px(px(PAGE_X)).pt(px(12.)).pb(px(48.)).child(if titles.is_empty() {
                    empty_state(Icon::Film, "Nothing here yet", "Titles tagged with this genre appear once their details are fetched from TMDB.", None).into_any_element()
                } else {
                    self.title_grid("genre", titles, cx).into_any_element()
                }),
            )
            .into_any_element()
    }

    pub fn render_home_page(&self, cx: &mut Context<Self>) -> AnyElement {
        if self.libraries.is_empty() {
            return div().px(px(38.)).child(self.render_welcome_public(cx)).into_any_element();
        }
        let mut resuming: Vec<&Item> = self.items.iter().filter(|i| !i.missing && i.progress.is_some_and(|p| p.resumable())).collect();
        resuming.sort_by_key(|i| std::cmp::Reverse(i.progress.map(|p| p.updated).unwrap_or(0)));
        resuming.retain(|i| !self.hidden(&TitleKey::Movie(i.path.clone())) && !self.hidden(&TitleKey::Show(i.show_key())));

        let mut rows = div().px(px(PAGE_X)).pt(px(8.)).pb(px(48.)).flex().flex_col().gap(px(48.));
        if !resuming.is_empty() {
            let cards: Vec<AnyElement> = resuming.iter().take(12).map(|i| self.continue_card(i, cx).into_any_element()).collect();
            rows = rows.child(self.section("Continue watching", None, div().id("row-continue").flex().gap(px(20.)).overflow_x_scroll().children(cards)));
        }
        let watchlist: Vec<_> = self.personal.marked(Mark::Watchlist).iter().filter_map(|k| self.title_view(k)).collect();
        if !watchlist.is_empty() {
            rows = rows.child(self.section("Watchlist", Some(self.see_all("see-watchlist", Screen::Watchlist, cx).into_any_element()), self.title_grid("home-watchlist", watchlist.into_iter().take(7).collect(), cx)));
        }
        let mut shows: Vec<_> = self.visible_shows().iter().map(TitleView::from_show).collect();
        shows.sort_by_key(|t| std::cmp::Reverse(t.added_at));
        if !shows.is_empty() {
            rows = rows.child(self.section("Recently added shows", Some(self.see_all("see-shows", Screen::Shows, cx).into_any_element()), self.title_grid("home-shows", shows.into_iter().take(7).collect(), cx)));
        }
        let mut movies: Vec<_> = self.visible_movies().iter().map(TitleView::from_movie).collect();
        movies.sort_by_key(|t| std::cmp::Reverse(t.added_at));
        if !movies.is_empty() {
            rows = rows.child(self.section("Recently added movies", Some(self.see_all("see-movies", Screen::Movies, cx).into_any_element()), self.title_grid("home-movies", movies.into_iter().take(7).collect(), cx)));
        }
        div().flex().flex_col().children(self.render_hero(cx)).child(rows).into_any_element()
    }

    // MARK: Library

    /// How often a title was played: finished plays plus an in-progress one.
    fn plays(&self, key: &TitleKey) -> usize {
        let paths: Vec<PathBuf> = match key {
            TitleKey::Movie(path) => vec![path.clone()],
            TitleKey::Show(show) => self.items.iter().filter(|i| &i.show_key() == show && i.season.is_some()).map(|i| i.path.clone()).collect(),
        };
        let finished = self.personal.history.iter().filter(|h| paths.contains(&h.path)).count();
        let started = self.items.iter().filter(|i| paths.contains(&i.path) && i.progress.is_some()).count();
        finished + started
    }

    fn category_card(&self, id: &'static str, icon_name: Icon, title: &str, count: usize, tint: Hsla, screen: Screen, cx: &mut Context<Self>) -> impl IntoElement {
        div()
            .id(id)
            .relative()
            .flex_1()
            .min_w(px(176.))
            .h(px(152.))
            .p(px(18.))
            .rounded(px(theme::RADIUS_XL))
            .overflow_hidden()
            .border_1()
            .border_color(theme::border())
            .bg(linear_gradient(135., linear_color_stop(with_alpha(tint, 0.32), 0.), linear_color_stop(theme::surface(), 0.9)))
            .cursor_pointer()
            .hover(|s| s.border_color(white(0.25)))
            .on_click(cx.listener(move |this, _, _, cx| {
                this.screen = screen.clone();
                cx.notify();
            }))
            .flex()
            .flex_col()
            .justify_between()
            .child(icon(icon_name, 26., theme::foreground()))
            .child(div().absolute().right(px(-14.)).bottom(px(-18.)).child(icon(icon_name, 110., white(0.06))))
            .child(
                div()
                    .flex()
                    .flex_col()
                    .gap(px(3.))
                    .child(div().text_size(px(14.)).font_weight(gpui::FontWeight::BOLD).text_color(theme::foreground()).child(title.to_string()))
                    .child(
                        div()
                            .flex()
                            .items_center()
                            .gap(px(5.))
                            .text_size(px(11.))
                            .text_color(theme::muted())
                            .child(format!("{count} title{}", if count == 1 { "" } else { "s" }))
                            .child(icon(Icon::ArrowRight, 13., theme::muted())),
                    ),
            )
    }

    fn genre_card(&self, index: usize, genre: String, _count: usize, cx: &mut Context<Self>) -> impl IntoElement {
        let lower = genre.to_lowercase();
        let (icon_name, tint) = if lower.contains("drama") {
            (Icon::Drama, gpui::hsla(0.07, 0.6, 0.35, 1.))
        } else if lower.contains("crime") {
            (Icon::Shield, gpui::hsla(0.6, 0.1, 0.3, 1.))
        } else if lower.contains("action") || lower.contains("adventure") || lower.contains("war") {
            (Icon::Swords, gpui::hsla(0.6, 0.5, 0.35, 1.))
        } else if lower.contains("mystery") || lower.contains("thriller") {
            (Icon::Eye, gpui::hsla(0.66, 0.5, 0.35, 1.))
        } else if lower.contains("sci-fi") || lower.contains("fantasy") || lower.contains("science") {
            (Icon::WandSparkles, gpui::hsla(0.74, 0.5, 0.35, 1.))
        } else if lower.contains("comedy") || lower.contains("family") || lower.contains("animation") {
            (Icon::Smile, gpui::hsla(0.13, 0.6, 0.35, 1.))
        } else {
            (Icon::Film, gpui::hsla(0.55, 0.3, 0.3, 1.))
        };
        let query = genre.clone();
        div()
            .id(SharedString::from(format!("genre-{index}")))
            .relative()
            .flex_none()
            .w(px(((self.page_width() - 4. * 16.) / 5.).max(150.)))
            .h(px(128.))
            .p(px(16.))
            .rounded(px(14.))
            .overflow_hidden()
            .border_1()
            .border_color(white(0.08))
            .bg(linear_gradient(135., linear_color_stop(with_alpha(tint, if theme::is_light() { 0.22 } else { 0.45 }), 0.), linear_color_stop(theme::surface(), 0.85)))
            .cursor_pointer()
            .hover(|s| s.border_color(white(0.3)).bg(linear_gradient(135., linear_color_stop(with_alpha(tint, if theme::is_light() { 0.32 } else { 0.6 }), 0.), linear_color_stop(theme::surface(), 0.85))))
            .on_click(cx.listener(move |this, _, _, cx| {
                this.screen = Screen::Genre(query.clone());
                cx.notify();
            }))
            .flex()
            .flex_col()
            .justify_end()
            .child(div().absolute().right(px(-12.)).bottom(px(-18.)).child(icon(icon_name, 104., white(0.07))))
            .child(div().text_size(px(20.)).line_height(px(24.)).font_weight(gpui::FontWeight::BOLD).text_color(theme::foreground()).child(genre))
    }

    pub fn render_library_page(&self, cx: &mut Context<Self>) -> AnyElement {
        let movies: Vec<_> = self.visible_movies().iter().map(TitleView::from_movie).collect();
        let shows: Vec<_> = self.visible_shows().iter().map(TitleView::from_show).collect();
        let (movie_count, show_count) = (movies.len(), shows.len());
        let mut all: Vec<_> = movies.into_iter().chain(shows).collect();
        let mut top: Vec<(usize, crate::personal_ui::TitleView)> = Vec::new();
        for title in &all {
            let plays = self.plays(&title.key);
            if plays > 0 {
                if let Some(view) = self.title_view(&title.key) {
                    top.push((plays, view));
                }
            }
        }
        top.sort_by_key(|(plays, t)| (std::cmp::Reverse(*plays), t.title.to_lowercase()));
        top.truncate(10);
        all = self.sort_and_filter(all);
        let total = all.len();
        let sort_label = match self.sort {
            Sort::Title => "Title",
            Sort::Added => "Recently added",
            Sort::Year => "Year",
        };
        let unwatched = self.watch_filter == WatchFilter::Unwatched;
        let sort_open = self.open_select == Some("lib-sort");
        let resuming: Vec<AnyElement> = {
            let mut r: Vec<&Item> = self.items.iter().filter(|i| !i.missing && i.progress.is_some_and(|p| p.resumable())).collect();
            r.sort_by_key(|i| std::cmp::Reverse(i.progress.map(|p| p.updated).unwrap_or(0)));
            r.into_iter().take(12).map(|i| self.continue_card(i, cx).into_any_element()).collect()
        };
        let mut genre_counts: std::collections::HashMap<String, usize> = Default::default();
        for meta in self.metas.values() {
            for g in &meta.genres {
                *genre_counts.entry(g.clone()).or_default() += 1;
            }
        }
        let mut genre_counts: Vec<(String, usize)> = genre_counts.into_iter().collect();
        genre_counts.sort_by(|a, b| b.1.cmp(&a.1).then(a.0.cmp(&b.0)));
        genre_counts.truncate(5);
        let genre_list_empty = genre_counts.is_empty();
        let genres: Vec<AnyElement> = genre_counts.into_iter().enumerate().map(|(i, (g, n))| self.genre_card(i, g, n, cx).into_any_element()).collect();

        let top_cards: Vec<AnyElement> = top
            .into_iter()
            .enumerate()
            .map(|(index, (_, t))| {
                let key = t.key.clone();
                let meta_image = self.metas.get(&t.key).and_then(|m| m.backdrop.clone());
                let card_w = self.wide_card_width() * 0.95;
                let image = meta_image.or(match &t.key {
                    TitleKey::Movie(p) => self.items.iter().find(|i| &i.path == p).and_then(|i| i.backdrop.clone()).or(t.poster.clone()),
                    TitleKey::Show(k) => self.shows().into_iter().find(|s| &s.key == k).and_then(|s| s.backdrop).or(t.poster.clone()),
                });
                // Prime-style rank: a huge grey numeral behind the card's
                // left edge, the 16:9 card overlapping it.
                let card_h = card_w * 0.5625;
                let rank = (index + 1).to_string();
                let num_w = if rank.len() > 1 { 190. } else { 112. };
                let group = SharedString::from(format!("top-{index}"));
                div()
                    .id(group.clone())
                    .group(group.clone())
                    .relative()
                    .flex_none()
                    .w(px(num_w + card_w - 34.))
                    .h(px(card_h + 8.))
                    .cursor_pointer()
                    .on_click(cx.listener(move |this, _, _, cx| this.open_title(&key, cx)))
                    .child(
                        div()
                            .absolute()
                            .left_0()
                            .bottom(px(-22.))
                            .text_size(px(card_h * 0.95))
                            .line_height(px(card_h))
                            .font_weight(gpui::FontWeight::BLACK)
                            .text_color(with_alpha(theme::muted(), if theme::is_light() { 0.45 } else { 0.55 }))
                            .child(rank),
                    )
                    .child(
                        div()
                            .absolute()
                            .right_0()
                            .top(px(4.))
                            .child(
                                div()
                                    .relative()
                                    .w(px(card_w))
                                    .h(px(card_h))
                                    .child(self.lift(
                                        group.clone(),
                                        card_w,
                                        card_h,
                                        theme::RADIUS_LG,
                                        crate::ui::artwork::FrameTone::Page,
                                        div().child(cover_r(image, theme::RADIUS_LG)),
                                        cx,
                                    ))
                                    .child(div().absolute().left_0().right_0().bottom_0().h(px(card_h * 0.5)).rounded_b(px(theme::RADIUS_LG)).bg(linear_gradient(180., linear_color_stop(ink(0.), 0.), linear_color_stop(ink(0.75), 1.))))
                                    .child(div().absolute().left(px(14.)).right(px(14.)).bottom(px(12.)).text_size(px(15.)).font_weight(gpui::FontWeight::BOLD).text_color(snow(1.)).truncate().child(t.title.clone()))
                                    .child(crate::ui::artwork::hover_veil(group.clone(), theme::RADIUS_LG)),
                            ),
                    )
                    .into_any_element()
            })
            .collect();

        div()
            .px(px(PAGE_X))
            .pt(px(84.))
            .pb(px(48.))
            .flex()
            .flex_col()
            .gap(px(40.))
            .child(
                div()
                    .flex()
                    .flex_wrap()
                    .items_end()
                    .justify_between()
                    .gap(px(13.))
                    .child(div().flex().flex_col().gap(px(10.)).child(h1("Library")).child(div().text_size(px(14.)).text_color(theme::muted()).child("Browse every movie and show in your libraries.")))
                    .child(
                        div()
                            .flex()
                            .items_center()
                            .gap(px(11.))
                            .child(div().text_size(px(11.)).text_color(theme::muted()).child(format!("{total} titles")))
                            .child(
                                div()
                                    .id("lib-unwatched")
                                    .h(px(37.))
                                    .px(px(14.))
                                    .flex()
                                    .items_center()
                                    .rounded_full()
                                    .cursor_pointer()
                                    .text_size(px(11.))
                                    .font_weight(gpui::FontWeight::SEMIBOLD)
                                    .bg(if unwatched { with_alpha(theme::accent(), 0.22) } else { theme::default() })
                                    .text_color(if unwatched { theme::accent() } else { theme::muted() })
                                    .on_click(cx.listener(|this, _, _, cx| {
                                        this.watch_filter = if this.watch_filter == WatchFilter::Unwatched { WatchFilter::All } else { WatchFilter::Unwatched };
                                        cx.notify();
                                    }))
                                    .child("Unwatched"),
                            )
                            .child(
                                div()
                                    .id("lib-sort")
                                    .h(px(37.))
                                    .min_w(px(168.))
                                    .px(px(14.))
                                    .flex()
                                    .items_center()
                                    .justify_between()
                                    .gap(px(10.))
                                    .rounded_full()
                                    .cursor_pointer()
                                    .bg(theme::default())
                                    .hover(|s| s.bg(theme::segment()))
                                    .when(sort_open, |el| el.bg(theme::segment()))
                                    .on_click(cx.listener(|this, _, _, cx| {
                                        this.toggle_select("lib-sort");
                                        cx.notify();
                                    }))
                                    .child(div().text_size(px(13.)).text_color(theme::foreground()).child(sort_label))
                                    .child(icon(Icon::ChevronDown, 16., theme::foreground()))
                                    .when(sort_open, |el| {
                                        el.child(dropdown(
                                            [(Sort::Added, "Recently added"), (Sort::Title, "Title"), (Sort::Year, "Year")]
                                                .into_iter()
                                                .map(|(value, label)| {
                                                    menu_item(format!("sort-{label}"), None, label, self.sort == value)
                                                        .on_click(cx.listener(move |this, _, _, cx| {
                                                            cx.stop_propagation();
                                                            this.sort = value;
                                                            this.open_select = None;
                                                            cx.notify();
                                                        }))
                                                        .into_any_element()
                                                })
                                                .collect(),
                                            180.,
                                        ))
                                    }),
                            ),
                    ),
            )
            .when(!genres.is_empty(), |el| {
                el.child(
                    div()
                        .flex()
                        .flex_col()
                        .gap(px(14.))
                        .child(div().flex().items_center().justify_between().child(h2("Categories")).child(div().text_size(px(13.)).text_color(theme::muted()).child("Browse by mood")))
                        .child(div().text_size(px(15.)).font_weight(gpui::FontWeight::SEMIBOLD).text_color(theme::foreground()).child("Genres"))
                        .child(div().flex().gap(px(16.)).children(genres)),
                )
            })
            .when(genre_list_empty, |el| el.child(
                self.section(
                    "Categories",
                    Some(div().text_size(px(11.)).text_color(theme::muted()).child("Browse by type").into_any_element()),
                    div()
                        .flex()
                        .flex_wrap()
                        .gap(px(14.))
                        .child(self.category_card("cat-movies", Icon::Film, "Movies", movie_count, theme::warning(), Screen::Movies, cx))
                        .child(self.category_card("cat-shows", Icon::Tv, "TV Shows", show_count, theme::accent(), Screen::Shows, cx))
                        .child(self.category_card("cat-watchlist", Icon::Bookmark, "Watchlist", self.personal.marked(Mark::Watchlist).len(), theme::success(), Screen::Watchlist, cx))
                        .child(self.category_card("cat-favorites", Icon::Heart, "Favorites", self.personal.marked(Mark::Favorite).len(), theme::danger(), Screen::Favorites, cx))
                        .child(self.category_card("cat-collections", Icon::FolderHeart, "Collections", self.personal.collections.len(), theme::segment(), Screen::Collections, cx)),
                ),
            ))
            .when(!top_cards.is_empty(), |el| {
                el.child(
                    div()
                        .flex()
                        .flex_col()
                        .gap(px(14.))
                        .child(div().flex().items_center().gap(px(8.)).child(icon(Icon::TrendingUp, 22., theme::accent())).child(h2("Top 10 in your library")))
                        .child(div().id("row-top").flex().gap(px(28.)).overflow_x_scroll().pb(px(24.)).children(top_cards)),
                )
            })
            .when(!resuming.is_empty(), |el| el.child(self.section("Continue watching", None, div().id("lib-continue").flex().gap(px(20.)).overflow_x_scroll().children(resuming))))
            .child(self.section("All titles", None, self.title_grid("library-all", all, cx)))
            .into_any_element()
    }

    // MARK: Title hero

    fn title_hero(
        &self,
        key: &TitleKey,
        title: &str,
        meta: Vec<String>,
        image: Option<PathBuf>,
        play: Option<(PathBuf, Option<f64>)>,
        watched: bool,
        on_watched: impl Fn(&mut Self, &mut Context<Self>) + 'static,
        window: &Window,
        cx: &mut Context<Self>,
    ) -> impl IntoElement {
        let (in_watchlist, favorite, hidden) = (self.personal.has(key, Mark::Watchlist), self.personal.has(key, Mark::Favorite), self.personal.has(key, Mark::Hidden));
        let (k1, k2, k3, k4) = (key.clone(), key.clone(), key.clone(), key.clone());
        let tmdb = self.metas.get(key).cloned();
        let scope = key.encode();
        let mut copy: Vec<AnyElement> = Vec::new();
        if let Some(m) = &tmdb {
            if !m.genres.is_empty() {
                copy.push(div().flex().gap(px(8.)).children(m.genres.iter().take(3).cloned().map(genre_chip)).into_any_element());
            }
        }
        copy.push(match tmdb.as_ref().and_then(|m| m.logo.clone()) {
            Some(logo) => div().h(px(96.)).max_w(px(340.)).child(crate::assets::artwork_image(logo).h_full().max_w(px(340.)).object_fit(ObjectFit::Contain)).into_any_element(),
            None => div().text_size(px(44.)).line_height(px(48.)).font_weight(gpui::FontWeight::BLACK).text_color(snow(1.)).child(title.to_uppercase()).into_any_element(),
        });
        copy.push(div().text_size(px(14.)).text_color(snow(0.85)).child(dot_join(meta)).into_any_element());
        if let Some(r) = tmdb.as_ref().and_then(|m| m.rating).filter(|r| *r > 0.0) {
            let out_of_five = r / 2.0;
            let filled = out_of_five.round() as usize;
            copy.push(
                div()
                    .flex()
                    .items_center()
                    .gap(px(8.))
                    .child(div().flex().gap(px(2.)).text_size(px(15.)).children((0..5).map(|i| div().text_color(if i < filled { theme::warning() } else { snow(0.3) }).child("★"))))
                    .child(div().text_size(px(12.)).text_color(snow(0.75)).child(format!("Average rating {out_of_five:.1}/5")))
                    .into_any_element(),
            );
        }
        if let Some(overview) = tmdb.as_ref().and_then(|m| m.overview.clone()).filter(|o| !o.is_empty()) {
            let short = if overview.chars().count() > 280 { format!("{}…", overview.chars().take(280).collect::<String>().trim_end()) } else { overview };
            copy.push(div().max_w(px(600.)).text_size(px(14.)).line_height(px(21.)).text_color(snow(0.78)).child(short).into_any_element());
        }
        div()
            .flex()
            .flex_col()
            .gap(px(13.))
            .child(
                div()
                    .relative()
                    .mx(px(-PAGE_X))
                    .mt(px(-84.))
                    .h(px(self.hero_height()))
                    .overflow_hidden()
                    .child(cover(tmdb.as_ref().and_then(|m| m.backdrop.clone()).or(image)))
                    .child(div().absolute().inset_0().bg(linear_gradient(90., linear_color_stop(ink(0.82), 0.), linear_color_stop(ink(0.0), 0.65))))
                    .child(div().absolute().left_0().right_0().top_0().h(px(150.)).bg(linear_gradient(180., linear_color_stop(ink(0.5), 0.), linear_color_stop(ink(0.0), 1.))))
                    .child(hero_fade())
                    .child(
                        div()
                            .absolute()
                            .left(px(HERO_GUTTER))
                            .bottom(px(56.))
                            .max_w(px(720.))
                            .flex()
                            .flex_col()
                            .gap(px(13.))
                            .children(copy.into_iter().enumerate().map(|(n, c)| rise(c, &scope, n)))
                            .child(
                                div()
                                    .flex()
                                    .flex_wrap()
                                    .items_center()
                                    .gap(px(10.))
                                    .when_some(play, |el, (path, resume_at)| {
                                        let restart = path.clone();
                                        el.child(
                                            self.pill_button("title-play", Some(Icon::Play), match resume_at {
                                                Some(at) => format!("Resume  {}", format_time(at)),
                                                None => "Play".into(),
                                            }, true)
                                            .on_click(cx.listener(move |this, _, window, cx| this.play_item(path.clone(), window, cx))),
                                        )
                                        .when(resume_at.is_some(), |el| {
                                            el.child(self.pill_button("title-restart", Some(Icon::Restart), "Start over", false).on_click(cx.listener(move |this, _, window, cx| {
                                                this.open_at(&restart, Some(0.0), window, cx)
                                            })))
                                        })
                                    })
                                    .child(self.circle_button("title-watched", if watched { Icon::CircleCheck } else { Icon::Circle }, watched).on_click(cx.listener(move |this, _, _, cx| {
                                        on_watched(this, cx);
                                        this.reload_catalog();
                                        cx.notify();
                                    })))
                                    .child(self.circle_button("title-watchlist", Icon::Bookmark, in_watchlist).on_click(cx.listener(move |this, _, _, cx| {
                                        this.catalog.toggle_mark(&k1, Mark::Watchlist);
                                        this.reload_catalog();
                                        cx.notify();
                                    })))
                                    .child(self.circle_button("title-favorite", Icon::Star, favorite).on_click(cx.listener(move |this, _, _, cx| {
                                        this.catalog.toggle_mark(&k2, Mark::Favorite);
                                        this.reload_catalog();
                                        cx.notify();
                                    })))
                                    .child(
                                        div()
                                            .child(self.circle_button("title-more", Icon::Ellipsis, self.open_select == Some("title-more")).on_click(cx.listener(|this, _, _, cx| {
                                                this.toggle_select("title-more");
                                                cx.notify();
                                            })))
                                            .when(self.open_select == Some("title-more"), |el| {
                                                el.child(dropdown(
                                                    vec![
                                                        menu_item("title-hide", Some(Icon::EyeOff), if hidden { "Unhide" } else { "Hide from library" }, false)
                                                            .on_click(cx.listener(move |this, _, _, cx| {
                                                                this.open_select = None;
                                                                this.catalog.toggle_mark(&k3, Mark::Hidden);
                                                                this.reload_catalog();
                                                                cx.notify();
                                                            }))
                                                            .into_any_element(),
                                                        menu_item("title-collection", Some(Icon::FolderHeart), "Add to collection", false)
                                                            .on_click(cx.listener(move |this, _, window, cx| {
                                                                this.open_select = None;
                                                                this.collection_picker = true;
                                                                this.collection_target = Some(k4.clone());
                                                                window.focus(&this.collection_focus.clone());
                                                                cx.notify();
                                                            }))
                                                            .into_any_element(),
                                                    ],
                                                    210.,
                                                ))
                                            }),
                                    ),
                            ),
                    ),
            )
            .when(self.collection_picker, |el| el.child(self.title_actions(key, window, cx)))
    }

    fn panel(&self, title: &str, icon_name: Option<Icon>, body: impl IntoElement) -> impl IntoElement {
        div()
            .rounded(px(19.))
            .bg(theme::surface())
            .border_1()
            .border_color(theme::border())
            .overflow_hidden()
            .child(
                div()
                    .px(px(22.))
                    .py(px(18.))
                    .flex()
                    .items_center()
                    .gap(px(8.))
                    .when_some(icon_name, |el, name| el.child(icon(name, 18., theme::muted())))
                    .child(div().text_size(px(18.)).font_weight(gpui::FontWeight::BOLD).text_color(theme::foreground()).child(title.to_string())),
            )
            .child(div().p(px(11.)).child(body))
    }

    /// Top cast from TMDB: 36px photo, name, role.
    fn cast_panel(&self, key: &TitleKey) -> Option<AnyElement> {
        let cast = self.metas.get(key).map(|m| m.cast.clone()).filter(|c| !c.is_empty())?;
        let rows = cast.into_iter().take(8).map(|person| {
            div()
                .flex()
                .items_center()
                .gap(px(11.))
                .px(px(11.))
                .py(px(6.))
                .child(
                    div()
                        .size(px(36.))
                        .flex_none()
                        .rounded_full()
                        .overflow_hidden()
                        .bg(theme::surface_secondary())
                        .relative()
                        .when_some(person.photo.clone(), |el, p| el.child(crate::assets::artwork_cover(p, 0.)))
                        .child(circle_mask(36., theme::surface())),
                )
                .child(
                    div()
                        .min_w_0()
                        .flex()
                        .flex_col()
                        .child(div().text_size(px(13.)).font_weight(gpui::FontWeight::SEMIBOLD).text_color(theme::foreground()).truncate().child(person.name))
                        .child(div().text_size(px(11.)).text_color(theme::muted()).truncate().child(person.role)),
                )
        });
        Some(self.panel("Top cast", None, div().flex().flex_col().children(rows)).into_any_element())
    }

    /// Title facts for the Details panel: TMDB fields first, then `extra`.
    fn title_details(&self, key: &TitleKey, extra: Vec<(&str, String)>) -> impl IntoElement {
        let meta = self.metas.get(key);
        let mut rows: Vec<(&str, String)> = Vec::new();
        if let Some(m) = meta {
            if let Some(y) = m.year {
                rows.push(("Released", y.to_string()));
            }
            if !m.genres.is_empty() {
                rows.push(("Genres", m.genres.join(", ")));
            }
            if let Some(r) = m.runtime {
                rows.push(("Runtime", format!("{r} min")));
            }
            if let Some(c) = m.certification.clone() {
                rows.push(("Rated", c));
            }
            if let Some(r) = m.rating.filter(|r| *r > 0.0) {
                rows.push(("TMDB rating", format!("{r:.1} / 10")));
            }
        }
        rows.extend(extra.into_iter().filter(|(_, v)| !v.is_empty()));
        div().flex().flex_col().children(rows.into_iter().map(|(l, v)| Self::detail_row(l, v)))
    }

    fn detail_row(label: &str, value: String) -> impl IntoElement {
        // Label and value share a line; a long value wraps under its label.
        div()
            .flex()
            .flex_wrap()
            .items_baseline()
            .justify_between()
            .gap_x(px(16.))
            .gap_y(px(2.))
            .px(px(11.))
            .py(px(9.))
            .child(div().flex_none().text_size(px(12.)).text_color(theme::muted()).child(label.to_string()))
            .child(div().min_w_0().text_size(px(13.)).text_color(theme::foreground()).text_right().child(value))
    }

    pub fn render_show_page(&self, key: &str, window: &Window, cx: &mut Context<Self>) -> AnyElement {
        let Some(show) = self.shows().into_iter().find(|s| s.key == key) else {
            return div().px(px(PAGE_X)).pt(px(84.)).child(empty_state(Icon::Tv, "Show not found", "This show is no longer in your library.", None)).into_any_element();
        };
        let title_key = TitleKey::Show(show.key.clone());
        let next = show.next_up().cloned();
        let seasons: Vec<u32> = show.seasons.keys().copied().collect();
        let season = self.selected_season.filter(|s| seasons.contains(s)).or_else(|| next.as_ref().and_then(|n| n.season)).or(seasons.first().copied()).unwrap_or(0);
        let all_watched = show.unwatched() == 0;
        let paths: Vec<PathBuf> = show.episodes().map(|e| e.path.clone()).collect();
        let tm = self.metas.get(&title_key);
        let meta = vec![
            tm.and_then(|m| m.year).map(|y| y.to_string()).unwrap_or_default(),
            tm.and_then(|m| m.runtime).map(|r| format!("{r} min")).unwrap_or_default(),
            tm.and_then(|m| m.certification.clone()).unwrap_or_default(),
            format!("{} season{}", seasons.iter().filter(|s| **s > 0).count(), if seasons.len() == 1 { "" } else { "s" }),
            "Series".into(),
        ];
        let hero = self.title_hero(
            &title_key,
            &show.title,
            meta,
            show.backdrop.clone().or(show.poster.clone()),
            next.as_ref().map(|n| (n.path.clone(), n.progress.filter(|p| p.resumable()).map(|p| p.position))),
            all_watched,
            move |this, _| {
                for path in &paths {
                    this.catalog.set_watched(path, !all_watched);
                }
            },
            window,
            cx,
        );

        let season_name = |s: u32| if s == 0 { "Extras".to_string() } else { format!("Season {s}") };
        let season_open = self.open_select == Some("season");
        let season_picker = div()
            .flex()
            .child(
                div()
                    .id("season-picker")
                    .h(px(44.))
                    .px(px(18.))
                    .flex()
                    .items_center()
                    .gap(px(12.))
                    .rounded(px(10.))
                    .cursor_pointer()
                    .bg(theme::default())
                    .hover(|s| s.bg(theme::segment()))
                    .text_size(px(16.))
                    .font_weight(gpui::FontWeight::SEMIBOLD)
                    .text_color(theme::foreground())
                    .on_click(cx.listener(|this, _, _, cx| {
                        this.toggle_select("season");
                        cx.notify();
                    }))
                    .child(season_name(season))
                    .child(icon(Icon::ChevronDown, 16., theme::foreground())),
            )
            .when(season_open && seasons.len() > 1, |el| {
                el.child(dropdown(
                    seasons
                        .iter()
                        .map(|s| {
                            let s = *s;
                            menu_item(format!("season-{s}"), None, season_name(s), s == season)
                                .on_click(cx.listener(move |this, _, _, cx| {
                                    this.selected_season = Some(s);
                                    this.open_select = None;
                                    cx.notify();
                                }))
                                .into_any_element()
                        })
                        .collect(),
                    200.,
                ))
            });

        let card_w = ((self.page_width() - 3. * 24.) / 4.).max(220.);
        let season_eps = show.seasons.get(&season).cloned().unwrap_or_default();
        let episode_count = season_eps.len();
        let runtime = self.metas.get(&title_key).and_then(|m| m.runtime);
        let mut episodes = div().flex().flex_wrap().gap_x(px(24.)).gap_y(px(36.));
        for episode in season_eps {
            let play = episode.path.clone();
            let watched = episode.watched();
            let progress = episode.progress.filter(|p| p.position > 0.0 && !watched && p.duration > 0.0);
            let em = self.episode_metas.get(&episode.path).cloned().unwrap_or_default();
            let show_art = self.metas.get(&title_key).and_then(|m| m.backdrop.clone()).or(show.backdrop.clone());
            let number = episode.episode.unwrap_or(0);
            let name = em.name.clone().or(episode.episode_title.clone()).unwrap_or_else(|| format!("Episode {number}"));
            let minutes = episode.progress.filter(|p| p.duration > 0.0).map(|p| (p.duration / 60.).round() as u32).or(runtime);
            let group = SharedString::from(format!("ep-{}", episode.id));
            episodes = episodes.child(
                div()
                    .id(SharedString::from(format!("episode-{}", episode.id)))
                    .group(group.clone())
                    .w(px(card_w))
                    .flex_none()
                    .flex()
                    .flex_col()
                    .gap(px(10.))
                    .cursor_pointer()
                    .on_click(cx.listener(move |this, _, window, cx| this.play_item(play.clone(), window, cx)))
                    .child(
                        div()
                            .relative()
                            .w(px(card_w))
                            .h(px(card_w * 0.5625))
                            .child(self.lift(
                                group.clone(),
                                card_w,
                                card_w * 0.5625,
                                theme::RADIUS_LG,
                                crate::ui::artwork::FrameTone::Page,
                                div().child(cover_r(em.still.clone().or(episode.backdrop.clone()).or(show_art).or(episode.poster.clone()), theme::RADIUS_LG)),
                                cx,
                            ))
                            .child(
                                div()
                                    .absolute()
                                    .inset_0()
                                    .rounded(px(theme::RADIUS_LG))
                                    .flex()
                                    .items_center()
                                    .justify_center()
                                    .bg(gpui::hsla(0., 0., 0., 0.35))
                                    .opacity(0.)
                                    .group_hover(group.clone(), |s| s.opacity(1.))
                                    .child(div().size(px(48.)).rounded_full().bg(gpui::hsla(0., 0., 1., 0.92)).flex().items_center().justify_center().child(icon(Icon::Play, 22., gpui::hsla(0., 0., 0., 1.)))),
                            )
                            .when_some(progress, |el, p| {
                                let left = ((p.duration - p.position) / 60.).ceil().max(1.) as u32;
                                el.child(div().absolute().right(px(8.)).bottom(px(12.)).child(badge(format!("{left} min left"))))
                                    .child(div().absolute().left_0().right_0().bottom_0().h(px(4.)).bg(gpui::hsla(0., 0., 1., 0.3)).child(div().h_full().w(gpui::relative(p.fraction() as f32)).bg(gpui::hsla(0., 0., 1., 1.))))
                            })
                            .child(crate::ui::artwork::hover_veil(group.clone(), theme::RADIUS_LG)),
                    )
                    .child(div().text_size(px(17.)).font_weight(gpui::FontWeight::BOLD).text_color(theme::foreground()).truncate().group_hover(group.clone(), |s| s.text_color(theme::accent())).child(format!("{number}. {name}")))
                    .when_some(em.overview.clone().filter(|o| !o.is_empty()), |el, o| el.child(div().text_size(px(14.)).line_height(px(20.)).text_color(theme::muted()).line_clamp(2).text_ellipsis().child(o)))
                    .child(
                        div()
                            .flex()
                            .items_center()
                            .gap(px(12.))
                            .text_size(px(13.))
                            .text_color(theme::muted())
                            .when_some(minutes, |el, m| el.child(format!("{m}min")))
                            .when(watched, |el| el.child(div().flex().items_center().gap(px(5.)).child(icon(Icon::CircleCheck, 14., theme::accent())).child("Watched"))),
                    ),
            );
        }

        let details = self.title_details(&title_key, vec![
            ("Seasons", seasons.iter().filter(|s| **s > 0).count().to_string()),
            ("Episodes", show.episodes().count().to_string()),
        ]);

        let others: Vec<_> = self
            .visible_shows()
            .iter()
            .filter(|s| s.key != show.key)
            .take(6)
            .map(TitleView::from_show)
            .collect();

        div()
            .px(px(PAGE_X))
            .pt(px(84.))
            .pb(px(48.))
            .flex()
            .flex_col()
            .gap(px(29.))
            .child(hero)
            .child(
                div()
                    .flex()
                    .flex_col()
                    .gap(px(20.))
                    .child(if seasons.len() > 1 { season_picker.into_any_element() } else { h2(season_name(season)).into_any_element() })
                    .child(div().text_size(px(16.)).text_color(theme::muted()).child(format!("{episode_count} episode{}", if episode_count == 1 { "" } else { "s" })))
                    .child(episodes),
            )
            .child(
                div()
                    .pt(px(12.))
                    .flex()
                    .gap(px(22.))
                    .items_start()
                    .children(self.cast_panel(&title_key).map(|c| div().flex_1().min_w_0().child(c)))
                    .child(div().flex_1().min_w_0().child(self.panel("Details", Some(Icon::List), details))),
            )
            .when(!others.is_empty(), |el| el.child(self.section("More like this", None, self.title_grid("more", others, cx))))
            .into_any_element()
    }

    pub fn render_movie_page(&self, path: &PathBuf, window: &Window, cx: &mut Context<Self>) -> AnyElement {
        let Some(movie) = self.items.iter().find(|i| &i.path == path).cloned() else {
            return div().px(px(PAGE_X)).pt(px(84.)).child(empty_state(Icon::Film, "Movie not found", "This movie is no longer in your library.", None)).into_any_element();
        };
        let key = TitleKey::Movie(path.clone());
        let watched = movie.watched();
        let toggle = path.clone();
        let meta = vec![
            movie.year.map(|y| y.to_string()).unwrap_or_default(),
            self.metas.get(&TitleKey::Movie(path.clone())).and_then(|m| m.runtime).map(|r| format!("{r} min")).or(movie.progress.filter(|p| p.duration > 0.0).map(|p| format!("{} min", (p.duration / 60.0).round()))).unwrap_or_default(),
            self.metas.get(&TitleKey::Movie(path.clone())).and_then(|m| m.certification.clone()).unwrap_or_default(),
            "Movie".into(),
            if movie.missing { "File unavailable".into() } else { String::new() },
        ];
        let hero = self.title_hero(
            &key,
            &movie.title,
            meta,
            movie.backdrop.clone().or(movie.poster.clone()),
            Some((path.clone(), movie.progress.filter(|p| p.resumable()).map(|p| p.position))),
            watched,
            move |this, _| this.catalog.set_watched(&toggle, !watched),
            window,
            cx,
        );
        let size = std::fs::metadata(path).map(|m| format!("{:.2} GB", m.len() as f64 / 1e9)).unwrap_or_default();
        let details = self.title_details(&key, vec![("Size", size)]);
        let others: Vec<_> = self.visible_movies().iter().filter(|m| &m.path != path).take(6).map(TitleView::from_movie).collect();
        div()
            .px(px(PAGE_X))
            .pt(px(84.))
            .pb(px(48.))
            .flex()
            .flex_col()
            .gap(px(29.))
            .child(hero)
            .child(div().flex().gap(px(22.)).items_start().children(self.cast_panel(&key).map(|c| div().w(px(496.)).child(c))).child(div().w(px(496.)).child(self.panel("Details", Some(Icon::List), details))))
            .when(!others.is_empty(), |el| el.child(self.section("More like this", None, self.title_grid("more-movies", others, cx))))
            .into_any_element()
    }

    // MARK: Settings

    fn toggle(&self, id: &'static str, on: bool, cx: &mut Context<Self>, flip: impl Fn(&mut Self) + 'static) -> impl IntoElement {
        div()
            .id(id)
            .w(px(37.))
            .h(px(21.))
            .p(px(2.))
            .rounded_full()
            .cursor_pointer()
            .bg(if on { theme::accent() } else { theme::segment() })
            .flex()
            .when(on, |el| el.justify_end())
            .on_click(cx.listener(move |this, _, _, cx| {
                flip(this);
                cx.notify();
            }))
            .child(div().size(px(16.)).rounded_full().bg(theme::foreground()))
    }

    fn language_select(&self, id: &'static str, setting: &'static str, cx: &mut Context<Self>) -> impl IntoElement {
        let current = self.catalog.setting(setting).unwrap_or_default();
        let label = LANGUAGES.iter().find(|(code, _)| *code == current).map(|(_, name)| name.to_string()).unwrap_or_else(|| language_name(&current));
        let open = self.open_select == Some(setting);
        div()
            .relative()
            .child(
                div()
                    .id(id)
                    .w(px(256.))
                    .h(px(40.))
                    .px(px(14.))
                    .flex()
                    .items_center()
                    .justify_between()
                    .rounded(px(theme::RADIUS_LG))
                    .cursor_pointer()
                    .bg(theme::surface_secondary())
                    .border_1()
                    .border_color(if open { theme::accent() } else { theme::border() })
                    .on_click(cx.listener(move |this, _, _, cx| {
                        this.toggle_select(setting);
                        cx.notify();
                    }))
                    .child(div().text_size(px(14.)).text_color(theme::foreground()).child(label))
                    .child(icon(Icon::ChevronDown, 16., theme::foreground())),
            )
            .when(open, |el| {
                el.child(dropdown(
                    LANGUAGES
                        .iter()
                        .map(|(code, name)| {
                            menu_item(format!("{setting}-{code}"), None, *name, *code == current)
                                .on_click(cx.listener(move |this, _, _, cx| {
                                    this.catalog.set_setting(setting, code);
                                    this.open_select = None;
                                    cx.notify();
                                }))
                                .into_any_element()
                        })
                        .collect(),
                    256.,
                ))
            })
    }

    fn settings_card(&self, icon_name: Icon, title: &str, rows: Vec<AnyElement>) -> impl IntoElement {
        div()
            .rounded(px(19.))
            .bg(theme::surface())
            .border_1()
            .border_color(theme::border())
            .child(
                div()
                    .px(px(22.))
                    .py(px(16.))
                    .flex()
                    .items_center()
                    .gap(px(13.))
                    .child(div().size(px(34.)).rounded(px(theme::RADIUS_LG)).bg(theme::surface_secondary()).flex().items_center().justify_center().child(icon(icon_name, 18., theme::muted())))
                    .child(div().text_size(px(14.)).font_weight(gpui::FontWeight::BOLD).text_color(theme::foreground()).child(title.to_string())),
            )
            .children(rows.into_iter().enumerate().map(|(index, row)| {
                div()
                    .px(px(22.))
                    .py(px(14.))
                    .when(index > 0, |el| el.border_t_1().border_color(theme::separator()))
                    .child(row)
            }))
    }

    fn setting_row(label: &str, control: impl IntoElement) -> AnyElement {
        div()
            .flex()
            .items_start()
            .justify_between()
            .gap(px(13.))
            .child(div().pt(px(3.)).text_size(px(13.)).font_weight(gpui::FontWeight::SEMIBOLD).text_color(theme::foreground()).child(label.to_string()))
            .child(control)
            .into_any_element()
    }

    pub fn render_settings_page(&self, window: &Window, cx: &mut Context<Self>) -> AnyElement {
        let section = if self.screen == Screen::Libraries { SettingsSection::Libraries } else { self.settings_section };
        let nav = |id: &'static str, icon_name: Icon, label: &'static str, target: SettingsSection, cx: &mut Context<Self>| {
            let active = section == target;
            div()
                .id(id)
                .relative()
                .h(px(40.))
                .px(px(11.))
                .flex()
                .items_center()
                .gap(px(11.))
                .rounded(px(theme::RADIUS_LG))
                .cursor_pointer()
                .when(active, |el| el.bg(theme::default()))
                .hover(|s| s.bg(theme::default_soft()))
                .on_click(cx.listener(move |this, _, _, cx| {
                    this.settings_section = target;
                    this.screen = Screen::Settings;
                    cx.notify();
                }))
                .when(active, |el| el.child(div().absolute().left(px(-14.)).top(px(10.)).w(px(2.)).h(px(21.)).rounded_full().bg(theme::accent())))
                .child(icon(icon_name, 18., if active { theme::accent() } else { theme::muted() }))
                .child(div().text_size(px(14.)).text_color(theme::foreground()).font_weight(if active { gpui::FontWeight::SEMIBOLD } else { gpui::FontWeight::NORMAL }).child(label))
        };
        let group = |text: &'static str| div().px(px(10.)).pt(px(10.)).pb(px(5.)).text_size(px(11.)).text_color(theme::muted()).child(text);

        let content: AnyElement = match section {
            SettingsSection::Playback => {
                let subs_on = self.catalog.setting("subtitles_on").as_deref() != Some("no");
                let autoplay = self.catalog.setting("autoplay").as_deref() == Some("on");
                let skip = self.catalog.setting("skip_markers").as_deref() == Some("on");
                div()
                    .flex()
                    .flex_col()
                    .gap(px(18.))
                    .child(self.settings_card(
                        Icon::Captions,
                        "Subtitles",
                        vec![
                            Self::setting_row("Turn on subtitles", self.toggle("set-subs-on", subs_on, cx, move |this| this.catalog.set_setting("subtitles_on", if subs_on { "no" } else { "yes" }))),
                            Self::setting_row("Preferred subtitle language", self.language_select("set-sub-lang", "subtitle_lang", cx)),
                        ],
                    ))
                    .child(self.settings_card(Icon::AudioLines, "Audio language", vec![Self::setting_row("Preferred audio language", self.language_select("set-audio-lang", "audio_lang", cx))]))
                    .child(self.settings_card(
                        Icon::SkipForward,
                        "Episodes",
                        vec![
                            Self::setting_row("Autoplay next episode", self.toggle("set-autoplay", autoplay, cx, move |this| this.catalog.set_setting("autoplay", if autoplay { "off" } else { "on" }))),
                            Self::setting_row("Skip intro and credits markers (IntroDB)", self.toggle("set-skip", skip, cx, move |this| this.catalog.set_setting("skip_markers", if skip { "off" } else { "on" }))),
                        ],
                    ))
                    .into_any_element()
            }
            SettingsSection::Metadata => {
                let (ok, message) = self.token_status.lock().clone();
                let connected = crate::metadata::token(&self.catalog).is_some();
                let masked = "•".repeat(self.token_draft.chars().count().min(40));
                let field = self.text_field("set-token", crate::personal_ui::Field::Token, &self.token_focus, &masked, "Paste your TMDB API Read Access Token", window, cx).w(px(380.));
                div()
                    .flex()
                    .flex_col()
                    .gap(px(18.))
                    .child(self.settings_card(
                        Icon::Film,
                        "TMDB",
                        vec![
                            Self::setting_row("Status", div().text_size(px(13.)).text_color(if connected { theme::success() } else { theme::muted() }).child(if connected { "Connected" } else { "Not connected — artwork and details stay local" })),
                            Self::setting_row(
                                "Access token",
                                div().flex().items_center().gap(px(10.)).child(field).child(self.pill_button("set-token-save", None, "Verify and save", true).h(px(32.)).px(px(14.)).text_size(px(12.)).on_click(cx.listener(|this, _, _, cx| this.save_token(cx)))),
                            ),
                        ],
                    ))
                    .when(!message.is_empty(), |el| el.child(div().text_size(px(13.)).text_color(if ok { theme::muted() } else { theme::danger() }).child(message)))
                    .child(div().text_size(px(12.)).text_color(theme::muted()).child("Artwork is saved on this Mac, so titles keep their posters offline."))
                    .into_any_element()
            }
            SettingsSection::Libraries => self.render_libraries_public(cx),
            SettingsSection::Appearance => {
                let current = self.catalog.setting("theme").unwrap_or_else(|| "dark".into());
                let choice = |value: &'static str, label: &'static str, icon_name: Icon, cx: &mut Context<Self>| {
                    let selected = current == value;
                    // Swatch: a tiny page in that theme (System is split).
                    let pane = |bg: u32, card: u32, line: u32| {
                        div()
                            .flex_1()
                            .h_full()
                            .p(px(8.))
                            .bg(gpui::rgb(bg))
                            .flex()
                            .flex_col()
                            .gap(px(5.))
                            .child(div().w(px(36.)).h(px(5.)).rounded_full().bg(gpui::rgb(line)))
                            .child(div().flex().gap(px(5.)).child(div().w(px(22.)).h(px(28.)).rounded(px(4.)).bg(gpui::rgb(card))).child(div().w(px(22.)).h(px(28.)).rounded(px(4.)).bg(gpui::rgb(card))))
                    };
                    let swatch = div().h(px(64.)).w_full().rounded(px(8.)).overflow_hidden().border_1().border_color(theme::border()).flex().children(match value {
                        "light" => vec![pane(0xf5f5f6, 0xffffff, 0xd4d4d8)],
                        "dark" => vec![pane(0x060607, 0x232325, 0x46464c)],
                        _ => vec![pane(0xf5f5f6, 0xffffff, 0xd4d4d8), pane(0x060607, 0x232325, 0x46464c)],
                    });
                    div()
                        .id(SharedString::from(format!("theme-{value}")))
                        .flex_1()
                        .min_w(px(150.))
                        .p(px(12.))
                        .flex()
                        .flex_col()
                        .gap(px(12.))
                        .rounded(px(theme::RADIUS_LG))
                        .border_1()
                        .cursor_pointer()
                        .border_color(if selected { with_alpha(theme::accent(), 0.55) } else { theme::border() })
                        .bg(if selected { theme::surface_secondary() } else { theme::surface() })
                        .hover(|s| s.border_color(theme::segment()))
                        .on_click(cx.listener(move |this, _, _, cx| {
                            this.catalog.set_setting("theme", value);
                            cx.notify();
                        }))
                        .child(
                            div()
                                .flex()
                                .items_center()
                                .justify_between()
                                .child(div().size(px(28.)).rounded(px(6.)).border_1().border_color(theme::border()).bg(theme::background()).flex().items_center().justify_center().child(icon(icon_name, 14., theme::foreground())))
                                .when(selected, |el| el.child(div().size(px(20.)).rounded_full().bg(theme::accent()).flex().items_center().justify_center().child(icon(Icon::Check, 12., theme::accent_foreground())))),
                        )
                        .child(div().text_size(px(13.)).font_weight(gpui::FontWeight::SEMIBOLD).text_color(theme::foreground()).child(label))
                        .child(swatch)
                };
                div()
                    .flex()
                    .flex_col()
                    .gap(px(14.))
                    .child(self.settings_card(
                        Icon::Palette,
                        "Theme",
                        vec![div().flex().flex_wrap().gap(px(12.)).child(choice("light", "Light", Icon::Sun, cx)).child(choice("dark", "Dark", Icon::Moon, cx)).child(choice("system", "System", Icon::Monitor, cx)).into_any_element()],
                    ))
                    .child(div().px(px(4.)).text_size(px(12.)).text_color(theme::muted()).child("System follows your Mac's appearance. The player always stays dark."))
                    .into_any_element()
            }
        };
        let heading = match section {
            SettingsSection::Playback => "Playback",
            SettingsSection::Libraries => "Libraries",
            SettingsSection::Appearance => "Appearance",
            SettingsSection::Metadata => "Metadata",
        };
        div()
            .px(px(38.))
            .pt(px(96.))
            .pb(px(38.))
            .flex()
            .gap(px(45.))
            .child(
                div()
                    .w(px(256.))
                    .flex_none()
                    .flex()
                    .flex_col()
                    .gap(px(3.))
                    .child(group("Preferences"))
                    .child(nav("settings-playback", Icon::Captions, "Playback", SettingsSection::Playback, cx))
                    .child(nav("settings-appearance", Icon::Palette, "Appearance", SettingsSection::Appearance, cx))
                    .child(nav("settings-metadata", Icon::Film, "Metadata", SettingsSection::Metadata, cx))
                    .child(group("Library"))
                    .child(nav("settings-libraries", Icon::Library, "Libraries", SettingsSection::Libraries, cx)),
            )
            .child(
                div()
                    .flex_1()
                    .min_w_0()
                    .flex()
                    .flex_col()
                    .gap(px(19.))
                    .child(div().pb(px(6.)).child(h1(heading)))
                    .child(content),
            )
            .into_any_element()
    }

    // MARK: Shell

    pub fn render_shell(&self, window: &Window, cx: &mut Context<Self>) -> impl IntoElement {
        let page: AnyElement = match self.screen.clone() {
            Screen::Home => self.render_home_page(cx),
            Screen::Library => self.render_library_page(cx),
            Screen::Genre(genre) => self.render_genre_page(&genre, cx),
            Screen::Show(key) => self.render_show_page(&key, window, cx),
            Screen::Movie(path) => self.render_movie_page(&path, window, cx),
            Screen::Settings | Screen::Libraries => self.render_settings_page(window, cx),
            other => div().px(px(PAGE_X)).pt(px(84.)).pb(px(38.)).child(self.render_list_screen(other, window, cx)).into_any_element(),
        };
        // The web app scrolls the page under a floating header; on Home the
        // header is transparent over the hero, elsewhere it is a solid scrim.
        // A new page starts at the top; carrying the old scroll offset over
        // made pages open mid-way and then jump.
        {
            let mut last = self.last_screen.borrow_mut();
            if last.as_ref() != Some(&self.screen) {
                if last.is_some() {
                    self.shell_scroll.set_offset(gpui::point(px(0.), px(0.)));
                }
                *last = Some(self.screen.clone());
            }
        }
        let hero_page = matches!(self.screen, Screen::Home | Screen::Show(_) | Screen::Movie(_));
        let on_home = hero_page && self.shell_scroll.offset().y > px(-(self.hero_height() - 120.));
        NAV_OVER.store(on_home, std::sync::atomic::Ordering::Relaxed);
        div()
            .absolute()
            .inset_0()
            .bg(theme::background())
            .text_color(theme::foreground())
            .child(
                div()
                    .id("shell-scroll")
                    .track_scroll(&self.shell_scroll)
                    .absolute()
                    .inset_0()
                    .overflow_y_scroll()
                    .child(
                        div()
                            .child(page)
                            .with_animation(SharedString::from(format!("page-{:?}", self.screen)), Animation::new(Duration::from_millis(140)).with_easing(ease_out_quint()), |el, t| {
                                el.opacity(0.94 + 0.06 * t)
                            }),
                    ),
            )
            .child(self.render_top_nav(window, cx).when(on_home, |el| el.bg(gpui::hsla(0., 0., 0., 0.)).border_color(gpui::hsla(0., 0., 0., 0.))))
    }
}

/// 20×20 progress ring (r=8, 2px): white/28 track, white fill from 12 o'clock.
pub fn progress_ring(fraction: f64) -> impl IntoElement {
    let fraction = fraction.clamp(0.0, 1.0) as f32;
    gpui::canvas(
        |_, _, _| (),
        move |bounds, _, window, _| {
            let center = bounds.center();
            let stroke = |from: f32, to: f32, color: Hsla, window: &mut Window| {
                if to <= from {
                    return;
                }
                let mut builder = gpui::PathBuilder::stroke(px(2.));
                let steps = ((to - from) * 48.).ceil().max(2.) as usize;
                for step in 0..=steps {
                    let a = (from + (to - from) * step as f32 / steps as f32) * std::f32::consts::TAU - std::f32::consts::FRAC_PI_2;
                    let p = gpui::point(center.x + px(8. * a.cos()), center.y + px(8. * a.sin()));
                    if step == 0 { builder.move_to(p) } else { builder.line_to(p) }
                }
                if let Ok(path) = builder.build() {
                    window.paint_path(path, color);
                }
            };
            stroke(0., 1., white(0.28), window);
            stroke(0., fraction.max(0.02), theme::foreground(), window);
        },
    )
    .size(px(20.))
}
