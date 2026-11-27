//! Plexy's HeroUI v3 dark theme, as sRGB tokens for GPUI.
//!
//! Values are HeroUI 3.2.7 `themes/default/variables.css` (`.dark` block),
//! converted from OKLCH. Names follow the CSS variables so screens read the
//! same as the web app (`--surface` → `theme::SURFACE`). Only the dark theme
//! exists for now; other Plexy themes can become further token sets.

#![allow(dead_code)]

use gpui::{rgb, rgba, Hsla};

use std::sync::atomic::{AtomicBool, Ordering};

static LIGHT: AtomicBool = AtomicBool::new(false);

/// Switches every token to the light (`true`) or dark set. Set once per
/// frame from the `theme` setting (`light`, `dark` or `system`).
pub fn set_light(light: bool) {
    LIGHT.store(light, Ordering::Relaxed);
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
