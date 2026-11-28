# Building UI in the Plexy player

The player is built on [GPUI Kit](https://gpui-kit.com/component/). Reach for
a Kit component first, styled through Plexy's theme. Write a Plexy component
only when the Kit has no equivalent, and put it in `src/ui/` so every screen
shares it.

## Order of preference

1. **A Kit component, as is.** `Switch`, `Select`, `Input`, `TabBar`, `Tag`,
   `Skeleton`, `Spinner`, alert dialogs (`window.open_alert_dialog`). They
   already handle focus, keyboard, accessibility labels and motion.
2. **A Plexy preset over a Kit component.** `ui::button::Button` wraps the
   Kit `Button` with Plexy's pill shape and sizes; `ui::surface::badge` wraps
   the Kit `Tag`.
3. **A Plexy component in `src/ui/`.** Only for things the Kit lacks: artwork
   frames (`ui::artwork`), the media-toned player menus (`ui::menu`), glass
   buttons over artwork (`Button::…glass().build_div()`), settings cards and
   rows (`ui::surface`).
4. **Inline `div()` styling in a screen** only for one-off layout. If you
   write the same thing twice, move it to `src/ui/`.

Never pull a widget out of `PlayerView` by borrowing `&self`: components take
plain data and callbacks.

## Theme

`theme.rs` holds Plexy's HeroUI tokens (`theme::surface()`, `theme::accent()`,
…). `theme::apply_kit_theme` copies them into the Kit theme at startup and on
every light/dark switch, so Kit components already draw in Plexy's colors.
Don't hard-code colors in screens; add a token instead.

## Buttons

```rust
use crate::ui::button::Button;

Button::new("save", "Save").primary().build().on_click(...)      // the one main action
Button::new("rescan", "Rescan").icon(Icon::Refresh).build()       // everything else (secondary)
Button::new("clear", "Clear cache").outline().build()             // on busy surfaces
Button::icon_only("remove", Icon::Trash).danger_hover().build()   // row actions
Button::new("reset", "Reset…").danger().build()                   // destructive
Button::new("play", "Play").glass().large().build_div()           // over artwork only
```

Sizes: `.small()` 28 px, default 32 px, `.large()` 40 px. Add `.loading(busy)`
while work runs.

## Settings pages

```rust
use crate::ui::surface::{card, card_header, row, rows, badge, Tone};

card()
    .child(card_header(Some(Icon::Film), "TMDB metadata", Some(desc), Some(trailing)))
    .children(rows(vec![
        row("Region", Some(hint), select).into_any_element(),
        row("Refresh", Some(hint), button).into_any_element(),
    ]))
```

The label and description go on the left and the control on the right. Each
row holds one setting. A card's trailing slot never shrinks, so long
descriptions wrap instead of clipping the action.

## Artwork

Use `ui::artwork::frame(radius)` with `art(image, radius)` inside it. Images
round their corners at the frame's clip, so hover-grown art never shows
square corners. Don't add masks or put backgrounds on the growing layer.

## Motion

Name a token from `ui::motion::MotionSpec`, never a raw duration:

| Token | Use |
| --- | --- |
| `instant()` 90 ms | press feedback, icon swaps |
| `fast()` 140 ms | hover, tab selection |
| `base()` 200 ms | buttons, toggles, chevrons |
| `page()` 240 ms enter + `PAGE_RISE` | page and settings section entrance |
| `overlay_in()` / `overlay_out()` | menus and popovers (exits are faster) |
| `hero()` 700 ms | hero crossfade and copy |

- One-shot entrance: `el.with_animation(id, MotionSpec::page().animation(), …)`.
- Interruptible state (hover, open/close): `el.with_tween(id, target, spec, …)`,
  which retargets from the current value instead of snapping.
- Animate opacity and paint offsets (`top`), not margins or sizes, so a
  transition doesn't re-lay out the page every frame.
- GPUI and the Kit honour the system's reduced-motion setting. Don't call
  `cx.notify()` or `request_animation_frame()` from render to drive motion.

Kit guidance: <https://gpui-kit.com/docs/animation/>.

## Player chrome and the video view

The libmpv surface is a GPUI `NativeView`, drawn beneath the player chrome.
GPUI 0.3 only calls mouse listeners on hovered elements, and the video view
blocks hover for everything painted before it. So pointer handling lives on
`player-chrome-layer`, the full-size layer above the video. Put new player
mouse handlers there, not on the player root.

## Floating layers

Anything drawn over other content (the top nav over a scrolling page,
popovers, menus, dismiss layers) must call `.occlude()`. GPUI otherwise
delivers clicks and hover to whatever is underneath, so a click on the nav
can play the episode card scrolled beneath it.
