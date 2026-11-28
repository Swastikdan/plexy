//! Reusable UI building blocks for the Plexy player.
//!
//! This module has no dependency on `PlayerView`, the catalog, playback or any
//! feature screen. Screens pass display data and callbacks in; components
//! return elements. See `docs/UI_KIT.md` and `docs/MOTION.md`.
//!
//! The kit is being introduced incrementally. Icons, menus, artwork frames and
//! motion land first; the rest of the catalog follows in the documented
//! phases.

// The kit intentionally exposes more variants than the current screens use
// while it is adopted incrementally.
#![allow(dead_code)]

pub mod artwork;
pub mod button;
pub mod surface;
pub mod icon;
pub mod menu;
pub mod motion;

/// Common imports for screens composing the kit.
#[allow(unused_imports)]
pub mod prelude {
    pub use super::artwork::FrameTone;
    pub use super::button::{Button, Size, Variant};
    pub use super::surface::{self, Tone};
    pub use super::icon::{icon, Icon};
    pub use super::menu::{MenuRow, MenuTone};
    pub use super::motion::{Easing, MotionSpec, TweenExt};
}

pub mod controls;
