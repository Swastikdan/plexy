use gpui::{AnyElement, Div, SharedString, Stateful, div, prelude::*, px};

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
        .id(gpui::ElementId::Name(id.into()))
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
                .font_weight(gpui::FontWeight::SEMIBOLD)
        })
        .when(!active, |el| el.hover(|s| s.bg(theme::default_soft())))
        .child(label.into())
}

pub fn search(field: Stateful<Div>) -> Div {
    div()
        .relative()
        .child(
            field
                .h(px(48.))
                .pl(px(46.))
                .pr(px(20.))
                .rounded_full()
                .bg(theme::surface())
                .text_size(px(15.)),
        )
        .child(div().absolute().left(px(18.)).top(px(14.)).child(icon(
            Icon::Search,
            20.,
            theme::muted(),
        )))
}

pub fn dialog(
    title: &'static str,
    body: impl IntoElement,
    footer: impl IntoElement,
) -> Stateful<Div> {
    div()
        .id(title)
        .absolute()
        .inset_0()
        .occlude()
        .bg(gpui::hsla(0., 0., 0., 0.55))
        .flex()
        .items_center()
        .justify_center()
        .p(px(20.))
        .child(
            div()
                .w_full()
                .max_w(px(440.))
                .p(px(22.))
                .rounded(px(theme::RADIUS_XL))
                .border_1()
                .border_color(theme::border())
                .bg(theme::overlay())
                .text_color(theme::foreground())
                .shadow_lg()
                .flex()
                .flex_col()
                .gap(px(16.))
                .child(
                    div()
                        .text_size(px(20.))
                        .font_weight(gpui::FontWeight::BOLD)
                        .child(title),
                )
                .child(body)
                .child(div().flex().justify_end().gap(px(8.)).child(footer)),
        )
}
