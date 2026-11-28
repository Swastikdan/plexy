//! Plexy's HeroUI v3 dark theme, as sRGB tokens for GPUI.
//!
//! Values are HeroUI 3.2.7 `themes/default/variables.css` (`.dark` block),
//! converted from OKLCH. Names follow the CSS variables so screens read the
//! same as the web app (`--surface` → `theme::SURFACE`). Only the dark theme
//! exists for now; other Plexy themes can become further token sets.

#![allow(dead_code)]

use gpui_kit::{rgb, rgba, Hsla};

use std::sync::atomic::{AtomicBool, Ordering};

static LIGHT: AtomicBool = AtomicBool::new(false);

/// Switches every token to the light (`true`) or dark set. Set once per
/// frame from the `theme` setting (`light`, `dark` or `system`).
/// Returns `true` when the theme changed, so the caller can refresh the Kit
/// theme with [`apply_kit_theme`].
pub fn set_light(light: bool) -> bool {
    LIGHT.swap(light, Ordering::Relaxed) != light
}

pub fn is_light() -> bool {
    LIGHT.load(Ordering::Relaxed)
}

macro_rules! token {
    ($($name:ident = $dark:expr, $light:expr;)*) => {
        $(pub fn $name() -> Hsla { rgb(if is_light() { $light } else { $dark }).into() })*
    };
}

// HeroUI 3 `.dark` / `.light` variables, converted from OKLCH.
token! {
    background = 0x060607, 0xf5f5f6;
    foreground = 0xfcfcfc, 0x18181b;
    surface = 0x18181b, 0xffffff;
    surface_secondary = 0x232325, 0xefeff1;
    surface_tertiary = 0x262728, 0xe7e7ea;
    overlay = 0x18181b, 0xffffff;
    muted = 0x9f9fa9, 0x71717a;
    default = 0x27272a, 0xe6e6e9;
    accent = 0x0485f7, 0x0485f7;
    accent_foreground = 0xfcfcfc, 0xfcfcfc;
    success = 0x17c964, 0x12a150;
    warning = 0xf7b750, 0xd9921f;
    danger = 0xdb3b3e, 0xd92d30;
    accent_hover = 0x0a74d6, 0x0a74d6;
    danger_hover = 0xc23336, 0xbf2629;
    segment = 0x46464c, 0xd4d4d8;
    border = 0x28282c, 0xe2e2e5;
    separator = 0x212124, 0xebebed;
}

/// `--default` at 50%: soft buttons and hovered rows.
pub fn default_soft() -> Hsla {
    rgba(if is_light() { 0xe6e6e980 } else { 0x27272a80 }).into()
}

/// HeroUI `--radius` (0.5rem) and its multiples.
pub const RADIUS: f32 = 8.0;
pub const RADIUS_LG: f32 = 12.0;
pub const RADIUS_XL: f32 = 16.0;

/// Copy Plexy's tokens into the GPUI Kit theme so Kit components (Button,
/// Switch, Select, Input, dialogs) draw in Plexy's colors. Call after
/// `gpui_kit::init` and whenever the light/dark setting changes.
pub fn apply_kit_theme(cx: &mut gpui_kit::App) {
    use gpui_kit::component::theme::{Theme, ThemeMode};
    let light = is_light();
    if Theme::global(cx).mode.is_dark() == light {
        Theme::change(if light { ThemeMode::Light } else { ThemeMode::Dark }, None, cx);
    }
    Theme::update(cx, |t| {
        let soft = default_soft();
        t.font_family = "Archivo".into();
        t.font_size = gpui_kit::px(14.);
        t.radius = gpui_kit::px(RADIUS);
        t.radius_lg = gpui_kit::px(RADIUS_LG);
        t.background = background();
        t.foreground = foreground();
        t.border = border();
        t.input = border();
        t.ring = accent();
        t.caret = accent();
        t.muted = surface_secondary();
        t.muted_foreground = muted();
        t.popover = overlay();
        t.popover_foreground = foreground();
        t.overlay = gpui_kit::hsla(0., 0., 0., 0.55);
        t.accent = soft;
        t.accent_foreground = foreground();
        t.list_hover = soft;
        t.list_active = default();
        t.list_active_border = gpui_kit::hsla(0., 0., 0., 0.);
        t.selection = gpui_kit::Hsla { a: 0.35, ..accent() };
        t.primary = accent();
        t.primary_hover = accent_hover();
        t.primary_active = accent_hover();
        t.primary_foreground = accent_foreground();
        t.secondary = default();
        t.secondary_hover = segment();
        t.secondary_active = segment();
        t.secondary_foreground = foreground();
        t.button_primary = accent();
        t.button_primary_hover = accent_hover();
        t.button_primary_active = accent_hover();
        t.button_primary_foreground = accent_foreground();
        t.button = default();
        t.button_hover = segment();
        t.button_active = segment();
        t.button_foreground = foreground();
        t.button_secondary = default();
        t.button_secondary_hover = segment();
        t.button_secondary_active = segment();
        t.button_secondary_foreground = foreground();
        t.danger = danger();
        t.danger_hover = danger_hover();
        t.danger_active = danger_hover();
        t.danger_foreground = gpui_kit::white();
        t.button_danger = danger();
        t.button_danger_hover = danger_hover();
        t.button_danger_active = danger_hover();
        t.button_danger_foreground = gpui_kit::white();
        t.success = success();
        t.warning = warning();
        t.switch = segment();
        t.switch_thumb = gpui_kit::white();
        t.tab_bar = surface();
        t.tab_bar_segmented = surface();
        t.tab_active = foreground();
        t.tab_active_foreground = background();
        t.tab_foreground = muted();
        t.scrollbar_thumb = segment();
        t.skeleton = surface_secondary();
    });
}
