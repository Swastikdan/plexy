//! The one button. Every clickable pill or icon square in the app should be a
//! [`Button`]: pick a [`Variant`] for meaning and a [`Size`] for density.
//!
//! ```ignore
//! Button::new("save", "Save").primary().build().on_click(...)
//! Button::new("rescan", "Rescan").icon(Icon::Refresh).build()
//! Button::icon_only("remove", Icon::Trash).ghost().danger_hover().build()
//! ```
//!
//! Variants follow shadcn/ui: `Primary` for the one main action in a view,
//! `Secondary` for everything else, `Outline` on busy surfaces, `Ghost` for
//! toolbars and row actions, `Danger` for destructive confirmation, `Glass`
//! for controls over artwork (hero, player).

use gpui_kit::{div, prelude::*, px, Div, ElementId, FontWeight, Hsla, SharedString, Stateful};

pub use gpui_kit::component::button::Button as KitButton;

use crate::{
    theme,
    ui::icon::{icon, Icon},
};

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub enum Variant {
    Primary,
    #[default]
    Secondary,
    Outline,
    Ghost,
    Danger,
    /// Translucent dark fill with a light border, for use over artwork.
    Glass,
}

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub enum Size {
    /// 28px: row actions, chips beside text.
    Sm,
    /// 32px: the default in settings, toolbars and dialogs.
    #[default]
    Md,
    /// 40px: hero and empty-state calls to action.
    Lg,
}

impl Size {
    pub fn height(self) -> f32 {
        match self {
            Size::Sm => 28.,
            Size::Md => 32.,
            Size::Lg => 40.,
        }
    }
    fn pad(self) -> f32 {
        match self {
            Size::Sm => 10.,
            Size::Md => 14.,
            Size::Lg => 18.,
        }
    }
    fn text(self) -> f32 {
        match self {
            Size::Sm => 12.,
            Size::Md => 13.,
            Size::Lg => 14.,
        }
    }
    fn icon(self) -> f32 {
        match self {
            Size::Sm => 14.,
            Size::Md => 15.,
            Size::Lg => 18.,
        }
    }
}

/// Colors for one variant: (background, hover background, text, border).
fn paint(variant: Variant) -> (Hsla, Hsla, Hsla, Option<Hsla>) {
    let clear = gpui_kit::hsla(0., 0., 0., 0.);
    match variant {
        Variant::Primary => (theme::accent(), theme::accent_hover(), theme::accent_foreground(), None),
        Variant::Secondary => (theme::default(), theme::segment(), theme::foreground(), None),
        Variant::Outline => (clear, theme::default_soft(), theme::foreground(), Some(theme::border())),
        Variant::Ghost => (clear, theme::default(), theme::foreground(), None),
        Variant::Danger => (theme::danger(), theme::danger_hover(), gpui_kit::white(), None),
        Variant::Glass => (
            gpui_kit::hsla(0., 0., 0.02, 0.45),
            gpui_kit::hsla(0., 0., 1., 0.12),
            gpui_kit::hsla(0., 0., 1., 1.),
            Some(gpui_kit::hsla(0., 0., 1., 0.18)),
        ),
    }
}

#[must_use]
pub struct Button {
    id: SharedString,
    label: Option<SharedString>,
    icon: Option<Icon>,
    variant: Variant,
    size: Size,
    danger_hover: bool,
    selected: bool,
}

impl Button {
    pub fn new(id: impl Into<SharedString>, label: impl Into<SharedString>) -> Self {
        Self { id: id.into(), label: Some(label.into()), icon: None, variant: Variant::default(), size: Size::default(), danger_hover: false, selected: false }
    }

    /// A square (or round, for `Glass`) button with only an icon.
    pub fn icon_only(id: impl Into<SharedString>, name: Icon) -> Self {
        Self { id: id.into(), label: None, icon: Some(name), variant: Variant::Ghost, size: Size::default(), danger_hover: false, selected: false }
    }

    pub fn icon(mut self, name: Icon) -> Self {
        self.icon = Some(name);
        self
    }
    pub fn variant(mut self, variant: Variant) -> Self {
        self.variant = variant;
        self
    }
    pub fn primary(self) -> Self {
        self.variant(Variant::Primary)
    }
    pub fn outline(self) -> Self {
        self.variant(Variant::Outline)
    }
    pub fn ghost(self) -> Self {
        self.variant(Variant::Ghost)
    }
    pub fn danger(self) -> Self {
        self.variant(Variant::Danger)
    }
    pub fn glass(self) -> Self {
        self.variant(Variant::Glass)
    }
    pub fn size(mut self, size: Size) -> Self {
        self.size = size;
        self
    }
    pub fn small(self) -> Self {
        self.size(Size::Sm)
    }
    pub fn large(self) -> Self {
        self.size(Size::Lg)
    }
    /// Ghost icon buttons that delete: tint red on hover.
    pub fn danger_hover(mut self) -> Self {
        self.danger_hover = true;
        self
    }
    /// Pressed/on state for toggle-like icon buttons.
    pub fn selected(mut self, selected: bool) -> Self {
        self.selected = selected;
        self
    }

    /// The GPUI Kit button for this preset: Kit focus ring, keyboard
    /// activation (Space/Enter) and theme colors, Plexy's pill shape and
    /// sizes. Chain `.on_click(...)` as on any Kit button.
    ///
    /// `Glass` has no Kit variant; it falls back to [`Self::build_div`].
    pub fn build(self) -> KitButton {
        use gpui_kit::component::{button::{ButtonRounded, ButtonVariants as _}, Sizable as _};
        let icon_only = self.label.is_none();
        let mut button = KitButton::new(ElementId::Name(self.id.clone()));
        button = match self.variant {
            Variant::Primary => button.primary(),
            Variant::Danger => button.danger(),
            Variant::Outline => button.outline(),
            Variant::Ghost => button.ghost(),
            Variant::Secondary | Variant::Glass => button,
        };
        button = match self.size {
            Size::Sm => button.small(),
            Size::Md => button,
            Size::Lg => button.large(),
        };
        if let Some(name) = self.icon {
            button = button.icon(gpui_kit::component::Icon::empty().path(name.path()));
        }
        if let Some(label) = self.label {
            button = button.label(label);
        }
        button
            .rounded(if icon_only { ButtonRounded::Size(px(theme::RADIUS)) } else { ButtonRounded::Size(px(999.)) })
            .toggled(self.selected)
            .when(self.danger_hover, |b| b.accessibility_label("Remove"))
    }

    /// The hand-drawn button: needed for `Glass` (over artwork), which the
    /// Kit has no variant for. Returns `Stateful<Div>` to chain `.on_click`.
    pub fn build_div(self) -> Stateful<Div> {
        let (bg, hover, fg, border) = paint(self.variant);
        // Selected inverts: white-on-dark over artwork, foreground-filled elsewhere.
        let (bg, fg, hover) = match (self.selected, self.variant) {
            (true, Variant::Glass) => (gpui_kit::hsla(0., 0., 1., 0.96), gpui_kit::hsla(0., 0., 0.02, 1.), gpui_kit::hsla(0., 0., 1., 0.82)),
            (true, _) => (theme::foreground(), theme::background(), Hsla { a: 0.85, ..theme::foreground() }),
            _ => (bg, fg, hover),
        };
        let hover = if self.danger_hover { Hsla { a: 0.15, ..theme::danger() } } else { hover };
        let h = self.size.height();
        let icon_size = self.size.icon();
        let icon_color = if self.danger_hover || self.label.is_some() || self.selected { fg } else { theme::muted() };
        let icon_color = if self.variant == Variant::Glass { fg } else { icon_color };
        let base = div()
            .id(ElementId::Name(self.id))
            .flex_none()
            .h(px(h))
            .flex()
            .items_center()
            .justify_center()
            .cursor_pointer()
            .bg(bg)
            .text_color(fg)
            .when_some(border, |el, b| el.border_1().border_color(b))
            .hover(move |s| s.bg(hover))
            .when_some(self.icon, |el, name| el.child(icon(name, icon_size, icon_color)));
        match self.label {
            Some(label) => base
                .px(px(self.size.pad()))
                .gap(px(6.))
                .rounded_full()
                .text_size(px(self.size.text()))
                .font_weight(FontWeight::SEMIBOLD)
                .child(label),
            None => base.w(px(h)).when(self.variant == Variant::Glass, |el| el.rounded_full()).when(self.variant != Variant::Glass, |el| el.rounded(px(theme::RADIUS))),
        }
    }
}
