//! Library screens drawn when nothing is playing: sidebar navigation, Home
//! (Continue Watching, Next Up, Recently Added), Movies and TV grids, a show
//! page with seasons and episodes, and library management.
//!
//! Colours, radii and type follow Plexy's HeroUI dark theme (`theme.rs`).

use std::collections::HashSet;
use std::path::PathBuf;

use gpui::{div, prelude::*, px, svg, Context, MouseButton, PathPromptOptions, SharedString, Window};

use crate::app::{format_time, PlayerView};
use crate::catalog::{self, Item, LibraryKind, Mark, Show, TitleKey};
use crate::personal_ui::{Field, TitleView};
use crate::theme;

#[derive(Clone, Debug, PartialEq)]
pub enum Screen {
    Home,
    Movies,
    Shows,
    Show(String),
    Movie(PathBuf),
    Search,
    /// Titles in one TMDB genre, from the Library's genre tiles.
    Genre(String),
    Watchlist,
    Favorites,
    Collections,
    History,
    Hidden,
    Libraries,
    Library,
    Settings,
}

impl Screen {
    /// Start page for screenshot checks: `PLEXY_SCREEN=library`, `show:<key>`,
    /// `genre:<name>`, `search:<query>`, `history`, `collections`, `appearance`.
    pub fn from_env() -> Screen {
        let Ok(value) = std::env::var("PLEXY_SCREEN") else { return Screen::Home };
        let (kind, arg) = value.split_once(':').unwrap_or((value.as_str(), ""));
        match kind {
            "library" => Screen::Library,
            "show" => Screen::Show(arg.to_string()),
            "movie" => Screen::Movie(PathBuf::from(arg)),
            "genre" => Screen::Genre(arg.to_string()),
            "search" => Screen::Search,
            "history" => Screen::History,
            "collections" => Screen::Collections,
            "settings" | "appearance" => Screen::Settings,
            _ => Screen::Home,
        }
    }
}

pub(crate) fn icon(name: &str, size: f32, color: gpui::Hsla) -> impl IntoElement {
    svg().path(format!("icons/{name}.svg")).size(px(size)).text_color(color)
}

fn white(alpha: f32) -> gpui::Hsla {
    gpui::Hsla { a: alpha, ..theme::foreground() }
}

pub(crate) fn section_title(text: &str) -> impl IntoElement {
    div().text_size(px(16.)).font_weight(gpui::FontWeight::BOLD).text_color(theme::foreground()).child(text.to_string())
}

pub(crate) fn progress_bar(fraction: f64) -> impl IntoElement {
    div()
        .h(px(3.))
        .w_full()
        .rounded_full()
        .bg(gpui::Hsla { a: 0.25, ..theme::foreground() })
        .child(div().h_full().rounded_full().w(gpui::relative(fraction as f32)).bg(theme::accent()))
}

impl PlayerView {
    pub fn tv_library_ids(&self) -> HashSet<i64> {
        self.libraries.iter().filter(|l| l.kind == LibraryKind::Shows).map(|l| l.id).collect()
    }

    pub fn shows(&self) -> Vec<Show> {
        catalog::shows(&self.items, &self.tv_library_ids())
    }

    pub(crate) fn movies(&self) -> Vec<Item> {
        let tv = self.tv_library_ids();
        self.items.iter().filter(|i| !tv.contains(&i.library_id) && !i.missing).cloned().collect()
    }

    /// The catalog's next episode after `path`, by season and episode.
    pub fn catalog_next(&self, path: &std::path::Path) -> Option<PathBuf> {
        let shows = self.shows();
        let show = shows.iter().find(|s| s.episodes().any(|e| e.path == path))?;
        let episodes: Vec<&Item> = show.episodes().filter(|e| e.season.unwrap_or(0) > 0).collect();
        let index = episodes.iter().position(|e| e.path == path)?;
        episodes.get(index + 1).map(|e| e.path.clone())
    }

    pub fn reload_catalog(&mut self) {
        self.libraries = self.catalog.libraries();
        self.items = self.catalog.items();
        self.personal = self.catalog.personal();
        let tv = self.tv_library_ids();
        let mut keys = HashSet::new();
        for item in &self.items {
            if !item.missing && tv.contains(&item.library_id) {
                keys.insert(TitleKey::Show(item.show_key()));
            }
            if item.season.is_none() {
                keys.insert(TitleKey::Movie(item.path.clone()));
            }
        }
        self.episode_metas = self.catalog.library_episode_metadata();
        self.metas = self.catalog.matched_title_metadata(&keys);
    }

    fn add_library(&mut self, kind: LibraryKind, window: &mut Window, cx: &mut Context<Self>) {
        let paths = cx.prompt_for_paths(PathPromptOptions {
            files: false,
            directories: true,
            multiple: true,
            prompt: Some(format!("Add {} Folder", kind.label()).into()),
        });
        cx.spawn_in(window, async move |this, cx| {
            if let Ok(Ok(Some(paths))) = paths.await {
                this.update(cx, |view, cx| {
                    let mut library = None;
                    for path in paths {
                        match library {
                            None => library = view.catalog.add_library(kind, &path).ok(),
                            Some(id) => {
                                let _ = view.catalog.add_root(id, &path);
                            }
                        }
                    }
                    view.reload_catalog();
                    view.catalog.scan(library, false);
                    cx.notify();
                })
                .ok();
            }
        })
        .detach();
    }

    fn add_root(&mut self, library_id: i64, window: &mut Window, cx: &mut Context<Self>) {
        let paths = cx.prompt_for_paths(PathPromptOptions { files: false, directories: true, multiple: true, prompt: Some("Add Folder".into()) });
        cx.spawn_in(window, async move |this, cx| {
            if let Ok(Ok(Some(paths))) = paths.await {
                this.update(cx, |view, cx| {
                    for path in paths {
                        let _ = view.catalog.add_root(library_id, &path);
                    }
                    view.reload_catalog();
                    view.catalog.scan(Some(library_id), false);
                    cx.notify();
                })
                .ok();
            }
        })
        .detach();
    }

    fn nav_item(&self, id: &'static str, label: &'static str, screen: Screen, cx: &mut Context<Self>) -> impl IntoElement {
        let active = match (&self.screen, &screen) {
            (Screen::Show(_), Screen::Shows) | (Screen::Movie(_), Screen::Movies) => true,
            (a, b) => a == b,
        };
        div()
            .id(id)
            .px(px(10.))
            .py(px(7.))
            .rounded(px(theme::RADIUS))
            .cursor_pointer()
            .text_size(px(12.))
            .font_weight(if active { gpui::FontWeight::SEMIBOLD } else { gpui::FontWeight::MEDIUM })
            .text_color(if active { theme::foreground() } else { theme::muted() })
            .when(active, |el| el.bg(theme::default()))
            .hover(|style| style.bg(theme::default_soft()).text_color(theme::foreground()))
            .on_click(cx.listener(move |this, _, _, cx| {
                this.screen = screen.clone();
                cx.notify();
            }))
            .child(label)
    }

    pub(crate) fn button(&self, id: impl Into<SharedString>, label: impl Into<SharedString>, primary: bool) -> gpui::Stateful<gpui::Div> {
        div()
            .id(gpui::ElementId::Name(id.into()))
            .h(px(29.))
            .px(px(11.))
            .flex()
            .items_center()
            .gap(px(6.))
            .rounded(px(theme::RADIUS_LG))
            .cursor_pointer()
            .text_size(px(11.))
            .font_weight(gpui::FontWeight::SEMIBOLD)
            .when(primary, |el| el.bg(theme::accent()).text_color(theme::accent_foreground()).hover(|s| s.opacity(0.9)))
            .when(!primary, |el| el.bg(theme::default()).text_color(theme::foreground()).hover(|s| s.bg(theme::segment())))
            .child(label.into())
    }

    /// Poster width: ~8 per row like the web grid.
    pub(crate) fn poster_width(&self) -> f32 {
        ((self.page_width() - 7. * 20.) / 8.).clamp(112., 200.)
    }

    pub(crate) fn poster(&self, poster: Option<PathBuf>, title: &str, width: f32, height: f32) -> gpui::Div {
        div()
            .w(px(width))
            .h(px(height))
            .rounded(px(10.))
            .overflow_hidden()
            .bg(theme::surface_secondary())
            .when_some(poster.clone(), |el, path| el.child(crate::assets::artwork_cover(path, 10.)))
            .when(poster.is_none(), |el| {
                // Tinted placeholder with the title, like the web app's
                // no-artwork state.
                el.child(
                    div()
                        .absolute()
                        .inset_0()
                        .p(px(12.))
                        .flex()
                        .flex_col()
                        .justify_end()
                        .text_size(px(14.))
                        .font_weight(gpui::FontWeight::BOLD)
                        .text_color(white(0.55))
                        .child(title.to_string()),
                )
            })
            .relative()
    }

    pub(crate) fn play_item(&mut self, path: PathBuf, window: &mut Window, cx: &mut Context<Self>) {
        self.open(&path, window, cx);
    }

    /// Landscape card: Continue Watching / Next Up.
    fn wide_card(&self, item: &Item, caption: String, cx: &mut Context<Self>) -> impl IntoElement {
        let path = item.path.clone();
        let fraction = item.progress.map(|p| p.fraction()).unwrap_or(0.0);
        let remaining = item.progress.filter(|p| p.duration > 0.0).map(|p| format!("{} left", format_time(p.duration - p.position)));
        div()
            .id(SharedString::from(format!("wide-{}", item.id)))
            .w(px(240.))
            .flex_none()
            .flex()
            .flex_col()
            .gap(px(6.))
            .cursor_pointer()
            .on_click(cx.listener(move |this, _, window, cx| this.play_item(path.clone(), window, cx)))
            .child(
                div()
                    .relative()
                    .w(px(240.))
                    .h(px(135.))
                    .rounded(px(theme::RADIUS_LG))
                    .overflow_hidden()
                    .bg(theme::surface_secondary())
                    .border_1()
                    .border_color(theme::border())
                    .when_some(item.poster.clone(), |el, poster| el.child(crate::assets::artwork_cover(poster, 0.)))
                    .child(
                        div()
                            .absolute()
                            .inset_0()
                            .flex()
                            .items_center()
                            .justify_center()
                            .child(div().size(px(38.)).rounded_full().bg(gpui::Hsla { a: 0.55, ..theme::background() }).flex().items_center().justify_center().child(icon("play", 22., theme::foreground()))),
                    )
                    .when(fraction > 0.0, |el| el.child(div().absolute().left(px(8.)).right(px(8.)).bottom(px(8.)).child(progress_bar(fraction)))),
            )
            .child(
                div()
                    .flex()
                    .flex_col()
                    .gap(px(2.))
                    .child(div().text_size(px(12.)).font_weight(gpui::FontWeight::SEMIBOLD).text_color(theme::foreground()).truncate().child(item.title.clone()))
                    .child(div().text_size(px(10.)).text_color(theme::muted()).truncate().child(match remaining {
                        Some(left) if !caption.is_empty() => format!("{caption} · {left}"),
                        Some(left) => left,
                        None => caption,
                    })),
            )
    }

    /// Portrait card for movies and shows, matching the web app's poster
    /// cards: 2:3 art, title and meta caption below.
    pub(crate) fn poster_card(
        &self,
        id: String,
        title: String,
        subtitle: String,
        poster: Option<PathBuf>,
        fraction: f64,
        watched: bool,
        cx: &mut Context<Self>,
        on_click: impl Fn(&mut Self, &mut Window, &mut Context<Self>) + 'static,
    ) -> impl IntoElement {
        let width = self.poster_width();
        let group = SharedString::from(format!("poster-{id}"));
        div()
            .id(SharedString::from(id))
            .group(group.clone())
            .w(px(width))
            .flex_none()
            .flex()
            .flex_col()
            .gap(px(7.))
            .cursor_pointer()
            .on_click(cx.listener(move |this, _, window, cx| on_click(this, window, cx)))
            .child(
                self.lift(
                    group.clone(),
                    width,
                    width * 1.5,
                    div()
                    .child(self.poster(poster, &title, width, width * 1.5).size_full())
                    .when(watched, |el| {
                        el.child(
                            div()
                                .absolute()
                                .top(px(7.))
                                .right(px(7.))
                                .size(px(20.))
                                .rounded_full()
                                .bg(theme::accent())
                                .flex()
                                .items_center()
                                .justify_center()
                                .child(icon("check", 14., theme::accent_foreground())),
                        )
                    })
                    .when(fraction > 0.0 && !watched, |el| el.child(div().absolute().left(px(7.)).right(px(7.)).bottom(px(7.)).child(progress_bar(fraction))))
                    .child(crate::shell_ui::hover_ring(group.clone(), 10.)),
                    cx,
                ),
            )
            .child(div().text_size(px(15.)).font_weight(gpui::FontWeight::MEDIUM).text_color(theme::foreground()).truncate().group_hover(group.clone(), |s| s.text_color(theme::accent())).child(title))
            .child(div().text_size(px(12.)).text_color(theme::muted()).truncate().child(subtitle))
    }

    fn row(&self, id: &'static str, title: &str, children: Vec<gpui::AnyElement>) -> impl IntoElement {
        div()
            .flex()
            .flex_col()
            .gap(px(11.))
            .child(section_title(title))
            .child(div().id(id).flex().gap(px(13.)).overflow_x_scroll().pb(px(5.)).children(children))
    }

    fn render_home(&self, cx: &mut Context<Self>) -> gpui::AnyElement {
        if self.libraries.is_empty() {
            return self.render_welcome(cx).into_any_element();
        }
        let mut continue_watching: Vec<&Item> = self.items.iter().filter(|i| !i.missing && i.progress.is_some_and(|p| p.resumable())).collect();
        continue_watching.sort_by_key(|i| std::cmp::Reverse(i.progress.map(|p| p.updated).unwrap_or(0)));

        let shows = self.visible_shows();
        let resuming: HashSet<PathBuf> = continue_watching.iter().map(|i| i.path.clone()).collect();
        let mut next_up: Vec<(u64, Item)> = shows
            .iter()
            .filter(|s| s.episodes().any(|e| e.watched()))
            .filter_map(|s| {
                let next = s.next_up()?;
                let last = s.episodes().filter_map(|e| e.progress.map(|p| p.updated)).max().unwrap_or(0);
                (!resuming.contains(&next.path)).then(|| (last, next.clone()))
            })
            .collect();
        next_up.sort_by_key(|(updated, _)| std::cmp::Reverse(*updated));

        let mut recent: Vec<(i64, String, String, Option<PathBuf>, Option<PathBuf>, Option<String>)> = Vec::new();
        for movie in self.visible_movies() {
            recent.push((movie.added_at, movie.title.clone(), movie.year.map(|y| y.to_string()).unwrap_or_default(), movie.poster.clone(), Some(movie.path.clone()), None));
        }
        for show in &shows {
            recent.push((show.added_at, show.title.clone(), format!("{} episodes", show.episodes().count()), show.poster.clone(), None, Some(show.key.clone())));
        }
        recent.sort_by_key(|r| std::cmp::Reverse(r.0));
        recent.truncate(20);

        let mut page = div().flex().flex_col().gap(px(29.));
        if !continue_watching.is_empty() {
            let cards = continue_watching.iter().take(20).map(|i| self.wide_card(i, i.episode_label(), cx).into_any_element()).collect();
            page = page.child(self.row("continue", "Continue Watching", cards));
        }
        if !next_up.is_empty() {
            let cards = next_up.iter().take(20).map(|(_, i)| self.wide_card(i, i.episode_label(), cx).into_any_element()).collect();
            page = page.child(self.row("next-up", "Next Up", cards));
        }
        if !recent.is_empty() {
            let cards = recent
                .into_iter()
                .enumerate()
                .map(|(index, (_, title, subtitle, poster, path, show))| {
                    self.poster_card(format!("recent-{index}"), title, subtitle, poster, 0.0, false, cx, move |this, window, cx| {
                        let _ = &window;
                        if let Some(path) = &path {
                            this.screen = Screen::Movie(path.clone());
                            cx.notify();
                        } else if let Some(key) = &show {
                            this.screen = Screen::Show(key.clone());
                            cx.notify();
                        }
                    })
                    .into_any_element()
                })
                .collect();
            page = page.child(self.row("recent", "Recently Added", cards));
        }
        if self.items.is_empty() {
            page = page.child(div().text_color(theme::muted()).child(if self.catalog.status.lock().running { "Scanning your folders…" } else { "No videos found in your library folders yet." }));
        }
        page.into_any_element()
    }

    fn render_welcome(&self, cx: &mut Context<Self>) -> impl IntoElement {
        div()
            .flex()
            .flex_col()
            .items_center()
            .justify_center()
            .gap(px(11.))
            .py(px(96.))
            .child(icon("film", 56., theme::accent()))
            .child(div().text_size(px(21.)).font_weight(gpui::FontWeight::BOLD).text_color(theme::foreground()).child("Welcome to Plexy"))
            .child(div().text_size(px(12.)).text_color(theme::muted()).child("Add your movie and TV folders. Everything stays on this Mac."))
            .child(
                div()
                    .flex()
                    .gap(px(8.))
                    .mt(px(6.))
                    .child(self.button("welcome-movies", "Add Movies Folder", true).on_click(cx.listener(|this, _, window, cx| this.add_library(LibraryKind::Movies, window, cx))))
                    .child(self.button("welcome-tv", "Add TV Folder", false).on_click(cx.listener(|this, _, window, cx| this.add_library(LibraryKind::Shows, window, cx))))
                    .child(self.button("welcome-open", "Open a File…", false).on_click(cx.listener(|this, _, window, cx| this.prompt_open(window, cx)))),
            )
    }

    fn render_movies(&self, cx: &mut Context<Self>) -> gpui::AnyElement {
        let titles: Vec<_> = self
            .visible_movies()
            .iter()
            .map(TitleView::from_movie)
            .collect();
        let titles = self.sort_and_filter(titles);
        let empty = titles.is_empty();
        div()
            .flex()
            .flex_col()
            .gap(px(14.))
            .child(self.grid_toolbar("Movies", true, cx))
            .when(empty, |el| el.child(div().text_color(theme::muted()).child("No movies here. Add a Movies library from Libraries, or change the filter.")))
            .child(self.title_grid("movie", titles, cx))
            .into_any_element()
    }

    fn render_shows(&self, cx: &mut Context<Self>) -> gpui::AnyElement {
        let titles: Vec<_> = self
            .visible_shows()
            .iter()
            .map(TitleView::from_show)
            .collect();
        let titles = self.sort_and_filter(titles);
        let empty = titles.is_empty();
        div()
            .flex()
            .flex_col()
            .gap(px(14.))
            .child(self.grid_toolbar("TV Shows", false, cx))
            .when(empty, |el| el.child(div().text_color(theme::muted()).child("No shows here. Add a TV library from Libraries, or change the filter.")))
            .child(self.title_grid("show", titles, cx))
            .into_any_element()
    }

    fn render_show(&self, key: &str, window: &Window, cx: &mut Context<Self>) -> gpui::AnyElement {
        let Some(show) = self.shows().into_iter().find(|s| s.key == key) else {
            return div().text_color(theme::muted()).child("This show is no longer in your library.").into_any_element();
        };
        let next = show.next_up().cloned();
        let mut page = div()
            .flex()
            .flex_col()
            .gap(px(22.))
            .child(
                div()
                    .flex()
                    .gap(px(22.))
                    .child(self.poster(show.poster.clone(), &show.title, 200., 300.))
                    .child(
                        div()
                            .flex()
                            .flex_col()
                            .justify_end()
                            .gap(px(8.))
                            .child(div().text_size(px(27.)).font_weight(gpui::FontWeight::BOLD).text_color(theme::foreground()).child(show.title.clone()))
                            .child(div().text_size(px(12.)).text_color(theme::muted()).child(format!(
                                "{} season{} · {} episodes · {} unwatched",
                                show.seasons.keys().filter(|s| **s > 0).count(),
                                if show.seasons.len() == 1 { "" } else { "s" },
                                show.episodes().count(),
                                show.unwatched()
                            )))
                            .child(self.title_actions(&TitleKey::Show(show.key.clone()), window, cx))
                            .when_some(next, |el, next| {
                                let path = next.path.clone();
                                let resume = next.progress.is_some_and(|p| p.resumable());
                                el.child(
                                    self.button("show-play", format!("{} {}", if resume { "Resume" } else { "Play" }, next.episode_label()), true)
                                        .w_auto()
                                        .on_click(cx.listener(move |this, _, window, cx| this.play_item(path.clone(), window, cx))),
                                )
                            }),
                    ),
            );
        for (season, episodes) in &show.seasons {
            let mut list = div().flex().flex_col().gap(px(3.));
            for episode in episodes {
                let path = episode.path.clone();
                let toggle_path = episode.path.clone();
                let watched = episode.watched();
                let fraction = episode.progress.map(|p| p.fraction()).unwrap_or(0.0);
                list = list.child(
                    div()
                        .id(SharedString::from(format!("ep-{}", episode.id)))
                        .flex()
                        .items_center()
                        .gap(px(13.))
                        .p(px(10.))
                        .rounded(px(theme::RADIUS_LG))
                        .cursor_pointer()
                        .hover(|s| s.bg(theme::surface()))
                        .on_click(cx.listener(move |this, _, window, cx| this.play_item(path.clone(), window, cx)))
                        .child(div().w(px(35.)).text_size(px(12.)).text_color(theme::muted()).child(episode.episode.map(|e| e.to_string()).unwrap_or_else(|| "—".into())))
                        .child(
                            div()
                                .flex_1()
                                .min_w_0()
                                .flex()
                                .flex_col()
                                .gap(px(5.))
                                .child(
                                    div()
                                        .text_size(px(12.))
                                        .font_weight(gpui::FontWeight::SEMIBOLD)
                                        .text_color(theme::foreground())
                                        .truncate()
                                        .child(episode.episode_title.clone().unwrap_or_else(|| episode.path.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_default())),
                                )
                                .when(fraction > 0.0 && !watched, |el| el.child(div().w(px(176.)).child(progress_bar(fraction)))),
                        )
                        .child(
                            div()
                                .id(SharedString::from(format!("ep-watched-{}", episode.id)))
                                .h(px(24.))
                                .px(px(8.))
                                .flex()
                                .items_center()
                                .gap(px(5.))
                                .rounded_full()
                                .text_size(px(10.))
                                .text_color(if watched { theme::accent() } else { theme::muted() })
                                .hover(|s| s.bg(theme::default()))
                                .on_mouse_down(MouseButton::Left, |_, _, cx| cx.stop_propagation())
                                .on_click(cx.listener(move |this, _, _, cx| {
                                    cx.stop_propagation();
                                    this.catalog.set_watched(&toggle_path, !watched);
                                    this.reload_catalog();
                                    cx.notify();
                                }))
                                .child(icon("check", 14., if watched { theme::accent() } else { theme::muted() }))
                                .child(if watched { "Watched" } else { "Mark watched" }),
                        ),
                );
            }
            page = page.child(
                div()
                    .flex()
                    .flex_col()
                    .gap(px(8.))
                    .child(section_title(&if *season == 0 { "Specials & Extras".to_string() } else { format!("Season {season}") }))
                    .child(list),
            );
        }
        page.into_any_element()
    }

    fn render_libraries(&self, cx: &mut Context<Self>) -> gpui::AnyElement {
        let status = self.catalog.status.lock().clone();
        let mut page = div()
            .flex()
            .flex_col()
            .gap(px(16.))
            .child(
                div()
                    .flex()
                    .items_center()
                    .justify_between()
                    .child(section_title("Libraries"))
                    .child(
                        div()
                            .flex()
                            .flex_wrap()
                            .gap(px(8.))
                            .child(self.button("lib-add-movies", "Add Movies Library", true).on_click(cx.listener(|this, _, window, cx| this.add_library(LibraryKind::Movies, window, cx))))
                            .child(self.button("lib-add-tv", "Add TV Library", true).on_click(cx.listener(|this, _, window, cx| this.add_library(LibraryKind::Shows, window, cx))))
                            .child(self.button("lib-scan-all", if status.running { "Scanning…" } else { "Rescan All" }, false).on_click(cx.listener(|this, _, _, cx| {
                                this.catalog.scan(None, false);
                                cx.notify();
                            }))),
                    ),
            );
        if status.running || !status.errors.is_empty() || status.finished_at.is_some() {
            page = page.child(
                div()
                    .p(px(11.))
                    .rounded(px(theme::RADIUS_LG))
                    .bg(theme::surface())
                    .border_1()
                    .border_color(theme::border())
                    .flex()
                    .flex_col()
                    .gap(px(5.))
                    .child(div().text_size(px(11.)).text_color(theme::foreground()).child(if status.running {
                        format!("Scanning {} — {} files checked, {} new", status.library.clone().unwrap_or_default(), status.scanned, status.added)
                    } else {
                        format!("Last scan: {} files checked, {} new", status.scanned, status.added)
                    }))
                    .when_some(status.current.clone().filter(|_| status.running), |el, current| el.child(div().text_size(px(10.)).text_color(theme::muted()).truncate().child(current)))
                    .children(status.errors.iter().map(|error| div().text_size(px(10.)).text_color(theme::danger()).child(error.clone()))),
            );
        }
        if self.libraries.is_empty() {
            page = page.child(crate::shell_ui::empty_state("library", "No libraries yet", "Add a Movies or TV folder to start building your library.", None));
        }
        for library in &self.libraries {
            let id = library.id;
            let auto = library.auto_refresh;
            let mut card = div()
                .id(SharedString::from(format!("library-card-{id}")))
                .p(px(14.))
                .rounded(px(theme::RADIUS_XL))
                .bg(theme::surface())
                .border_1()
                .border_color(theme::border())
                .hover(|s| s.bg(theme::surface_secondary()).border_color(theme::segment()))
                .flex()
                .flex_col()
                .gap(px(10.))
                .child(
                    div()
                        .flex()
                        .flex_wrap()
                        .gap(px(10.))
                        .items_center()
                        .justify_between()
                        .child(
                            div()
                                .flex()
                                .flex_col()
                                .min_w_0()
                                .gap(px(2.))
                                .child(div().text_size(px(14.)).font_weight(gpui::FontWeight::BOLD).text_color(theme::foreground()).child(library.name.clone()))
                                .child(div().text_size(px(10.)).text_color(theme::muted()).child(format!("{} · {} items", library.kind.label(), library.item_count))),
                        )
                        .child(
                            div()
                                .flex()
                                .gap(px(6.))
                                .child(self.button(format!("lib-auto-{id}"), if auto { "Auto-refresh: On" } else { "Auto-refresh: Off" }, false).on_click(cx.listener(move |this, _, _, cx| {
                                    this.catalog.set_auto_refresh(id, !auto);
                                    this.reload_catalog();
                                    cx.notify();
                                })))
                                .child(self.button(format!("lib-root-{id}"), "Add Folder", false).on_click(cx.listener(move |this, _, window, cx| this.add_root(id, window, cx))))
                                .child(self.button(format!("lib-scan-{id}"), "Rescan", false).on_click(cx.listener(move |this, _, _, cx| {
                                    this.catalog.scan(Some(id), false);
                                    cx.notify();
                                })))
                                .child(
                                    self.button(format!("lib-remove-{id}"), "Remove", false)
                                        .text_color(theme::danger())
                                        .on_click(cx.listener(move |this, _, _, cx| {
                                            this.catalog.remove_library(id);
                                            this.reload_catalog();
                                            cx.notify();
                                        })),
                                ),
                        ),
                );
            for root in &library.roots {
                let root_id = root.id;
                card = card.child(
                    div()
                        .flex()
                        .items_center()
                        .gap(px(8.))
                        .px(px(10.))
                        .py(px(6.))
                        .rounded(px(theme::RADIUS))
                        .bg(theme::surface_secondary())
                        .child(icon("folder", 16., theme::muted()))
                        .child(div().flex_1().min_w_0().text_size(px(10.)).text_color(theme::foreground()).truncate().child(root.path.display().to_string()))
                        .when(!root.available, |el| el.child(div().text_size(px(10.)).text_color(theme::warning()).child("Unavailable — entries kept")))
                        .child(
                            div()
                                .id(SharedString::from(format!("root-remove-{root_id}")))
                                .text_size(px(10.))
                                .text_color(theme::muted())
                                .cursor_pointer()
                                .hover(|s| s.text_color(theme::danger()))
                                .on_click(cx.listener(move |this, _, _, cx| {
                                    this.catalog.remove_root(root_id);
                                    this.reload_catalog();
                                    cx.notify();
                                }))
                                .child("Remove folder"),
                        ),
                );
            }
            page = page.child(card);
        }
        page.into_any_element()
    }

    pub fn render_welcome_public(&self, cx: &mut Context<Self>) -> impl IntoElement {
        self.render_welcome(cx)
    }

    pub fn render_libraries_public(&self, cx: &mut Context<Self>) -> gpui::AnyElement {
        self.render_libraries(cx)
    }

    /// Screens that keep the simple list layout inside the new shell.
    pub fn render_list_screen(&self, screen: Screen, window: &Window, cx: &mut Context<Self>) -> gpui::AnyElement {
        let lists = |this: &Self, cx: &mut Context<Self>| {
            div().flex().gap(px(8.)).children(
                [("lists-watchlist", "Watchlist", Screen::Watchlist), ("lists-favorites", "Favorites", Screen::Favorites), ("lists-collections", "Collections", Screen::Collections), ("lists-hidden", "Hidden", Screen::Hidden)]
                    .into_iter()
                    .map(|(id, label, target)| {
                        let active = this.screen == target;
                        div()
                            .id(id)
                            .h(px(30.))
                            .px(px(13.))
                            .flex()
                            .items_center()
                            .rounded_full()
                            .cursor_pointer()
                            .text_size(px(11.))
                            .font_weight(gpui::FontWeight::SEMIBOLD)
                            .bg(if active { theme::foreground() } else { theme::default() })
                            .text_color(if active { theme::background() } else { theme::foreground() })
                            .on_click(cx.listener(move |this, _, _, cx| {
                                this.screen = target.clone();
                                cx.notify();
                            }))
                            .child(label)
                    }),
            )
        };
        let body = match screen {
            Screen::Movies => self.render_movies(cx),
            Screen::Shows => self.render_shows(cx),
            Screen::Search => self.render_search(window, cx),
            Screen::Watchlist => self.render_mark_list(Mark::Watchlist, "Watchlist", "Add titles from their page to watch later.", cx),
            Screen::Favorites => self.render_mark_list(Mark::Favorite, "Favorites", "Titles you favorite appear here.", cx),
            Screen::Hidden => self.render_mark_list(Mark::Hidden, "Hidden", "Hidden titles stay out of Home and the grids. Open one to unhide it.", cx),
            Screen::Collections => self.render_collections(window, cx),
            Screen::History => self.render_history(cx),
            _ => div().into_any_element(),
        };
        let personal = matches!(screen, Screen::Watchlist | Screen::Favorites | Screen::Hidden) || (screen == Screen::Collections && !self.personal.collections.is_empty());
        div().flex().flex_col().gap(px(19.)).when(personal, |el| el.child(lists(self, cx))).child(body).into_any_element()
    }

    #[allow(dead_code)]
    pub fn render_library(&self, window: &Window, cx: &mut Context<Self>) -> impl IntoElement {
        let content = match self.screen.clone() {
            Screen::Home => self.render_home(cx),
            Screen::Movies => self.render_movies(cx),
            Screen::Shows => self.render_shows(cx),
            Screen::Show(key) => self.render_show(&key, window, cx),
            Screen::Movie(path) => self.render_movie(&path, window, cx),
            Screen::Search => self.render_search(window, cx),
            Screen::Watchlist => self.render_mark_list(Mark::Watchlist, "Watchlist", "Add titles from their page to watch later.", cx),
            Screen::Favorites => self.render_mark_list(Mark::Favorite, "Favorites", "Titles you favorite appear here.", cx),
            Screen::Hidden => self.render_mark_list(Mark::Hidden, "Hidden", "Hidden titles stay out of Home and the grids. Open one to unhide it.", cx),
            Screen::Collections => self.render_collections(window, cx),
            Screen::History => self.render_history(cx),
            Screen::Genre(genre) => self.render_genre_page(&genre, cx),
            Screen::Libraries | Screen::Library | Screen::Settings => self.render_libraries(cx),
        };
        let scanning = self.catalog.status.lock().running;
        let top_inset = if window.is_fullscreen() { 18. } else { 44. };
        div()
            .absolute()
            .inset_0()
            .flex()
            .bg(theme::background())
            .text_color(theme::foreground())
            .child(
                div()
                    .w(px(176.))
                    .flex_none()
                    .h_full()
                    .pt(px(top_inset))
                    .px(px(11.))
                    .pb(px(13.))
                    .bg(theme::surface())
                    .border_r_1()
                    .border_color(theme::separator())
                    .flex()
                    .flex_col()
                    .gap(px(3.))
                    .child(div().px(px(10.)).pb(px(14.)).text_size(px(19.)).font_weight(gpui::FontWeight::BLACK).text_color(theme::foreground()).child("Plexy"))
                    .child(div().pb(px(8.)).child(self.text_field("nav-search", Field::Search, &self.search_focus, &self.search_query, "Search", window, cx)))
                    .child(self.nav_item("nav-home", "Home", Screen::Home, cx))
                    .child(self.nav_item("nav-movies", "Movies", Screen::Movies, cx))
                    .child(self.nav_item("nav-shows", "TV Shows", Screen::Shows, cx))
                    .child(div().px(px(10.)).pt(px(13.)).pb(px(3.)).text_size(px(10.)).font_weight(gpui::FontWeight::SEMIBOLD).text_color(theme::muted()).child("Your library"))
                    .child(self.nav_item("nav-watchlist", "Watchlist", Screen::Watchlist, cx))
                    .child(self.nav_item("nav-favorites", "Favorites", Screen::Favorites, cx))
                    .child(self.nav_item("nav-collections", "Collections", Screen::Collections, cx))
                    .child(self.nav_item("nav-history", "History", Screen::History, cx))
                    .child(self.nav_item("nav-hidden", "Hidden", Screen::Hidden, cx))
                    .child(div().h(px(10.)))
                    .child(self.nav_item("nav-libraries", "Libraries", Screen::Libraries, cx))
                    .child(div().flex_1())
                    .child(
                        div()
                            .id("nav-open")
                            .px(px(10.))
                            .py(px(7.))
                            .rounded(px(theme::RADIUS))
                            .cursor_pointer()
                            .text_size(px(11.))
                            .text_color(theme::muted())
                            .hover(|s| s.bg(theme::default_soft()).text_color(theme::foreground()))
                            .on_click(cx.listener(|this, _, window, cx| this.prompt_open(window, cx)))
                            .child("Open File…  ⌘O"),
                    )
                    .when(scanning, |el| el.child(div().px(px(10.)).pt(px(5.)).text_size(px(10.)).text_color(theme::muted()).child("Scanning library…"))),
            )
            .child(
                div()
                    .id("library-scroll")
                    .flex_1()
                    .min_w_0()
                    .h_full()
                    .overflow_y_scroll()
                    .pt(px(top_inset + 8.))
                    .px(px(29.))
                    .pb(px(38.))
                    .child(content),
            )
    }
}
