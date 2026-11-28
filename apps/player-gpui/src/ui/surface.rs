//! Cards, rows, badges and text styles for settings-like pages.
//!
//! Anatomy (shadcn "Card" + "Item"):
//!
//! ```text
//! card()
//! ├─ card_header(icon, title, description, trailing)
//! ├─ row(label, description, control)      ← separated by hairlines
//! └─ row(...)
//! ```
//!
//! Use `card().child(card_header(..)).children(rows(vec![...]))` for a settings
//! group. Use `card().p(px(PAD))` for free-form content.

use gpui_kit::{div, prelude::*, px, AnyElement, Div, FontWeight, Hsla, SharedString};

use crate::{
    theme,
    ui::icon::{icon, Icon},
};

/// Inner padding of cards and rows.
pub const PAD: f32 = 18.;
/// Vertical gap between cards on a page.
pub const STACK: f32 = 14.;

pub fn alpha(color: Hsla, a: f32) -> Hsla {
    Hsla { a, ..color }
}

// MARK: Text

/// Page heading inside settings-like pages (smaller than the browse `h1`).
pub fn page_title(text: impl Into<SharedString>) -> Div {
    div().text_size(px(24.)).line_height(px(30.)).font_weight(FontWeight::BOLD).text_color(theme::foreground()).child(text.into())
}

pub fn title(text: impl Into<SharedString>) -> Div {
    div().text_size(px(14.)).font_weight(FontWeight::SEMIBOLD).text_color(theme::foreground()).child(text.into())
}

pub fn body(text: impl Into<SharedString>) -> Div {
    div().text_size(px(13.)).line_height(px(19.)).text_color(theme::muted()).child(text.into())
}

pub fn caption(text: impl Into<SharedString>) -> Div {
    div().text_size(px(12.)).line_height(px(17.)).text_color(theme::muted()).child(text.into())
}

/// Small uppercase-free group label above a list (sidebar groups, form labels).
pub fn label(text: impl Into<SharedString>) -> Div {
    div().text_size(px(12.)).font_weight(FontWeight::SEMIBOLD).text_color(theme::muted()).child(text.into())
}

// MARK: Card

/// The surface every settings group sits on.
pub fn card() -> Div {
    div().rounded(px(theme::RADIUS_XL)).bg(theme::surface()).border_1().border_color(theme::border()).overflow_hidden()
}

/// A 32px rounded square holding an icon; leads card headers and list rows.
pub fn icon_tile(name: Icon, size: f32) -> Div {
    div()
        .flex_none()
        .size(px(size))
        .rounded(px(theme::RADIUS))
        .bg(theme::surface_secondary())
        .flex()
        .items_center()
        .justify_center()
        .child(icon(name, (size * 0.5).round(), theme::muted()))
}

/// Icon, title and optional description on the left; `trailing` on the right.
pub fn card_header(lead: Option<Icon>, heading: impl Into<SharedString>, description: Option<SharedString>, trailing: Option<AnyElement>) -> Div {
    div()
        .px(px(PAD))
        .py(px(14.))
        .flex()
        .items_center()
        .gap(px(12.))
        .when_some(lead, |el, name| el.child(icon_tile(name, 32.)))
        .child(div().flex_1().min_w_0().flex().flex_col().gap(px(2.)).child(title(heading)).when_some(description, |el, d| el.child(body(d))))
        // The trailing slot never shrinks: long descriptions wrap instead of
        // squeezing the action (the Reset button used to be clipped).
        .when_some(trailing, |el, trailing| el.child(div().flex_none().flex().items_center().gap(px(8.)).child(trailing)))
}

/// One row: label (and optional description) left, control right.
pub fn row(heading: impl Into<SharedString>, description: Option<SharedString>, control: impl IntoElement) -> Div {
    div()
        .flex()
        .items_center()
        .justify_between()
        .gap(px(20.))
        .child(
            div()
                .flex_1()
                .min_w_0()
                .flex()
                .flex_col()
                .gap(px(2.))
                .child(div().text_size(px(13.)).font_weight(FontWeight::MEDIUM).text_color(theme::foreground()).child(heading.into()))
                .when_some(description, |el, d| el.child(caption(d))),
        )
        .child(div().flex_none().child(control))
}

/// Wrap rows with card padding and hairlines between them (and above the first).
pub fn rows(items: Vec<AnyElement>) -> Vec<AnyElement> {
    items.into_iter().map(|item| div().px(px(PAD)).py(px(12.)).border_t_1().border_color(theme::separator()).child(item).into_any_element()).collect()
}

// MARK: Badge

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Tone {
    Neutral,
    Success,
    Warning,
    Danger,
    Accent,
}

impl Tone {
    pub fn color(self) -> Hsla {
        match self {
            Tone::Neutral => theme::muted(),
            Tone::Success => theme::success(),
            Tone::Warning => theme::warning(),
            Tone::Danger => theme::danger(),
            Tone::Accent => theme::accent(),
        }
    }
}

/// A small status pill: "Connected", "Matched", "Auto-refresh on".
pub fn badge(text: impl Into<SharedString>, tone: Tone) -> Div {
    use gpui_kit::component::{tag::Tag, Sizable as _};
    // Kit `Tag` with Plexy's tinted-fill look: tone color on a 12% wash, no border.
    let color = tone.color();
    let fill = if tone == Tone::Neutral { theme::default() } else { alpha(color, 0.12) };
    div().flex_none().child(
        Tag::custom(fill, color, alpha(color, 0.))
            .small()
            .rounded_full()
            .font_weight(FontWeight::SEMIBOLD)
            .child(text.into()),
    )
}

/// A stat tile: big number over a caption.
pub fn stat(value: impl Into<SharedString>, caption_text: impl Into<SharedString>) -> Div {
    div()
        .flex_1()
        .min_w(px(120.))
        .px(px(14.))
        .py(px(12.))
        .rounded(px(theme::RADIUS_LG))
        .bg(theme::surface_secondary())
        .flex()
        .flex_col()
        .gap(px(2.))
        .child(div().text_size(px(18.)).font_weight(FontWeight::BOLD).text_color(theme::foreground()).child(value.into()))
        .child(caption(caption_text))
}
