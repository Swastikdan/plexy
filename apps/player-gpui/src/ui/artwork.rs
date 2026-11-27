//! Artwork framing: clipped art, rounded-corner restoration, hover veil and
//! optional inset ring.
//!
//! GPUI paints images with their own corner radii but clips a parent only
//! rectangularly. The frame therefore owns three layers: a fixed clipped
//! container, the art (which may grow for a hover lift), and a corner mask
//! painted with the actual local backdrop. Keep badges and controls outside
//! the growing layer so only the art moves.

use std::path::PathBuf;

use gpui::{div, prelude::*, px, Div, Hsla, SharedString};

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
                    gpui::hsla(0., 0., 0.06, 1.)
                } else {
                    gpui::hsla(0., 0., 0.08, 1.)
                }
            }
        }
    }
}

/// The fixed, clipped art frame. Add the art layer and the corner restoration
/// as children; put badges/controls on an outer relative wrapper.
pub fn frame(radius: f32) -> Div {
    div().relative().rounded(px(radius)).overflow_hidden()
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
        .bg(theme::surface_secondary())
        .when_some(image, |el, path| {
            el.child(assets::artwork_cover(path, radius))
        })
}

/// Paints `color` over the corners outside a rounded rect. Use this at frame
/// size after a grown image, with the local backdrop color.
pub fn corner_mask(r: f32, color: Hsla) -> impl IntoElement {
    gpui::canvas(
        |_, _, _| (),
        move |bounds, _, window, _| {
            let (o, w, h) = (
                bounds.origin,
                f32::from(bounds.size.width),
                f32::from(bounds.size.height),
            );
            // (corner x, corner y, arc centre x, arc centre y, start angle)
            for (x, y, cx_, cy_, start) in [
                (0., 0., r, r, 0.5f32),
                (w, 0., w - r, r, 0.75),
                (w, h, w - r, h - r, 0.0),
                (0., h, r, h - r, 0.25),
            ] {
                let mut b = gpui::PathBuilder::fill();
                b.move_to(gpui::point(o.x + px(x), o.y + px(y)));
                for step in 0..=8 {
                    let a = (start + 0.25 * step as f32 / 8.) * std::f32::consts::TAU;
                    b.line_to(gpui::point(
                        o.x + px(cx_ + (r + 0.4) * a.cos()),
                        o.y + px(cy_ + (r + 0.4) * a.sin()),
                    ));
                }
                b.close();
                if let Ok(path) = b.build() {
                    window.paint_path(path, color);
                }
            }
        },
    )
    .absolute()
    .inset_0()
}

/// A fixed, clipped frame with a rounded-corner restoration layer at frame
/// size. Callers add the growing art layer and fixed decorations.
pub fn framed(radius: f32, tone: FrameTone, art: impl IntoElement) -> Div {
    frame(radius)
        .child(art)
        .child(corner_mask(radius, tone.backdrop()))
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
        .border_color(gpui::transparent_black())
        .group_hover(group, |s| s.border_color(snow(0.9)))
}

fn with_alpha(color: Hsla, a: f32) -> Hsla {
    Hsla { a, ..color }
}

fn snow(a: f32) -> Hsla {
    gpui::hsla(0., 0., 1., a)
}

fn ink(a: f32) -> Hsla {
    gpui::hsla(0., 0., 0.02, a)
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
        let base = gpui::hsla(0.5, 0.5, 0.5, 1.);
        assert_eq!(with_alpha(base, 0.25).a, 0.25);
        assert_eq!(with_alpha(base, 0.25).h, base.h);
        assert_eq!(snow(0.5).a, 0.5);
        assert_eq!(ink(0.5).a, 0.5);
    }
}
