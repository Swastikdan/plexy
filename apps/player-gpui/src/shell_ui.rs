//! The Plexy shell from the web app's layout: top navigation, the Home hero
//! carousel and rows, the Library page, title hero pages with the episodes
//! panel, and Settings. Metadata the web app fetches online (genres, cast,
//! community ratings, logos) has no local source yet, so those slots show
//! what the catalog knows: libraries, file details and your own rating.

use std::path::PathBuf;
use std::time::{Duration, Instant};

use gpui::{div, ease_in_out, img, Animation, AnimationExt, linear_color_stop, linear_gradient, prelude::*, px, AnyElement, Context, Hsla, ObjectFit, SharedString, Window};

use crate::app::{format_time, PlayerView};
use crate::catalog::{Item, Mark, TitleKey};
use crate::library_ui::{icon, progress_bar, Screen};
use crate::mpv::language_name;
use crate::personal_ui::{Sort, WatchFilter};
use crate::theme;

const HERO_INTERVAL: Duration = Duration::from_secs(8);
pub const LANGUAGES: [(&str, &str); 10] = [
    ("", "Default"),
    ("eng", "English"),
    ("hin", "Hindi"),
    ("jpn", "Japanese"),
    ("fre", "French"),
    ("spa", "Spanish"),
    ("ger", "German"),
    ("kor", "Korean"),
    ("ita", "Italian"),
    ("por", "Portuguese"),
];

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum SettingsSection {
    Playback,
    Libraries,
    Appearance,
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

fn h1(text: impl Into<SharedString>) -> impl IntoElement {
    div().text_size(px(32.)).line_height(px(37.)).font_weight(gpui::FontWeight::BOLD).text_color(theme::foreground()).child(text.into())
}

fn h2(text: impl Into<SharedString>) -> impl IntoElement {
    div().text_size(px(19.)).font_weight(gpui::FontWeight::BOLD).text_color(theme::foreground()).child(text.into())
}

fn dot_join(parts: Vec<String>) -> String {
    parts.into_iter().filter(|p| !p.is_empty()).collect::<Vec<_>>().join("  ·  ")
}

/// Cover image that fills its box, or a tinted placeholder.
fn cover(image: Option<PathBuf>) -> impl IntoElement {
    div()
        .absolute()
        .inset_0()
        .bg(theme::surface_secondary())
        .when_some(image, |el, path| el.child(img(path).size_full().object_fit(ObjectFit::Cover)))
}

fn badge(text: impl Into<SharedString>) -> impl IntoElement {
    div()
        .px(px(6.))
        .py(px(2.))
        .rounded(px(theme::RADIUS))
        .bg(black(0.72))
        .text_size(px(10.))
        .font_weight(gpui::FontWeight::SEMIBOLD)
        .text_color(theme::foreground())
        .child(text.into())
}

impl PlayerView {
    // MARK: Building blocks

    pub fn pill_button(&self, id: impl Into<SharedString>, icon_name: Option<&'static str>, label: impl Into<SharedString>, primary: bool) -> gpui::Stateful<gpui::Div> {
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
            .when(!primary, |el| el.bg(black(0.45)).border_1().border_color(white(0.18)).text_color(theme::foreground()).hover(|s| s.bg(white(0.12))))
            .when_some(icon_name, |el, name| el.child(icon(name, 18., theme::foreground())))
            .child(label.into())
    }

    pub fn circle_button(&self, id: impl Into<SharedString>, icon_name: &'static str, active: bool) -> gpui::Stateful<gpui::Div> {
        div()
            .id(gpui::ElementId::Name(id.into()))
            .size(px(42.))
            .flex()
            .items_center()
            .justify_center()
            .rounded_full()
            .cursor_pointer()
            .border_1()
            .border_color(white(0.18))
            .bg(if active { with_alpha(theme::accent(), 0.25) } else { black(0.45) })
            .hover(|s| s.bg(white(0.12)))
            .child(icon(icon_name, 20., if active { theme::accent() } else { theme::foreground() }))
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
            .child(icon("arrow-right", 14., theme::foreground()))
    }

    fn section(&self, title: &str, action: Option<AnyElement>, body: impl IntoElement) -> impl IntoElement {
        div()
            .flex()
            .flex_col()
            .gap(px(14.))
            .child(div().flex().items_center().justify_between().child(h2(title.to_string())).children(action))
            .child(body)
    }

    // MARK: Top navigation

    fn nav_icon(&self, id: &'static str, icon_name: &'static str, label: &'static str, screen: Screen, cx: &mut Context<Self>) -> impl IntoElement {
        let active = match (&self.screen, &screen) {
            (Screen::Movies | Screen::Shows | Screen::Movie(_) | Screen::Show(_), Screen::Library) => true,
            (Screen::Watchlist | Screen::Favorites | Screen::Hidden, Screen::Collections) => true,
            (a, b) => a == b,
        };
        div()
            .id(id)
            .h(px(34.))
            .px(px(if active { 16. } else { 12. }))
            .flex()
            .items_center()
            .gap(px(6.))
            .rounded_full()
            .cursor_pointer()
            .when(active, |el| el.bg(theme::default()))
            .hover(|s| s.bg(theme::default_soft()))
            .on_click(cx.listener(move |this, _, _, cx| {
                this.screen = screen.clone();
                cx.notify();
            }))
            .child(icon(icon_name, 18., if active { theme::foreground() } else { theme::muted() }))
            .when(active, |el| el.child(div().text_size(px(13.)).font_weight(gpui::FontWeight::SEMIBOLD).text_color(theme::foreground()).child(label)))
    }

    fn round_icon(&self, id: &'static str, icon_name: &'static str, active: bool, cx: &mut Context<Self>, screen: Screen) -> impl IntoElement {
        div()
            .id(id)
            .size(px(37.))
            .flex()
            .items_center()
            .justify_center()
            .rounded_full()
            .cursor_pointer()
            .bg(theme::default())
            .when(active, |el| el.border_2().border_color(theme::accent()))
            .hover(|s| s.bg(theme::segment()))
            .on_click(cx.listener(move |this, _, _, cx| {
                this.screen = screen.clone();
                cx.notify();
            }))
            .child(icon(icon_name, 20., theme::foreground()))
    }

    fn page_title(&self) -> Option<String> {
        Some(match &self.screen {
            Screen::Home => return None,
            Screen::Library | Screen::Movies | Screen::Shows => "Library".into(),
            Screen::Movie(path) => self.items.iter().find(|i| &i.path == path).map(|i| i.title.clone()).unwrap_or_default(),
            Screen::Show(key) => self.shows().into_iter().find(|s| &s.key == key).map(|s| s.title).unwrap_or_default(),
            Screen::Search => "Search".into(),
            Screen::Watchlist => "Watchlist".into(),
            Screen::Favorites => "Favorites".into(),
            Screen::Hidden => "Hidden".into(),
            Screen::Collections => "Collections".into(),
            Screen::History => "History".into(),
            Screen::Libraries | Screen::Settings => "Settings".into(),
        })
    }

    fn render_top_nav(&self, window: &Window, cx: &mut Context<Self>) -> impl IntoElement {
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
                            .hover(|s| s.bg(theme::default()))
                            .on_click(cx.listener(|this, _, _, cx| {
                                this.go_back();
                                cx.notify();
                            }))
                            .child(icon("arrow-left", 20., theme::foreground()))
                            .into_any_element(),
                    })
                    .child(div().text_size(px(17.)).font_weight(gpui::FontWeight::BOLD).text_color(theme::foreground()).truncate().child(title.unwrap_or_else(|| "Plexy".into()))),
            )
            .child(
                div()
                    .flex()
                    .items_center()
                    .gap(px(3.))
                    .child(self.nav_icon("top-home", "home", "Home", Screen::Home, cx))
                    .child(self.nav_icon("top-library", "library", "Library", Screen::Library, cx))
                    .child(self.nav_icon("top-collections", "folder-heart", "Collections", Screen::Collections, cx))
                    .child(self.nav_icon("top-history", "clock", "History", Screen::History, cx)),
            )
            .child(div().flex_1())
            .child(
                div()
                    .flex()
                    .gap(px(8.))
                    .child(self.round_icon("top-libraries", "server", matches!(self.screen, Screen::Libraries), cx, Screen::Libraries))
                    .child(self.round_icon("top-search", "search", self.screen == Screen::Search, cx, Screen::Search))
                    .child(self.round_icon("top-settings", "settings", self.screen == Screen::Settings, cx, Screen::Settings)),
            )
    }

    fn go_back(&mut self) {
        self.screen = match &self.screen {
            Screen::Movie(_) | Screen::Show(_) | Screen::Movies | Screen::Shows => Screen::Library,
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
        heroes
    }

    /// Advances the carousel; called from the UI tick.
    pub fn tick_hero(&mut self) {
        if self.screen == Screen::Home && !self.hero_paused && self.hero_since.elapsed() > HERO_INTERVAL {
            let count = self.heroes().len().max(1);
            self.hero_index = (self.hero_index + 1) % count;
            self.hero_since = Instant::now();
        }
    }

    fn render_hero(&self, cx: &mut Context<Self>) -> Option<impl IntoElement> {
        let heroes = self.heroes();
        let count = heroes.len();
        let hero = heroes.get(self.hero_index % count.max(1))?.clone();
        let rating = self.personal.rating(&hero.key);
        let in_watchlist = self.personal.has(&hero.key, Mark::Watchlist);
        let (play, details, mark) = (hero.play.clone(), hero.key.clone(), hero.key.clone());
        let arrow = |id: &'static str, name: &'static str, step: isize| {
            div()
                .id(id)
                .size(px(42.))
                .rounded_full()
                .flex()
                .items_center()
                .justify_center()
                .cursor_pointer()
                .bg(black(0.45))
                .border_1()
                .border_color(white(0.15))
                .hover(|s| s.bg(white(0.12)))
                .on_click(cx.listener(move |this, _, _, cx| {
                    let count = this.heroes().len().max(1) as isize;
                    this.hero_index = ((this.hero_index as isize + step).rem_euclid(count)) as usize;
                    this.hero_since = Instant::now();
                    cx.notify();
                }))
                .child(icon(name, 22., theme::foreground()))
        };
        Some(
            div()
                .relative()
                .h(px(340.))
                .mx(px(38.))
                .mt(px(16.))
                .rounded(px(theme::RADIUS_XL))
                .border_1()
                .border_color(theme::border())
                .overflow_hidden()
                .child(cover(hero.image.clone()))
                .child(
                    div()
                        .absolute()
                        .inset_0()
                        .bg(theme::background())
                        .with_animation(SharedString::from(format!("hero-fade-{}", self.hero_index)), Animation::new(Duration::from_millis(600)).with_easing(ease_in_out), |el, t| el.opacity(1. - t)),
                )
                .child(div().absolute().inset_0().bg(linear_gradient(90., linear_color_stop(black(0.85), 0.), linear_color_stop(black(0.0), 0.7))))
                .child(div().absolute().inset_0().bg(linear_gradient(180., linear_color_stop(black(0.0), 0.55), linear_color_stop(theme::background(), 1.))))
                .when(count > 1, |el| {
                    el.child(div().absolute().left(px(13.)).top(px(149.)).child(arrow("hero-prev", "chevron-left", -1)))
                        .child(div().absolute().right(px(13.)).top(px(149.)).child(arrow("hero-next", "chevron-right", 1)))
                })
                .child(
                    div()
                        .absolute()
                        .left(px(72.))
                        .bottom(px(28.))
                        .max_w(px(608.))
                        .flex()
                        .flex_col()
                        .gap(px(14.))
                        .child(
                            div()
                                .text_size(px(46.))
                                .line_height(px(52.))
                                .font_weight(gpui::FontWeight::BLACK)
                                .text_color(theme::foreground())
                                .child(hero.title.to_uppercase()),
                        )
                        .child(
                            div()
                                .flex()
                                .items_center()
                                .gap(px(8.))
                                .text_size(px(14.))
                                .text_color(white(0.85))
                                .child(dot_join(hero.meta.clone()))
                                .when(rating > 0, |el| el.child(div().text_color(theme::warning()).child(format!("★ {rating}/5")))),
                        )
                        .child(
                            div()
                                .flex()
                                .gap(px(11.))
                                .child(
                                    self.pill_button("hero-play", Some("play"), if hero.resume { "Continue watching" } else { "Play" }, true)
                                        .on_click(cx.listener(move |this, _, window, cx| this.play_item(play.clone(), window, cx))),
                                )
                                .child(self.pill_button("hero-details", None, "Details", false).on_click(cx.listener(move |this, _, _, cx| this.open_title(&details, cx))))
                                .child(self.circle_button("hero-bookmark", "bookmark", in_watchlist).on_click(cx.listener(move |this, _, _, cx| {
                                    this.catalog.toggle_mark(&mark, Mark::Watchlist);
                                    this.reload_catalog();
                                    cx.notify();
                                }))),
                        )
                        .when(count > 1, |el| {
                            el.child(
                                div()
                                    .flex()
                                    .items_center()
                                    .gap(px(8.))
                                    .pt(px(13.))
                                    .child(
                                        div()
                                            .id("hero-pause")
                                            .size(px(30.))
                                            .rounded_full()
                                            .flex()
                                            .items_center()
                                            .justify_center()
                                            .cursor_pointer()
                                            .border_1()
                                            .border_color(white(0.2))
                                            .hover(|s| s.bg(white(0.1)))
                                            .on_click(cx.listener(|this, _, _, cx| {
                                                this.hero_paused = !this.hero_paused;
                                                this.hero_since = Instant::now();
                                                cx.notify();
                                            }))
                                            .child(icon(if self.hero_paused { "play" } else { "pause" }, 14., theme::foreground())),
                                    )
                                    .children((0..count).map(|index| {
                                        let active = index == self.hero_index % count;
                                        div()
                                            .id(SharedString::from(format!("hero-dot-{index}")))
                                            .h(px(6.))
                                            .w(px(if active { 38. } else { 12. }))
                                            .rounded_full()
                                            .cursor_pointer()
                                            .overflow_hidden()
                                            .bg(white(0.3))
                                            .when(active, |el| {
                                                let key = format!("hero-dot-fill-{}-{}", self.hero_index, self.hero_paused);
                                                let paused = self.hero_paused;
                                                el.child(div().h_full().w_full().bg(theme::foreground()).with_animation(SharedString::from(key), Animation::new(HERO_INTERVAL), move |el, t| {
                                                    el.w(gpui::relative(if paused { 1. } else { t }))
                                                }))
                                            })
                                            .on_click(cx.listener(move |this, _, _, cx| {
                                                this.hero_index = index;
                                                this.hero_since = Instant::now();
                                                cx.notify();
                                            }))
                                    })),
                            )
                        }),
                ),
        )
    }

    /// Landscape Continue Watching card with episode and remaining badges.
    fn continue_card(&self, item: &Item, cx: &mut Context<Self>) -> impl IntoElement {
        let path = item.path.clone();
        let progress = item.progress.unwrap_or_default();
        let name = item.episode_title.clone().unwrap_or_else(|| item.title.clone());
        let subtitle = if item.season.is_some() { item.title.clone() } else { item.year.map(|y| y.to_string()).unwrap_or_default() };
        div()
            .id(SharedString::from(format!("cw-{}", item.id)))
            .relative()
            .w(px(352.))
            .h(px(198.))
            .flex_none()
            .rounded(px(theme::RADIUS_XL))
            .overflow_hidden()
            .border_1()
            .border_color(theme::border())
            .cursor_pointer()
            .on_click(cx.listener(move |this, _, window, cx| this.play_item(path.clone(), window, cx)))
            .child(cover(item.backdrop.clone().or(item.poster.clone())))
            .child(div().absolute().inset_0().bg(linear_gradient(180., linear_color_stop(black(0.0), 0.45), linear_color_stop(black(0.85), 1.))))
            .when_some(item.episode, |el, e| el.child(div().absolute().top(px(11.)).left(px(11.)).child(badge(format!("E{e}")))))
            .when(progress.duration > 0.0, |el| el.child(div().absolute().top(px(11.)).right(px(11.)).child(badge(format_time(progress.duration - progress.position)))))
            .child(
                div()
                    .absolute()
                    .left(px(14.))
                    .right(px(14.))
                    .bottom(px(13.))
                    .flex()
                    .flex_col()
                    .gap(px(3.))
                    .child(div().text_size(px(14.)).font_weight(gpui::FontWeight::SEMIBOLD).text_color(theme::foreground()).truncate().child(name))
                    .child(div().text_size(px(10.)).text_color(white(0.7)).truncate().child(subtitle))
                    .child(div().pt(px(5.)).child(progress_bar(progress.fraction()))),
            )
    }

    pub fn render_home_page(&self, cx: &mut Context<Self>) -> AnyElement {
        if self.libraries.is_empty() {
            return div().px(px(38.)).child(self.render_welcome_public(cx)).into_any_element();
        }
        let mut resuming: Vec<&Item> = self.items.iter().filter(|i| !i.missing && i.progress.is_some_and(|p| p.resumable())).collect();
        resuming.sort_by_key(|i| std::cmp::Reverse(i.progress.map(|p| p.updated).unwrap_or(0)));
        resuming.retain(|i| !self.hidden(&TitleKey::Movie(i.path.clone())) && !self.hidden(&TitleKey::Show(i.show_key())));

        let mut rows = div().px(px(38.)).pb(px(38.)).flex().flex_col().gap(px(35.));
        if !resuming.is_empty() {
            let cards: Vec<AnyElement> = resuming.iter().take(12).map(|i| self.continue_card(i, cx).into_any_element()).collect();
            rows = rows.child(self.section("Continue watching", None, div().id("row-continue").flex().gap(px(14.)).overflow_x_scroll().children(cards)));
        }
        let watchlist: Vec<_> = self.personal.marked(Mark::Watchlist).iter().filter_map(|k| self.title_view(k)).collect();
        if !watchlist.is_empty() {
            rows = rows.child(self.section("Watchlist", Some(self.see_all("see-watchlist", Screen::Watchlist, cx).into_any_element()), self.title_grid("home-watchlist", watchlist.into_iter().take(7).collect(), cx)));
        }
        let mut shows: Vec<_> = self.visible_shows().iter().filter_map(|s| self.title_view(&TitleKey::Show(s.key.clone()))).collect();
        shows.sort_by_key(|t| std::cmp::Reverse(t.added_at));
        if !shows.is_empty() {
            rows = rows.child(self.section("Recently added shows", Some(self.see_all("see-shows", Screen::Shows, cx).into_any_element()), self.title_grid("home-shows", shows.into_iter().take(7).collect(), cx)));
        }
        let mut movies: Vec<_> = self.visible_movies().iter().filter_map(|m| self.title_view(&TitleKey::Movie(m.path.clone()))).collect();
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

    fn category_card(&self, id: &'static str, icon_name: &'static str, title: &str, count: usize, tint: Hsla, screen: Screen, cx: &mut Context<Self>) -> impl IntoElement {
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
                            .child(icon("arrow-right", 13., theme::muted())),
                    ),
            )
    }

    pub fn render_library_page(&self, cx: &mut Context<Self>) -> AnyElement {
        let movies: Vec<_> = self.visible_movies().iter().filter_map(|m| self.title_view(&TitleKey::Movie(m.path.clone()))).collect();
        let shows: Vec<_> = self.visible_shows().iter().filter_map(|s| self.title_view(&TitleKey::Show(s.key.clone()))).collect();
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

        let top_cards: Vec<AnyElement> = top
            .into_iter()
            .enumerate()
            .map(|(index, (_, t))| {
                let key = t.key.clone();
                let image = match &t.key {
                    TitleKey::Movie(p) => self.items.iter().find(|i| &i.path == p).and_then(|i| i.backdrop.clone()).or(t.poster.clone()),
                    TitleKey::Show(k) => self.shows().into_iter().find(|s| &s.key == k).and_then(|s| s.backdrop).or(t.poster.clone()),
                };
                div()
                    .id(SharedString::from(format!("top-{index}")))
                    .flex_none()
                    .flex()
                    .items_end()
                    .cursor_pointer()
                    .on_click(cx.listener(move |this, _, _, cx| this.open_title(&key, cx)))
                    .child(
                        div()
                            .text_size(px(96.))
                            .line_height(px(88.))
                            .font_weight(gpui::FontWeight::BLACK)
                            .text_color(theme::segment())
                            .mr(px(-8.))
                            .child((index + 1).to_string()),
                    )
                    .child(
                        div()
                            .flex()
                            .flex_col()
                            .gap(px(10.))
                            .child(div().relative().w(px(301.)).h(px(169.)).rounded(px(theme::RADIUS_XL)).overflow_hidden().border_1().border_color(theme::border()).child(cover(image)))
                            .child(div().text_size(px(13.)).font_weight(gpui::FontWeight::SEMIBOLD).text_color(theme::foreground()).child(t.title.clone())),
                    )
                    .into_any_element()
            })
            .collect();

        div()
            .px(px(38.))
            .pt(px(29.))
            .pb(px(38.))
            .flex()
            .flex_col()
            .gap(px(32.))
            .child(
                div()
                    .flex()
                    .flex_wrap()
                    .items_end()
                    .justify_between()
                    .gap(px(13.))
                    .child(div().flex().flex_col().gap(px(8.)).child(h1("Library")).child(div().text_size(px(13.)).text_color(theme::muted()).child("Browse every movie and show in your libraries.")))
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
                                    .on_click(cx.listener(|this, _, _, cx| {
                                        this.sort = match this.sort {
                                            Sort::Added => Sort::Title,
                                            Sort::Title => Sort::Year,
                                            Sort::Year => Sort::Added,
                                        };
                                        cx.notify();
                                    }))
                                    .child(div().text_size(px(13.)).text_color(theme::foreground()).child(sort_label))
                                    .child(icon("chevron-down", 16., theme::foreground())),
                            ),
                    ),
            )
            .child(
                self.section(
                    "Categories",
                    Some(div().text_size(px(11.)).text_color(theme::muted()).child("Browse by type").into_any_element()),
                    div()
                        .flex()
                        .flex_wrap()
                        .gap(px(14.))
                        .child(self.category_card("cat-movies", "film", "Movies", movie_count, theme::warning(), Screen::Movies, cx))
                        .child(self.category_card("cat-shows", "tv", "TV Shows", show_count, theme::accent(), Screen::Shows, cx))
                        .child(self.category_card("cat-watchlist", "bookmark", "Watchlist", self.personal.marked(Mark::Watchlist).len(), theme::success(), Screen::Watchlist, cx))
                        .child(self.category_card("cat-favorites", "heart", "Favorites", self.personal.marked(Mark::Favorite).len(), theme::danger(), Screen::Favorites, cx))
                        .child(self.category_card("cat-collections", "folder-heart", "Collections", self.personal.collections.len(), theme::segment(), Screen::Collections, cx)),
                ),
            )
            .when(!top_cards.is_empty(), |el| {
                el.child(
                    div()
                        .flex()
                        .flex_col()
                        .gap(px(14.))
                        .child(div().flex().items_center().gap(px(8.)).child(icon("trending-up", 22., theme::accent())).child(h2("Top 10 in your library")))
                        .child(div().id("row-top").flex().gap(px(22.)).overflow_x_scroll().children(top_cards)),
                )
            })
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
        let rating = self.personal.rating(key);
        let (in_watchlist, favorite, hidden) = (self.personal.has(key, Mark::Watchlist), self.personal.has(key, Mark::Favorite), self.personal.has(key, Mark::Hidden));
        let (k1, k2, k3, k4) = (key.clone(), key.clone(), key.clone(), key.clone());
        let stars = div().flex().items_center().gap(px(3.)).children((1..=5u8).map(|star| {
            let key = key.clone();
            div()
                .id(SharedString::from(format!("hero-star-{star}")))
                .cursor_pointer()
                .text_size(px(18.))
                .text_color(if star <= rating { theme::warning() } else { white(0.35) })
                .hover(|s| s.text_color(theme::warning()))
                .on_click(cx.listener(move |this, _, _, cx| {
                    this.catalog.set_rating(&key, star);
                    this.reload_catalog();
                    cx.notify();
                }))
                .child(if star <= rating { "★" } else { "☆" })
        }));
        div()
            .flex()
            .flex_col()
            .gap(px(13.))
            .child(
                div()
                    .relative()
                    .h(px(400.))
                    .rounded(px(22.))
                    .overflow_hidden()
                    .border_1()
                    .border_color(theme::border())
                    .child(cover(image))
                    .child(div().absolute().inset_0().bg(linear_gradient(90., linear_color_stop(black(0.9), 0.), linear_color_stop(black(0.0), 0.75))))
                    .child(div().absolute().inset_0().bg(linear_gradient(180., linear_color_stop(black(0.0), 0.5), linear_color_stop(black(0.8), 1.))))
                    .child(
                        div()
                            .absolute()
                            .left(px(48.))
                            .bottom(px(45.))
                            .max_w(px(720.))
                            .flex()
                            .flex_col()
                            .gap(px(13.))
                            .child(div().text_size(px(44.)).line_height(px(48.)).font_weight(gpui::FontWeight::BLACK).text_color(theme::foreground()).child(title.to_uppercase()))
                            .child(div().text_size(px(14.)).text_color(white(0.85)).child(dot_join(meta)))
                            .child(div().flex().items_center().gap(px(11.)).child(div().text_size(px(12.)).text_color(white(0.75)).child("Your rating")).child(stars))
                            .child(
                                div()
                                    .flex()
                                    .flex_wrap()
                                    .items_center()
                                    .gap(px(10.))
                                    .when_some(play, |el, (path, resume_at)| {
                                        let restart = path.clone();
                                        el.child(
                                            self.pill_button("title-play", Some("play"), match resume_at {
                                                Some(at) => format!("Resume  {}", format_time(at)),
                                                None => "Play".into(),
                                            }, true)
                                            .on_click(cx.listener(move |this, _, window, cx| this.play_item(path.clone(), window, cx))),
                                        )
                                        .when(resume_at.is_some(), |el| {
                                            el.child(self.pill_button("title-restart", Some("restart"), "Start over", false).on_click(cx.listener(move |this, _, window, cx| {
                                                this.open_at(&restart, Some(0.0), window, cx)
                                            })))
                                        })
                                    })
                                    .child(self.circle_button("title-watched", if watched { "circle-check" } else { "circle" }, watched).on_click(cx.listener(move |this, _, _, cx| {
                                        on_watched(this, cx);
                                        this.reload_catalog();
                                        cx.notify();
                                    })))
                                    .child(self.circle_button("title-watchlist", "bookmark", in_watchlist).on_click(cx.listener(move |this, _, _, cx| {
                                        this.catalog.toggle_mark(&k1, Mark::Watchlist);
                                        this.reload_catalog();
                                        cx.notify();
                                    })))
                                    .child(self.circle_button("title-favorite", "star", favorite).on_click(cx.listener(move |this, _, _, cx| {
                                        this.catalog.toggle_mark(&k2, Mark::Favorite);
                                        this.reload_catalog();
                                        cx.notify();
                                    })))
                                    .child(self.circle_button("title-more", "ellipsis", self.title_menu).on_click(cx.listener(|this, _, _, cx| {
                                        this.title_menu = !this.title_menu;
                                        cx.notify();
                                    }))),
                            )
                            .when(self.title_menu, |el| {
                                el.child(
                                    div()
                                        .flex()
                                        .gap(px(8.))
                                        .child(self.pill_button("title-hide", Some("eye-off"), if hidden { "Unhide" } else { "Hide from library" }, false).on_click(cx.listener(move |this, _, _, cx| {
                                            this.catalog.toggle_mark(&k3, Mark::Hidden);
                                            this.reload_catalog();
                                            cx.notify();
                                        })))
                                        .child(self.pill_button("title-collection", Some("folder-heart"), "Add to collection", false).on_click(cx.listener(move |this, _, window, cx| {
                                            this.collection_picker = !this.collection_picker;
                                            this.collection_target = Some(k4.clone());
                                            if this.collection_picker {
                                                window.focus(&this.collection_focus.clone());
                                            }
                                            cx.notify();
                                        }))),
                                )
                            }),
                    ),
            )
            .when(self.collection_picker, |el| el.child(self.title_actions(key, window, cx)))
    }

    fn panel(&self, title: &str, icon_name: Option<&'static str>, body: impl IntoElement) -> impl IntoElement {
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
                    .border_b_1()
                    .border_color(theme::separator())
                    .when_some(icon_name, |el, name| el.child(icon(name, 18., theme::muted())))
                    .child(div().text_size(px(18.)).font_weight(gpui::FontWeight::BOLD).text_color(theme::foreground()).child(title.to_string())),
            )
            .child(div().p(px(11.)).child(body))
    }

    fn detail_row(label: &str, value: String) -> impl IntoElement {
        div()
            .flex()
            .flex_col()
            .gap(px(2.))
            .px(px(11.))
            .py(px(8.))
            .child(div().text_size(px(10.)).text_color(theme::muted()).child(label.to_string()))
            .child(div().text_size(px(12.)).text_color(theme::foreground()).child(value))
    }

    pub fn render_show_page(&self, key: &str, window: &Window, cx: &mut Context<Self>) -> AnyElement {
        let Some(show) = self.shows().into_iter().find(|s| s.key == key) else {
            return div().p(px(38.)).text_color(theme::muted()).child("This show is no longer in your library.").into_any_element();
        };
        let title_key = TitleKey::Show(show.key.clone());
        let next = show.next_up().cloned();
        let seasons: Vec<u32> = show.seasons.keys().copied().collect();
        let season = self.selected_season.filter(|s| seasons.contains(s)).or_else(|| next.as_ref().and_then(|n| n.season)).or(seasons.first().copied()).unwrap_or(0);
        let all_watched = show.unwatched() == 0;
        let paths: Vec<PathBuf> = show.episodes().map(|e| e.path.clone()).collect();
        let meta = vec![
            format!("{} season{}", seasons.iter().filter(|s| **s > 0).count(), if seasons.len() == 1 { "" } else { "s" }),
            format!("{} episodes", show.episodes().count()),
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

        let season_tabs = div().flex().gap(px(6.)).children(seasons.iter().map(|s| {
            let s = *s;
            let active = s == season;
            div()
                .id(SharedString::from(format!("season-{s}")))
                .h(px(27.))
                .px(px(11.))
                .flex()
                .items_center()
                .rounded_full()
                .cursor_pointer()
                .text_size(px(11.))
                .font_weight(gpui::FontWeight::SEMIBOLD)
                .bg(if active { theme::foreground() } else { theme::default() })
                .text_color(if active { theme::background() } else { theme::foreground() })
                .on_click(cx.listener(move |this, _, _, cx| {
                    this.selected_season = Some(s);
                    cx.notify();
                }))
                .child(if s == 0 { "Extras".to_string() } else { format!("Season {s}") })
        }));

        let mut episodes = div().flex().flex_col().gap(px(5.));
        for episode in show.seasons.get(&season).cloned().unwrap_or_default() {
            let (play, toggle, clear) = (episode.path.clone(), episode.path.clone(), episode.path.clone());
            let watched = episode.watched();
            let current = next.as_ref().is_some_and(|n| n.path == episode.path);
            let progress = episode.progress.filter(|p| p.position > 0.0 && !watched);
            episodes = episodes.child(
                div()
                    .id(SharedString::from(format!("episode-{}", episode.id)))
                    .flex()
                    .items_center()
                    .gap(px(14.))
                    .p(px(8.))
                    .rounded(px(theme::RADIUS_XL))
                    .cursor_pointer()
                    .when(current, |el| el.bg(theme::surface_secondary()).border_l_2().border_color(theme::accent()))
                    .hover(|s| s.bg(theme::surface_secondary()))
                    .on_click(cx.listener(move |this, _, window, cx| this.play_item(play.clone(), window, cx)))
                    .child(
                        div()
                            .relative()
                            .w(px(152.))
                            .h(px(86.))
                            .flex_none()
                            .rounded(px(theme::RADIUS_LG))
                            .overflow_hidden()
                            .child(cover(episode.backdrop.clone().or(show.backdrop.clone()).or(episode.poster.clone())))
                            .when_some(progress, |el, p| el.child(div().absolute().left_0().right_0().bottom_0().h(px(3.)).child(div().h_full().w(gpui::relative(p.fraction() as f32)).bg(theme::accent())))),
                    )
                    .child(
                        div()
                            .flex_1()
                            .min_w_0()
                            .flex()
                            .flex_col()
                            .gap(px(5.))
                            .child(
                                div()
                                    .text_size(px(14.))
                                    .font_weight(gpui::FontWeight::SEMIBOLD)
                                    .text_color(theme::foreground())
                                    .truncate()
                                    .child(episode.episode_title.clone().unwrap_or_else(|| format!("Episode {}", episode.episode.unwrap_or(0)))),
                            )
                            .child(div().text_size(px(11.)).text_color(theme::muted()).child(format!("Season {}, Episode {}", episode.season.unwrap_or(0), episode.episode.unwrap_or(0)))),
                    )
                    .child(
                        div()
                            .id(SharedString::from(format!("ep-check-{}", episode.id)))
                            .size(px(29.))
                            .flex()
                            .items_center()
                            .justify_center()
                            .rounded_full()
                            .hover(|s| s.bg(theme::default()))
                            .on_click(cx.listener(move |this, _, _, cx| {
                                cx.stop_propagation();
                                this.catalog.set_watched(&toggle, !watched);
                                this.reload_catalog();
                                cx.notify();
                            }))
                            .child(icon(if watched { "circle-check" } else { "circle" }, 20., if watched { theme::accent() } else { theme::muted() })),
                    )
                    .when(progress.is_some() || watched, |el| {
                        el.child(
                            div()
                                .id(SharedString::from(format!("ep-clear-{}", episode.id)))
                                .size(px(29.))
                                .flex()
                                .items_center()
                                .justify_center()
                                .rounded_full()
                                .hover(|s| s.bg(theme::default()))
                                .on_click(cx.listener(move |this, _, _, cx| {
                                    cx.stop_propagation();
                                    this.catalog.set_watched(&clear, false);
                                    this.reload_catalog();
                                    cx.notify();
                                }))
                                .child(icon("trash", 18., theme::muted())),
                        )
                    }),
            );
        }

        let folder = show.episodes().next().and_then(|e| e.path.parent().map(|p| p.display().to_string())).unwrap_or_default();
        let watched_count = show.episodes().filter(|e| e.watched()).count();
        let details = div()
            .flex()
            .flex_col()
            .child(Self::detail_row("Episodes", format!("{} · {watched_count} watched", show.episodes().count())))
            .child(Self::detail_row("Seasons", seasons.iter().filter(|s| **s > 0).map(|s| s.to_string()).collect::<Vec<_>>().join(", ")))
            .child(Self::detail_row("Folder", folder));

        let others: Vec<_> = self
            .visible_shows()
            .into_iter()
            .filter(|s| s.key != show.key)
            .filter_map(|s| self.title_view(&TitleKey::Show(s.key)))
            .take(6)
            .collect();

        div()
            .px(px(38.))
            .pt(px(19.))
            .pb(px(38.))
            .flex()
            .flex_col()
            .gap(px(29.))
            .child(hero)
            .child(
                div()
                    .flex()
                    .gap(px(22.))
                    .items_start()
                    .child(div().flex_1().min_w_0().child(self.panel("Episodes", None, div().flex().flex_col().gap(px(11.)).child(div().px(px(8.)).child(season_tabs)).child(episodes))))
                    .child(div().w(px(336.)).flex_none().child(self.panel("Details", Some("list"), details))),
            )
            .when(!others.is_empty(), |el| el.child(self.section("More like this", None, self.title_grid("more", others, cx))))
            .into_any_element()
    }

    pub fn render_movie_page(&self, path: &PathBuf, window: &Window, cx: &mut Context<Self>) -> AnyElement {
        let Some(movie) = self.items.iter().find(|i| &i.path == path).cloned() else {
            return div().p(px(38.)).text_color(theme::muted()).child("This movie is no longer in your library.").into_any_element();
        };
        let key = TitleKey::Movie(path.clone());
        let watched = movie.watched();
        let toggle = path.clone();
        let meta = vec![
            movie.year.map(|y| y.to_string()).unwrap_or_default(),
            movie.progress.filter(|p| p.duration > 0.0).map(|p| format!("{} min", (p.duration / 60.0).round())).unwrap_or_default(),
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
        let details = div()
            .flex()
            .flex_col()
            .child(Self::detail_row("File", path.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_default()))
            .child(Self::detail_row("Size", size))
            .child(Self::detail_row("Folder", path.parent().map(|p| p.display().to_string()).unwrap_or_default()));
        let others: Vec<_> = self.visible_movies().into_iter().filter(|m| &m.path != path).filter_map(|m| self.title_view(&TitleKey::Movie(m.path))).take(6).collect();
        div()
            .px(px(38.))
            .pt(px(19.))
            .pb(px(38.))
            .flex()
            .flex_col()
            .gap(px(29.))
            .child(hero)
            .child(div().w(px(496.)).child(self.panel("Details", Some("list"), details)))
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
                        this.open_select = if this.open_select == Some(setting) { None } else { Some(setting) };
                        cx.notify();
                    }))
                    .child(div().text_size(px(14.)).text_color(theme::foreground()).child(label))
                    .child(icon("chevron-down", 16., theme::foreground())),
            )
            .when(open, |el| {
                el.child(
                    div()
                        .mt(px(5.))
                        .w(px(256.))
                        .p(px(5.))
                        .rounded(px(theme::RADIUS_LG))
                        .bg(theme::overlay())
                        .border_1()
                        .border_color(theme::border())
                        .flex()
                        .flex_col()
                        .children(LANGUAGES.iter().map(|(code, name)| {
                            let selected = *code == current;
                            div()
                                .id(SharedString::from(format!("{setting}-{code}")))
                                .flex()
                                .items_center()
                                .justify_between()
                                .px(px(10.))
                                .py(px(6.))
                                .rounded(px(theme::RADIUS))
                                .cursor_pointer()
                                .hover(|s| s.bg(theme::default_soft()))
                                .on_click(cx.listener(move |this, _, _, cx| {
                                    this.catalog.set_setting(setting, code);
                                    this.open_select = None;
                                    cx.notify();
                                }))
                                .child(div().text_size(px(12.)).text_color(theme::foreground()).child(*name))
                                .when(selected, |el| el.child(icon("check", 16., theme::accent())))
                        })),
                )
            })
    }

    fn settings_card(&self, icon_name: &'static str, title: &str, rows: Vec<AnyElement>) -> impl IntoElement {
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
                    .border_b_1()
                    .border_color(theme::separator())
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

    pub fn render_settings_page(&self, cx: &mut Context<Self>) -> AnyElement {
        let section = if self.screen == Screen::Libraries { SettingsSection::Libraries } else { self.settings_section };
        let nav = |id: &'static str, icon_name: &'static str, label: &'static str, target: SettingsSection, cx: &mut Context<Self>| {
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
                div()
                    .flex()
                    .flex_col()
                    .gap(px(18.))
                    .child(self.settings_card(
                        "captions",
                        "Subtitles",
                        vec![
                            Self::setting_row("Turn on subtitles", self.toggle("set-subs-on", subs_on, cx, move |this| this.catalog.set_setting("subtitles_on", if subs_on { "no" } else { "yes" }))),
                            Self::setting_row("Preferred subtitle language", self.language_select("set-sub-lang", "subtitle_lang", cx)),
                        ],
                    ))
                    .child(self.settings_card("audio-lines", "Audio language", vec![Self::setting_row("Preferred audio language", self.language_select("set-audio-lang", "audio_lang", cx))]))
                    .into_any_element()
            }
            SettingsSection::Libraries => self.render_libraries_public(cx),
            SettingsSection::Appearance => self
                .settings_card(
                    "palette",
                    "Theme",
                    vec![Self::setting_row(
                        "Dark",
                        div().text_size(px(12.)).text_color(theme::muted()).child("Plexy's HeroUI dark theme. More themes later."),
                    )],
                )
                .into_any_element(),
        };
        let heading = match section {
            SettingsSection::Playback => "Playback",
            SettingsSection::Libraries => "Libraries",
            SettingsSection::Appearance => "Appearance",
        };
        div()
            .px(px(38.))
            .pt(px(29.))
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
                    .child(nav("settings-playback", "captions", "Playback", SettingsSection::Playback, cx))
                    .child(nav("settings-appearance", "palette", "Appearance", SettingsSection::Appearance, cx))
                    .child(group("Library"))
                    .child(nav("settings-libraries", "library", "Libraries", SettingsSection::Libraries, cx)),
            )
            .child(
                div()
                    .flex_1()
                    .min_w_0()
                    .flex()
                    .flex_col()
                    .gap(px(19.))
                    .child(div().pb(px(14.)).border_b_1().border_color(theme::border()).child(h1(heading)))
                    .child(content),
            )
            .into_any_element()
    }

    // MARK: Shell

    pub fn render_shell(&self, window: &Window, cx: &mut Context<Self>) -> impl IntoElement {
        let page: AnyElement = match self.screen.clone() {
            Screen::Home => self.render_home_page(cx),
            Screen::Library => self.render_library_page(cx),
            Screen::Show(key) => self.render_show_page(&key, window, cx),
            Screen::Movie(path) => self.render_movie_page(&path, window, cx),
            Screen::Settings | Screen::Libraries => self.render_settings_page(cx),
            other => div().px(px(38.)).pt(px(29.)).pb(px(38.)).child(self.render_list_screen(other, window, cx)).into_any_element(),
        };
        div()
            .absolute()
            .inset_0()
            .flex()
            .flex_col()
            .bg(theme::background())
            .text_color(theme::foreground())
            .child(self.render_top_nav(window, cx))
            .child(
                div().id("shell-scroll").flex_1().min_h_0().overflow_y_scroll().child(
                    div()
                        .child(page)
                        .with_animation(SharedString::from(format!("page-{:?}", self.screen)), Animation::new(Duration::from_millis(260)).with_easing(ease_in_out), |el, t| {
                            el.opacity(t).mt(px(10. * (1. - t)))
                        }),
                ),
            )
    }
}
