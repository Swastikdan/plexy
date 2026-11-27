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
            MenuTone::Media => rgba(0x0d131cf5).into(),
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

    pub fn radio_border(self) -> Hsla {
        match self {
            MenuTone::App => theme::border(),
            MenuTone::Media => snow(0.72),
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
        .gap(px(2.))
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
                if self.selected {
                    row = row.child(icon(Icon::Check, 15., theme::accent()));
                }
            }
            RowKind::Radio => {
                let accent = theme::accent();
                let border = if self.selected {
                    accent
                } else {
                    tone.radio_border()
                };
                row = row.child(
                    div()
                        .size(px(16.))
                        .flex_none()
                        .rounded_full()
                        .border_2()
                        .border_color(border)
                        .flex()
                        .items_center()
                        .justify_center()
                        .when(self.selected, |el| {
                            el.child(div().size(px(8.)).rounded_full().bg(accent))
                        }),
                );
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
                        .size(px(16.))
                        .flex_none()
                        .flex()
                        .items_center()
                        .justify_center()
                        .when(self.selected, |el| {
                            el.child(icon(Icon::Check, 15., theme::accent()))
                        }),
                );
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
