# Rust player motion engine and performance

Design document for `apps/player-gpui`, pinned to **GPUI 0.2.2**. **No source
was changed for this pass.** The component and icon proposals live in
[UI_KIT.md](UI_KIT.md).

## 1. Summary

The app is not in a frame-rate emergency today. It feels flat because most
state changes are instantaneous and the few animations use a single easing, no
exit, and a second 30 Hz clock. It also has one smoothness bug waiting to
happen: UI motion driven by the playback timer instead of the display clock.

The symptoms are visible:

- 45 `.hover()`, 14 `group_hover()` and 3 `.active()` calls snap to their end
  state. Menus, dropdowns, the volume popover, the seek thumb, toggles and
  play/pause icons appear or change with no transition.
- The player chrome fades in fixed 0.25/0.12 steps on the 33 ms playback
  timer, not with time-based easing at display refresh. Fast on a fast tick,
  slower when the tick runs late; linear either way.
- The OSD is sampled from `Instant::elapsed()` inside that same 30 Hz tick.
- The hero is a flat image crossfade. Copy rises via layout offset; dots change
  color instantly and only animate width; there is no ambient depth.
- Entrances exist; exits almost never do. The page enter is a 140 ms
  0.94 → 1 opacity change — intentionally subtle on the web, nearly invisible
  here.
- Continuous animations re-render the whole `PlayerView`, and the Home/Library
  render path recomputes heroes, shows, movies and card art every frame. That
  is the latent performance problem: it may be fine at rest, but it is the
  first thing that will stutter once every hover is animated.

So the work splits in two:

1. **Smoother:** move UI animation off the playback tick onto the display
   clock, make it time-based, and remove per-frame data recomputation.
2. **Richer:** give every interaction a designed response, add exits and
   choreography, and use the motion vocabulary the web app already defines.

### Feasibility verdict

- **Reusable UI kit:** yes. It is a module extraction with a strict dependency
  rule; no visual redesign is required. See [UI_KIT.md](UI_KIT.md).
- **Separate motion engine:** yes. GPUI 0.2.2 already exposes element state and
  frame scheduling; a target-driven tween/presence layer can be built in the
  crate with no new dependency.
- **Full web motion parity:** no, not pixel-for-pixel. GPUI 0.2.2 has no style
  transforms and cannot transform artwork, so the web card zoom is emulated by
  growing and clipping the art inside a fixed frame (as `lift` does), which is
  layout work. SVG rotates and scales, so icon motion can match.

## 2. Current animation inventory

| # | Surface | Trigger | Current implementation | Why it feels weak |
| --- | --- | --- | --- | --- |
| 1 | Hero copy (`shell_ui::render_hero`) | slide change | 700 ms `ease_out_quint`, 60 ms per-child stagger via two-animation delay hack; animates `opacity` + `top` 12 px | Every child is its own animation/layout wrapper; delay produces frames that do nothing; layout offset rather than paint-only |
| 2 | Hero copy (`shell_ui::rise`) | title page | Same recipe, content-scoped id | Duplicate helper; same layout cost |
| 3 | Hero image crossfade | slide change | 700 ms opacity 0 → 1 over the previous image | Flat dissolve; no layered scrim movement; rapid changes can expose an intermediate slide |
| 4 | Hero dots | slide change | 300 ms width 8 ↔ 20, `ease_out_quint`; background snaps | The active color change is instant, so the dot "pops" while the width glides |
| 5 | Top-nav active label | active nav | 200 ms width 0 → measured + opacity | Exit is instant; width animation reflows the nav group |
| 6 | Dropdown | open | 140 ms opacity; measured trigger position, flip/align and window margin | Entrance only; no exit; static `"dropdown"` id; anchoring is custom global-state code |
| 7 | Page enter | screen change | 140 ms opacity 0.94 → 1 on the whole page | Too subtle to read as a transition; wraps the entire page subtree |
| 8 | Player chrome | pointer/play state | `controls_opacity += ±step` in `tick()` (33 ms) | Frame-dependent, linear, 30 Hz; not an animation |
| 9 | OSD (play/pause/seek flash) | action | `age` → opacity 1 until 600 ms, then out by 900 ms; icon size 1.12 → 1 over 250 ms | Sampled at 30 Hz; size is layout; no interruptible fade |
| 10 | Subtitle spinner | search busy | 900 ms repeat, opacity `0.4 + 0.6·sin(πt)` | Pulses instead of rotating; `Animation::repeat()` keeps a frame loop for as long as it is mounted |
| 11 | Hover / press | everywhere | 45 `.hover()`, 14 `group_hover()`, 3 `.active()` paint-time styles | Instant; no transition duration, no glow ramp for most controls |
| 12 | Volume popover | hover/until timer | `when(open)` adds/removes the element | Appears/disappears with no motion |
| 13 | Player menus | open/close | `when_some(menu)` adds/removes | Instant; no slide/fade; no exit |
| 14 | Up next card | near end/ended | Appears fully rendered; countdown text changes per second | No entrance, no attention cue, countdown jumps |
| 15 | Toggle | click | `justify_end` flips; colors snap | The knob teleports |
| 16 | Segmented / chips / tabs | click | Background/text colors snap | No shared selected-pill motion |
| 17 | Seek bar | hover/drag | Height 3 → 6 px and thumb opacity 0 → 1 snap | The most-used player control has no micro-feedback |
| 18 | Progress bar/ring | tick | Width/fraction jumps at 30 Hz | Visible stair-stepping on short content; ring has no catch-up |
| 19 | Play/pause, mute, fullscreen icons | state | Icon path swaps instantly | Visual discontinuity in the primary control |
| 20 | Sidebar/settings selection | click | Background + accent bar snap | The selection indicator jumps between rows |
| 21 | Card lift | card hover | 220 ms `ease_out_quint` changing width/height/left/top by 3%; art fixed wrapper is unclipped | Layout animation; art, badges, veil and actions grow past the card; primary hover-bleed cause |

Since the first audit, the working tree added `hover_ring`, `corner_mask`,
`episode_tile` and `lift`. The veil/overlays use instant `group_hover`; `lift`
is a 220 ms layout animation. Their clipping/light-theme bug is a
visual-correctness item (UI_KIT hotfix H2), not something to animate around.
Fix the frame before tuning the lift.

## 3. How GPUI 0.2.2 actually animates

These facts determine the engine design. They come from the pinned crate
source (`gpui-0.2.2/src/elements/animation.rs` and `window.rs`).

1. `with_animation(id, Animation, animator)` is an `Element` wrapper. Its
   state is `{ start: Instant, animation_ix: usize }`, keyed by the element's
   global id (the parent id path). `animator(element, t)` is called on every
   layout pass with an eased `t`.
2. It computes `t = start.elapsed() / duration`, so it is **time-based**, not
   frame-count-based. That part is already good.
3. While not done, it calls `window.request_animation_frame()`. That schedules
   `cx.notify(current_view)` on the next frame — **the whole `PlayerView`
   re-renders**, not just the animated element.
4. When `t > 1`, it either moves to the next animation in
   `with_animations([...])` or marks the element done. There is no native
   delay, no completion callback, no interruption/velocity, and no target
   change: the animation is a one-shot from 0 to 1.
5. There is **no transform in `Style`** in 0.2.2. You cannot scale or translate
   a `div`/image. Only `Svg` exposes
   `with_transformation(Transformation::{rotate, scale, translate})`, and it
   is paint-only (does not affect layout or hitboxes). `Window::paint_image`
   has no transformation parameter.
6. `with_animations` is used today to fake a delay with a zero-easing first
   animation. It works, but during the delay the element still requests
   animation frames, re-runs layout, and applies the hidden state. For a
   five-child hero stagger this is wasted work.
7. Because the animation state is keyed by tree position/id, the same id with
   different content at the same position reuses the finished state and will
   not replay. A removed element's state is dropped, but a still-mounted
   element that changes its target needs a different id or a new engine.
8. `request_animation_frame()` gives display-refresh pacing (60 Hz, or 120 Hz
   on ProMotion). That is the right clock for UI motion. The 33 ms playback
   timer is the wrong clock for UI motion.
9. `window.on_next_frame` and `request_animation_frame` can also be used by a
   custom element to keep its own loop alive only while a tween/spring is
   active.

The practical conclusion: keep GPUI's clock, but stop using one-shot
`with_animation` for interactive state. Build a small target-driven element
that can interrupt, delay, spring, and finish quietly.

## 4. Motion language

The web app's tokens are the reference:

- `--ease-out: cubic-bezier(0.23, 1, 0.32, 1)`
- page enter 140 ms opacity-only (intentional; it avoids a hero flash)
- hero copy 700 ms with 60 ms stagger
- hero crossfade 700 ms
- card hover 500 ms (web transform); dots 300 ms
- card border 240 ms

Adopt those values, add the missing interaction tiers, and keep one place for
them.

### Durations

| Token | Value | Use |
| --- | ---: | --- |
| `INSTANT` | 90 ms | press feedback, icon swap, focus ring |
| `FAST` | 140 ms | hover, chip/tab selection, tiny fades |
| `BASE` | 200 ms | buttons, fields, toggles, chevrons |
| `SLOW` | 300 ms | dots, selected indicators, page content |
| `OVERLAY` | 180 ms in / 140 ms out | menus, popovers, dropdowns |
| `HERO` | 700 ms | hero crossfade + copy |
| `AMBIENT` | 8–12 s | optional slow scrim drift; never required for comprehension |

Rules:

- Most UI feedback ≤ 200 ms.
- One hero-scale moment per screen.
- Exits are 20–30% faster than entrances.
- Never animate a delay longer than 240 ms before content is readable.

### Easings

| Token | Curve | Use |
| --- | --- | --- |
| `STANDARD` | `cubic-bezier(0.23, 1, 0.32, 1)` | entrances, hovers, most transitions |
| `ENTER` | `cubic-bezier(0.16, 1, 0.30, 1)` | overlays, page content |
| `EXIT` | `cubic-bezier(0.40, 0, 1, 1)` | dismissals |
| `IN_OUT` | `cubic-bezier(0.65, 0, 0.35, 1)` | size/position moves |
| `LINEAR` | linear | continuous rotation only (spinner) |

`ease_out_quint()` is a good approximation of `STANDARD`; implement the exact
bezier in `ui::motion::easing` so the web and Rust apps stay aligned. Clamp all
eased output to `[0, 1]` for opacity and color; a spring may overshoot a size
or offset, but not alpha.

### Stagger

- 60 ms per hero copy child, 5 children maximum.
- 40 ms per list item only on first paint of a *featured* row, never on
  scroll or hover.
- Cap total choreography at ~300 ms; don't make the user wait for the last
  item.

### What animates vs. what snaps

| Animate | Snap |
| --- | --- |
| Opacity, background/border/text color, shadow | Content changes and text edits |
| Card lift (2–3 px, leaf only), overlay reveal | Scroll position |
| Menu/popover enter/exit | Window resize |
| Selected pill/toggle knob | Playback seek commit |
| Hero crossfade/copy/dots | Progress values that update every tick (smooth at most with a short catch-up) |
| Spinner rotation, chevron rotation (SVG) | Critical error text |

## 5. Engine design

Add `src/ui/motion/`:

```text
ui/motion/
  mod.rs          re-exports MotionSpec, Easing, helpers
  tokens.rs       durations, staggers, spring presets
  easing.rs       exact cubic-bezier, ease-out variants, clamp
  tween.rs        Tween element: target-driven, interruptible, delayed
  spring.rs       optional damped-spring value for hover/press
  presence.rs     mount/unmount with exit animation
  choreography.rs staggered helpers
  interaction.rs  HoverTarget / PressTarget state
  reduce_motion.rs preference plumbing
```

Nothing outside `ui/motion` should import `gpui::Animation` or name a UI
duration. The engine is internal to the crate; no new dependency.

### 5.1 Target-driven tween

The core is a custom `Element`, modeled on `AnimationElement` but with a
target instead of a one-shot timeline:

```rust
pub struct MotionSpec {
    pub duration: Duration,
    pub delay: Duration,
    pub easing: Easing,
}

pub struct Tween<E> {
    id: ElementId,
    target: f32,              // the value this render wants
    spec: MotionSpec,
    element: Option<E>,
    animator: Box<dyn Fn(E, f32) -> E>,
}

struct TweenState {
    value: f32,
    from: f32,
    target: f32,
    started: Instant,
    delay_until: Instant,
    done: bool,
}
```

On each `request_layout`:

1. Read the previous state with `window.with_element_state(global_id, …)`.
2. If `target` changed, rebase: `from = current value`, `target = new target`,
   `started = now`, `delay_until = now + delay`, `done = false`. This is the
   interruption path. If the user leaves a card mid-fade, it eases back from
   where it is instead of snapping to the start.
3. Sample `t = clamp((now - started - delay) / duration, 0, 1)`, apply easing,
   store `value`.
4. Call the animator with the value.
5. If not done, `window.request_animation_frame()`.
6. When done, stop requesting frames.

This gives delay without the zero-easing hack, interruption without id
churn, and completion without a separate timer.

API sketch:

```rust
ui::motion::tween(
    ("card-hover", key.encode()),
    if hovered { 1.0 } else { 0.0 },
    MotionSpec::fast(),
    |el, t| el
        .border_color(lerp_hsla(theme::border(), snow(0.28), t))
        .opacity(0.9 + 0.1 * t),
);
```

The animator receives the already-eased value. For values that need a
different range, use `lerp(a, b, t)` inside the closure.

Important: the engine only requests frames while at least one tween is
active. A finished hover costs nothing. Do not attach a tween to every card in
a grid; only the currently hovered/selected one.

### 5.2 Presence (exit animations)

GPUI removes an element as soon as the parent stops rendering it. To animate
out, the element must stay mounted for the exit duration. `presence` wraps
that policy:

```rust
pub fn presence(
    id: impl Into<ElementId>,
    open: bool,
    enter: MotionSpec,
    exit: MotionSpec,
    child: impl FnOnce() -> AnyElement,
) -> impl IntoElement;
```

Behavior:

- `open = true`: mount, tween 0 → 1.
- `open = false` while mounted: keep rendering the last child for
  `exit.duration`, tween 1 → 0, then render an empty element.
- Reopening during the exit reverses from the current value.
- The wrapper remains in the tree, so clicks must be disabled once the exit
  starts; otherwise an invisible overlay can eat the first click.
- Use it for dropdowns, player menus, the volume popover, the collection
  picker, and the Up next card.

For pages, use a simpler rule: a 140–160 ms opacity/6 px content fade keyed by
screen, and do not retain the previous screen unless it can be rebuilt from a
cheap cached model. Retaining the whole old screen is usually more expensive
than the transition is worth.

### 5.3 Springs

GPUI 0.2.2 has no spring API. A damped spring is still useful for hover/press
because it gives velocity continuity that a duration curve cannot:

```text
v += (-stiffness * (x - target) - damping * v) * dt
x += v * dt
```

- Integrate with the real frame delta, clamped to e.g. 1/120 s.
- Stop when `|x - target| < epsilon` and `|v| < epsilon`.
- Use critically damped presets for opacity and colors; a little overshoot is
  acceptable for an offset/size but must be clamped in the animator.
- Start with one preset for hover (`stiffness ≈ 300`, `damping ≈ 30`) and one
  for press (`stiffness ≈ 500`, `damping ≈ 35`). Tune by feel, not by
  spreadsheet.

Do not use springs for the hero or page transitions; those want predictable
timing. Duration curves are easier to choreograph and screenshot.

### 5.4 Interaction state

Hover and press need a value the component can read each render. Two tiers:

1. **Leaf micro-feedback:** keep GPUI's `.hover()`/`.active()` for tiny
   controls where a 90 ms color change is enough. This is already instant and
   has no state cost.
2. **Animated surfaces:** screens pass `hovered` / `pressed` into composite
   components. A `HoverTarget` helper in the screen state stores the current
   key:
   ```rust
   pub struct HoverTarget { current: Option<SharedString> }
   impl HoverTarget {
       pub fn set(&mut self, key: Option<SharedString>, cx: &mut Context<Self>) -> bool;
       pub fn is(&self, key: &str) -> bool;
   }
   ```
   Only one poster card is `hovered` at a time, so one tween runs, not fifty.
   The same pattern drives `pressed` for the hero buttons and nav.

Why not a global hover registry: transient UI state should be owned by the
view that renders the elements. A global map adds cleanup and cross-view
lifetime rules for very little reuse. If the kit later needs a stateful
button entity, it can wrap this helper.

### 5.5 Keyframes for the OSD

The OSD has a defined shape: pop in (scale/opacity), hold, fade out at
600–900 ms. Model it as keyframes rather than a tick:

```rust
keyframes(id, total, &[
    (0.00, 1.12), (0.28, 1.00), (0.66, 1.00), (1.00, 0.92),
], |el, scale| el ...);
```

The OSD is then driven by one display-clock animation keyed by a timestamp or
sequence number. It ends and stops requesting frames; the old 30 Hz sampling
in `tick()` can be deleted. Opacity can use the same timeline:
`0 → 1 by 8%`, hold to 66%, `1 → 0` by 100%.

## 6. Performance plan

### 6.1 The real costs

| Cost | Where | Fix |
| --- | --- | --- |
| Full-view re-render per animation frame | `request_animation_frame` notifies the current view | Accept for now; it is the GPUI model. Keep animated subtrees small and don't animate forty cards at once. |
| Home recomputes heroes/shows/movies per render | `render_home_page`, `heroes()`, `visible_shows()`, `visible_movies()`, `card_art()` | Build a `HomeModel` once in `reload_catalog()`; invalidate on catalog/metadata/personal changes |
| `card_art` calls `shows()` per card | `continue_card` → `card_art` | Precompute `show_key → backdrop` and `episode path → still` maps |
| Library recomputes Top 10 with `plays()` per title | `render_library_page` | Build counts in one pass over history/progress; cache with the model |
| 30 Hz playback tick | `PlayerView::tick` (33 ms while media) | Keep for playback state; remove UI fades from it. Later split the seek bar into a child entity if profiling shows it matters. |
| Path/icon strings allocated per render | `format!("icons/{name}.svg")`, `format!` element ids | Static `Icon::path()`; derive ids from stable keys and reuse where practical |
| Image decode/reupload | `assets::artwork_cover` | Already cached (128 entries / 64 MB, max 2 decodes); don't animate image size or trigger new decodes per frame |
| Hidden animations | repeat spinner, mounted overlays | Stop when unmounted; `Presence` unmounts after exit; don't use `Animation::repeat()` for non-visible elements |

The current image cache is a good piece of engineering: it defers the lookup
to paint, skips off-screen cards with `content_mask`, and bounds decodes. The
motion work should not disturb it.

### 6.2 Memoization contract

Add to `PlayerView`:

```rust
struct HomeModel {
    heroes: Vec<Hero>,
    continue_watching: Vec<Item>,
    watchlist: Vec<TitleView>,
    recent_shows: Vec<TitleView>,
    recent_movies: Vec<TitleView>,
    show_backdrops: HashMap<String, Option<PathBuf>>,
}
```

Rebuild it in `reload_catalog()` (and after a personal-mark change), not in
`render_home_page()`. Keep `tick_hero()` reading the cached `heroes.len()`.
This removes the per-frame sorting and cloning during the 700 ms hero
crossfade, which is exactly when the app must stay at display refresh.

The Library page similarly needs a cached model for:
- `all` sorted/filtered titles;
- `genre_counts` (currently rebuilt from all metadata each render);
- Top 10 play counts (one pass, not per-title `plays()`);
- the resolved backdrop for each top card.

### 6.3 Paint-only rules

Prefer, in order:

1. **Opacity** on a small overlay layer.
2. **Colors** (background, border, text) on a leaf.
3. **Shadow** (if it does not re-layout).
4. **SVG transform** (icons only).
5. **Size/inset/margin** on a small leaf, only when unavoidable.

Do not animate layout on:
- the page container;
- a poster grid/row;
- text blocks with wrapping content;
- the hero copy container as a whole.

The current `rise` uses `top` on a wrapper; keep it for the hero (it is the
only way to get a rise in 0.2.2), but animate only the leaf wrapper and use
one animation for the whole copy block where possible, not five independent
layout wrappers.

The current `lift` animates width/height/left/top on card art. It is a
deliberate exception because GPUI has no image transform. Keep it clipped to
the art layer, limit it to the one hovered card, and profile it. If it breaks
the frame budget, fall back to a fixed art layer plus the veil/border ramp
instead of animating layout.

### 6.4 The frame loop

- One display-clock animation per visual effect; no `Instant::elapsed()`
  sampled in `tick()` for opacity.
- `tick()` remains the playback/data clock. It should notify for new playback
  state, not to advance UI fades.
- All motion frame requests come from `ui::motion` elements. When no tween is
  active, the app is idle.
- Don't run a 30 Hz fade next to a 60 Hz tween on the same element; the slower
  clock wins visually and doubles the work.
- Avoid `Animation::repeat()` except for an actually visible spinner. A
  repeated animation keeps notifying the view forever.

### 6.5 Frame budget and measurement

Targets for the release build on the target Mac:

- Every transition completes without a dropped frame at 60 Hz in the common
  case; 120 Hz where the display supports it.
- No single frame during a hero crossfade or hover exceeds ~16 ms of CPU+GPU
  work (measure, don't guess).
- No more than one hero-scale animation and a handful of small tweens at once.
- Idle library screen: zero animation-frame notifications when nothing is
  happening.

Instrumentation to add behind a debug env var (`PLEXY_MOTION_STATS=1`):

- Count animation frames per second while any motion is active.
- Log transitions that run longer than their spec (late frames).
- Log `render_home`/`render_library` model rebuilds vs cached renders.
- Optionally track the slowest frame in a rolling window.

Use Instruments (Time Profiler / Animation Hitches) for the real check; the
logs are for spotting accidental perpetual animations.

## 7. Surface-by-surface spec

Ordered by user impact. Each item states the target, not an implementation
mandate.

### P0 — correct the clocks (no visual redesign)

| Surface | Target |
| --- | --- |
| Player chrome | Time-based 180 ms in / 220 ms out, `STANDARD`; interruptible on pointer/pause/menu changes; stop notifying when fully hidden |
| OSD | Display-clock keyframes, 900 ms total; no 30 Hz sampling; stop frames at the end |
| Spinner | 1 s repeat while busy: either rotate the static glyph or build an 8-segment opacity cycle; only while the request is busy |
| Play/pause and mute icons | 90 ms crossfade or a swap keyed by state; no layout change |

Acceptance: on a paused frame, the chrome no longer steps in 4/9 visible
increments; the OSD fades smoothly; idle CPU drops when no overlay is visible.

### P1 — interaction feedback

| Surface | Target |
| --- | --- |
| Poster/wide/episode cards | 140 ms border/overlay ramp, 2–3 px art lift (leaf), caption meta color ramp; one hovered card at a time; all of it inside a clipped `ArtworkFrame`; badges/progress/actions stay fixed |
| Buttons/chips/segments | 90–140 ms background/border/text ramp; pressed state 90 ms; selected pill moves/settles (spring or 200 ms) |
| Toggle | 160 ms knob slide + track color; `STANDARD` |
| Seek bar | 140 ms track height and thumb opacity; keep the preview instant |
| Nav items | 140 ms background; active label exit as well as enter |
| Progress bar/ring | optional 200 ms catch-up tween when the fraction changes; never block the next seek |

Acceptance: every clickable surface has a visible press response; hovering a
card is a smooth ramp, not a snap; no card animation causes the grid to
reflow; no hover frame shows a square corner or a page-colored wedge in either
theme.

### P2 — overlays and transitions

| Surface | Target |
| --- | --- |
| Dropdown/menu | 180 ms enter (opacity + 4 px), 140 ms exit; presence; `MenuPanel` + `MenuRow` geometry; closed state not clickable |
| Volume popover | 140 ms enter/exit, slight upward drift |
| Collection picker | Same as dropdown; no layout jump in the title page |
| Page content | 160 ms fade + 6 px rise for non-Home pages; Home keeps the web's opacity-only 140 ms enter so the hero does not flash |
| Up next card | 200 ms enter from the bottom-right; countdown number ticks with a 120 ms fade, not a jump |

Acceptance: overlays never disappear in one frame; clicking during an exit
does not hit an invisible layer; opening a menu twice does not stack copies.

### P3 — hero choreography

| Surface | Target |
| --- | --- |
| Hero image | Two-slot crossfade, 700 ms; key by title identity, not slide index; no intermediate slide on rapid next/prev |
| Hero copy | One staggered timeline (700 ms, 60 ms per child) instead of five independent layout wrappers; content key includes the title |
| Hero dots | 300 ms width and color; active dot eases to full white; click is immediate |
| Hero scrim | Optional 700 ms opacity breathing on a separate gradient layer — cheap depth without touching the image |
| Hero actions | Primary pill settles in last; no more than one extra motion after the copy |

Acceptance: advancing rapidly through five slides never shows a blank or
half-faded hero; the first two copy children are readable by ~250 ms and the
block is settled by ~1 s; reduced-motion mode is a cut.

### P4 — restraint/polish

- Star rating hover/fill ramp.
- Checkmark pop (SVG scale) on watched toggles.
- Sidebar active indicator slide.
- Focus ring fade for keyboard users.
- No ambient motion on Library/Settings; one hero moment is enough.

## 8. Rollout

**Prerequisite:** finish UI_KIT hotfix H1 (menus) and H2 (artwork frames)
before P1. Animating an unclipped frame, or a menu that is about to change
geometry, only advertises the bug.

### Phase 0 — instrument and freeze the baseline

- Capture the current Home/Library/Show/Player at rest and mid-transition.
- Add motion stats and model-rebuild counters (debug only).
- Record current frame timing during hero advance and a player menu open.

### Phase 1 — engine + P0

- Add `ui/motion` (tween, easing, presence, tokens).
- Replace chrome fade, OSD, spinner and icon swaps.
- Keep the playback tick for playback.
- Acceptance: the P0 checks, no visual change at rest, `cargo test`.

### Phase 2 — interaction + memoization

- Add `HomeModel`/`LibraryModel` and remove per-frame recomputation.
- Add card/button/toggle/seek/nav feedback.
- Acceptance: hero advance holds display refresh while hovering cards;
  one tween per surface; no grid reflow.

### Phase 3 — overlays

- Add presence and port dropdowns, player menus, volume, picker, Up next.
- Acceptance: enter/exit both visible; no ghost clicks; Escape/outside click
  unchanged.

### Phase 4 — hero + reduced motion

- Two-slot crossfade, one copy timeline, dot color, optional scrim.
- Add the Reduce Motion setting and route every helper through it.
- Acceptance: rapid slide changes stay coherent; reduce-motion removes
  spatial movement and stagger, keeps instant state changes.

### Phase 5 — gallery + guardrails

- Motion presets in the component gallery with replay buttons.
- Grep/test gate: no raw `Animation`/durations outside `ui/motion`; no
  per-frame model rebuilds in render.
- Update [UI_KIT.md](UI_KIT.md) if component APIs changed.

## 9. Gotchas

- **Animation ids are identity.** A list that keeps the same index but changes
  content will reuse the previous state. Use content keys for carousels,
  cards and lists.
- **Removing an element skips the exit.** `when(open, …)` cannot animate out;
  use `Presence` and keep the child mounted for the exit duration.
- **Do not nest two clocks.** A 30 Hz manual fade under a 60 Hz tween looks
  like dropped frames.
- **GPUI 0.2.2 cannot scale artwork.** Do not fake a card zoom by animating
  image width/height; it re-layouts and re-samples. Use the web's 3 px lift as
  a border/overlay/offset adaptation, or wait for a GPUI version with
  transforms.
- **Opacity is cheap, layout is not.** The hero copy `top` animation is a
  deliberate exception; keep it leaf-local.
- **Do not animate while data is still being computed.** Memoize first, then
  animate; otherwise the animation becomes a profiler for `heroes()`.
- **Reduced motion is not just shorter durations.** Remove the spatial
  movement and stagger; keep opacity changes near-instant.
- **`Animation::repeat()` never stops on its own.** Tie it to the visible
  spinner only.
- **Exits must disable hit-testing.** An invisible overlay that still eats
  clicks is worse than no animation.
- **Theme switches re-render.** Never capture `theme::foreground()` in a
  long-lived struct; read it in render or interpolate from current tokens.

## 10. Acceptance checklist

- [ ] Chrome fade and OSD are display-clock animations, not `tick()` steps.
- [ ] Every overlay has a designed exit and cannot receive clicks while
      invisible.
- [ ] Hover/press on cards, buttons, toggles, segments, seek bar and nav is a
      visible ramp, not a snap.
- [ ] All hover layers live inside a clipped `ArtworkFrame`; no square corners
      or page-colored wedges in light or dark theme.
- [ ] Dropdowns and player menus use the same `MenuPanel`/`MenuRow` geometry
      (app tone vs media tone), including settings and track lists.
- [ ] Hero copy uses one timeline and content-keyed ids; rapid next/prev never
      blanks the image.
- [ ] No screen render path recomputes heroes/shows/card art per frame.
- [ ] Idle UI requests no animation frames.
- [ ] No raw `gpui::Animation` or UI duration outside `ui/motion`.
- [ ] Reduce Motion is honored across all helpers.
- [ ] `cargo test --locked --release -- --test-threads=1` and the README
      self-tests pass; screenshots at rest match the pre-refactor baseline.

## Appendix A — easing reference

```rust
pub fn cubic_bezier(x1: f32, y1: f32, x2: f32, y2: f32) -> impl Fn(f32) -> f32 {
    move |t| {
        // Solve x(u) = t for u (Newton + bisection fallback), then return y(u).
        // STANDARD = (0.23, 1.0, 0.32, 1.0)
        // ENTER    = (0.16, 1.0, 0.30, 1.0)
        // EXIT     = (0.40, 0.0, 1.0, 1.0)
        // IN_OUT   = (0.65, 0.0, 0.35, 1.0)
    }
}

pub fn ease_out_quint(t: f32) -> f32 { 1.0 - (1.0 - t).powi(5) }
pub fn lerp(a: f32, b: f32, t: f32) -> f32 { a + (b - a) * t }
```

Cache the bezier samples or use a small lookup table if it is evaluated for
many elements per frame; the curve is constant per spec.

## Appendix B — suggested tests

- Easing endpoints (`0 → 0`, `1 → 1`) and monotonicity for the standard
  curves.
- `lerp` endpoints and midpoint for colors, including alpha.
- Tween interruption: a target change mid-flight starts from the current
  value, not from 0 or 1.
- Presence: open → close → reopen within the exit window reverses without a
  flash.
- Reduce motion: all specs collapse to a cut, no stagger.
- Icon parity: every `Icon::all()` has an asset and every asset is mapped.
- Model cache: changing a mark/metadata epoch rebuilds once, rendering does
  not rebuild.

## Appendix C — reference links

- Component and icon plan: [UI_KIT.md](UI_KIT.md)
- Web easing/timing origin: `apps/web/src/styles.css`,
  `apps/web/src/components/home-hero.tsx`
- GPUI 0.2.2 animation source:
  `gpui-0.2.2/src/elements/animation.rs`
- GPUI frame scheduling: `gpui-0.2.2/src/window.rs`
  (`request_animation_frame`, `with_element_state`)
