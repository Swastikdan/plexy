//! Search, sorting and filters, title pages and the personal library:
//! watchlist, favorites, ratings, hidden titles, collections and history.

use std::path::PathBuf;

use gpui_kit::component::Disableable as _;
use gpui_kit::{
    div, point, prelude::*, px, relative, size, AnyElement, App, AvailableSpace, Bounds, Context,
    Element, ElementId, FocusHandle, GlobalElementId, InspectorElementId, KeyDownEvent, LayoutId,
    Pixels, SharedString, Style, WeakEntity, Window,
};

use crate::app::{format_time, PlayerView};
use crate::catalog::{Item, Mark, Show, TitleKey};
use crate::library_ui::{progress_bar, section_title, Screen};
use crate::ui::icon::{icon, Icon};
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
    Token,
    MarkerStart,
    MarkerEnd,
    FixSearch,
    Remap,
}

/// A resolved title for cards and lists.
#[derive(Clone)]
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

impl TitleView {
    pub fn from_movie(movie: &Item) -> Self {
        Self {
            key: TitleKey::Movie(movie.path.clone()),
            title: movie.title.clone(),
            subtitle: movie.year.map(|y| y.to_string()).unwrap_or_else(|| "Movie".into()),
            poster: movie.poster.clone(),
            fraction: movie.progress.map(|p| p.fraction()).unwrap_or(0.0),
            watched: movie.watched(),
            added_at: movie.added_at,
            year: movie.year,
        }
    }

    pub fn from_show(show: &Show) -> Self {
        let total = show.episodes().count();
        let unwatched = show.unwatched();
        Self {
            key: TitleKey::Show(show.key.clone()),
            title: show.title.clone(),
            subtitle: if unwatched == 0 { format!("{total} episodes · Watched") } else { format!("{total} episodes · {unwatched} unwatched") },
            poster: show.poster.clone(),
            fraction: 0.0,
            watched: unwatched == 0,
            added_at: show.added_at,
            year: None,
        }
    }
}

const POSTER_GAP: f32 = 20.;
pub(crate) const POSTER_TITLE_LINE: f32 = 19.;
pub(crate) const POSTER_SUBTITLE_LINE: f32 = 16.;
pub(crate) const POSTER_TEXT_GAP: f32 = 7.;

struct TitleGrid {
    id: SharedString,
    titles: Vec<TitleView>,
    view: WeakEntity<PlayerView>,
    poster: f32,
}

impl TitleGrid {
    fn columns(width: f32, poster: f32) -> usize {
        (((width + POSTER_GAP) / (poster + POSTER_GAP)).floor() as usize).max(1)
    }

    fn card_height(poster: f32) -> f32 {
        poster * 1.5 + POSTER_TITLE_LINE + POSTER_SUBTITLE_LINE + 2. * POSTER_TEXT_GAP
    }

    fn visible_rows(rows: usize, stride: f32, top: f32, bottom: f32) -> std::ops::Range<usize> {
        let first = ((top / stride).floor() as usize).saturating_sub(1).min(rows);
        let last = ((bottom / stride).ceil() as usize).saturating_add(1).min(rows);
        first..last
    }
}

impl Element for TitleGrid {
    type RequestLayoutState = ();
    type PrepaintState = Vec<AnyElement>;

    fn id(&self) -> Option<ElementId> {
        Some(self.id.clone().into())
    }

    fn source_location(&self) -> Option<&'static std::panic::Location<'static>> {
        None
    }

    fn request_layout(
        &mut self, _: Option<&GlobalElementId>, _: Option<&InspectorElementId>,
        window: &mut Window, _: &mut App,
    ) -> (LayoutId, ()) {
        let poster = self.poster;
        let count = self.titles.len();
        let mut style = Style::default();
        style.size.width = relative(1.).into();
        (window.request_measured_layout(style, move |known, available, _, _| {
            let width = known.width.unwrap_or_else(|| match available.width {
                AvailableSpace::Definite(width) => width,
                _ => px(poster),
            });
            let rows = count.div_ceil(Self::columns(f32::from(width), poster));
            let height = rows as f32 * Self::card_height(poster)
                + rows.saturating_sub(1) as f32 * POSTER_GAP;
            size(width, px(height))
        }), ())
    }

    fn prepaint(
        &mut self, _: Option<&GlobalElementId>, _: Option<&InspectorElementId>,
        bounds: Bounds<Pixels>, _: &mut (), window: &mut Window, cx: &mut App,
    ) -> Vec<AnyElement> {
        // The shell owns scrolling. Reserve the whole grid in layout and build
        // the rows that intersect its clip, with one extra row at each edge.
        let clip = window.content_mask().bounds;
        if !clip.intersects(&bounds) {
            return Vec::new();
        }
        let columns = Self::columns(f32::from(bounds.size.width), self.poster);
        let height = Self::card_height(self.poster);
        let stride = height + POSTER_GAP;
        let rows = Self::visible_rows(
            self.titles.len().div_ceil(columns), stride,
            f32::from(clip.top() - bounds.top()), f32::from(clip.bottom() - bounds.top()),
        );
        let start = (rows.start * columns).min(self.titles.len());
        let end = (rows.end * columns).min(self.titles.len());
        let mut cards = self.view.update(cx, |view, cx| {
            self.titles[start..end].iter().map(|title| {
                let title = view.enrich_view(title.clone());
                let key = title.key;
                view.poster_card(
                    format!("{}-{}", self.id, key.encode()), title.title, title.subtitle,
                    title.poster, title.fraction, title.watched, cx,
                    move |view, _, cx| view.open_title(&key, cx),
                ).into_any_element()
            }).collect::<Vec<_>>()
        }).unwrap_or_default();
        for (index, card) in (start..end).zip(&mut cards) {
            let offset = point(
                px((index % columns) as f32 * (self.poster + POSTER_GAP)),
                px((index / columns) as f32 * stride),
            );
            card.prepaint_as_root(
                bounds.origin + offset, size(px(self.poster).into(), px(height).into()), window, cx,
            );
        }
        cards
    }

    fn paint(
        &mut self, _: Option<&GlobalElementId>, _: Option<&InspectorElementId>, _: Bounds<Pixels>,
        _: &mut (), cards: &mut Vec<AnyElement>, window: &mut Window, cx: &mut App,
    ) {
        for card in cards {
            card.paint(window, cx);
        }
    }
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
    /// Verifies the drafted TMDB token off the UI thread, saves it, then
    /// enriches the library in the background.
    pub fn save_token(&mut self, cx: &mut Context<Self>) {
        let token = self.token_draft.trim().to_string();
        if token.is_empty() {
            return;
        }
        *self.token_status.lock() = (true, "Checking token…".into());
        let (status, catalog) = (self.token_status.clone(), self.catalog.clone());
        std::thread::spawn(move || match crate::metadata::verify_token(&token) {
            Ok(()) => {
                if let Err(error) = catalog.set_tmdb_token(&token) {
                    *status.lock() = (false, error.to_string());
                    return;
                }
                *status.lock() = (true, "Connected. Fetching artwork and details…".into());
                let (enriched, review) = crate::metadata::enrich_missing(&catalog);
                catalog.bump_metadata_epoch();
                *status.lock() = (true, format!("Connected. Matched {enriched} title{}{}.", if enriched == 1 { "" } else { "s" }, if review > 0 { format!(", {review} need review") } else { String::new() }));
            }
            Err(message) => *status.lock() = (false, message),
        });
        self.token_draft.clear();
        self.token_clear = true;
        cx.notify();
    }

    pub fn on_field_key(&mut self, field: Field, event: &KeyDownEvent, window: &mut Window, cx: &mut Context<Self>) {
        cx.stop_propagation();
        let keystroke = &event.keystroke;
        let mods = keystroke.modifiers;
        let mut text = match field {
            Field::Search => self.search_query.clone(),
            Field::Collection => self.collection_draft.clone(),
            Field::Token => self.token_draft.clone(),
            Field::FixSearch => self.fix_query.clone(),
            Field::Remap => match &self.remap { Some(r) => r.query.clone(), None => return },
            Field::MarkerStart | Field::MarkerEnd => {
                let Some(editor) = &self.marker_editor else { return };
                if field == Field::MarkerStart { editor.start.clone() } else { editor.end.clone() }
            }
        };
        match keystroke.key.as_str() {
            "backspace" if mods.platform || mods.alt => text.clear(),
            "backspace" => {
                text.pop();
            }
            "escape" if matches!(field, Field::MarkerStart | Field::MarkerEnd) => {
                self.marker_editor = None;
                window.focus(&self.focus_handle(), cx);
                cx.notify();
                return;
            }
            "escape" if field == Field::Collection && self.collection_picker => {
                self.collection_picker = false;
                self.collection_target = None;
                self.collection_draft.clear();
                window.focus(&self.focus_handle(), cx);
                cx.notify();
                return;
            }
            "escape" => text.clear(),
            "enter" => {
                if matches!(field, Field::MarkerStart | Field::MarkerEnd) {
                    self.save_marker(false, cx);
                    if self.marker_editor.is_none() {
                        window.focus(&self.focus_handle(), cx);
                    }
                    return;
                }
                if field == Field::Token {
                    self.save_token(cx);
                    return;
                }
                if field == Field::Remap {
                    self.remap_search(cx);
                    return;
                }
                if field == Field::Collection {
                    self.collection_draft = text;
                    self.create_collection_from_draft(cx);
                    if self.collection_draft.is_empty() {
                        self.new_collection_open = false;
                    }
                    cx.notify();
                    return;
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
            Field::Token => self.token_draft = text,
            Field::FixSearch => {
                self.fix_query = text;
                self.filter_fix_matches();
            }
            Field::Remap => {
                if let Some(remap) = &mut self.remap {
                    remap.set_query(text);
                }
            }
            Field::MarkerStart | Field::MarkerEnd => {
                if let Some(editor) = &mut self.marker_editor {
                    if field == Field::MarkerStart { editor.start = text; } else { editor.end = text; }
                    editor.error = None;
                }
            }
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
    ) -> gpui_kit::Stateful<gpui_kit::Div> {
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
            .text_size(px(12.))
            .on_click(cx.listener(move |_, _, window, cx| {
                window.focus(&focus_for_click, cx);
                cx.stop_propagation();
            }))
            .on_key_down(cx.listener(move |this, event: &KeyDownEvent, window, cx| this.on_field_key(field, event, window, cx)))
            .when(value.is_empty() && focused, |el| el.child(div().flex_none().w(px(2.)).h(px(14.)).bg(theme::accent())))
            .child(if value.is_empty() {
                div().text_color(theme::muted()).child(placeholder).into_any_element()
            } else {
                div()
                    .flex()
                    .items_center()
                    .min_w_0()
                    .text_color(theme::foreground())
                    .child(value.to_string())
                    .when(focused, |el| el.child(div().ml(px(1.)).w(px(2.)).h(px(14.)).bg(theme::accent())))
                    .into_any_element()
            })
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
            TitleKey::Movie(path) => self.items.iter()
                .find(|item| &item.path == path && !item.missing)
                .map(TitleView::from_movie),
            TitleKey::Show(show_key) => self.shows().iter()
                .find(|show| &show.key == show_key)
                .map(TitleView::from_show),
        }
    }

    pub fn open_title(&mut self, key: &TitleKey, cx: &mut Context<Self>) {
        self.collection_picker = false;
        self.open_select = None;
        self.selected_season = None;
        self.screen = match key {
            TitleKey::Movie(path) => Screen::Movie(path.clone()),
            TitleKey::Show(show) => Screen::Show(show.clone()),
        };
        cx.notify();
    }

    /// Fills poster and the `2017 · ★ 7.5` caption from TMDB when matched.
    pub fn enrich_view(&self, mut t: TitleView) -> TitleView {
        if let Some(meta) = self.metas.get(&t.key) {
            if !meta.name.is_empty() {
                t.title = meta.name.clone();
            }
            if meta.poster.is_some() {
                t.poster = meta.poster.clone();
            }
            let mut parts = Vec::new();
            if let Some(y) = meta.year.or(t.year) {
                parts.push(y.to_string());
            }
            if let Some(r) = meta.rating.filter(|r| *r > 0.0) {
                parts.push(format!("★ {r:.1}"));
            }
            if !parts.is_empty() {
                t.subtitle = parts.join(" · ");
            }
        }
        t
    }

    pub fn title_grid(&self, id_prefix: &str, titles: Vec<TitleView>, cx: &mut Context<Self>) -> impl IntoElement {
        TitleGrid {
            id: SharedString::from(id_prefix.to_owned()),
            titles,
            view: cx.entity().downgrade(),
            poster: self.poster_width(),
        }
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
        crate::ui::controls::tabs(options.iter().map(|(value, label)| {
            let value = *value;
            crate::ui::controls::tab(format!("{id}-{label}"), *label, value == current)
                .on_click(cx.listener(move |this, _, _, cx| {
                    set(this, value);
                    cx.notify();
                }))
                .into_any_element()
        })).p(px(2.)).rounded(px(theme::RADIUS_LG)).bg(theme::surface_secondary())
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

    fn chip(&self, id: String, label: String, active: bool) -> gpui_kit::Stateful<gpui_kit::Div> {
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
            .font_weight(gpui_kit::FontWeight::SEMIBOLD)
            .when(active, |el| el.bg(theme::foreground()).text_color(theme::background()))
            .when(!active, |el| el.bg(theme::default()).text_color(theme::foreground()).hover(|s| s.bg(theme::segment())))
            .child(label)
    }

    /// Watchlist, Favorite, rating, Hide and Add to Collection.
    pub fn title_actions(&self, key: &TitleKey, window: &Window, cx: &mut Context<Self>) -> impl IntoElement {
        let encoded = key.encode();
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
                this.reload_catalog(cx);
                cx.notify();
            })));
        }
        let in_collections = self.personal.collections.iter().filter(|c| c.titles.contains(key)).count();
        let picker_key = key.clone();
        row = row.child(self.rating_stars(key, cx)).child(
            self.chip(
                format!("collections-{encoded}"),
                if in_collections > 0 { format!("In {in_collections} collection{}", if in_collections == 1 { "" } else { "s" }) } else { "Add to Collection".into() },
                in_collections > 0 || self.collection_picker,
            )
            .on_click(cx.listener(move |this, _, window, cx| {
                this.collection_picker = !this.collection_picker;
                this.collection_target = Some(picker_key.clone());
                if this.collection_picker {
                    window.focus(&this.collection_focus.clone(), cx);
                }
                cx.notify();
            })),
        );
        let mut column = div().flex().flex_col().gap(px(10.)).child(row);
        if self.collection_picker {
            let mut picker = crate::ui::menu::panel(crate::ui::menu::MenuTone::App)
                .id("collection-picker")
                .overflow_y_scroll()
                .w(px(288.));
            for collection in &self.personal.collections {
                let id = collection.id;
                let key = key.clone();
                let member = collection.titles.contains(&key);
                picker = picker.child(
                    crate::ui::menu::MenuRow::collection(format!("pick-{id}"), collection.name.clone(), member).on_click(cx.listener(
                        move |this, _, _, cx| {
                            this.catalog.toggle_in_collection(id, &key);
                            this.reload_catalog(cx);
                            cx.notify();
                        },
                    )),
                );
            }
            let draft = self.collection_draft.clone();
            picker = picker.child(
                div().px(px(4.)).pt(px(4.)).pb(px(2.)).child(self.text_field(
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

    fn rating_stars(&self, key: &TitleKey, cx: &mut Context<Self>) -> impl IntoElement {
        let encoded = key.encode();
        let rating = self.personal.rating(key);
        div().flex().items_center().gap(px(4.)).children((1..=5u8).map(|star| {
            let key = key.clone();
            div()
                .id(SharedString::from(format!("star-{star}-{encoded}")))
                .px(px(6.))
                .rounded(px(6.))
                .cursor_pointer()
                .text_size(px(18.))
                .text_color(if star <= rating { theme::foreground() } else { theme::muted() })
                .hover(|s| s.bg(theme::default()).text_color(theme::foreground()))
                .on_click(cx.listener(move |this, _, _, cx| {
                    this.catalog.set_rating(&key, star);
                    this.reload_catalog(cx);
                    cx.notify();
                }))
                .child("★")
        }))
    }

    pub fn render_rating_dialog(&self, cx: &mut Context<Self>) -> Option<crate::ui::controls::DialogParts> {
        let key = self.rating_target.as_ref()?;
        Some(crate::ui::controls::dialog(
            "Rate title",
            self.rating_stars(key, cx),
            self.button("rating-done", "Done", true).on_click(cx.listener(|this, _, _, cx| {
                this.rating_target = None;
                cx.notify();
            })),
        ))
    }

    pub fn render_collection_dialog(&self, window: &Window, cx: &mut Context<Self>) -> Option<crate::ui::controls::DialogParts> {
        let key = self.collection_target.as_ref().filter(|_| self.collection_picker)?;
        let items = self.personal.collections.iter().map(|collection| {
            let id = collection.id;
            let key = key.clone();
            crate::ui::menu::MenuRow::collection(format!("collection-choice-{id}"), collection.name.clone(), collection.titles.contains(&key))
                .on_click(cx.listener(move |this, _, _, cx| {
                    this.catalog.toggle_in_collection(id, &key);
                    this.reload_catalog(cx);
                    cx.notify();
                }))
        });
        let body = div().flex().flex_col().gap(px(10.))
            .when(!self.personal.collections.is_empty(), |el| {
                el.child(div().id("collection-choices").max_h(px(156.)).overflow_y_scroll()
                    .flex().flex_col().gap(px(crate::ui::menu::ITEM_GAP)).children(items))
            })
            .child(self.text_field("collection-dialog-name", Field::Collection, &self.collection_focus,
                &self.collection_draft, "New collection name, then Return", window, cx));
        Some(crate::ui::controls::dialog("Add to collection", body,
            self.button("collection-done", "Done", true).on_click(cx.listener(|this, _, window, cx| {
                this.collection_picker = false;
                this.collection_target = None;
                this.collection_draft.clear();
                window.focus(&this.focus_handle(), cx);
                cx.notify();
            }))))
    }

    pub fn render_movie(&self, path: &PathBuf, window: &Window, cx: &mut Context<Self>) -> gpui_kit::AnyElement {
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
                    .child(div().text_size(px(29.)).font_weight(gpui_kit::FontWeight::BOLD).text_color(theme::foreground()).child(movie.title.clone()))
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
                                this.reload_catalog(cx);
                                cx.notify();
                            }))),
                    )
                    .child(self.title_actions(&key, window, cx))
                    .child(div().pt(px(6.)).text_size(px(10.)).text_color(theme::muted()).child(path.display().to_string())),
            )
            .into_any_element()
    }

    pub fn render_search(&self, window: &Window, cx: &mut Context<Self>) -> gpui_kit::AnyElement {
        let query = self.search_query.trim().to_string();
        let field = self.text_field("search-page", Field::Search, &self.search_focus, &self.search_query, "Search your films and shows…", window, cx);
        let mut page = div().flex().flex_col().gap(px(28.)).child(crate::ui::controls::search(field));
        if query.is_empty() {
            let mut resuming: Vec<&Item> = self.items.iter().filter(|i| !i.missing && i.progress.is_some_and(|p| p.resumable())).collect();
            resuming.sort_by_key(|i| std::cmp::Reverse(i.progress.map(|p| p.updated).unwrap_or(0)));
            if !resuming.is_empty() {
                let cards: Vec<gpui_kit::AnyElement> = resuming.iter().take(12).map(|i| self.continue_card(i, cx).into_any_element()).collect();
                page = page.child(self.shell_section("Jump back in", None, div().id("row-jump").flex().gap(px(20.)).overflow_x_scroll().children(cards)));
            }
            let mut all: Vec<TitleView> = self.visible_shows().iter().map(TitleView::from_show).chain(self.visible_movies().iter().map(TitleView::from_movie)).collect();
            all.sort_by_key(|t| std::cmp::Reverse(t.added_at));
            all.truncate(8);
            if !all.is_empty() {
                page = page.child(self.shell_section("Recently added", Some(self.see_all_link("search-see-all", Screen::Library, cx)), self.title_grid("search-recent", all, cx)));
            }
            return page.into_any_element();
        }
        // Genre and cast matches from TMDB metadata, like the web search.
        let meta_hit = |key: &TitleKey| {
            self.metas.get(key).is_some_and(|m| {
                let mut hay = vec![m.name.as_str()];
                hay.extend(m.genres.iter().map(String::as_str));
                hay.extend(m.cast.iter().map(|c| c.name.as_str()));
                hay.iter().any(|h| matches(&query, &[h]))
            })
        };
        let movies: Vec<TitleView> = self
            .visible_movies()
            .iter()
            .filter(|m| matches(&query, &[&m.title, &m.path.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_default()]) || meta_hit(&TitleKey::Movie(m.path.clone())))
            .map(TitleView::from_movie)
            .collect();
        let shows = self.visible_shows();
        let show_hits: Vec<TitleView> = shows
            .iter()
            .filter(|s| matches(&query, &[&s.title]) || meta_hit(&TitleKey::Show(s.key.clone())))
            .map(TitleView::from_show)
            .collect();
        let episodes: Vec<Item> = shows
            .iter()
            .flat_map(|s| s.episodes().cloned().collect::<Vec<_>>())
            .filter(|e| {
                let file = e.path.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_default();
                let tmdb_name = self.episode_metas.get(&e.path).and_then(|m| m.name.clone()).unwrap_or_default();
                matches(&query, &[e.episode_title.as_deref().unwrap_or_default(), &tmdb_name, &file]) && !matches(&query, &[&e.title])
            })
            .take(40)
            .collect();
        if movies.is_empty() && show_hits.is_empty() && episodes.is_empty() {
            return page.child(crate::shell_ui::empty_state(Icon::Search, "No matches", &format!("Nothing in your library matches “{query}”. Try a title, genre or cast name."), None)).into_any_element();
        }
        if !show_hits.is_empty() {
            page = page.child(section_title("TV Shows")).child(self.title_grid("search-show", show_hits, cx));
        }
        if !movies.is_empty() {
            page = page.child(section_title("Movies")).child(self.title_grid("search-movie", movies, cx));
        }
        if !episodes.is_empty() {
            let w = self.tile_width();
            let rows: Vec<_> = episodes
                .into_iter()
                .map(|e| {
                    let path = e.path.clone();
                    self.episode_tile(SharedString::from(format!("search-ep-{}", e.id)), &e, w, None, None, cx, move |this, window, cx| this.play_item(path.clone(), window, cx)).into_any_element()
                })
                .collect();
            page = page.child(section_title("Episodes")).child(div().flex().flex_wrap().gap_x(px(20.)).gap_y(px(28.)).children(rows));
        }
        page.into_any_element()
    }

    pub fn render_mark_list(&self, mark: Mark, title: &str, empty: &str, cx: &mut Context<Self>) -> gpui_kit::AnyElement {
        let mut keys = self.personal.marked(mark);
        keys.sort_by_key(|k| k.encode());
        let titles: Vec<TitleView> = keys.iter().filter_map(|k| self.title_view(k)).collect();
        let none = titles.is_empty();
        div()
            .flex()
            .flex_col()
            .gap(px(14.))
            .when(none, |el| el.child(crate::shell_ui::empty_state(match mark { Mark::Watchlist => Icon::Bookmark, Mark::Favorite => Icon::Heart, _ => Icon::EyeOff }, &format!("No {} yet", title.to_lowercase()), empty, None)))
            .child(self.title_grid(&format!("list-{title}"), titles, cx))
            .into_any_element()
    }

    /// Creates a collection named by the draft (adding the title being
    /// collected, if any) and clears the draft.
    pub fn create_collection_from_draft(&mut self, cx: &mut Context<Self>) {
        let name = self.collection_draft.trim().to_string();
        if name.is_empty() {
            return;
        }
        if let Some(id) = self.catalog.create_collection(&name) {
            if let Some(key) = self.collection_target.clone() {
                self.catalog.toggle_in_collection(id, &key);
            }
            self.collection_draft.clear();
            self.reload_catalog(cx);
        }
    }

    /// New collection: a name field in a modal; Create or Return saves.
    pub fn render_new_collection_dialog(&self, window: &Window, cx: &mut Context<Self>) -> Option<crate::ui::controls::DialogParts> {
        use crate::ui::button::Button;
        if !self.new_collection_open {
            return None;
        }
        let body = div()
            .flex()
            .flex_col()
            .gap(px(8.))
            .child(div().text_size(px(13.)).text_color(theme::muted()).child("Group movies and shows your way. Add titles from their page."))
            .child(
                self.text_field("collection-create", Field::Collection, &self.collection_focus, &self.collection_draft, "Name, like Weekend picks", window, cx)
                    .h(px(38.))
                    .px(px(14.))
                    .rounded_full()
                    .text_size(px(14.)),
            );
        let footer = div()
            .flex()
            .gap(px(8.))
            .child(Button::new("collection-create-cancel", "Cancel").build().on_click(cx.listener(|this, _, window, cx| {
                this.new_collection_open = false;
                this.collection_draft.clear();
                window.focus(&this.focus_handle(), cx);
                cx.notify();
            })))
            .child(
                Button::new("collection-create-save", "Create")
                    .primary()
                    .build()
                    .disabled(self.collection_draft.trim().is_empty())
                    .on_click(cx.listener(|this, _, window, cx| {
                        this.create_collection_from_draft(cx);
                        this.new_collection_open = false;
                        window.focus(&this.focus_handle(), cx);
                        cx.notify();
                    })),
            );
        Some(crate::ui::controls::dialog("New collection", body, footer))
    }

    pub fn render_collections(&self, _window: &Window, cx: &mut Context<Self>) -> gpui_kit::AnyElement {
        use crate::ui::button::Button;
        let open = |cx: &mut Context<Self>| {
            Button::new("collection-new", "New collection").primary().icon(Icon::Plus).build().on_click(cx.listener(|this, _, window, cx| {
                this.new_collection_open = true;
                window.focus(&this.collection_focus, cx);
                cx.notify();
            }))
        };
        let page = div().flex().flex_col().gap(px(16.));
        if self.personal.collections.is_empty() {
            let new_button = open(cx);
            return page
                .child(crate::shell_ui::empty_state(
                    Icon::FolderHeart,
                    "No collections yet",
                    "Group movies and shows your way. Watchlist, Favorites and Hidden are in the tabs above.",
                    Some(new_button.into_any_element()),
                ))
                .into_any_element();
        }
        let mut page = page.child(div().flex().justify_end().child(open(cx)));
        for collection in &self.personal.collections {
            let id = collection.id;
            let titles: Vec<TitleView> = collection.titles.iter().filter_map(|k| self.title_view(k)).collect();
            let count = match titles.len() {
                1 => "1 title".to_string(),
                n => format!("{n} titles"),
            };
            page = page.child(
                crate::ui::surface::card()
                    .p(px(16.))
                    .flex()
                    .flex_col()
                    .gap(px(14.))
                    .child(
                        div()
                            .flex()
                            .items_center()
                            .gap(px(12.))
                            .child(
                                div()
                                    .size(px(36.))
                                    .flex_none()
                                    .rounded(px(10.))
                                    .bg(theme::surface_secondary())
                                    .flex()
                                    .items_center()
                                    .justify_center()
                                    .child(icon(Icon::FolderHeart, 18., theme::muted())),
                            )
                            .child(
                                div()
                                    .flex_1()
                                    .min_w_0()
                                    .flex()
                                    .flex_col()
                                    .child(div().text_size(px(15.)).font_weight(gpui_kit::FontWeight::BOLD).text_color(theme::foreground()).truncate().child(collection.name.clone()))
                                    .child(div().text_size(px(12.)).text_color(theme::muted()).child(count)),
                            )
                            .child(
                                Button::icon_only(format!("collection-delete-{id}"), Icon::Trash).danger_hover().small().build().on_click(cx.listener(move |this, _, _, cx| {
                                    this.catalog.delete_collection(id);
                                    this.reload_catalog(cx);
                                    cx.notify();
                                })),
                            ),
                    )
                    .when(titles.is_empty(), |el| {
                        el.child(div().text_size(px(12.)).text_color(theme::muted()).child("Empty. Use Add to collection on a title page."))
                    })
                    .when(!titles.is_empty(), |el| el.child(self.title_grid(&format!("collection-{id}"), titles, cx))),
            );
        }
        page.into_any_element()
    }

    pub fn render_history(&self, cx: &mut Context<Self>) -> gpui_kit::AnyElement {
        let count = self.personal.history.len();
        let mut page = div().flex().flex_col().gap(px(18.));
        if count == 0 {
            return page
                .child(crate::shell_ui::empty_state(Icon::Clock, "Nothing watched yet", "Finish a movie or an episode and it appears here, newest first, so you can rewatch it in a click.", None))
                .into_any_element();
        }
        let now = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_secs() as i64).unwrap_or(0);
        let group_of = |at: i64| match (now - at) / 86400 {
            0 => "Today",
            1 => "Yesterday",
            2..7 => "This week",
            7..31 => "This month",
            _ => "Earlier",
        };
        let mut current: Option<&str> = None;
        let mut group = div().flex().flex_wrap().gap_x(px(20.)).gap_y(px(28.));
        let mut groups: Vec<gpui_kit::AnyElement> = Vec::new();
        let flush = |label: &str, body: gpui_kit::Div| {
            div()
                .flex()
                .flex_col()
                .gap(px(10.))
                .child(div().text_size(px(13.)).font_weight(gpui_kit::FontWeight::SEMIBOLD).text_color(theme::muted()).child(label.to_string()))
                .child(body)
                .into_any_element()
        };
        for entry in &self.personal.history {
            let label = group_of(entry.watched_at);
            if current != Some(label) {
                if let Some(prev) = current {
                    groups.push(flush(prev, std::mem::replace(&mut group, div().flex().flex_wrap().gap_x(px(20.)).gap_y(px(28.)))));
                }
                current = Some(label);
            }
            let id = entry.id;
            let path = entry.path.clone();
            let ago = now - entry.watched_at;
            let when = match ago {
                ..60 => "Just now".to_string(),
                60..3600 => format!("{} min ago", ago / 60),
                3600..86400 => format!("{} h ago", ago / 3600),
                86400..172800 => "Yesterday".to_string(),
                _ => format!("{} days ago", ago / 86400),
            };
            let w = self.tile_width();
            let item = self.items.iter().find(|i| i.path == entry.path).cloned().unwrap_or_else(|| crate::catalog::Item { path: entry.path.clone(), title: entry.title.clone(), ..Default::default() });
            let remove = div()
                .id(SharedString::from(format!("history-remove-{id}")))
                .size(px(30.))
                .flex()
                .items_center()
                .justify_center()
                .rounded_full()
                .bg(gpui_kit::hsla(0., 0., 0., 0.6))
                .hover(|s| s.bg(theme::danger()))
                .on_click(cx.listener(move |this, _, _, cx| {
                    cx.stop_propagation();
                    this.catalog.remove_history(id);
                    this.reload_catalog(cx);
                    cx.notify();
                }))
                .child(icon(Icon::Trash, 14., gpui_kit::hsla(0., 0., 1., 1.)))
                .into_any_element();
            group = group.child(self.episode_tile(SharedString::from(format!("history-{id}")), &item, w, Some(when), Some(remove), cx, move |this, window, cx| this.open_at(&path, Some(0.0), window, cx)));
        }
        if let Some(label) = current {
            groups.push(flush(label, group));
        }
        page = page.children(groups);
        page.into_any_element()
    }
}
