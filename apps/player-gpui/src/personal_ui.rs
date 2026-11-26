//! Search, sorting and filters, title pages and the personal library:
//! watchlist, favorites, ratings, hidden titles, collections and history.

use std::path::PathBuf;

use gpui::{div, prelude::*, px, Context, FocusHandle, KeyDownEvent, SharedString, Window};

use crate::app::{format_time, PlayerView};
use crate::catalog::{Item, Mark, Show, TitleKey};
use crate::library_ui::{icon, progress_bar, section_title, Screen};
use crate::theme;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Sort {
    Title,
    Added,
    Year,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum WatchFilter {
    All,
    Unwatched,
    Watched,
}

/// Which single-line field a keystroke edits.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Field {
    Search,
    Collection,
}

/// A resolved title for cards and lists.
pub struct TitleView {
    pub key: TitleKey,
    pub title: String,
    pub subtitle: String,
    pub poster: Option<PathBuf>,
    pub fraction: f64,
    pub watched: bool,
    pub added_at: i64,
    pub year: Option<u32>,
}

fn matches(query: &str, haystacks: &[&str]) -> bool {
    let words: Vec<String> = query.to_lowercase().split_whitespace().map(String::from).collect();
    let joined = haystacks.join(" ").to_lowercase().replace(['.', '_'], " ");
    !words.is_empty() && words.iter().all(|w| joined.contains(w.as_str()))
}

impl PlayerView {
    // MARK: Text fields

    /// Minimal single-line editing: typing, Backspace, ⌘⌫ to clear, ⌘V to
    /// paste, Enter to submit, Escape to clear. Keystrokes never reach the
    /// player shortcuts while a field has focus.
    pub fn on_field_key(&mut self, field: Field, event: &KeyDownEvent, _window: &mut Window, cx: &mut Context<Self>) {
        cx.stop_propagation();
        let keystroke = &event.keystroke;
        let mods = keystroke.modifiers;
        let mut text = match field {
            Field::Search => self.search_query.clone(),
            Field::Collection => self.collection_draft.clone(),
        };
        match keystroke.key.as_str() {
            "backspace" if mods.platform || mods.alt => text.clear(),
            "backspace" => {
                text.pop();
            }
            "escape" => text.clear(),
            "enter" => {
                if field == Field::Collection {
                    if let Some(id) = self.catalog.create_collection(&text) {
                        if let Some(key) = self.collection_target.clone() {
                            self.catalog.toggle_in_collection(id, &key);
                        }
                        text.clear();
                        self.reload_catalog();
                    }
                }
            }
            "v" if mods.platform => {
                if let Some(paste) = cx.read_from_clipboard().and_then(|c| c.text()) {
                    text.push_str(paste.lines().next().unwrap_or_default());
                }
            }
            _ if mods.platform || mods.control => return,
            _ => {
                if let Some(typed) = keystroke.key_char.as_ref().filter(|c| !c.chars().any(char::is_control)) {
                    text.push_str(typed);
                } else {
                    return;
                }
            }
        }
        match field {
            Field::Search => {
                self.search_query = text;
                if self.screen != Screen::Search {
                    self.screen = Screen::Search;
                }
            }
            Field::Collection => self.collection_draft = text,
        }
        cx.notify();
    }

    pub fn text_field(
        &self,
        id: &'static str,
        field: Field,
        focus: &FocusHandle,
        value: &str,
        placeholder: &'static str,
        window: &Window,
        cx: &mut Context<Self>,
    ) -> gpui::Stateful<gpui::Div> {
        let focused = focus.is_focused(window);
        let focus_for_click = focus.clone();
        div()
            .id(id)
            .track_focus(focus)
            .h(px(30.))
            .px(px(10.))
            .flex()
            .items_center()
            .gap(px(6.))
            .rounded(px(theme::RADIUS_LG))
            .bg(theme::surface_secondary())
            .border_1()
            .border_color(if focused { theme::accent() } else { theme::border() })
            .cursor_text()
            .on_click(cx.listener(move |_, _, window, cx| {
                window.focus(&focus_for_click);
                cx.stop_propagation();
            }))
            .on_key_down(cx.listener(move |this, event: &KeyDownEvent, window, cx| this.on_field_key(field, event, window, cx)))
            .child(if value.is_empty() {
                div().text_size(px(11.)).text_color(theme::muted()).child(placeholder).into_any_element()
            } else {
                div()
                    .flex()
                    .items_center()
                    .min_w_0()
                    .text_size(px(11.))
                    .text_color(theme::foreground())
                    .child(value.to_string())
                    .when(focused, |el| el.child(div().ml(px(1.)).w(px(2.)).h(px(14.)).bg(theme::accent())))
                    .into_any_element()
            })
            .when(value.is_empty() && focused, |el| el.child(div().w(px(2.)).h(px(14.)).bg(theme::accent())))
    }

    // MARK: Title resolution

    pub fn hidden(&self, key: &TitleKey) -> bool {
        self.personal.has(key, Mark::Hidden)
    }

    pub fn visible_movies(&self) -> Vec<Item> {
        self.movies().into_iter().filter(|m| !self.hidden(&TitleKey::Movie(m.path.clone()))).collect()
    }

    pub fn visible_shows(&self) -> Vec<Show> {
        self.shows().into_iter().filter(|s| !self.hidden(&TitleKey::Show(s.key.clone()))).collect()
    }

    pub fn title_view(&self, key: &TitleKey) -> Option<TitleView> {
        match key {
            TitleKey::Movie(path) => {
                let movie = self.items.iter().find(|i| &i.path == path && !i.missing)?;
                Some(TitleView {
                    key: key.clone(),
                    title: movie.title.clone(),
                    subtitle: movie.year.map(|y| y.to_string()).unwrap_or_else(|| "Movie".into()),
                    poster: movie.poster.clone(),
                    fraction: movie.progress.map(|p| p.fraction()).unwrap_or(0.0),
                    watched: movie.watched(),
                    added_at: movie.added_at,
                    year: movie.year,
                })
            }
            TitleKey::Show(show_key) => {
                let show = self.shows().into_iter().find(|s| &s.key == show_key)?;
                let total = show.episodes().count();
                let unwatched = show.unwatched();
                Some(TitleView {
                    key: key.clone(),
                    title: show.title.clone(),
                    subtitle: if unwatched == 0 { format!("{total} episodes · Watched") } else { format!("{total} episodes · {unwatched} unwatched") },
                    poster: show.poster.clone(),
                    fraction: 0.0,
                    watched: unwatched == 0,
                    added_at: show.added_at,
                    year: None,
                })
            }
        }
    }

    pub fn open_title(&mut self, key: &TitleKey, cx: &mut Context<Self>) {
        self.collection_picker = false;
        self.title_menu = false;
        self.selected_season = None;
        self.screen = match key {
            TitleKey::Movie(path) => Screen::Movie(path.clone()),
            TitleKey::Show(show) => Screen::Show(show.clone()),
        };
        cx.notify();
    }

    pub fn title_grid(&self, id_prefix: &str, titles: Vec<TitleView>, cx: &mut Context<Self>) -> impl IntoElement {
        let cards: Vec<_> = titles
            .into_iter()
            .map(|t| {
                let key = t.key.clone();
                self.poster_card(
                    format!("{id_prefix}-{}", t.key.encode()),
                    t.title,
                    t.subtitle,
                    t.poster,
                    t.fraction,
                    t.watched,
                    cx,
                    move |this, _, cx| this.open_title(&key, cx),
                )
                .into_any_element()
            })
            .collect();
        div().flex().flex_wrap().gap(px(16.)).children(cards)
    }

    // MARK: Sort and filter

    pub fn sort_and_filter(&self, mut titles: Vec<TitleView>) -> Vec<TitleView> {
        titles.retain(|t| match self.watch_filter {
            WatchFilter::All => true,
            WatchFilter::Unwatched => !t.watched,
            WatchFilter::Watched => t.watched,
        });
        match self.sort {
            Sort::Title => titles.sort_by_key(|t| t.title.to_lowercase()),
            Sort::Added => titles.sort_by_key(|t| std::cmp::Reverse(t.added_at)),
            Sort::Year => titles.sort_by_key(|t| (std::cmp::Reverse(t.year.unwrap_or(0)), t.title.to_lowercase())),
        }
        titles
    }

    fn segment<T: Copy + PartialEq + 'static>(
        &self,
        id: &'static str,
        options: &[(T, &'static str)],
        current: T,
        cx: &mut Context<Self>,
        set: fn(&mut Self, T),
    ) -> impl IntoElement {
        div()
            .flex()
            .p(px(2.))
            .gap(px(2.))
            .rounded(px(theme::RADIUS_LG))
            .bg(theme::surface_secondary())
            .children(options.iter().map(|(value, label)| {
                let value = *value;
                let active = value == current;
                div()
                    .id(SharedString::from(format!("{id}-{label}")))
                    .h(px(24.))
                    .px(px(10.))
                    .flex()
                    .items_center()
                    .rounded(px(theme::RADIUS))
                    .cursor_pointer()
                    .text_size(px(10.))
                    .font_weight(gpui::FontWeight::SEMIBOLD)
                    .when(active, |el| el.bg(theme::segment()).text_color(theme::foreground()))
                    .when(!active, |el| el.text_color(theme::muted()).hover(|s| s.text_color(theme::foreground())))
                    .on_click(cx.listener(move |this, _, _, cx| {
                        set(this, value);
                        cx.notify();
                    }))
                    .child(*label)
            }))
    }

    pub fn grid_toolbar(&self, title: &str, years: bool, cx: &mut Context<Self>) -> impl IntoElement {
        let mut sorts = vec![(Sort::Title, "Title"), (Sort::Added, "Recently Added")];
        if years {
            sorts.push((Sort::Year, "Year"));
        }
        div()
            .flex()
            .flex_wrap()
            .items_center()
            .justify_between()
            .gap(px(10.))
            .child(section_title(title))
            .child(
                div()
                    .flex()
                    .gap(px(8.))
                    .child(self.segment("sort", &sorts, self.sort, cx, |this, v| this.sort = v))
                    .child(self.segment(
                        "filter",
                        &[(WatchFilter::All, "All"), (WatchFilter::Unwatched, "Unwatched"), (WatchFilter::Watched, "Watched")],
                        self.watch_filter,
                        cx,
                        |this, v| this.watch_filter = v,
                    )),
            )
    }

    // MARK: Title actions

    fn chip(&self, id: String, label: String, active: bool) -> gpui::Stateful<gpui::Div> {
        div()
            .id(SharedString::from(id))
            .h(px(29.))
            .px(px(11.))
            .flex()
            .items_center()
            .gap(px(5.))
            .rounded(px(theme::RADIUS_LG))
            .cursor_pointer()
            .text_size(px(11.))
            .font_weight(gpui::FontWeight::SEMIBOLD)
            .when(active, |el| el.bg(gpui::Hsla { a: 0.18, ..theme::accent() }).text_color(theme::accent()))
            .when(!active, |el| el.bg(theme::default()).text_color(theme::foreground()).hover(|s| s.bg(theme::segment())))
            .when(active, |el| el.child(icon("check", 14., theme::accent())))
            .child(label)
    }

    /// Watchlist, Favorite, rating, Hide and Add to Collection.
    pub fn title_actions(&self, key: &TitleKey, window: &Window, cx: &mut Context<Self>) -> impl IntoElement {
        let encoded = key.encode();
        let rating = self.personal.rating(key);
        let mut row = div().flex().flex_wrap().items_center().gap(px(6.));
        for (mark, label) in [(Mark::Watchlist, "Watchlist"), (Mark::Favorite, "Favorite"), (Mark::Hidden, "Hidden")] {
            let active = self.personal.has(key, mark);
            let key = key.clone();
            let text = match (mark, active) {
                (Mark::Hidden, false) => "Hide".to_string(),
                _ => label.to_string(),
            };
            row = row.child(self.chip(format!("mark-{label}-{encoded}"), text, active).on_click(cx.listener(move |this, _, _, cx| {
                this.catalog.toggle_mark(&key, mark);
                this.reload_catalog();
                cx.notify();
            })));
        }
        let stars = div().flex().items_center().gap(px(2.)).ml(px(5.)).children((1..=5u8).map(|star| {
            let key = key.clone();
            div()
                .id(SharedString::from(format!("star-{star}-{encoded}")))
                .px(px(2.))
                .cursor_pointer()
                .text_size(px(18.))
                .text_color(if star <= rating { theme::warning() } else { theme::segment() })
                .hover(|s| s.text_color(theme::warning()))
                .on_click(cx.listener(move |this, _, _, cx| {
                    this.catalog.set_rating(&key, star);
                    this.reload_catalog();
                    cx.notify();
                }))
                .child("★")
        }));
        let in_collections = self.personal.collections.iter().filter(|c| c.titles.contains(key)).count();
        let picker_key = key.clone();
        row = row.child(stars).child(
            self.chip(
                format!("collections-{encoded}"),
                if in_collections > 0 { format!("In {in_collections} collection{}", if in_collections == 1 { "" } else { "s" }) } else { "Add to Collection".into() },
                in_collections > 0 || self.collection_picker,
            )
            .on_click(cx.listener(move |this, _, window, cx| {
                this.collection_picker = !this.collection_picker;
                this.collection_target = Some(picker_key.clone());
                if this.collection_picker {
                    window.focus(&this.collection_focus.clone());
                }
                cx.notify();
            })),
        );
        let mut column = div().flex().flex_col().gap(px(10.)).child(row);
        if self.collection_picker {
            let mut picker = div()
                .w(px(288.))
                .p(px(8.))
                .rounded(px(theme::RADIUS_XL))
                .bg(theme::surface())
                .border_1()
                .border_color(theme::border())
                .flex()
                .flex_col()
                .gap(px(3.));
            for collection in &self.personal.collections {
                let id = collection.id;
                let key = key.clone();
                let member = collection.titles.contains(&key);
                picker = picker.child(
                    div()
                        .id(SharedString::from(format!("pick-{id}")))
                        .flex()
                        .items_center()
                        .gap(px(8.))
                        .px(px(8.))
                        .py(px(6.))
                        .rounded(px(theme::RADIUS))
                        .cursor_pointer()
                        .hover(|s| s.bg(theme::default_soft()))
                        .on_click(cx.listener(move |this, _, _, cx| {
                            this.catalog.toggle_in_collection(id, &key);
                            this.reload_catalog();
                            cx.notify();
                        }))
                        .child(div().size(px(13.)).when(member, |el| el.child(icon("check", 16., theme::accent()))))
                        .child(div().text_size(px(11.)).text_color(theme::foreground()).child(collection.name.clone())),
                );
            }
            let draft = self.collection_draft.clone();
            picker = picker.child(
                div().pt(px(5.)).child(self.text_field(
                    "new-collection",
                    Field::Collection,
                    &self.collection_focus,
                    &draft,
                    "New collection name, then Return",
                    window,
                    cx,
                )),
            );
            column = column.child(picker);
        }
        column
    }

    // MARK: Screens

    pub fn render_movie(&self, path: &PathBuf, window: &Window, cx: &mut Context<Self>) -> gpui::AnyElement {
        let Some(movie) = self.items.iter().find(|i| &i.path == path).cloned() else {
            return div().text_color(theme::muted()).child("This movie is no longer in your library.").into_any_element();
        };
        let key = TitleKey::Movie(path.clone());
        let resumable = movie.progress.filter(|p| p.resumable());
        let watched = movie.watched();
        let play_path = path.clone();
        let restart_path = path.clone();
        let toggle_path = path.clone();
        div()
            .flex()
            .gap(px(26.))
            .child(self.poster(movie.poster.clone(), &movie.title, 240., 360.))
            .child(
                div()
                    .flex_1()
                    .min_w_0()
                    .flex()
                    .flex_col()
                    .gap(px(11.))
                    .pt(px(10.))
                    .child(div().text_size(px(29.)).font_weight(gpui::FontWeight::BOLD).text_color(theme::foreground()).child(movie.title.clone()))
                    .child(div().text_size(px(12.)).text_color(theme::muted()).child(
                        [movie.year.map(|y| y.to_string()), movie.progress.filter(|p| p.duration > 0.0).map(|p| format_time(p.duration)), movie.missing.then(|| "File unavailable".to_string())]
                            .into_iter()
                            .flatten()
                            .collect::<Vec<_>>()
                            .join(" · "),
                    ))
                    .when_some(resumable, |el, p| {
                        el.child(
                            div()
                                .flex()
                                .items_center()
                                .gap(px(8.))
                                .child(div().w(px(192.)).child(progress_bar(p.fraction())))
                                .child(div().text_size(px(10.)).text_color(theme::muted()).child(format!("{} left", format_time(p.duration - p.position)))),
                        )
                    })
                    .child(
                        div()
                            .flex()
                            .gap(px(8.))
                            .child(
                                self.button("movie-play", if resumable.is_some() { format!("Resume from {}", format_time(resumable.unwrap().position)) } else { "Play".into() }, true)
                                    .on_click(cx.listener(move |this, _, window, cx| this.play_item(play_path.clone(), window, cx))),
                            )
                            .when(resumable.is_some(), |el| {
                                el.child(self.button("movie-restart", "Start Over", false).on_click(cx.listener(move |this, _, window, cx| {
                                    this.open_at(&restart_path, Some(0.0), window, cx);
                                })))
                            })
                            .child(self.button("movie-watched", if watched { "Mark Unwatched" } else { "Mark Watched" }, false).on_click(cx.listener(move |this, _, _, cx| {
                                this.catalog.set_watched(&toggle_path, !watched);
                                this.reload_catalog();
                                cx.notify();
                            }))),
                    )
                    .child(self.title_actions(&key, window, cx))
                    .child(div().pt(px(6.)).text_size(px(10.)).text_color(theme::muted()).child(path.display().to_string())),
            )
            .into_any_element()
    }

    pub fn render_search(&self, window: &Window, cx: &mut Context<Self>) -> gpui::AnyElement {
        let query = self.search_query.trim().to_string();
        let mut page = div().flex().flex_col().gap(px(19.)).child(section_title("Search")).child(
            div().w(px(384.)).child(self.text_field("search-page", Field::Search, &self.search_focus, &self.search_query, "Titles, episodes or file names", window, cx)),
        );
        if query.is_empty() {
            return page.child(div().text_color(theme::muted()).child("Type to search your library.")).into_any_element();
        }
        let movies: Vec<TitleView> = self
            .visible_movies()
            .iter()
            .filter(|m| matches(&query, &[&m.title, &m.path.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_default()]))
            .filter_map(|m| self.title_view(&TitleKey::Movie(m.path.clone())))
            .collect();
        let shows = self.visible_shows();
        let show_hits: Vec<TitleView> = shows
            .iter()
            .filter(|s| matches(&query, &[&s.title]))
            .filter_map(|s| self.title_view(&TitleKey::Show(s.key.clone())))
            .collect();
        let episodes: Vec<Item> = shows
            .iter()
            .flat_map(|s| s.episodes().cloned().collect::<Vec<_>>())
            .filter(|e| {
                let file = e.path.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_default();
                matches(&query, &[e.episode_title.as_deref().unwrap_or_default(), &file]) && !matches(&query, &[&e.title])
            })
            .take(40)
            .collect();
        if movies.is_empty() && show_hits.is_empty() && episodes.is_empty() {
            return page.child(div().text_color(theme::muted()).child(format!("Nothing matches “{query}”."))).into_any_element();
        }
        if !show_hits.is_empty() {
            page = page.child(section_title("TV Shows")).child(self.title_grid("search-show", show_hits, cx));
        }
        if !movies.is_empty() {
            page = page.child(section_title("Movies")).child(self.title_grid("search-movie", movies, cx));
        }
        if !episodes.is_empty() {
            let rows: Vec<_> = episodes
                .into_iter()
                .map(|e| {
                    let path = e.path.clone();
                    div()
                        .id(SharedString::from(format!("search-ep-{}", e.id)))
                        .flex()
                        .gap(px(10.))
                        .p(px(8.))
                        .rounded(px(theme::RADIUS_LG))
                        .cursor_pointer()
                        .hover(|s| s.bg(theme::surface()))
                        .on_click(cx.listener(move |this, _, window, cx| this.play_item(path.clone(), window, cx)))
                        .child(div().text_size(px(12.)).font_weight(gpui::FontWeight::SEMIBOLD).text_color(theme::foreground()).child(e.title.clone()))
                        .child(div().text_size(px(12.)).text_color(theme::muted()).child(e.episode_label()))
                        .into_any_element()
                })
                .collect();
            page = page.child(section_title("Episodes")).child(div().flex().flex_col().children(rows));
        }
        page.into_any_element()
    }

    pub fn render_mark_list(&self, mark: Mark, title: &str, empty: &str, cx: &mut Context<Self>) -> gpui::AnyElement {
        let mut keys = self.personal.marked(mark);
        keys.sort_by_key(|k| k.encode());
        let titles: Vec<TitleView> = keys.iter().filter_map(|k| self.title_view(k)).collect();
        let none = titles.is_empty();
        div()
            .flex()
            .flex_col()
            .gap(px(14.))
            .child(section_title(title))
            .when(none, |el| el.child(div().text_color(theme::muted()).child(empty.to_string())))
            .child(self.title_grid(&format!("list-{title}"), titles, cx))
            .into_any_element()
    }

    pub fn render_collections(&self, window: &Window, cx: &mut Context<Self>) -> gpui::AnyElement {
        let mut page = div().flex().flex_col().gap(px(14.)).child(section_title("Collections")).child(
            div().w(px(336.)).child(self.text_field("collection-create", Field::Collection, &self.collection_focus, &self.collection_draft, "New collection name, then Return", window, cx)),
        );
        if self.personal.collections.is_empty() {
            page = page.child(div().text_color(theme::muted()).child("No collections yet. Create one here or from a title page."));
        }
        for collection in &self.personal.collections {
            let id = collection.id;
            let titles: Vec<TitleView> = collection.titles.iter().filter_map(|k| self.title_view(k)).collect();
            page = page.child(
                div()
                    .flex()
                    .flex_col()
                    .gap(px(10.))
                    .p(px(14.))
                    .rounded(px(theme::RADIUS_XL))
                    .bg(theme::surface())
                    .border_1()
                    .border_color(theme::border())
                    .child(
                        div()
                            .flex()
                            .items_center()
                            .justify_between()
                            .child(div().text_size(px(14.)).font_weight(gpui::FontWeight::BOLD).text_color(theme::foreground()).child(format!("{} · {}", collection.name, titles.len())))
                            .child(self.button(format!("collection-delete-{id}"), "Delete Collection", false).text_color(theme::danger()).on_click(cx.listener(move |this, _, _, cx| {
                                this.catalog.delete_collection(id);
                                this.reload_catalog();
                                cx.notify();
                            }))),
                    )
                    .when(titles.is_empty(), |el| el.child(div().text_size(px(11.)).text_color(theme::muted()).child("Empty. Use “Add to Collection” on a title page.")))
                    .child(self.title_grid(&format!("collection-{id}"), titles, cx)),
            );
        }
        page.into_any_element()
    }

    pub fn render_history(&self, cx: &mut Context<Self>) -> gpui::AnyElement {
        let mut page = div().flex().flex_col().gap(px(14.)).child(section_title("History"));
        if self.personal.history.is_empty() {
            return page.child(div().text_color(theme::muted()).child("Finished titles appear here.")).into_any_element();
        }
        let now = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_secs() as i64).unwrap_or(0);
        let mut list = div().flex().flex_col().gap(px(3.));
        for entry in &self.personal.history {
            let id = entry.id;
            let path = entry.path.clone();
            let ago = now - entry.watched_at;
            let when = match ago {
                ..60 => "Just now".to_string(),
                60..3600 => format!("{} min ago", ago / 60),
                3600..86400 => format!("{} h ago", ago / 3600),
                _ => format!("{} days ago", ago / 86400),
            };
            list = list.child(
                div()
                    .id(SharedString::from(format!("history-{id}")))
                    .flex()
                    .items_center()
                    .gap(px(11.))
                    .p(px(10.))
                    .rounded(px(theme::RADIUS_LG))
                    .cursor_pointer()
                    .hover(|s| s.bg(theme::surface()))
                    .on_click(cx.listener(move |this, _, window, cx| this.open_at(&path, Some(0.0), window, cx)))
                    .child(
                        div()
                            .flex_1()
                            .min_w_0()
                            .flex()
                            .gap(px(8.))
                            .child(div().text_size(px(12.)).font_weight(gpui::FontWeight::SEMIBOLD).text_color(theme::foreground()).child(entry.title.clone()))
                            .child(div().text_size(px(12.)).text_color(theme::muted()).truncate().child(entry.label.clone())),
                    )
                    .child(div().text_size(px(10.)).text_color(theme::muted()).child(when))
                    .child(
                        div()
                            .id(SharedString::from(format!("history-remove-{id}")))
                            .px(px(8.))
                            .py(px(3.))
                            .rounded_full()
                            .text_size(px(10.))
                            .text_color(theme::muted())
                            .hover(|s| s.bg(theme::default()).text_color(theme::danger()))
                            .on_click(cx.listener(move |this, _, _, cx| {
                                cx.stop_propagation();
                                this.catalog.remove_history(id);
                                this.reload_catalog();
                                cx.notify();
                            }))
                            .child("Remove"),
                    ),
            );
        }
        page = page.child(list);
        page.into_any_element()
    }
}
