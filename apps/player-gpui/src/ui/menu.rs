//! Canonical menu panel and rows.
//!
//! One geometry for shell dropdowns and player menus. The *tone* changes the
//! palette (app follows light/dark; media stays dark), never the measurements.
//! Call sites own the open state and attach click handlers to the returned
//! rows.

use gpui::{div, prelude::*, px, rgba, App, ClickEvent, Div, Hsla, SharedString, Stateful, Window};

use crate::theme;
use crate::ui::icon::{icon, Icon};

/// Panel and row measurements from `docs/UI_KIT.md` §6.1.
pub const PANEL_PADDING: f32 = 6.;
pub const PANEL_RADIUS: f32 = 12.;
pub const ROW_HEIGHT: f32 = 36.;
pub const ROW_HEIGHT_TWO_LINE: f32 = 48.;
pub const ROW_HEIGHT_NAVIGATION: f32 = 40.;
pub const ROW_RADIUS: f32 = 8.;
pub const ROW_PADDING_X: f32 = 10.;
pub const ROW_GAP: f32 = 10.;
pub const ITEM_GAP: f32 = 4.;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum MenuTone {
    /// App surfaces: light/dark theme tokens.
    App,
    /// Player menus: always dark, because the player stays dark.
    Media,
}

impl MenuTone {
    pub fn panel_bg(self) -> Hsla {
        match self {
            MenuTone::App => theme::overlay(),
            MenuTone::Media => rgba(0x18181bf5).into(),
        }
    }

    pub fn border(self) -> Hsla {
        match self {
            MenuTone::App => theme::border(),
            MenuTone::Media => snow(0.1),
        }
    }

    pub fn text(self) -> Hsla {
        match self {
            MenuTone::App => theme::foreground(),
            MenuTone::Media => snow(0.96),
        }
    }

    pub fn muted(self) -> Hsla {
        match self {
            MenuTone::App => theme::muted(),
            MenuTone::Media => snow(0.55),
        }
    }

    pub fn hover(self) -> Hsla {
        match self {
            MenuTone::App => theme::default(),
            MenuTone::Media => snow(0.1),
        }
    }

    pub fn divider(self) -> Hsla {
        match self {
            MenuTone::App => theme::separator(),
            MenuTone::Media => snow(0.14),
        }
    }

    pub fn selected(self) -> Hsla {
        match self {
            MenuTone::App => theme::segment(),
            MenuTone::Media => snow(0.18),
        }
    }


}

fn snow(a: f32) -> Hsla {
    gpui::hsla(0., 0., 1., a)
}

/// The panel every menu lives in. Add a width/position/max-height as needed.
pub fn panel(tone: MenuTone) -> Div {
    div()
        .p(px(PANEL_PADDING))
        .rounded(px(PANEL_RADIUS))
        .bg(tone.panel_bg())
        .border_1()
        .border_color(tone.border())
        .shadow_lg()
        .max_h(px(340.))
        .flex()
        .flex_col()
        .gap(px(ITEM_GAP))
}

pub fn select_trigger(
    id: impl Into<SharedString>,
    label: impl Into<SharedString>,
    open: bool,
) -> Stateful<Div> {
    div()
        .id(gpui::ElementId::Name(id.into()))
        .relative()
        .h(px(40.))
        .px(px(14.))
        .flex()
        .items_center()
        .justify_between()
        .gap(px(10.))
        .rounded(px(theme::RADIUS_LG))
        .cursor_pointer()
        .bg(theme::surface_secondary())
        .border_1()
        .border_color(if open { theme::foreground() } else { theme::border() })
        .hover(|style| style.bg(theme::default()))
        .text_size(px(14.))
        .text_color(theme::foreground())
        .child(div().min_w_0().truncate().child(label.into()))
        .child(div().flex_none().child(icon(Icon::ChevronDown, 16., theme::foreground())))
}

/// A menu positioned below its trigger or at a context-click point.
pub fn popup(
    items: Vec<gpui::AnyElement>,
    width: f32,
    position: Option<gpui::Point<gpui::Pixels>>,
) -> impl IntoElement {
    gpui::deferred(Popup { items: Some(items), width: px(width), position }).with_priority(2)
}

struct Popup {
    items: Option<Vec<gpui::AnyElement>>,
    width: gpui::Pixels,
    position: Option<gpui::Point<gpui::Pixels>>,
}

impl IntoElement for Popup {
    type Element = Self;

    fn into_element(self) -> Self {
        self
    }
}

impl gpui::Element for Popup {
    type RequestLayoutState = ();
    type PrepaintState = gpui::AnyElement;

    fn id(&self) -> Option<gpui::ElementId> { None }
    fn source_location(&self) -> Option<&'static std::panic::Location<'static>> { None }

    fn request_layout(
        &mut self,
        _: Option<&gpui::GlobalElementId>,
        _: Option<&gpui::InspectorElementId>,
        window: &mut Window,
        cx: &mut App,
    ) -> (gpui::LayoutId, ()) {
        // Fill the trigger's bounds without affecting the surrounding layout.
        let style = gpui::Style {
            position: gpui::Position::Absolute,
            inset: gpui::Edges::all(px(0.).into()),
            ..Default::default()
        };
        (window.request_layout(style, [], cx), ())
    }

    fn prepaint(
        &mut self,
        _: Option<&gpui::GlobalElementId>,
        _: Option<&gpui::InspectorElementId>,
        bounds: gpui::Bounds<gpui::Pixels>,
        _: &mut (),
        window: &mut Window,
        cx: &mut App,
    ) -> gpui::AnyElement {
        let viewport = window.viewport_size();
        let edge = px(8.);
        let gap = px(6.);
        let (x, top, bottom) = match self.position {
            Some(point) => (point.x, point.y, point.y),
            None => (bounds.left(), bounds.top() - gap, bounds.bottom() + gap),
        };
        let items = self.items.take().expect("popup prepaint");
        let ideal = px(items.len() as f32 * ROW_HEIGHT
            + items.len().saturating_sub(1) as f32 * ITEM_GAP + 2. * (PANEL_PADDING + 1.)).min(px(340.));
        let below = viewport.height - bottom - edge;
        let above = top - edge;
        let flip = below < ideal && above > below;
        let max_height = ideal.min(if flip { above } else { below }).max(px(0.));
        let width = self.width.min(viewport.width - edge * 2.);
        let x = x.min(viewport.width - width - edge).max(edge);
        let mut menu = panel(MenuTone::App).id("popup").occlude()
            .w(width).max_h(max_height).overflow_y_scroll().children(items).into_any_element();
        let size = menu.layout_as_root(
            gpui::size(gpui::AvailableSpace::Definite(width), gpui::AvailableSpace::MinContent),
            window,
            cx,
        );
        let y = if flip { top - size.height } else { bottom };
        menu.prepaint_at(gpui::point(x, y), window, cx);
        menu
    }

    fn paint(
        &mut self,
        _: Option<&gpui::GlobalElementId>,
        _: Option<&gpui::InspectorElementId>,
        _: gpui::Bounds<gpui::Pixels>,
        _: &mut (),
        menu: &mut gpui::AnyElement,
        window: &mut Window,
        cx: &mut App,
    ) {
        menu.paint(window, cx);
    }
}

/// A full-width separator between groups of rows.
pub fn divider(tone: MenuTone) -> Div {
    div().mx(px(6.)).my(px(4.)).h(px(1.)).bg(tone.divider())
}

type ClickHandler = Box<dyn Fn(&ClickEvent, &mut Window, &mut App) + 'static>;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum RowKind {
    Action,
    Radio,
    Navigation,
    Collection,
}

/// A menu row in the canonical anatomy. The builder keeps call sites from
/// re-declaring padding, type sizes or icon sizes.
pub struct MenuRow {
    id: SharedString,
    tone: MenuTone,
    kind: RowKind,
    label: SharedString,
    detail: Option<SharedString>,
    icon: Option<Icon>,
    value: Option<SharedString>,
    selected: bool,
    danger: bool,
    on_click: Option<ClickHandler>,
}

impl MenuRow {
    fn new(id: impl Into<SharedString>, label: impl Into<SharedString>, kind: RowKind) -> Self {
        Self {
            id: id.into(),
            tone: MenuTone::App,
            kind,
            label: label.into(),
            detail: None,
            icon: None,
            value: None,
            selected: false,
            danger: false,
            on_click: None,
        }
    }

    pub fn action(id: impl Into<SharedString>, label: impl Into<SharedString>) -> Self {
        Self::new(id, label, RowKind::Action)
    }

    pub fn radio(
        id: impl Into<SharedString>,
        label: impl Into<SharedString>,
        selected: bool,
    ) -> Self {
        let mut row = Self::new(id, label, RowKind::Radio);
        row.selected = selected;
        row
    }

    pub fn navigation(
        id: impl Into<SharedString>,
        icon: Icon,
        label: impl Into<SharedString>,
        value: impl Into<SharedString>,
    ) -> Self {
        let mut row = Self::new(id, label, RowKind::Navigation);
        row.icon = Some(icon);
        row.value = Some(value.into());
        row
    }

    pub fn collection(
        id: impl Into<SharedString>,
        label: impl Into<SharedString>,
        selected: bool,
    ) -> Self {
        let mut row = Self::new(id, label, RowKind::Collection);
        row.selected = selected;
        row
    }

    pub fn tone(mut self, tone: MenuTone) -> Self {
        self.tone = tone;
        self
    }

    pub fn detail(mut self, detail: impl Into<SharedString>) -> Self {
        self.detail = Some(detail.into());
        self
    }

    pub fn icon(mut self, icon: Icon) -> Self {
        self.icon = Some(icon);
        self
    }

    pub fn selected(mut self, selected: bool) -> Self {
        self.selected = selected;
        self
    }

    pub fn danger(mut self, danger: bool) -> Self {
        self.danger = danger;
        self
    }

    pub fn on_click(
        mut self,
        handler: impl Fn(&ClickEvent, &mut Window, &mut App) + 'static,
    ) -> Self {
        self.on_click = Some(Box::new(handler));
        self
    }
}

impl IntoElement for MenuRow {
    type Element = Stateful<Div>;

    fn into_element(self) -> Self::Element {
        let tone = self.tone;
        let height = match self.kind {
            RowKind::Navigation => ROW_HEIGHT_NAVIGATION,
            RowKind::Radio if self.detail.is_some() => ROW_HEIGHT_TWO_LINE,
            _ => ROW_HEIGHT,
        };
        let hover = if self.danger {
            with_alpha(theme::danger(), 0.12)
        } else if self.selected {
            tone.selected()
        } else {
            tone.hover()
        };
        let label_color = if self.danger {
            theme::danger()
        } else {
            tone.text()
        };

        let mut row = div()
            .id(gpui::ElementId::Name(self.id.clone()))
            .h(px(height))
            .flex_none()
            .when(self.selected, |row| row.bg(tone.selected()))
            .px(px(ROW_PADDING_X))
            .flex()
            .items_center()
            .gap(px(ROW_GAP))
            .rounded(px(ROW_RADIUS))
            .cursor_pointer()
            .text_size(px(13.))
            .font_weight(gpui::FontWeight::SEMIBOLD)
            .text_color(label_color)
            .hover(move |s| s.bg(hover));

        match self.kind {
            RowKind::Action => {
                if let Some(icon_name) = self.icon {
                    row = row.child(icon(icon_name, 16., tone.muted()));
                }
                row = row.child(
                    div()
                        .flex_1()
                        .min_w_0()
                        .truncate()
                        .child(self.label.clone()),
                );

            }
            RowKind::Radio => {
                row = row.child(
                    div()
                        .flex_1()
                        .min_w_0()
                        .flex()
                        .flex_col()
                        .gap(px(1.))
                        .child(div().truncate().child(self.label.clone()))
                        .when_some(self.detail.clone(), |el, detail| {
                            el.child(
                                div()
                                    .text_size(px(11.))
                                    .font_weight(gpui::FontWeight::NORMAL)
                                    .text_color(tone.muted())
                                    .truncate()
                                    .child(detail),
                            )
                        }),
                );
            }
            RowKind::Navigation => {
                if let Some(icon_name) = self.icon {
                    row = row.child(icon(icon_name, 18., tone.muted()));
                }
                row = row
                    .child(
                        div()
                            .flex_1()
                            .min_w_0()
                            .text_size(px(14.))
                            .truncate()
                            .child(self.label.clone()),
                    )
                    .when_some(self.value.clone(), |el, value| {
                        el.child(
                            div()
                                .text_size(px(12.))
                                .font_weight(gpui::FontWeight::NORMAL)
                                .text_color(tone.muted())
                                .child(value),
                        )
                    })
                    .child(icon(Icon::ChevronRight, 14., tone.muted()));
            }
            RowKind::Collection => {
                row = row.child(
                    div()
                        .flex_1()
                        .min_w_0()
                        .truncate()
                        .child(self.label.clone()),
                );
            }
        }

        if let Some(handler) = self.on_click {
            row = row.on_click(handler);
        }
        row
    }
}

fn with_alpha(color: Hsla, a: f32) -> Hsla {
    Hsla { a, ..color }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn row_heights_match_the_documented_scale() {
        assert_eq!(ROW_HEIGHT, 36.);
        assert_eq!(ROW_HEIGHT_TWO_LINE, 48.);
        assert_eq!(ROW_HEIGHT_NAVIGATION, 40.);
        assert_eq!(PANEL_PADDING, 6.);
        assert_eq!(ROW_PADDING_X, 10.);
    }

    #[test]
    fn media_tone_stays_dark() {
        let media = MenuTone::Media;
        assert_eq!(media.text().l, 1.);
        assert!(media.panel_bg().l < 0.15);
    }
}
