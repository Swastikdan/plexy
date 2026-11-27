# Rust player UI — orchestration and handoff

This is the parent document for the Rust player UI work. Read it first, then
the two children:

| Document | What it owns |
| --- | --- |
| **This file** | Order of work, current status, handoff protocol, verification matrix, append-only log |
| [UI_KIT.md](UI_KIT.md) | Reusable components, typed icons, tokens, scene workflow, canonical menu and artwork specs, migration phases |
| [MOTION.md](MOTION.md) | Animation audit, GPUI 0.2.2 constraints, motion engine, performance/memoization plan, motion rollout |

**Status:** design and audit complete; implementation not started. No Rust
source was changed by the documentation pass.

**Next action:** HOT-1 — implement the canonical `MenuPanel`/`MenuRow`/
`Dropdown` from [UI_KIT.md §6.1](UI_KIT.md#61-canonical-menu-and-dropdown) and
adopt every menu. Then HOT-2 (artwork frames), then HOT-3 (light theme).

**Last updated:** 2026-11-27 19:38 IST.

## 1. Working rules

- `apps/player-gpui` has uncommitted UI parity work in flight. Check
  `git status` and `git diff` before editing. Never revert, reformat or
  "clean up" files you did not intentionally change.
- The current code is the visual source of truth. The web app is the reference
  where the Rust app is still catching up. The kit is **not** a new design
  language.
- Implement in small commits/patches. One component or one hotfix at a time.
  Do not combine the full extraction with a visual redesign.
- Every component change needs a before/after capture in **light and dark**
  theme, not just a compile.
- The player chrome always stays dark. App surfaces follow the theme. That is
  why the menu spec has `App` and `Media` tones, not one palette.
- If a doc detail no longer matches the code, fix the doc in the same change.
  Update this parent log before updating the children if the order of work
  changes.

## 2. Current snapshot

Taken from the working tree on 2026-11-27 around 19:25 IST. The tree is moving;
re-measure if the counts look stale.

| Item | Value |
| --- | --- |
| Crate | `apps/player-gpui` |
| Total Rust | ~10,570 lines |
| UI-facing files | `shell_ui.rs` ~2,300 · `app.rs` ~2,330 · `library_ui.rs` ~860 · `personal_ui.rs` ~820 · `theme.rs` 60 · `assets.rs` 184 |
| Icons | 68 SVGs, 272 KB, stringly typed |
| Type | 20 distinct font sizes |
| Radii | 10 distinct corner radii |
| Interaction | 45 `.hover()`, 14 `group_hover()`, 3 `.active()` |
| Animation | 7 `with_animation` + 2 `with_animations`; chrome/OSD still manual 30 Hz |
| Theme | dark + light tokens now exist; the player stays dark |

Structure today: most widgets are `impl PlayerView` methods, so they borrow
catalog/navigation state and cannot be reused. The shell, library, personal
and player files each own their own versions of buttons, cards and menus.

Recent tree changes that matter to this plan:

- Light theme tokens were added to `theme.rs`.
- `hover_ring`, `corner_mask`, `episode_tile` and a light-theme hero fade were
  added. Hover feedback is still instant.
- A `lift()` helper now animates card art to 103% over 220 ms by changing
  width/height/left/top. The art sits in a fixed wrapper that does not clip, so
  the grown image is the primary "bleeding out" cause.
- The shell dropdown now measures its trigger and flips/aligns itself with a
  window margin. Keep that behavior when extracting `Dropdown`; the remaining
  problem is item/panel geometry, not anchoring.
- Menu anatomy diverged further: shell dropdown items, player settings rows,
  player track rows and the collection picker are four different systems.
- Some episode art frames have no `overflow_hidden`, and one hover overlay has
  no radius. This is the rest of the reported bleed, most visible in light
  theme.

## 3. Status board

Legend: `TODO`, `IN PROGRESS`, `BLOCKED`, `DONE`.

| ID | Milestone | Status | Depends on | Done when |
| --- | --- | --- | --- | --- |
| ORCH-0 | Audit + docs + parent log | DONE | — | This file, UI_KIT.md, MOTION.md exist and link each other |
| HOT-1 | Canonical menus + dropdown behavior | TODO | ORCH-0 | Every menu in §6 uses one row/panel anatomy; dropdown checklist passes |
| HOT-2 | Artwork frame + hover clipping | TODO | ORCH-0 | `lift` grows only inside a clipped frame; no square corners/page-colored wedges on any card, either theme |
| HOT-3 | Light-theme regression pass | TODO | HOT-1, HOT-2 | Home/Library/Title/Search/Settings pass in light theme |
| KIT-0 | `src/ui` + tokens + typed icons | TODO | HOT-1, HOT-2 | `ui::icon`, tokens, asset-parity tests, gallery skeleton |
| KIT-1 | Foundation/media atoms | TODO | KIT-0 | Artwork frame, text, scrim, progress, badge, empty, spinner |
| KIT-2 | Controls | TODO | KIT-1 | Button, icon button, chip, toggle, segmented, field, stars |
| KIT-3 | Surfaces + cards | TODO | KIT-1 | Panel, settings card/row, poster/wide/episode/tile/cast |
| KIT-4 | Overlays | TODO | KIT-2, KIT-3 | Dropdown/menu/popover/presence, adopted everywhere |
| KIT-5 | Screens compose | TODO | KIT-4 | Feature files contain no duplicated visual recipes |
| MOT-0 | Motion engine + token layer | TODO | KIT-0 | Tween/easing/presence/spring in `ui::motion`; unit tests |
| MOT-1 | Chrome/OSD/spinner/icon swaps | TODO | MOT-0, HOT-2 | Display-clock, time-based, no 30 Hz UI fade |
| MOT-2 | Hover/press + memoization | TODO | MOT-1 | Smooth hover, one tween per surface, no per-frame model rebuild |
| MOT-3 | Overlay presence + page transitions | TODO | MOT-2, KIT-4 | Enter and exit; no ghost clicks |
| MOT-4 | Hero + reduced motion | TODO | MOT-3 | Two-slot crossfade, one copy timeline, reduced-motion setting |
| QA-1 | Scene gallery + screenshots | TODO | KIT-0 | Every scene/state/icon in the gallery, both themes |

## 4. Where the next agent starts

Do **HOT-1 first**, then **HOT-2**, then **HOT-3**. Do not start with motion.

Why this order:

1. They are user-visible issues today: inconsistent menus and hover bleed.
2. They create the first real kit modules (`ui/menu`, `ui/artwork`) instead of
   throwaway patches.
3. Motion (MOT-1 onward) must not animate an unclipped frame or a menu whose
   geometry is about to change.

Concrete first task:

1. Read [UI_KIT.md §6.1](UI_KIT.md#61-canonical-menu-and-dropdown).
2. Add `src/ui/menu.rs` (or equivalent) with `MenuPanel`, `MenuRow` and the
   `Dropdown` behavior contract.
3. Replace the shell dropdown rows first (Library sort, title more, season,
   Settings language), then the player Settings root and track menus, then
   the collection picker.
4. Capture every open menu in light and dark; tick the matrix in §6.
5. Update the status board and append a log entry, then move to HOT-2.

Do not attempt the whole `src/ui` tree in the same patch.

## 5. Canonical decisions (short form)

Full detail lives in the children; these are the non-negotiables.

### Menus and dropdowns

- One `MenuPanel`: `p(6)`, radius 12, max height 340 (app) / 560 (player),
  offset 6, `snap_to_window_with_margin(8)`.
- One `MenuRow`: 36 px single-line, 48 px two-line, 40 px navigation;
  `px(10)`, `py(6)`, gap 10, radius 8; label 13 semibold; detail/value 11
  muted; leading 16; trailing 15 check / 14 chevron.
- Variants: `Action`, `Radio`, `Navigation`, `Collection`.
- App tone follows light/dark tokens; media tone is always dark.
- A dropdown anchors to its trigger, flips when needed, closes on outside
  click/Escape/selection, and only one is open at a time.
- The current four systems (shell `menu_item`, player `menu_row`, player
  `settings_row`, collection picker) are the bug. Do not add a fifth.

### Artwork frames

- Every art frame: `relative`, `rounded(r)`, `overflow_hidden`, fixed size.
- Only the art layer may grow. Badges, progress, actions, veil and ring stay
  fixed at frame size; `lift` must not scale the decorations.
- Hover overlay: `absolute inset_0 rounded(r)`, inside the frame.
- Optional ring: inset 1 px, radius `r - 1`, border width always reserved; use
  a fixed snow ring over art, not `theme::foreground()`.
- `corner_mask` must use the actual local backdrop (`Page`, `Surface`,
  `Media`), never an unconditional page background. Keep it at frame size so
  a grown image gets rounded corners back.
- No frame/grid layout shift on hover. No square corners. No page-colored
  wedges.

### UI kit

- Source-owned (shadcn-style), in-repo, no new dependency.
- `ui` depends on `theme` + `assets`; it never imports `PlayerView`, catalog,
  feature modules or mpv.
- Props and callbacks in, elements out. Screens own state and side effects.
- Icons become a generated `Icon` enum with static `path()`; no string names
  or `format!("icons/…")` in screens.
- Scenes (Home, Library, Title, Search, Settings, Player, menus) are the
  visual regression harness. Components without a scene are not done.

### Motion

- The only place that names durations/easings is `ui::motion`.
- Display clock for UI; the 33 ms playback tick stays for playback only.
- Target-driven, interruptible tween; presence for exits; no raw
  `with_animation` in feature files.
- Memoize Home/Library models before animating hover; otherwise animation
  exposes the recompute cost.
- Fix clipping before hover motion.

## 6. Menu verification matrix

Every row must be checked in both themes. "Open" means the menu is visible and
anchored to its trigger, not simply rendered somewhere.

| Menu | Trigger | Expected |
| --- | --- | --- |
| Library sort | Library toolbar | anchored below, flips above near bottom, selected check on the right, 36 px rows |
| Title "more" | Title hero ⋯ | icon + label rows, check/danger states, closes on select/outside/Escape |
| Season picker | Show page | one row per season, selected check, scrolls if long |
| Settings language | Settings → Playback | same 36 px rows, no double padding, list scrolls, app tone |
| Player Settings root | Gear/more button | `Navigation` rows: 18 icon, 14 label, 12 value, 14 chevron |
| Player Audio/Subtitles | Settings submenu | `Radio` rows: 16 radio, 13 label, 11 detail, check optional |
| Player Speed/Chapters | Settings submenu | same radio/action rhythm as audio/subtitles |
| Collection picker | Title actions | fixed check slot, 36 px rows, no layout jump |
| Volume popover | Speaker | not a menu; shared popover surface/geometry only |

Behavior checks for each: outside click, Escape, trigger re-click, item click,
long-list scroll, selected visibility, window-edge flip, light/dark tone,
keyboard focus if implemented.

## 7. Hover/clipping verification matrix

| Surface | States |
| --- | --- |
| Poster cards | art/no art, progress, watched, hover (lift), light/dark |
| Wide + Continue cards | art/no art, progress ring/bar, badges, hover |
| Search episode tile | art/no art, action button, progress, hover (lift), light/dark |
| History episode tile | art, remove action, hover (lift), light/dark |
| Show-page episode card | art, progress, watched, hover (lift), light/dark |
| Top 10 card | art, rank overlap, hover (lift) |
| Title hero / genre hero | no card hover; check scrims in light theme |

Pass criteria: the image may grow **inside** its frame, but the frame, badges,
progress and actions stay fixed; no square dark/white corner; no page-colored
wedge; no frame/grid size change on hover; the pointer leaving removes the
hover state cleanly.

## 8. Work protocol

Before coding:

1. Read `AGENTS.md` at the repo root.
2. Read this file, then [UI_KIT.md](UI_KIT.md), then [MOTION.md](MOTION.md).
3. Run `git status --short` and inspect the diff for files you will touch.
4. Capture the current state of the scene you are changing, both themes.
5. Mark the milestone `IN PROGRESS` in §3.

While coding:

- One milestone per patch. If you discover a new issue, add it to §11 instead
  of silently expanding the scope.
- Prefer a new `ui/` module over another `PlayerView` method.
- Keep the old helper until all call sites are replaced and verified.
- Use the canonical measurements from §5; do not invent a new padding "just
  for this menu".

Before handoff:

1. `cd apps/player-gpui && cargo check`.
2. `cargo test --locked --release -- --test-threads=1`.
3. Launch the app and walk the verification matrix for the touched surface.
4. Capture after screenshots in both themes.
5. Update §3 (status + next), §6/§7 if the matrix changed, and append to §11.
6. State the exact next TODO and any blockers in the handoff message.

Useful commands:

```sh
cd apps/player-gpui
cargo check
cargo test --locked --release -- --test-threads=1
cargo run --locked --release
```

The README also documents `--self-test` and `--library-test`. They drive the
real window and write a JSON report; use them for playback regressions, not as
a substitute for the light-theme visual pass.

## 9. Overall definition of done

- [ ] HOT-1/HOT-2/HOT-3 pass the matrices above in both themes.
- [ ] One icon API, one menu anatomy, one artwork frame, one motion layer.
- [ ] `ui` has no imports from app/catalog/feature modules/mpv.
- [ ] Screens compose the kit; no duplicated visual recipes remain.
- [ ] Scenes + gallery cover the states in [UI_KIT.md §3](UI_KIT.md#scenes-how-the-kit-is-built-and-verified).
- [ ] Motion follows [MOTION.md](MOTION.md): display clock, exits, presence,
      memoized data, reduced motion.
- [ ] `cargo test --locked --release -- --test-threads=1` passes and the
      README self-tests pass.
- [ ] This parent log is current and names the next task.

## 10. Risks and open decisions

- **In-flight tree:** the UI parity work is uncommitted and moving. Re-read
  files before applying a patch; do not use stale line numbers from the docs.
- **GPUI 0.2.2:** no style transforms, no image scale; card "zoom" must be a
  color/overlay/leaf-offset adaptation. Only SVG rotates/scales.
- **Light theme:** recently added and less exercised. It is the required
  second pass for every visual change.
- **Dropdown state:** the current implementation uses global statics for
  dismissal (`DROPDOWN_DISMISSED`, `DROPDOWN_CLOSED`) and trigger measurement
  (`DROPDOWN_TRIGGER`). Encapsulate measurement in the `Dropdown` component
  and keep open/dismiss state in the screen; do not build more behavior on
  the statics.
- **Player tone:** app dropdowns follow the theme; player menus stay dark.
  This is intentional, not a theming bug.
- **Gallery scope:** keep scenes in the existing window behind a debug flag
  rather than a second app. Revisit only if startup/asset cost grows.
- **Reduced motion:** GPUI 0.2.2 exposes no OS preference. Start with an app
  setting; revisit on upgrade.

## 11. Orchestration log

Append a dated entry after each milestone. Do not rewrite history; correct a
previous entry with a new one if needed.

| Date (IST) | Actor | Change | Next |
| --- | --- | --- | --- |
| 2026-11-27 19:00 | docs pass | Audited UI and motion; created `UI_KIT.md` and `MOTION.md`; linked from the app README | Review the plan, then start extraction |
| 2026-11-27 19:25 | re-audit | Source changed after the first pass (light theme, `hover_ring`, `corner_mask`, `episode_tile`). Confirmed four menu item systems; identified episode hover clipping/radius and page-background corner mask as bleed contributors. Added canonical menu/artwork specs, scene workflow, and this parent log. | Start HOT-1: `ui::menu` + adopt all menus |
| 2026-11-27 19:32 | re-audit 2 | Source changed again. Added `lift()` (art grows 3% via width/height/left/top over 220 ms) and measured dropdown anchoring. `lift` is now the primary bleed cause because its fixed wrapper does not clip. Updated UI_KIT §6.2, motion counts (7+2 animations, 14 group_hover, 10,573 lines) and the hover matrix. | HOT-1, then HOT-2 with `ArtworkFrame::lift` |
|  |  |  |  |

### Log template

```text
| YYYY-MM-DD HH:MM | <agent/name> | <what changed; files; acceptance result> | <exact next milestone> |
```

If a task is blocked, add a row with `BLOCKED:` and the reason, then update §3
to `BLOCKED`. Do not leave a blocked task marked `IN PROGRESS`.
