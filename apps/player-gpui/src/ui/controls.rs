use gpui_kit::{AnyElement, Div, SharedString, Stateful, TestSupportExt as _, div, prelude::*, px};

use crate::{
    theme,
    ui::icon::{Icon, icon},
};

pub fn tabs(items: impl IntoIterator<Item = AnyElement>) -> Div {
    div().flex().flex_wrap().gap(px(4.)).children(items)
}

pub fn tab(
    id: impl Into<SharedString>,
    label: impl Into<SharedString>,
    active: bool,
) -> Stateful<Div> {
    div()
        .id(gpui_kit::ElementId::Name(id.into()))
        .h(px(38.))
        .px(px(12.))
        .flex()
        .items_center()
        .gap(px(8.))
        .rounded(px(theme::RADIUS_LG))
        .cursor_pointer()
        .text_size(px(13.))
        .text_color(if active {
            theme::foreground()
        } else {
            theme::muted()
        })
        .when(active, |el| {
            el.bg(theme::default())
                .font_weight(gpui_kit::FontWeight::SEMIBOLD)
        })
        .when(!active, |el| el.hover(|s| s.bg(theme::default_soft())))
        .child(label.into())
}

/// The app's one search field: a pill with a leading magnifier. `search` is
/// the page-sized field; `search_compact` the same field for toolbars.
pub fn search(field: Stateful<Div>) -> Div {
    search_sized(field, 48., 20., 15.)
}

pub fn search_compact(field: Stateful<Div>) -> Div {
    search_sized(field, 36., 16., 13.)
}

fn search_sized(field: Stateful<Div>, height: f32, glyph: f32, text: f32) -> Div {
    let inset = (height - glyph) / 2.;
    div()
        .relative()
        .child(
            field
                .h(px(height))
                .pl(px(inset + glyph + 10.))
                .pr(px(inset + 4.))
                .rounded_full()
                .bg(theme::surface())
                .text_size(px(text)),
        )
        .child(div().absolute().left(px(inset + 2.)).top(px(inset)).child(icon(Icon::Search, glyph, theme::muted())))
}

/// A segmented control: options in a pill track, the selected one raised.
/// Each option is `(label, count)`.
pub fn segmented(
    id: &'static str,
    options: impl IntoIterator<Item = (&'static str, Option<usize>)>,
    selected: usize,
    on_select: impl Fn(usize, &mut gpui_kit::Window, &mut gpui_kit::App) + 'static,
) -> Div {
    let on_select = std::rc::Rc::new(on_select);
    div()
        .flex()
        .items_center()
        .gap(px(2.))
        .p(px(3.))
        .rounded_full()
        .bg(theme::surface())
        .children(options.into_iter().enumerate().map(|(index, (label, count))| {
            let active = index == selected;
            let on_select = on_select.clone();
            div()
                .id(gpui_kit::ElementId::NamedInteger(id.into(), index as u64))
                .h(px(30.))
                .px(px(14.))
                .flex()
                .items_center()
                .gap(px(6.))
                .rounded_full()
                .cursor_pointer()
                .text_size(px(13.))
                .font_weight(gpui_kit::FontWeight::SEMIBOLD)
                .text_color(if active { theme::foreground() } else { theme::muted() })
                .when(active, |el| el.bg(theme::default()))
                .when(!active, |el| el.hover(|s| s.text_color(theme::foreground())))
                .child(label)
                .when_some(count, |el, n| {
                    el.child(div().text_size(px(11.)).text_color(theme::muted()).child(n.to_string()))
                })
                .on_click(move |_, window, cx| on_select(index, window, cx))
                .test_support()
        }))
}

/// The parts of a dialog. Screens return these; `PlayerView` shows them in a
/// GPUI Kit `Dialog` (focus trap, Escape, overlay, entrance motion) through
/// [`open_kit_dialog`].
pub struct DialogParts {
    pub title: &'static str,
    pub body: AnyElement,
    pub footer: AnyElement,
}

pub fn dialog(title: &'static str, body: impl IntoElement, footer: impl IntoElement) -> DialogParts {
    DialogParts { title, body: body.into_any_element(), footer: footer.into_any_element() }
}

/// Fill a Kit `Dialog` from [`DialogParts`]. The Kit supplies the focus
/// trap, Escape and overlay; the panel keeps Plexy's modal look (raised
/// overlay surface, large radius, 22 px padding, no close cross: the footer
/// carries Cancel).
pub fn open_kit_dialog(dialog: gpui_kit::component::dialog::Dialog, parts: DialogParts) -> gpui_kit::component::dialog::Dialog {
    dialog
        .close_button(false)
        .centered()
        .w(px(440.))
        .p(px(22.))
        .bg(theme::overlay())
        .rounded(px(theme::RADIUS_XL))
        .shadow_lg()
        .title(div().text_size(px(20.)).font_weight(gpui_kit::FontWeight::BOLD).text_color(theme::foreground()).child(parts.title))
        .child(div().text_color(theme::foreground()).child(parts.body))
        .footer(div().flex().justify_end().gap(px(8.)).child(parts.footer))
}
