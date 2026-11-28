//! Artwork framing: clipped art, rounded-corner restoration, hover veil and
//! optional inset ring.
//!
//! GPUI paints images with their own corner radii but clips a parent only
//! rectangularly. The frame therefore owns three layers: a fixed clipped
//! container, the art (which may grow for a hover lift), and a corner mask
//! painted with the actual local backdrop. Keep badges and controls outside
//! the growing layer so only the art moves.

use std::path::PathBuf;

use gpui_kit::{div, prelude::*, px, Div, Hsla, SharedString};

use crate::assets;
use crate::theme;

/// What sits behind a card, used to restore the rounded corners after the
/// image is clipped. Pick the surface the card actually sits on.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum FrameTone {
    Page,
    Surface,
    Media,
}

impl FrameTone {
    pub fn backdrop(self) -> Hsla {
        match self {
            FrameTone::Page => theme::background(),
            FrameTone::Surface => theme::surface(),
            FrameTone::Media => {
                if theme::is_light() {
                    gpui_kit::hsla(0., 0., 0.06, 1.)
                } else {
                    gpui_kit::hsla(0., 0., 0.08, 1.)
                }
            }
        }
    }
}

/// The fixed, clipped art frame. Add the art layer and the corner restoration
/// as children; put badges/controls on an outer relative wrapper.
pub fn frame(radius: f32) -> Div {
    // The placeholder color lives on the frame, which never grows, so its
    // rounded corners stay intact while the art layer scales on hover.
    div().relative().rounded(px(radius)).overflow_hidden().bg(theme::surface_secondary())
}

/// A fixed-size overlay inside a frame: hover wash, veil, gradient, etc.
pub fn overlay(radius: f32) -> Div {
    div().absolute().inset_0().rounded(px(radius))
}

/// Full-bleed artwork for a frame. The frame supplies the clip; this helper
/// only paints the image/placeholder.
pub fn art(image: Option<PathBuf>, radius: f32) -> impl IntoElement {
    div()
        .absolute()
        .inset_0()
        .when_some(image, |el, path| {
            el.child(assets::artwork_cover(path, radius))
        })
}

/// A fixed, clipped frame around a (possibly growing) art layer. The art
/// rounds its own corners at the frame's clip, so no mask is needed.
pub fn framed(radius: f32, tone: FrameTone, art: impl IntoElement) -> Div {
    let _ = tone;
    frame(radius).child(art)
}

/// Theme-aware hover wash. The current visual keeps the name `hover_ring` for
/// compatibility; this helper is what that name actually paints.
pub fn hover_veil(group: SharedString, radius: f32) -> Div {
    let veil = if theme::is_light() {
        ink(0.12)
    } else {
        snow(0.07)
    };
    overlay(radius)
        .bg(veil)
        .opacity(0.)
        .group_hover(group, |s| s.opacity(1.))
}

/// Optional inset ring. Kept separate from the veil so a ring can be added
/// later without scaling with the artwork. Border width is always reserved.
pub fn hover_ring(group: SharedString, radius: f32) -> Div {
    overlay((radius - 1.).max(0.))
        .border_2()
        .border_color(gpui_kit::transparent_black())
        .group_hover(group, |s| s.border_color(snow(0.9)))
}

fn with_alpha(color: Hsla, a: f32) -> Hsla {
    Hsla { a, ..color }
}

fn snow(a: f32) -> Hsla {
    gpui_kit::hsla(0., 0., 1., a)
}

fn ink(a: f32) -> Hsla {
    gpui_kit::hsla(0., 0., 0.02, a)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn frame_tone_uses_current_theme_tokens() {
        assert_eq!(FrameTone::Page.backdrop(), theme::background());
        assert_eq!(FrameTone::Surface.backdrop(), theme::surface());
    }

    #[test]
    fn alpha_helper_preserves_rgb() {
        let base = gpui_kit::hsla(0.5, 0.5, 0.5, 1.);
        assert_eq!(with_alpha(base, 0.25).a, 0.25);
        assert_eq!(with_alpha(base, 0.25).h, base.h);
        assert_eq!(snow(0.5).a, 0.5);
        assert_eq!(ink(0.5).a, 0.5);
    }
}
