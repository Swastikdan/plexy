# Rust player UI kit and icon library

Design document and implementation checkpoint for `apps/player-gpui`. The first
slice is now in the tree: typed `ui::Icon`, canonical `ui::menu` panel/rows,
clipped `ui::artwork` frames, and the `ui::motion` engine. The rest of the
catalog is still being extracted.

The companion document is [MOTION.md](MOTION.md): the animation audit, the
motion engine, and the frame-performance plan. The parent orchestration log is
[README.md](README.md).

## 1. The problem

The shell, library and personal screens draw the same ideas repeatedly, but
each idea is written inline in the file that first needed it:

- The player is one `PlayerView`, and almost every widget is an
  `impl PlayerView` method that takes `&self` (and often
  `&mut Context<Self>`). Nothing can be reused by another screen without
  borrowing the whole view, the catalog, and the current navigation state.
- Button, card, panel, menu, field and text styles are re-declared at each use
  site. Small differences in height, radius and font size accumulate.
- Icons are passed as strings through two `icon(name, …)` helpers plus inline
  `svg().path(format!(…))` calls. A typo is a blank icon at runtime, and every
  render allocates the path string.
- Animation constants and easing curves are repeated across files, and most
  interactive states (hover, press, open, close) change instantly.

This is not a rewrite request. The visual language is already close to the web
app. The goal is to name it once, keep it in one layer, and make the screens
compose it.

## 2. Current state, verified against the working tree

The working tree has uncommitted UI parity work in progress, so treat the
counts below as a dated snapshot, not a stable API.

Approximate snapshot of the UI-facing code:

| File | Lines | What it owns now |
| --- | ---: | --- |
| `src/theme.rs` | 60 | HeroUI color tokens, dark/light theme switch, three radii |
| `src/library_ui.rs` | ~860 | Home, Movies/TV, show page, Libraries, `icon`, poster card, wide card, progress bar |
| `src/personal_ui.rs` | ~820 | Search, filters, title actions, collections, history, text field, chips, segmented control |
| `src/shell_ui.rs` | ~2,300 | Top nav, hero, Library page, title hero, cast/details panels, Settings, dropdown, `episode_tile`, `lift`, `hover_ring`, `corner_mask` |
| `src/app.rs` | ~2,330 | Player chrome, seek bar, volume, menus, OSD, Up next, icon button, menu rows |
| `src/assets.rs` | 184 | Embedded SVG assets and the artwork decode cache |

Measured in this snapshot: **10,483 lines** across the crate, **68 SVG icons**
(272 KB, now typed), **20 distinct font sizes**, **10 distinct corner radii**,
**41 `.hover()`**, **3 `.active()`** and **6 `group_hover()` calls**, and
**8 animation wrappers** (6 single `with_animation`, 2 `with_animations`) plus
**2 `with_tween` call sites**. The counts are a symptom index, not a target.

### Where the duplication lives

| Concept | Current symbols | Notes |
| --- | --- | --- |
| Translucent ink/snow | `with_alpha`, `white`, `black` in three files; `snow`, `ink` in `shell_ui` | Same math, different names, different files |
| Icon | `library_ui::icon`, `app::icon`, inline `svg().path(…)`, `img("icons/plexy-logo.svg")` | Stringly typed, path allocated per render |
| Button | `button`, `pill_button`, `circle_button`, `icon_button`, `round_icon`, `chip`, `see_all`, `menu_item`, settings `nav`, ad-hoc button closures | Nine button-like builders; primary/secondary colors drift |
| Card | `poster_card`, `wide_card`, `continue_card`, `episode_tile`, `category_card`, `genre_card`, Top 10 inline card, show-page episode card | Similar borders/radii/hover/captions; some frames clip, some do not |
| Surface | `panel`, `settings_card`, dropdown container, picker container, player menu panel | Same `surface` + `border` + radius recipe with different paddings |
| Menu/overlay | `dropdown` + `menu_item`, player `menu_row`, player `settings_row`, volume popover, collection picker | Three different item anatomies for the same idea |
| Text | `h1`, `h2`, `section_title`, ad-hoc 13/14/22 px headings | 20 raw font sizes |
| Progress | `progress_bar`, `progress_ring` | Two implementations, one visual idea |
| Artwork | `cover`, `cover_r`, `poster`, `card_art`, `corner_mask`, `hover_ring` | Artwork source precedence, clipping and hover decoration mixed together |
| Empty | `empty_state` | Already centralized — the model to follow |
| Hover/press | 41 `.hover()` + 6 `group_hover()` + 3 `.active()` | Instant style swaps, no transition; card hover is now a clipped tween |

Two structure problems matter more than duplicated lines:

1. **Widgets depend on `PlayerView`.** `poster_card` takes `&self` only to read
   `poster_width`; `continue_card` reads metadata and `shows()`; Settings
   widgets read the catalog directly. A reusable component must receive data
   and callbacks, not the view.
2. **Data is recomputed inside render.** Home calls `heroes()`,
   `visible_shows()` and `visible_movies()` several times per frame;
   `card_art` calls `shows()` for every card. Once an animation keeps the view
   repainting at 60/120 Hz this is the most likely source of jank. The motion
   plan treats memoization as a first-class part of the fix, not an
   optimization afterthought.

## 3. Target structure

Keep this inside the crate first. The app is the only Rust consumer today; a
separate workspace crate would add Cargo plumbing without a second user.
Promote `src/ui` to `crates/plexy-ui` only when another Rust target needs it.
The module boundary is what makes that promotion mechanical later.

```text
src/
  theme.rs              color, type, spacing and radius tokens (existing file, extended)
  ui/
    mod.rs              curated re-exports: `use crate::ui::prelude::*;`
    tokens.rs           type scale, spacing, radii, icon sizes
    icon.rs             generated typed Icon enum + icon element
    paint.rs            snow/ink, color lerp, scrim presets
    text.rs             heading/body/caption/section title
    button.rs           Button, IconButton, SeeAll
    chip.rs             Chip, Badge, GenreChip, StarRating
    controls.rs         Toggle, Segmented, TextField, DropdownTrigger
    surface.rs          Panel, SettingsCard, Card, SettingsRow
    media.rs            Artwork, PosterCard, WideCard, EpisodeCard, TileCard, CastRow
    progress.rs         ProgressBar, ProgressRing
    feedback.rs         EmptyState, Spinner, Skeleton
    overlay.rs          Dropdown, MenuItem, Popover, Presence
    motion/             see MOTION.md; the only module that names durations/easings
  library_ui.rs         screen composition only
  personal_ui.rs        screen composition only
  shell_ui.rs           screen composition only
  app.rs                player layout; composes ui primitives
```

Dependency direction is one-way:

```text
main / app (PlayerView, catalog, playback)
        ↓
feature screens (library_ui, personal_ui, shell_ui)
        ↓
ui (stateless visual components + motion)
        ↓
theme + assets
```

`ui` must not import `PlayerView`, `catalog`, `Screen`, `mpv`, or any feature
module. If a component needs data, it takes it as props. If it needs behavior,
it takes a callback. This rule is what prevents the kit from collapsing back
into view methods.

### Design rules

1. **Props in, elements out.** Components receive owned display data
   (`String`, `Option<PathBuf>`, `f32`, `bool`) and return `impl IntoElement`
   or a concrete `Stateful<Div>`/`Svg` when the caller needs to chain GPUI
   events.
2. **Screens own state and side effects.** The kit does not read the catalog,
   open media, or mutate watch state. It emits clicks through a handler.
3. **No hidden theme snapshots.** Read `theme::` at render time. The theme is a
   global (light/dark), so caching colors in a component constructor would
   freeze the old theme.
4. **Interaction state is explicit.** Composite components accept
   `hovered: bool`, `pressed: bool`, `selected: bool` where an animated
   response matters. Leaf buttons may use GPUI's instant `.hover()` for
   micro-feedback, but large surfaces (cards, hero, rows) should receive the
   state from the screen so motion can be interruptible.
5. **Stable ids.** Every interactive element gets an id derived from its
   content (`poster-{TitleKey}`, `episode-{item.id}`), never from a loop index
   when content can change. Animation keys build on the same identity.
6. **Return concrete types deliberately.** A function that callers will add
   `.on_click()` to returns `Stateful<Div>` or `Svg`; a pure visual returns
   `impl IntoElement`. This avoids "cannot call method on opaque type" churn.
7. **No GPUI types leak into screen data.** `Icon` is the icon type; `&str`
   names only exist inside `ui::icon`.
8. **Accessibility is constrained by GPUI 0.2.2.** There is no semantic
   accessibility API in the pinned version. Keep real focus handles and
   keyboard paths for fields and primary actions, use text labels alongside
   icon-only controls where possible, and do not animate focus indicators
   away. Revisit when the GPUI version exposes roles/labels.

### Follow the existing UI, not a parallel design language

The kit is **source-owned** in the shadcn sense: components live in this
repository, are edited like app code, and are composed by screens. It is not a
dependency that imposes a new look. The source of truth is the current Plexy
UI (and the web app where the Rust app is still catching up), not an
imagined redesign.

That means:

- Tokens come from the existing HeroUI values and the current screen
  measurements. If a proposed token changes a pixel, it waits for a
  screenshot-reviewed pass.
- Component variants come from real call sites, not a generic design system.
  Start with the variants that exist today; add a new one only when a screen
  needs it.
- A component is considered done when the scene that uses it matches the
  pre-extraction screenshot at rest, in both light and dark themes.

### Scenes: how the kit is built and verified

A **scene** is an existing screen region in a named state: art + copy +
controls arranged as the app actually uses them. Components are extracted from
scenes, not designed in isolation, and scenes are the visual regression
harness.

| Scene | Required states |
| --- | --- |
| Home | populated, empty library, hero slide 1/2, hero hover, row overflow, light/dark |
| Library | grid, genre tiles, Top 10, sort closed/open, unwatched filter, light/dark |
| Title | movie, show, logo vs text title, resume, cast panel, more-menu open, episode hover, light/dark |
| Search | idle, results, episode result hover, light/dark |
| Collections / History | empty, populated, remove action, light/dark |
| Settings | each section, language dropdown open, scrolled list, light/dark |
| Player | controls visible/hidden, More menu, track menu, volume open, Up next, OSD |
| Menus | every trigger open, item selected, item disabled, long list scrolled |

Build order for a new scene:

1. **Capture the current screen** in both themes at the target window size.
2. **Annotate regions**: page gutters, header, hero, rows, cards, captions,
   overlays. Mark which regions are already shared.
3. **Define the data model** the scene needs (titles, art, progress badges,
   actions). Keep it independent of `PlayerView`.
4. **Map regions to kit parts** from the catalog in §6. If a part does not
   exist, add the smallest variant that covers the real call site.
5. **Assemble the scene in the gallery first**, using the same window size and
   theme. Compare against the capture.
6. **Replace one region at a time** in the feature screen; keep the old code
   until the new region matches.
7. **Record the scene state** in the gallery and in the parent orchestration
   log. A component without a scene is not finished.
8. **Repeat in the light theme.** Most clipping and surface bugs only appear
   there.

### How to add a component

1. Find two or more real call sites. If there is only one, keep it local until
   a second appears.
2. List the differences in props, not in copied style. If the differences are
   pixel drift, choose one token and verify in a scene.
3. Put the component in `ui/` with no `PlayerView`, catalog or feature
   imports.
4. Add the state matrix to the gallery: default, hover, pressed, selected,
   disabled, focused, loading, empty, dark, light.
5. Replace call sites one at a time and capture before/after.
6. Delete the old helper only after all call sites are gone.

Do not build a "scene framework" (layout engine, descriptors, runtime
interpreter) for this. A scene is Rust composition plus a gallery entry and a
screenshot. Keep it boring.

## 4. Tokens

Colors already live in `theme.rs` and should stay there. Add the missing
scales there or in `ui/tokens.rs`; do not introduce a second color system.

### Type scale

The current sizes cluster in 1 px steps: 10, 11, 12, 13, 14, 15, 16, 17, 18,
19, 21, 22, 27, 29, 30, 32, 44, 48, 60, 64. Collapsing them all at once would
change layout and break visual parity. Define semantic tokens now, map each
existing use to the nearest token, and only normalize values in a dedicated
screenshot-reviewed pass.

| Token | Value | Use |
| --- | ---: | --- |
| `TEXT_MICRO` | 10 | badges, overline |
| `TEXT_CAPTION` | 11–12 | card captions, helper copy |
| `TEXT_BODY_SM` | 13 | metadata, menu rows, labels |
| `TEXT_BODY` | 14 | paragraphs, primary labels |
| `TEXT_TITLE_SM` | 16–18 | section titles, panel headings |
| `TEXT_TITLE` | 22 | page section headings |
| `TEXT_DISPLAY` | 32 | page h1 |
| `TEXT_HERO_SM` | 44 | title hero text |
| `TEXT_HERO` | 60–64 | home hero wordmark |

### Spacing and radii

Use a 4 px base with a small half-step. Existing odd values (11, 13, 18, 22,
29) should map to the nearest token during extraction; do **not** round every
value in the same commit as a structural refactor.

| Token | Value | Typical use |
| --- | ---: | --- |
| `SPACE_0_5` | 2 | icon gaps, dot gaps |
| `SPACE_1` | 4 | tight gaps |
| `SPACE_1_5` | 6 | chip padding |
| `SPACE_2` | 8 | control padding |
| `SPACE_3` | 12 | card gaps |
| `SPACE_4` | 16 | section inner gaps |
| `SPACE_5` | 20 | poster grid gap |
| `SPACE_6` | 24 | page gutter (`PAGE_X`) |
| `SPACE_8` | 32 | large section gaps |
| `SPACE_12` | 48 | home row rhythm |

| Token | Value | Use |
| --- | ---: | --- |
| `RADIUS_XS` | 6 | tiny islands, episode art |
| `RADIUS_SM` | 8 | controls, menu rows |
| `RADIUS_MD` | 10 | posters |
| `RADIUS_LG` | 12 | wide cards, fields |
| `RADIUS_XL` | 14–16 | continue cards, genre tiles |
| `RADIUS_2XL` | 20–22 | hero panels, title hero |

The existing `theme::RADIUS` (8), `RADIUS_LG` (12) and `RADIUS_XL` (16) stay for
compatibility. New code should use named tokens, not raw numbers. The current
values 13, 18, 19 and 22 are card-specific visual choices; tokenize them
first, then decide whether to merge them.

### Paint helpers

Move the four copies of `with_alpha`/`white`/`black`/`snow`/`ink` into
`ui::paint` (or `theme::ink`) and re-export:

```rust
pub fn with_alpha(color: Hsla, a: f32) -> Hsla;
pub fn ink(a: f32) -> Hsla;   // fixed near-black for scrims over artwork
pub fn snow(a: f32) -> Hsla;  // fixed white for copy over artwork
pub fn lerp_hsla(a: Hsla, b: Hsla, t: f32) -> Hsla;
```

`ink`/`snow` exist because copy over art must stay white-on-dark in both
themes. Keep that distinction visible in the name; don't reuse
`theme::foreground()` for artwork overlays.

## 5. Icon library

### What exists

As of the first implementation slice, `src/ui/icon.rs` is in the tree with the
typed enum, `path()`, `all()` and asset-parity tests. Every UI call site now
uses `ui::icon(Icon::…)`; the old string helper is gone from the feature
files. The pipeline below remains the contract for adding icons.

- `tools/extract-icons.ts` copies icons from the web app (Video.js neutral for
  player chrome, lucide for the rest) into `assets/icons/*.svg`.
- `build.rs` embeds every SVG as `const ICONS: &[(&str, &[u8])]` and
  `assets::Assets` serves them by path.
- Screens call `icon("play", 18., color)`, which does
  `svg().path(format!("icons/{name}.svg"))`; some sites call `svg().path`
  directly; the Settings rows bypass the helper entirely.
- 68 icons, 272 KB total. The whole set is embedded by `build.rs`; Rust cannot
  tree-shake individual `include_bytes!` entries by usage, so every icon
  ships. At 272 KB this is negligible next to libmpv. The `format!` path is
  the real per-render cost, not the asset size. If the set grows much larger,
  switch `build.rs` from walking the directory to embedding an explicit
  manifest generated from `Icon::all()`; do not optimize the current 272 KB.

### Target: one typed enum, one element helper

Add `src/ui/icon.rs` with a generated `Icon` enum and a checked-in mapping.
Feature code then imports one facade:

```rust
use crate::ui::prelude::*; // Icon, ui::icon, component builders

icon(Icon::Play, 18., theme::foreground());
```

No feature module imports `assets` or constructs `icons/{name}.svg` itself.

```rust
#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash)]
pub enum Icon {
    Play,
    Pause,
    Restart,
    Seek,
    Volume,
    VolumeLow,
    Mute,
    // …
}

impl Icon {
    /// Static asset path: `"icons/play.svg"`.
    pub const fn path(self) -> &'static str { /* generated match */ }

    /// Every icon, for the gallery and asset-parity tests.
    pub const fn all() -> &'static [Icon] { /* generated slice */ }
}

/// Returns `Svg` so callers can add a transformation (rotation/scale) without
/// a second wrapper. All UI code goes through this; no string names.
pub fn icon(icon: Icon, size: f32, color: Hsla) -> Svg {
    svg()
        .path(icon.path())
        .size(px(size))
        .text_color(color)
}
```

Why an enum instead of `&'static str`:

- Typos become compile errors instead of an empty icon.
- Discoverability: `Icon::` autocompletes the real set.
- `path()` returns a static path; no `format!` allocation per icon per frame.
- Dynamic choices stay typed: `Genre::icon() -> Icon`,
  `volume_icon(…) -> Icon`, `Menu::icon() -> Icon`.
- A component can take `Icon` in its props instead of a second stringly API.
- A gallery can iterate `Icon::all()` and render every asset.

Why not an icon font: GPUI tints SVG masks directly, retains vector quality at
every size, and the icons already exist as SVG. A font would add generation,
licensing, and text-shaping work for no gain here.

### Asset pipeline

Keep `tools/extract-icons.ts` as the source of truth. Extend it to emit both:

1. `assets/icons/*.svg` (as today).
2. `src/ui/icon.rs` with the `Icon` enum, `path()` and `all()`.

The generator must sort variants, reject non-identifier names, and preserve
the asset name for the path. `build.rs` continues to embed all SVGs; it does
not need to generate the enum.

Add a test that fails on drift:

```rust
#[test]
fn every_icon_has_an_asset() {
    for icon in Icon::all() {
        let relative = icon.path().trim_start_matches("icons/");
        assert!(
            Path::new("assets/icons").join(relative).is_file(),
            "missing asset for {icon:?}"
        );
    }
}
```

Add a second test that walks `assets/icons` and asserts every `.svg` is
reachable from `Icon::all()` (or explicitly listed as legacy/removed). This is
the guard that keeps the enum and the asset folder in sync.

### Naming rules

- Variant names are PascalCase of the asset stem: `fullscreen-exit` →
  `FullscreenExit`, `subtitles-on` → `SubtitlesOn`.
- Keep the semantic asset names the app already uses; don't rename the files
  in the same change as the enum introduction.
- Resolve duplicates deliberately:
  - `settings` (Video.js gear) vs `cog` (lucide): keep `Settings`; mark `cog`
    legacy and remove it if unused.
  - `more` (vertical ellipsis, player) vs `ellipsis` (horizontal, title
    actions): expose `MoreVertical` and `MoreHorizontal`, mapping to the two
    assets, so call sites read correctly.
  - `play` vs `play-outline`: `Play` for the filled control, `PlayOutline` for
    the decorative variant.
- `plexy-logo` is a brand mark, not a mask. Use a separate
  `ui::brand_mark()` helper backed by `img()` (it can be multi-color); don't
  tint it through `icon()`.

### Icon sizes

Keep `f32` in the element helper (the app uses 12–32 px and one 110 px
decoration), but add semantic constants used by components:

```rust
pub mod icon_size {
    pub const XS: f32 = 12.;
    pub const SM: f32 = 16.;
    pub const MD: f32 = 20.;
    pub const LG: f32 = 24.;
    pub const XL: f32 = 32.;
}
```

Icons that animate should be `Svg` values so the motion layer can use
`with_transformation(Transformation::rotate(…))` (the only GPUI element that
supports transforms in 0.2.2). This enables a real spinner and a rotating
chevron without layout work.

### Migration

1. Add `ui::icon` and the generated enum with `all()` and `path()`.
2. Replace the two `icon()` helpers and every direct `svg().path(…)` call with
   `ui::icon(Icon::…, …)`.
3. Replace string icon parameters in props (`icon_name: &'static str`,
   `Menu`, genre mapping, `volume_icon`, `flash`) with `Icon`.
4. Delete the duplicated helpers and the `format!` path construction.
5. Add the asset-parity tests and the component gallery page (below).

The component gallery is also the icon gallery: one grid of every
`Icon::all()` at 16/20/24 px on both theme backgrounds. It catches missing
assets and accidentally invisible tint colors immediately.

## 6. Component catalog

The table is the extraction order. Start at the top; each row is independent
enough to land in one commit.

| Layer | Target component | Current source(s) | Props / notes |
| --- | --- | --- | --- |
| Foundation | `paint::ink/snow/with_alpha/lerp_hsla` | `shell_ui`, `library_ui`, `app` | Pure functions; no view |
| Foundation | `Icon` + `icon()` | `library_ui::icon`, `app::icon`, inline SVG | typed enum; see §5 |
| Foundation | `Artwork` | `cover`, `cover_r`, `poster`, `assets::artwork_cover` | `Option<PathBuf>`, radius, placeholder text; owns the image-cache call |
| Foundation | `ArtworkFrame` | `cover_r` + `corner_mask` + `hover_ring` + `lift` + card wrappers | clipped rounded frame, tone-aware corner mask, optional art lift, fixed hover veil/ring; see §6.2 |
| Foundation | `Text` / `Heading` / `Caption` | `h1`, `h2`, `section_title`, ad-hoc text | semantic type token, color, truncation, line clamp |
| Foundation | `Scrim` | hero gradients, genre-page gradients, continue-card overlay | preset enum (`HeroLeft`, `Bottom`, `Card`) + strength |
| Progress | `ProgressBar` | `library_ui::progress_bar`, inline episode bars | fraction, height, color, rounded |
| Progress | `ProgressRing` | `shell_ui::progress_ring` | fraction, size, stroke, track/fill colors |
| Feedback | `EmptyState` | `shell_ui::empty_state` | `Icon`, title, body, optional action; keep the exact current layout |
| Feedback | `Spinner` | subtitle-search spinner | rotate transform, size, color |
| Controls | `Button` | `button`, `pill_button`, ad-hoc action closures | variant (`Primary`, `Secondary`, `Ghost`, `Danger`), size (`Sm`, `Md`, `Lg`), icon, label, disabled, on_click |
| Controls | `IconButton` | `icon_button`, `round_icon`, `circle_button` | icon, size, active, tooltip label, on_click |
| Controls | `SeeAll` | `see_all` | label + arrow icon, on_click |
| Controls | `Chip` | `chip`, `genre_chip`, segment items | active, on_click |
| Controls | `Badge` | `badge` | label, tone |
| Controls | `StarRating` | rating stars in `title_actions` and title hero | value, interactive, on_rate |
| Controls | `Toggle` | `toggle` | on, on_change; animate the knob in the motion phase |
| Controls | `Segmented` | `personal_ui::segment` | options, selected, on_change |
| Controls | `TextField` | `personal_ui::text_field` | value, placeholder, focus, key handler; editing policy stays with the screen |
| Surface | `Panel` | `panel` | title, optional icon, body; radius and header padding tokens |
| Surface | `SettingsCard` + `SettingsRow` | `settings_card`, `setting_row`, player `settings_row` | icon tile, title, rows, optional between-row divider |
| Overlay | `MenuPanel` | `dropdown` container, player menu panel | p6, radius 12, max height, tone (`App` / `Media`), optional header; see §6.1 |
| Overlay | `MenuRow` | `menu_item`, player `menu_row`, player `settings_row`, collection picker row | one anatomy for action, radio, navigation and two-line rows; see §6.1 |
| Overlay | `Dropdown` | `dropdown` + `open_select` + outside-click statics | anchored trigger, `snap_to_window_with_margin(8)`, flip, dismiss, one open; see §6.1 |
| Overlay | `Popover` | volume popover, collection picker | anchored content, side, width, presence/exit in the motion phase |
| Media | `PosterCard` | `poster_card` | title, caption, art, progress, watched, width, hovered, on_click; uses `ArtworkFrame` |
| Media | `WideCard` | `wide_card`, `continue_card` | art, title, caption, badge, progress/ring, width, hovered, on_click; uses `ArtworkFrame` |
| Media | `EpisodeCard` | `episode_tile`, inline show-page episode card | still, number, name, overview, runtime, progress, watched, hovered, on_play, on_watched; uses `ArtworkFrame` |
| Media | `TileCard` | `category_card`, `genre_card` | icon, tint, title, count, large watermark icon, on_click |
| Media | `CastRow` | `cast_panel` inline rows | photo, name, role, avatar size |
| Layout | `SectionHeader` | `section` header, `section_title` | title, optional subtitle, optional action |
| Layout | `Row` / `Grid` | repeated row/grid wrappers | gap, scroll id, children |
| Layout | `PageHeader` | page h1 + subtitle blocks | title, subtitle, trailing control |

### Player chrome boundary

The player's transport is intentionally app-specific: a seek bar with chapter
marks and trickplay, a volume popover with drag/scroll, audio/subtitle menus,
and an Up next card. Keep that composition in `app.rs`, but build it from
`ui::Button`, `ui::IconButton`, `ui::MenuItem`, `ui::Popover`, `ui::Badge`,
`ui::Icon` and `ui::ProgressBar`. The reusable kit should not learn about
libmpv, chapters or track lists.

### API shape

Prefer a small builder when a component has more than three variants; keep a
plain function for everything else. Example target call sites:

```rust
// Button: callback at construction so the component returns a normal element.
ui::Button::new("hero-play", if hero.resume { "Continue watching" } else { "Play" })
    .variant(ui::ButtonVariant::Primary)
    .size(ui::ButtonSize::Lg)
    .icon(Icon::Play)
    .on_click(cx.listener(move |this, _, window, cx| {
        this.play_item(play.clone(), window, cx)
    }));

// Poster card: data + interaction state in, behavior out.
ui::PosterCard::new(title, caption, poster)
    .progress(fraction)
    .watched(watched)
    .width(self.poster_width())
    .hovered(self.hovered_title.as_ref() == Some(&key))
    .on_hover(cx.listener(move |this, hovered: &bool, _, cx| {
        this.set_hovered(hovered.then(|| key.clone()), cx);
    }))
    .on_click(cx.listener(move |this, _, _, cx| this.open_title(&key, cx)));

// Section header + row stay compositional, not a mega-component.
ui::section(
    "Recently added shows",
    Some(ui::SeeAll::new("see-shows", "See all").on_click(…)),
    ui::row("home-shows", 20., poster_cards),
);
```

Two GPUI specifics to keep in mind while implementing:

- `.hover()` and `.active()` are paint-time style refinements; they cannot
  drive an interpolated value. Animated hover needs an explicit `hovered`
  flag in view state (or the motion engine's target-driven helper).
- An element's id is its animation identity. Keep ids stable for the same
  content, and changed when the animated state changes. Do not key a
  carousel by array index alone.

### 6.1 Canonical menu and dropdown

This is the fix for the reported inconsistency: "settings dropdown items look
different from the details-page dropdowns". There were **four** menu item
anatomies, all doing the same job; `src/ui/menu.rs` now implements the
canonical panel/row and the shell/player/collection surfaces adopt it.

| Surface | Container | Row | Type | Anatomy |
| --- | --- | --- | --- | --- |
| Shell dropdowns: Library sort, title "more", season picker, Settings language | `p(5)`, radius 12, border, shadow, max-h 340 | height 34, `px(10)`, gap 10, radius 8 | 13 px | optional 16 icon, label, optional 15 check |
| Player "Settings" root (`Menu::More`) | player panel `p(10)`, radius 14, 400-wide, no border, 48 header | `settings_row`: `px(14) py(12)`, gap 14, radius 8 | 17 px bold | 22 icon, label, value, 16 chevron |
| Player audio/subtitle/chapters menus | same player panel | `menu_row`: `px(14) py(10)`, gap 14, radius 8 | 16 + 12 detail | 20 radio, label, detail |
| Collection picker | `p(8)`, radius 16 | `px(8) py(6)`, gap 8 | 11 px | fixed 13 check slot, name |

The previous result was three different vertical rhythms (34 / 44 / 48 px),
two text scales (13 vs 16/17), two icon scales (16 vs 20/22), and three panel
paddings (5 / 8 / 10). The player is always dark, which hid some of the drift;
in light theme the shell popovers exposed it.

The measurements below are the convergence target. Capture the current web
player menu and the shell dropdown before freezing them; if a 1 px change
breaks visual parity, keep the old value as a token default and note it.

#### Target `MenuPanel`

One container recipe, with a tone instead of a second design:

| Property | App tone | Media tone (player) |
| --- | --- | --- |
| Background | `theme::overlay()` | fixed dark `panel_bg()` |
| Border | 1 px `theme::border()` | 1 px white/10 or none |
| Radius | 12 | 12 |
| Padding | 6 | 6 |
| Shadow | `shadow_lg` | `shadow_lg` |
| Width | trigger width, min 180, max 320 | 360–400, fixed |
| Max height | 340, scroll | 560, scroll |
| Offset from trigger | 6 | anchored/fixed |
| Header | optional 40 px, 14 semibold, centered | same |

The media tone exists because the player must stay dark even when the app is
light. Same geometry, different palette; that is still "themed". Do not let
the player menu turn into a white sheet in light mode.

#### Target `MenuRow`

| Property | Value |
| --- | --- |
| Height | 36 single-line, 48 two-line, 40 navigation |
| Padding | `px(10)`, `py(6)`; center vertically |
| Gap | 10 |
| Radius | 8 |
| Label | 13 px semibold, foreground |
| Detail / value | 11 px muted, line-height 15, truncate |
| Leading slot | Optional 16 px icon |
| Trailing slot | 14 px chevron and optional value on navigation rows |
| Hover | `theme::default()` background |
| Selected | Neutral full-row fill with a foreground label |
| Space between items | 4 px |
| Danger | danger text, danger-tinted hover |
| Divider | 1 px separator, `mx(6) my(4)` |

Variants:

- `Action`: label with an optional leading icon. Used for title actions,
  sort, seasons and language choices.
- `Radio`: label and optional secondary detail. Used for player track choices.
- `Navigation`: leading 18 px icon, 14 px semibold label, trailing 12 px value
  and 14 px chevron. Used for player settings and library types.
- `Collection`: selectable label. Used in the collection picker.


Concrete conversion map:

| Current | Target |
| --- | --- |
| Shell item `h(34)`, panel `p(5)` | `h(36)`, panel `p(6)` |
| Player navigation `px(14) py(12)`, 17 px bold | `px(10) py(6)`, height 40, 14 px semibold |
| Player track `px(14) py(10)`, 16 + 12, 20 radio | `px(10) py(6)`, height 48, 13 + 11 |
| Collection picker `px(8) py(6)`, 11 px | `px(10) py(6)`, height 36, 13 px |
| Panel radius 12 (shell) / 14 (player), padding 5/8/10 | radius 12, padding 6, tone decides color |
| Icon 16 (shell) / 20–22 (player) | 16 leading; 18 only in `Navigation` |
| Selection indicators | Shared neutral selected row |

#### Dropdown behavior checklist

- A menu opens in the same frame as the trigger click. The deferred menu
  uses the trigger bounds from layout, with a 6 px offset and 8 px window
  margin. An episode context menu uses the pointer position.
- The panel flips above its anchor when that side has more room and the
  full list does not fit below. Long lists scroll inside the available space.
- One shell menu opens at a time. Clicking the trigger or outside the panel,
  selecting a row, or pressing Escape closes the menu.


Target call shape:

```rust
// Inside the trigger's relative wrapper:
.when(open, |el| {
    el.child(
        ui::Dropdown::new("library-sort")
            .width(ui::DropdownWidth::Trigger)
            .on_dismiss(cx.listener(|this, _, _, cx| {
                this.open_select = None;
                cx.notify();
            }))
            .items([
                ui::MenuRow::radio("sort-added", "Recently added", selected)
                    .on_click(cx.listener(move |this, _, _, cx| { … })),
                ui::MenuRow::radio("sort-title", "Title", selected)
                    .on_click(cx.listener(move |this, _, _, cx| { … })),
            ]),
    )
});
```

The exact builder name can change; the behavior and measurements above are the
contract.

Implemented today: `ui::menu::{panel, divider, MenuRow}` with
`MenuRow::{action, radio, navigation, collection}`. The `Dropdown` wrapper
name above is the intended next step; the shell currently keeps its measured
anchoring function and composes these rows.

### 6.2 Artwork frames and hover clipping

Reported symptom: on some title and episode cards, hovering made the image
"bleed out" of its rounded frame, mostly in the light theme. The pre-hotfix
code had five contributors. The implementation now uses
`ui::artwork::{frame, framed, corner_mask, hover_veil}` and keeps decorations
outside the growing art; the notes below remain the contract.

| Cause | Evidence in the pre-hotfix tree | Effect |
| --- | --- | --- |
| The lift grows the art outside its fixed wrapper | `lift()` places art at `left(-w·0.015)`, `top(-h·0.015)`, `w(w·1.03)`, `h(h·1.03)`; the fixed `relative` wrapper has no `rounded`/`overflow_hidden` | The art (and everything inside it) grows past the card boundary on hover — the primary bleed |
| No clip on the art frame | `episode_tile` and the show-page episode frame are `relative` + `rounded` with no `overflow_hidden`; `poster_card`'s outer frame is unclipped | Even without the lift, overlay/action/veil layers can paint outside the rounded art |
| Square hover overlay | Show-page episode card adds `.absolute().inset_0()` + dark background with **no `rounded`** | A square dark wash appears over rounded artwork; most visible on a light page |
| Corner mask uses the page background | `cover_r` calls `corner_mask(radius, theme::background())` unconditionally | On a card that sits on `surface`/`surface_secondary`, the light theme shows page-colored wedges at the corners |
| Decorations live inside the growing layer | Poster badges, progress bars, action buttons and the `hover_ring` veil are children of the art that `lift()` resizes | They scale/shift with the art; the veil's radius is the grown radius, not the frame radius |

`hover_ring()` is currently a veil, not a ring: it paints a theme-aware tint
and fades it in with `group_hover`. The name should become `hover_veil` when
extracted. If a ring is added later, it belongs to the fixed frame, inset 1 px,
not to the growing art.

#### Target `ArtworkFrame`

One component owns the visual frame, with the art and the decorations on
separate layers:

```rust
ui::ArtworkFrame::new(art)
    .radius(12.)
    .tone(ui::FrameTone::Page)   // Page | Surface | Media
    .lift(0.03)                  // optional; grows/crops the art only
    .overlay(hover_veil)          // optional; fixed-size, clipped
    .ring(ui::HoverRing::art())   // optional; fixed-size, inset
```

Layer order, bottom to top:

1. **Frame:** `.relative().rounded(radius).overflow_hidden()`, fixed size.
2. **Art layer:** the optional 3% growth. It is clipped by the frame; the
   frame does not move.
3. **Corner restoration:** `corner_mask(radius, tone_backdrop)` at frame size.
   GPUI clips rectangularly, so this restores the rounded corners after a
   grown image is clipped. Use the local backdrop, never the page background.
4. **Decorations:** badges, progress, action button, hover veil. Fixed at the
   frame size and radius; they must not be children of the growing art.
5. **Frame border/ring:** draw above the corner mask so the mask never paints
   over the border. Optional ring is inset 1 px, radius `radius - 1`, border
   width always reserved so there is no layout shift. Over art, use a fixed
   snow ring (or a subtle two-tone ring for light backgrounds), not
   `theme::foreground()`.

Rules:

1. The frame is always `.relative().rounded(radius).overflow_hidden()`.
2. Only the art layer may grow. The frame, caption, badges, progress, action
   buttons and veil stay fixed.
3. The image uses `artwork_cover(path, radius)`; the corner mask is painted
   with the **local backdrop token** (`Page` → `background`,
   `Surface` → `surface`, `Media` → the player panel color).
4. If the art target cannot overflow the frame (exact aspect, no cover/lift),
   skip the corner mask entirely.
5. Any hover overlay is `.absolute().inset_0().rounded(radius)` at frame size.
6. Action buttons (remove, watched) are inside the frame or padded clear of
   the rounded corners; they never overhang the art.
7. Verify on `background`, `surface` and `surface_secondary` in both themes.
   The bug is not limited to the page background.

The `lift()` animation is 220 ms today and animates width/height/left/top,
which is layout work. Keep it only if it stays smooth for one hovered card;
otherwise use the veil/border ramp alone. See [MOTION.md](MOTION.md).

#### Minimal hotfix shape

Until `ArtworkFrame` exists, the current `lift()` can be made safe without
changing its visual idea:

```rust
// Before: the wrapper is fixed, but the grown art is not clipped.
div()
    .relative()
    .w(px(w))
    .h(px(h))
    .child(art_with_lift)

// After: clip the growth to the frame, restore rounded corners, and keep
// decorations above the growth but at frame size.
div()
    .relative()
    .rounded(px(radius))
    .overflow_hidden()
    .w(px(w))
    .h(px(h))
    .child(art_with_lift)                 // only this grows
    .child(corner_mask(radius, tone_bg))  // frame-size, local backdrop
    .child(fixed_badges_progress_and_veil)
    .child(optional_inset_ring)
```

For the show-page episode card, also add `.rounded(px(radius))` to the hover
overlay; it currently paints a square dark wash. For `cover_r`, pass the card's
local surface color into `corner_mask` instead of hardcoding
`theme::background()`. These two changes plus the clip remove the visible
bleed before the full component extraction.

Acceptance:

- Hovering any poster, wide card, search episode, history episode, Top 10 card
  or show episode never reveals a square corner or a page-colored wedge.
- The card frame stays fixed; only the art inside it grows/crops.
- Badges, progress and action buttons do not move or scale on hover.
- The hover veil and ring disappear cleanly when the pointer leaves.
- The same capture passes in light and dark theme.

## 7. Component gallery

Add a debug-only gallery screen (or a `--ui-gallery` launch flag) that renders:

- every `Icon` at 16/20/24 px on dark and light surfaces;
- buttons in all variants/sizes/disabled states;
- poster/wide/episode/tile cards with and without art, progress and hover;
- fields focused/unfocused, toggles on/off, segmented states;
- dropdown/popover open/closing, empty state, progress bar/ring fractions;
- the motion presets from [MOTION.md](MOTION.md), with a "replay" button.

This is the visual regression harness for the kit. It is also the fastest way
to review a component change without clicking through the catalog. Keep it
behind a debug setting or flag so it never appears in the normal navigation.

## 8. Migration plan

Do this in small, independently reviewable commits. The current working tree
has UI parity work in flight; coordinate with that branch and do not mix a
structural refactor with visual changes.

### Hotfix lane — visual correctness (started)

These were the first real pieces of the kit. **HOT-1 and HOT-2 code landed on
2026-11-27; HOT-3 (visual verification) is the remaining step.** Do not mark
them done until the parent matrices are checked in both themes.

- **H1 — menus and dropdowns.** Add `MenuPanel`, `MenuRow` and the `Dropdown`
  behavior from §6.1. Adopt them in the shell dropdowns (Library sort, title
  more, season, Settings language), the player Settings root, player track
  menus and the collection picker. One container padding, one row rhythm, one
  icon/check scale, app vs media tone.
- **H2 — artwork frames.** Add `ArtworkFrame` from §6.2. Clip every art
  frame, grow only the art inside the frame, keep badges/progress/actions/veil
  fixed, round every hover overlay, make the corner mask use the local
  surface, and inset any ring. Apply to poster, wide, continue,
  search/history episode, show episode, and Top 10 cards.
- **H3 — light-theme pass.** Capture every scene in light and dark. The light
  theme is where corner masks, hover rings and surface mismatches show up.
- Acceptance: the dropdown matrix in the parent orchestration log passes; no
  square hover corner or page-colored wedge in either theme; no layout shift.

### Phase 0 — groundwork (no visual change)

- Create `src/ui/mod.rs` and `ui::prelude`.
- Add paint helpers, type/spacing/radius tokens, and `ui::icon` with the typed
  enum.
- Add the icon asset-parity tests.
- Add the gallery skeleton.
- Acceptance: `cargo check`, `cargo test`, screenshots byte-identical at rest.

### Phase 1 — foundation and media atoms

- Move `Artwork`, `Text`, `Scrim`, `ProgressBar`, `ProgressRing`, `Badge`,
  `Chip`, `EmptyState`, `Spinner`.
- Replace the duplicated helpers in `shell_ui`, `library_ui`, `app`.
- Acceptance: no `svg().path(format!` remains; no `fn icon` outside `ui`;
  all screenshots identical.

### Phase 2 — controls

- Add `Button`, `IconButton`, `SeeAll`, `Toggle`, `Segmented`, `TextField`,
  `StarRating`.
- Port each call site by variant, not by copy-pasting the old style. If two
  call sites differ by 1 px today, decide the token once and verify the
  screenshot.
- Acceptance: one button style per variant; no ad-hoc button closures outside
  the player transport (which uses the primitives).

### Phase 3 — surfaces and cards

- Add `Panel`, `SettingsCard`, `SettingsRow`, `ArtworkFrame`, `PosterCard`,
  `WideCard`, `EpisodeCard`, `TileCard`, `CastRow`.
- Move artwork-source precedence out of `card_art` and into the screen's
  model, so cards receive one resolved `Option<PathBuf>`.
- Acceptance: card gaps, radii and captions match the web reference; grid
  layout unchanged; hover clipping holds in both themes.

### Phase 4 — overlays

- Finish `Dropdown`, `MenuPanel`, `MenuRow` and `Popover` with the presence
  helper from [MOTION.md](MOTION.md) so they can animate out as well as in.
- Replace the remaining overlay implementations (shell dropdown, player
  menus, volume popover, collection picker).
- Acceptance: one open overlay at a time; Escape/outside click behavior is
  unchanged; exit animation does not trap clicks after it finishes.

### Phase 5 — screens compose

- Make `library_ui`, `personal_ui`, `shell_ui` screen composition only.
- Delete the old helpers and the `PlayerView` widget methods that only wrapped
  them.
- Add a review checklist/grep gate: feature files may not contain raw
  `Animation`, `Duration::from_millis` for UI motion, `svg().path`, or
  `icon_name` strings.

### Phase 6 — motion

Follow [MOTION.md](MOTION.md). This is the phase that intentionally changes
the feel; do not hide it inside the structural refactor.

## 9. Definition of done

- One icon API: `ui::Icon` + `ui::icon`; no string icon names outside the
  generated module.
- One component per concept in the catalog; feature files contain layout and
  data wiring, not re-declared visual recipes.
- `ui` has no imports from `app`, `catalog`, `personal_ui`, `library_ui`,
  `shell_ui`, or `mpv`.
- All screens render identically at rest, confirmed by before/after captures
  of Home, Library, Show, Movie, Search, Settings, and the player, in light
  and dark theme.
- Menu rows share one anatomy across shell dropdowns, Settings language,
  title details, player Settings and player track menus; the dropdown
  behavior checklist in §6.1 passes.
- Artwork frames clip hover overlays and rings in both themes; no square
  corners or page-colored wedges.
- Every interactive surface has a hover and press response; every overlay has
  an exit path; focus states are visible.
- The gallery covers every component state, every icon, and every scene from
  §3.
- `cargo test --locked --release -- --test-threads=1` passes, and the app
  still passes the self-test flows in the README.

## 10. Non-goals and open questions

- **Not** a design refresh. The HeroUI tokens, spacing rhythm and type sizes
  should stay visually the same during extraction.
- **Not** a separate crate yet. Revisit when a second Rust consumer exists.
- **Not** an icon font or sprite atlas. Typed SVG paths are the right level
  for GPUI 0.2.2.
- **Not** a general-purpose widget framework. Keep components props-first and
  small; composition belongs in the screens.
- Open: whether `theme.rs` or `ui/tokens.rs` owns type/spacing. Recommendation:
  extend `theme.rs` so there is one import for design decisions.
- Open: whether the gallery is a `Screen` variant or a separate `--ui-gallery`
  window. Recommendation: a debug flag on the existing window; it can reuse
  the live theme and fonts.
- Open: automatic macOS Reduce Motion detection. GPUI 0.2.2 does not expose
  it; start with an app setting and revisit on the next GPUI upgrade.

## Appendix A — current icon set

The 68 assets in `assets/icons` at the time of this document. The generated
enum should follow these stems; resolve the duplicates called out in §5 before
freezing the public names.

| Group | Asset stems |
| --- | --- |
| Playback | `audio`, `audio-lines`, `back`, `captions`, `chapters`, `forward`, `fullscreen`, `fullscreen-exit`, `more`, `mute`, `pause`, `pip`, `play`, `play-outline`, `restart`, `seek`, `skip-forward`, `speed`, `spinner`, `subtitles`, `subtitles-on`, `volume`, `volume-low` |
| Navigation and shell | `arrow-left`, `arrow-right`, `arrow-up-down`, `chevron-down`, `chevron-left`, `chevron-right`, `clock`, `close`, `cog`, `folder`, `folder-heart`, `folder-plus`, `home`, `layers`, `library`, `list`, `monitor`, `moon`, `search`, `server`, `settings`, `sun`, `tv` |
| Personal library | `bookmark`, `check`, `circle`, `circle-check`, `ellipsis`, `eye`, `eye-off`, `heart`, `minus`, `plus`, `refresh`, `star`, `trash` |
| Metadata and genre tiles | `drama`, `film`, `palette`, `shield`, `smile`, `swords`, `trending-up`, `wand-sparkles` |
| Brand | `plexy-logo` (use `brand_mark()`, not `icon()`) |

`cog`/`settings` and `more`/`ellipsis` are the two known duplicate pairs.
`play-outline` is a deliberate decorative variant, not a duplicate.

