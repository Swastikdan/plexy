//! Typed icon library for the Plexy player UI.
//!
//! This module mirrors the SVG files in `apps/player-gpui/assets/icons`, which
//! are extracted from the web app by `tools/extract-icons.ts`. That script is
//! the source of truth for the icon set and is intended to emit this file
//! alongside the assets. When an SVG is added, renamed or removed, update the
//! enum, [`Icon::path`], [`Icon::asset_stem`] and [`Icon::all`] in the same
//! change; the tests below fail if the folder and [`Icon::all`] drift apart.
//!
//! UI code should render through [`icon`] with an [`Icon`] rather than building
//! `icons/{name}.svg` paths itself. The compiler then catches typos, and no
//! path string is allocated per icon per frame.

use gpui_kit::{prelude::*, px, svg, Hsla, Svg};

/// Every icon embedded from `assets/icons`.
///
/// Variants are mechanical PascalCase forms of the asset stems, sorted by
/// variant name. `PlexyLogo` is a brand mark rather than a monochrome mask;
/// prefer an image helper for it when the original colors matter.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash)]
pub enum Icon {
    ArrowLeft,
    ArrowRight,
    ArrowUpDown,
    Audio,
    AudioLines,
    Back,
    Bookmark,
    Captions,
    Chapters,
    Check,
    ChevronDown,
    ChevronLeft,
    ChevronRight,
    Circle,
    CircleCheck,
    Clock,
    Close,
    Cog,
    Drama,
    Ellipsis,
    Eye,
    EyeOff,
    Film,
    Folder,
    FolderHeart,
    FolderPlus,
    Forward,
    Fullscreen,
    FullscreenExit,
    Heart,
    Home,
    Layers,
    Library,
    List,
    Minus,
    Monitor,
    Moon,
    More,
    Mute,
    Palette,
    Pause,
    Pip,
    Play,
    PlayOutline,
    PlexyLogo,
    Plus,
    Refresh,
    Restart,
    Search,
    Seek,
    Server,
    Settings,
    Shield,
    SkipForward,
    Smile,
    Speed,
    Spinner,
    Star,
    Subtitles,
    SubtitlesOn,
    Sun,
    Swords,
    Trash,
    TrendingUp,
    Tv,
    Volume,
    VolumeLow,
    WandSparkles,
}

impl Icon {
    /// Static asset path expected by GPUI, for example `"icons/play.svg"`.
    pub const fn path(self) -> &'static str {
        match self {
            Self::ArrowLeft => "icons/arrow-left.svg",
            Self::ArrowRight => "icons/arrow-right.svg",
            Self::ArrowUpDown => "icons/arrow-up-down.svg",
            Self::Audio => "icons/audio.svg",
            Self::AudioLines => "icons/audio-lines.svg",
            Self::Back => "icons/back.svg",
            Self::Bookmark => "icons/bookmark.svg",
            Self::Captions => "icons/captions.svg",
            Self::Chapters => "icons/chapters.svg",
            Self::Check => "icons/check.svg",
            Self::ChevronDown => "icons/chevron-down.svg",
            Self::ChevronLeft => "icons/chevron-left.svg",
            Self::ChevronRight => "icons/chevron-right.svg",
            Self::Circle => "icons/circle.svg",
            Self::CircleCheck => "icons/circle-check.svg",
            Self::Clock => "icons/clock.svg",
            Self::Close => "icons/close.svg",
            Self::Cog => "icons/cog.svg",
            Self::Drama => "icons/drama.svg",
            Self::Ellipsis => "icons/ellipsis.svg",
            Self::Eye => "icons/eye.svg",
            Self::EyeOff => "icons/eye-off.svg",
            Self::Film => "icons/film.svg",
            Self::Folder => "icons/folder.svg",
            Self::FolderHeart => "icons/folder-heart.svg",
            Self::FolderPlus => "icons/folder-plus.svg",
            Self::Forward => "icons/forward.svg",
            Self::Fullscreen => "icons/fullscreen.svg",
            Self::FullscreenExit => "icons/fullscreen-exit.svg",
            Self::Heart => "icons/heart.svg",
            Self::Home => "icons/home.svg",
            Self::Layers => "icons/layers.svg",
            Self::Library => "icons/library.svg",
            Self::List => "icons/list.svg",
            Self::Minus => "icons/minus.svg",
            Self::Monitor => "icons/monitor.svg",
            Self::Moon => "icons/moon.svg",
            Self::More => "icons/more.svg",
            Self::Mute => "icons/mute.svg",
            Self::Palette => "icons/palette.svg",
            Self::Pause => "icons/pause.svg",
            Self::Pip => "icons/pip.svg",
            Self::Play => "icons/play.svg",
            Self::PlayOutline => "icons/play-outline.svg",
            Self::PlexyLogo => "icons/plexy-logo.svg",
            Self::Plus => "icons/plus.svg",
            Self::Refresh => "icons/refresh.svg",
            Self::Restart => "icons/restart.svg",
            Self::Search => "icons/search.svg",
            Self::Seek => "icons/seek.svg",
            Self::Server => "icons/server.svg",
            Self::Settings => "icons/settings.svg",
            Self::Shield => "icons/shield.svg",
            Self::SkipForward => "icons/skip-forward.svg",
            Self::Smile => "icons/smile.svg",
            Self::Speed => "icons/speed.svg",
            Self::Spinner => "icons/spinner.svg",
            Self::Star => "icons/star.svg",
            Self::Subtitles => "icons/subtitles.svg",
            Self::SubtitlesOn => "icons/subtitles-on.svg",
            Self::Sun => "icons/sun.svg",
            Self::Swords => "icons/swords.svg",
            Self::Trash => "icons/trash.svg",
            Self::TrendingUp => "icons/trending-up.svg",
            Self::Tv => "icons/tv.svg",
            Self::Volume => "icons/volume.svg",
            Self::VolumeLow => "icons/volume-low.svg",
            Self::WandSparkles => "icons/wand-sparkles.svg",
        }
    }

    /// The SVG file stem, for example `"play"` for `"icons/play.svg"`.
    pub const fn asset_stem(self) -> &'static str {
        match self {
            Self::ArrowLeft => "arrow-left",
            Self::ArrowRight => "arrow-right",
            Self::ArrowUpDown => "arrow-up-down",
            Self::Audio => "audio",
            Self::AudioLines => "audio-lines",
            Self::Back => "back",
            Self::Bookmark => "bookmark",
            Self::Captions => "captions",
            Self::Chapters => "chapters",
            Self::Check => "check",
            Self::ChevronDown => "chevron-down",
            Self::ChevronLeft => "chevron-left",
            Self::ChevronRight => "chevron-right",
            Self::Circle => "circle",
            Self::CircleCheck => "circle-check",
            Self::Clock => "clock",
            Self::Close => "close",
            Self::Cog => "cog",
            Self::Drama => "drama",
            Self::Ellipsis => "ellipsis",
            Self::Eye => "eye",
            Self::EyeOff => "eye-off",
            Self::Film => "film",
            Self::Folder => "folder",
            Self::FolderHeart => "folder-heart",
            Self::FolderPlus => "folder-plus",
            Self::Forward => "forward",
            Self::Fullscreen => "fullscreen",
            Self::FullscreenExit => "fullscreen-exit",
            Self::Heart => "heart",
            Self::Home => "home",
            Self::Layers => "layers",
            Self::Library => "library",
            Self::List => "list",
            Self::Minus => "minus",
            Self::Monitor => "monitor",
            Self::Moon => "moon",
            Self::More => "more",
            Self::Mute => "mute",
            Self::Palette => "palette",
            Self::Pause => "pause",
            Self::Pip => "pip",
            Self::Play => "play",
            Self::PlayOutline => "play-outline",
            Self::PlexyLogo => "plexy-logo",
            Self::Plus => "plus",
            Self::Refresh => "refresh",
            Self::Restart => "restart",
            Self::Search => "search",
            Self::Seek => "seek",
            Self::Server => "server",
            Self::Settings => "settings",
            Self::Shield => "shield",
            Self::SkipForward => "skip-forward",
            Self::Smile => "smile",
            Self::Speed => "speed",
            Self::Spinner => "spinner",
            Self::Star => "star",
            Self::Subtitles => "subtitles",
            Self::SubtitlesOn => "subtitles-on",
            Self::Sun => "sun",
            Self::Swords => "swords",
            Self::Trash => "trash",
            Self::TrendingUp => "trending-up",
            Self::Tv => "tv",
            Self::Volume => "volume",
            Self::VolumeLow => "volume-low",
            Self::WandSparkles => "wand-sparkles",
        }
    }

    /// Every icon, in the same order as the enum variants.
    pub const fn all() -> &'static [Icon] {
        &[
            Self::ArrowLeft,
            Self::ArrowRight,
            Self::ArrowUpDown,
            Self::Audio,
            Self::AudioLines,
            Self::Back,
            Self::Bookmark,
            Self::Captions,
            Self::Chapters,
            Self::Check,
            Self::ChevronDown,
            Self::ChevronLeft,
            Self::ChevronRight,
            Self::Circle,
            Self::CircleCheck,
            Self::Clock,
            Self::Close,
            Self::Cog,
            Self::Drama,
            Self::Ellipsis,
            Self::Eye,
            Self::EyeOff,
            Self::Film,
            Self::Folder,
            Self::FolderHeart,
            Self::FolderPlus,
            Self::Forward,
            Self::Fullscreen,
            Self::FullscreenExit,
            Self::Heart,
            Self::Home,
            Self::Layers,
            Self::Library,
            Self::List,
            Self::Minus,
            Self::Monitor,
            Self::Moon,
            Self::More,
            Self::Mute,
            Self::Palette,
            Self::Pause,
            Self::Pip,
            Self::Play,
            Self::PlayOutline,
            Self::PlexyLogo,
            Self::Plus,
            Self::Refresh,
            Self::Restart,
            Self::Search,
            Self::Seek,
            Self::Server,
            Self::Settings,
            Self::Shield,
            Self::SkipForward,
            Self::Smile,
            Self::Speed,
            Self::Spinner,
            Self::Star,
            Self::Subtitles,
            Self::SubtitlesOn,
            Self::Sun,
            Self::Swords,
            Self::Trash,
            Self::TrendingUp,
            Self::Tv,
            Self::Volume,
            Self::VolumeLow,
            Self::WandSparkles,
        ]
    }
}

/// Renders `icon` at `size` pixels in `color`.
///
/// Returns [`Svg`] rather than an element so callers can add SVG
/// transformations, such as rotating a spinner or flipping a chevron, without
/// introducing another wrapper.
pub fn icon(icon: Icon, size: f32, color: Hsla) -> Svg {
    svg().path(icon.path()).size(px(size)).text_color(color)
}

#[cfg(test)]
mod tests {
    use std::{collections::HashSet, path::Path};

    use super::Icon;

    #[test]
    fn all_has_68_unique_icons() {
        let icons = Icon::all();
        assert_eq!(icons.len(), 68, "Icon::all() must list every icon");
        let unique: HashSet<Icon> = icons.iter().copied().collect();
        assert_eq!(unique.len(), icons.len(), "Icon::all() has duplicates");
    }

    #[test]
    fn every_icon_path_has_an_asset() {
        let icons_dir = Path::new(env!("CARGO_MANIFEST_DIR")).join("assets/icons");

        for icon in Icon::all() {
            assert_eq!(
                icon.path(),
                format!("icons/{}.svg", icon.asset_stem()),
                "path and asset stem disagree for {icon:?}"
            );

            let relative = icon
                .path()
                .strip_prefix("icons/")
                .expect("icon paths start with icons/");
            let file = icons_dir.join(relative);
            assert!(
                file.is_file(),
                "missing asset for {icon:?}: {}",
                file.display()
            );
        }
    }

    #[test]
    fn every_asset_has_an_icon() {
        let icons_dir = Path::new(env!("CARGO_MANIFEST_DIR")).join("assets/icons");
        let mut stems: Vec<String> = std::fs::read_dir(icons_dir)
            .expect("assets/icons")
            .filter_map(|entry| entry.ok()?.file_name().into_string().ok())
            .filter_map(|name| name.strip_suffix(".svg").map(str::to_owned))
            .collect();
        stems.sort();

        let mut known: Vec<&str> = Icon::all().iter().map(|icon| icon.asset_stem()).collect();
        known.sort();

        assert_eq!(stems, known, "assets/icons and Icon::all() are out of sync");
    }
}
