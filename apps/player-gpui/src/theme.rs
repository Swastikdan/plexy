//! Plexy's HeroUI v3 dark theme, as sRGB tokens for GPUI.
//!
//! Values are HeroUI 3.2.7 `themes/default/variables.css` (`.dark` block),
//! converted from OKLCH. Names follow the CSS variables so screens read the
//! same as the web app (`--surface` → `theme::SURFACE`). Only the dark theme
//! exists for now; other Plexy themes can become further token sets.

#![allow(dead_code)]

use gpui::{rgb, rgba, Hsla};

macro_rules! token {
    ($($name:ident = $hex:expr;)*) => {
        $(pub fn $name() -> Hsla { rgb($hex).into() })*
    };
}

token! {
    background = 0x060607;
    foreground = 0xfcfcfc;
    surface = 0x18181b;
    surface_secondary = 0x232325;
    surface_tertiary = 0x262728;
    overlay = 0x18181b;
    muted = 0x9f9fa9;
    default = 0x27272a;
    accent = 0x0485f7;
    accent_foreground = 0xfcfcfc;
    success = 0x17c964;
    warning = 0xf7b750;
    danger = 0xdb3b3e;
    segment = 0x46464c;
    border = 0x28282c;
    separator = 0x212124;
}

/// `--default` at 50%: soft buttons and hovered rows.
pub fn default_soft() -> Hsla {
    rgba(0x27272a80).into()
}

/// HeroUI `--radius` (0.5rem) and its multiples.
pub const RADIUS: f32 = 8.0;
pub const RADIUS_LG: f32 = 12.0;
pub const RADIUS_XL: f32 = 16.0;
