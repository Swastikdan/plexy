# 013: Visual parity — inventory, re-creation plan, and the screenshot loop

Status: **WEB + DESKTOP DONE** — all P0/P1 web states pass; mobile explicitly deferred
Scope: `apps/web`, `apps/desktop` (web UI + native mpv chrome), `docs/design`, `qa/ui-parity`
Owner: design + client surfaces

> **Current instruction:** implement the website and desktop only. Mobile work is
> deliberately skipped; its baselines remain in `qa/ui-loop/home-mobile`,
> `library-mobile`, and `onboarding-mobile` for a later pass.

---

## 1. The brief

1. Make a plan.
2. Check the internet.
3. Find every UI state and image Plexy has, from onboarding to the player to
   the dashboard.
4. Plan how to re-create the UI we need from those images.
5. Build a loop that implements the changes: look at the UI, then look at the
   image. If they match, the state is done. If not, implement again.

The deliverables of this plan are the inventory
(`docs/design/UI_INVENTORY.md`), the reference catalogue
(`docs/design/REFERENCE.md`), the reference assets
(`docs/design/reference/`), and the repeatable loop in `qa/ui-parity/`.

## 2. Internet check (done)

- Searched for Plexy and for the reference authors. There is an unrelated
  open-source project called *Plexy* (an alternative Plex web UI). It has no
  relationship to this repository and none of its assets are used.
- The home and player references are **slothUI — 3 Free Video Streaming App
  UI** / **Video Player For Web & Mobile** (Figma Community, CC BY 4.0). The
  library reference is **StreamVista — Movies & Shows Page**. The onboarding
  reference is a Netflix iOS onboarding set curated by Mobbin.
- The references are stored locally so the loop is offline-repeatable:
  `docs/design/reference/{home,library,player,onboarding}`.
- No network access is required to run the loop; the app, Chrome, and the
  Android emulator are local.

## 3. What we are matching (and what we are not)

**Parity target: dark theme, P0 surfaces.**

| Priority | State | Reference | Surfaces |
| --- | --- | --- | --- |
| P0 | Home, populated | `home/desktop.webp`, `home/mobile.webp` | web, mobile |
| P0 | Library / dashboard | `library/desktop*.webp`, `library/mobile.webp` | web, mobile |
| P0 | Player chrome | `player/web-*.webp`, `player/mobile-*.webp` | web, desktop mpv, mobile |
| P0 | Onboarding | `onboarding/00…13.webp` (structure only) | mobile |
| P1 | Title detail | derived from home hero + library cards | web, mobile |
| P1 | Search | derived from home header + library rows | web, mobile |
| P1 | Settings overview | current design, shared tokens only | web, mobile |
| P2 | All other 40 screens / 500+ states | consistency pass | all |

**Not in scope**

- Copying the marketing page's trial banner, footer, or brand names.
- Copying Netflix's email, code, and account screens; Plexy is local-first.
- A second accent color. The references use indigo and red; Plexy uses one
  indigo brand accent.
- Replacing real catalog artwork with reference artwork.
- Reworking the playback engine, the API, or any non-visual behavior.

## 4. Design translation

### 4.1 Tokens

Add a **cinema surface** token set used by home, library, title, and player.
Admin/settings keep the current HeroUI surfaces but inherit the accent and type.

| Token | Dark | Use |
| --- | --- | --- |
| `--cinema-canvas` | `#080808` | page ground |
| `--cinema-surface` | `#141416` | cards, sheets |
| `--cinema-raised` | `#1d1f21` | header scrim, pinned bars |
| `--cinema-ink` | `#f7f8f8` | primary text |
| `--cinema-muted` | `#9aa0a3` | meta |
| `--cinema-line` | `rgba(255,255,255,.10)` | hairlines, card borders |
| `--cinema-glass` | `rgba(255,255,255,.08)` | secondary pills |
| `--cinema-glass-line` | `rgba(255,255,255,.16)` | pill borders |
| `--brand` | `#5045e6` | primary actions, selected, progress |
| `--brand-strong` | `#6a60ff` | hover |
| `--brand-ink` | `#ffffff` | on-brand text |

Keep `--danger`, `--warning`, `--success` from the current theme. The light
theme gets equivalent tokens (`#f5f5f5` canvas, `#ffffff` surface, `#18181b`
ink) and is verified after dark.

### 4.2 Type

- UI: **Archivo Variable** (already loaded). Keep weights 400/500/700/900.
- Display: add **Anton** (OFL) as `--font-display`. Use only for hero titles
  and the giant player watermark; everything else stays Archivo.
- Scale: hero display `clamp(3.2rem, 5.5vw, 5.5rem)` / mobile `2.75rem`,
  uppercase, line-height .88, tracking −0.02em. Section title 17→19px/700.
  Meta 11–13px/500. Buttons 13–14px/700.

### 4.3 Components

| Component | Specification |
| --- | --- |
| `CinemaHeader` | 72–80px; brand left; `Home / Library` text pills; centered search field (desktop); settings, notifications, avatar circles right; transparent over hero, `rgba(8,8,8,.82)` + blur after 24px scroll |
| `SearchField` | 46px, 999px radius, `cinema-glass` + blur, magnifier right, placeholder “Search titles, people, episodes”; ⌘K focus |
| `GenreChips` | 28px, 999px, glass, 11px/600 |
| `DisplayTitle` | Anton, uppercase, white, text-shadow for legibility |
| `HeroActions` | primary 44px indigo with Play; secondary 44px glass with Details; optional circular watchlist/trailer buttons |
| `HeroDots` | 3–5 dots, 6px, active 24px wide pill; carousel pause accessible via a small control |
| `EpisodeCard` | 16:9, 12px radius, 1px `cinema-line`, thumbnail, top-left `E1`, top-right duration, badge, title bottom-left, progress ring bottom-right; 4-up at 1440 |
| `ShelfHeader` | 20px/700 title left; sort/“See all” right with 16px icon |
| `PosterCard` | 2:3, 10px radius, no border, caption below or overlay; rank variant with 64px numeral |
| `GenreTile` | 2-up poster collage, 16px radius, 14px/700 label, arrow |
| `PlayerChrome` | black scrims, 4px seek line, title/time at the ends, circular glass controls; web bottom row, mobile top-right + center transport |
| `OnboardingShell` | black, full-bleed art, one idea per screen, bottom-anchored CTA, 3-dot progress, back chevron |

### 4.4 Per-surface recreation

#### Home (web + mobile)

Current: 64vh hero with a text title, meta line, synopsis, and three icon/pill
actions; rows of posters; no visible search field; no genre chips; no episode
cards.

Target:

1. Header becomes `CinemaHeader`: search field centered, three circular action
   buttons right, nav pills left. Search still opens `/search`.
2. Hero becomes 78vh (desktop) / 72vh max (mobile), copy bottom-left, genre
   chips, Anton display title, one-line meta, two pills, dots bottom-left.
   Keep the carousel arrows on hover/focus. Keep a pause control for
   accessibility, visually part of the dots.
3. “Continue watching” becomes the reference's four-up episode row: 16:9 stills,
   E chip, duration chip, title, progress ring. Four cards fit at 1440; 2.2 at
   mobile.
4. Add a shelf header with a sort control for “Continue watching” (Recently
   watched / Next up).
5. Keep the existing poster rows below, restyled to the reference density.
6. Mobile: hero 500px, display 44px, one primary + one glass pill, dots under
   the copy, bottom tab bar unchanged but selected tab uses the indigo rounded
   square.

#### Library (web + mobile)

Current: a single card grid with a kind toggle and sort popover.

Target: the StreamVista dashboard rhythm, using only real Plexy data:

1. Top bar as above; add a `Movies / TV shows` segmented control under the
   header.
2. Featured hero: the most recently added title with a full-bleed still, title,
   meta, Play, and two icon actions.
3. “Our genres”: derive the top 6 genres from the library; each tile is a 2-up
   collage + label + arrow, linking to a filtered library.
4. “Top 10 in your library”: rank by rating or watch count; large numeral,
   poster, rank badge.
5. “Recently added” poster row.
6. “Continue watching” wide-card row.
7. Drop the trial CTA and the marketing footer.
8. Mobile: two-column poster grid remains the “All” destination; the dashboard
   sections are horizontal scrollers above it.

#### Player (web + desktop + mobile)

Current: Video.js neutral skin on web, custom mobile chrome, already close to
the reference but with a different control arrangement.

Target:

1. Web/desktop: bottom title-left/time-right, seek line full width, left
   transport cluster, right volume/settings/PiP/fullscreen/more. Center
   play/±10 appears while paused or scrubbing. Add the scrub thumbnail (already
   generated) and the “Play again” end pill.
2. Mobile: keep close top-left; fit/PiP/more top-right in 48px glass circles;
   center pause with ±10; title and time bottom; bottom toolbar
   (Speed/Lock/Episodes/Audio/Next) remains on tap. Match the reference's
   spacing and 48px hit targets.
3. Keep every existing menu and state; restyle panels to 18px radius glass.
4. Steam's red progress line is not adopted; use the indigo brand for the seek
   fill and keep the buffered range neutral white/20.

#### Onboarding (mobile)

Current: three mode cards and setup rows on a scroll page; no step rhythm.

Target (six steps, one idea each):

1. **Welcome** — brand mark, “Your movies. Your server. Your rules.”, Get
   started / “I already have a library”.
2. **Mode** — Local / Hybrid / Online cards, one selected, Continue.
3. **Folders** — permission explanation, Add media folder, list of connected
   folders, Continue.
4. **First scan** — progress, found counts, “Keep this running in the
   background”.
5. **Metadata** — optional TMDB connection, “Not now”.
6. **Ready** — “Everything is ready.”, Start watching.

Rules: 3-dot progress (or step count), back chevron on steps 2–5, bottom CTA,
full-bleed gradient/art on steps 1–2, no account/email/PIN.

## 5. Implementation phases

### Phase 0 — Harness and baseline (this change)

- [x] Reference assets copied, cropped, and documented.
- [x] Complete UI inventory.
- [x] CDP capture, mobile capture, compare, and loop scripts.
- [x] QA session helper and mobile onboarding helper.
- [x] Baseline captures for web and mobile.
- [x] `player-mobile` blocked: no local video on the QA device.

### Phase 1 — Tokens and primitives

- [x] Add cinema tokens to `apps/web/src/styles.css`.
- [x] Load Anton for display; keep Archivo for UI.
- [x] Add the desktop search field, genre chips, header actions, and
      episode-card anatomy.
- [x] Home web passes the rubric (11/12, iteration 11).
- [x] Global indigo accent, cinema glass, and the library/player primitives.
- [x] Library web passes (11/12, iteration 4).
- [x] Player web/desktop passes (11/12, iteration 4).
- [x] Title, search and settings web pass their consistency pass.
- [ ] Mobile tokens and primitives — **deferred**.

### Phase 2 — Home

- [x] Replace `home-hero.tsx` composition; keep the carousel, watchlist, and
  Play/Resume logic.
- [x] Replace the continue-watching card with the episode card anatomy; add the
  sort control.
- [x] Restyle poster rows and their hover/focus/menu states.
- [x] Home web passes.
- [ ] Mobile home — **deferred**.

### Phase 3 — Library

- [x] Add the dashboard sections and data derivations (genres, top 10, recently
  added, continue).
- [x] Keep the all-titles grid below, with sort, Unwatched and genre filters.
- [x] Library web passes.
- [ ] Mobile library — **deferred**.

### Phase 4 — Player

- [x] Web: restructure the neutral skin's control layout; keep all menus,
  chapters, versions and keyboard bindings.
- [x] Desktop mpv: pass the title/subtitle into the shared chrome; keep the
  transparent surface and traffic-light inset.
- [x] Player web/desktop passes.
- [ ] Mobile player chrome — **deferred**.

### Phase 5 — Onboarding

- [ ] Mobile onboarding — **deferred** with the rest of the mobile work.

### Phase 6 — Title, search, settings, remainder

- [x] Title: chips, display title, pill actions, episode card anatomy.
- [x] Search: centered pill field, result cards.
- [x] Settings: layout unchanged; brand accent, type, and focus rings applied.
- [x] Web/desktop sweep for dark, light, 390px web, focus and reduced motion.
- [ ] Mobile sweep — **deferred**.

### Phase 7 — Regression gate

- [x] `bun run typecheck` (includes web build).
- [x] `bun run test:desktop` (19 pass) and `bun run test:packages` (7 pass).
- [x] Re-capture the web/desktop baseline states and assess them.
- [x] `bun run build:web`.
- [ ] Desktop package smoke test (launch, connect, play mpv, fullscreen) — the
  shared chrome typechecks and tests pass; packaging still needs a manual pass.

## 6. The visual loop

The loop is the acceptance mechanism. It is deliberately small: capture the
state, compare it with the reference, look at both, decide, implement, repeat.

### 6.1 States

`qa/ui-parity/states.json` defines each state:

```json
{
  "id": "home-web",
  "platform": "web",
  "url": "/",
  "viewport": { "width": 1440, "height": 960 },
  "reference": "docs/design/reference/home/desktop.webp",
  "waitFor": "h1",
  "requirements": [
    "Centred rounded search field in the header",
    "Genre chips above an oversized uppercase title",
    "Two pill hero actions",
    "Four-up 16:9 continue-watching row with progress rings"
  ]
}
```

Web states use CDP against the signed-in QA Chrome. Mobile states use the
running emulator plus a deep link. Onboarding states clear the app first.

### 6.2 One iteration

```sh
# 1. Look at the UI
bun qa/ui-parity/capture.mjs --state home-web --iteration 1

# 2. Put it next to the image and measure the layout
python3 qa/ui-parity/compare.py --state home-web --iteration 1

# 3. Review the pair and write the verdict
#    Open qa/ui-loop/home-web/iteration-1/side-by-side.webp and
#    reference. Mark every requirement and every mismatch in assessment.json.

# 4. If not a match, implement and repeat
bun qa/ui-parity/loop.mjs --state home-web --agent opencode --yes
# or: --implement-cmd "bun run your-fixer"
```

`loop.mjs` automates the sequence and can hand the brief to an implementation
agent:

```sh
bun qa/ui-parity/loop.mjs --state home-web --agent opencode --max 4 --yes
```

In that mode the loop:

1. Captures iteration N.
2. Runs `compare.py`, which writes `current.png`, `reference.png`,
   `side-by-side.webp`, `overlay.webp`, `report.json`, and `report.md`.
3. Generates `brief.md`: the reference, the current capture, the measured gaps,
   the requirement checklist, the files that own the state, and the rules.
4. Invokes `opencode run --agent build` with that brief, or the command given
   by `--implement-cmd`.
5. Captures iteration N+1 and compares. It stops on a pass, after `--max`
   iterations, or after two iterations without a layout-score improvement.
6. Never touches git history; it logs `git status --porcelain` before and
   after each iteration.

### 6.3 The rubric

The loop's numeric report is advisory. The verdict is a visual review with a
fixed rubric, 0–2 per category:

| Category | 0 | 1 | 2 |
| --- | --- | --- | --- |
| Composition | different structure | some zones match | every zone in the reference exists in the same place |
| Typography | wrong face/scale/case | close, one axis off | face, size, weight, case, tracking and alignment match |
| Color & surface | wrong canvas/accent | palette close | canvas, accent, glass and borders match |
| Component anatomy | missing parts | parts present but wrong | pills/cards/chips/badges/progress match |
| Spacing & density | cramped/loose | minor drift | gutters, row heights, card count and rhythm match |
| Interaction | missing/incorrect | partial | hover, focus, dots, pause, reduced motion all behave |

**Pass** requires 10/12 and **zero hard blockers**. Hard blockers:

- wrong navigation structure (missing search, missing nav, wrong tab bar);
- hero shorter than 60vh on desktop / 45vh on mobile;
- fewer than four cards in the desktop episode row;
- wrong accent hue or unreadable text (< 4.5:1 for body);
- a state that regressed functionality or lost a control;
- reference content traced as UI instead of real data.

The numeric report records:

- `layout_similarity` — cosine similarity of the row/column luminance profiles;
- `palette_distance` — distance between the 5-color palettes;
- `dark_ratio` — share of near-black pixels;
- `aspect_delta`, `mean_abs_diff` (informational; different artwork dominates
  raw pixels).

Content differs by design, so raw pixel difference is never the gate.

### 6.4 Stop and escalation

- **Pass** → write `PASS` with the score and move to the next state.
- **No improvement in 2 iterations** → stop and write `BLOCKED` with the
  mismatch list; do not burn iterations.
- **Functional regression** (tests fail, control missing) → revert the
  iteration, write `BLOCKED`.
- **Reference is ambiguous** → record the decision in the plan's decisions log
  and continue; do not invent a different layout.

### 6.5 Artifacts

```
qa/ui-loop/<state>/
  iteration-1/
    current.png
    reference.png
    side-by-side.webp
    overlay.webp
    current-edges.png
    reference-edges.png
    report.json
    report.md
    dom.json          # web
    hierarchy.json    # mobile (uiautomator)
    brief.md
    assessment.json   # written by the reviewer
    implement.log     # when an agent runs
  PASS | BLOCKED
```

Artifacts are local QA output and are ignored by git except for the final
screenshots referenced by the plan.

## 7. Acceptance

- [ ] Home web and mobile reach a rubric pass against the references.
- [ ] Library web and mobile reach a rubric pass on the shared sections.
- [ ] Player web and mobile reach a rubric pass; every existing player state
      still works.
- [ ] Onboarding has six steps, a back affordance, progress, and a bottom CTA;
      first-run gating still works.
- [ ] Title, search, settings, and the remaining inventory use the new tokens
      and primitives without losing a control.
- [ ] Light theme, reduced motion, focus rings, 1.3×/2.0× text scaling, and
      390 × 844 web all pass.
- [ ] `bun run typecheck`, `bun run test`, `bun run build:web`,
      `bun run typecheck:native`, `bun run test:native` pass.
- [ ] No reference artwork ships in the product.
- [ ] The loop can be run again from a clean checkout with the documented
      commands.

## 8. Decisions

1. **Indigo is the only brand accent** (`#5045e6`); red references are layout
   references only.
2. **Anton for display titles**, Archivo for UI.
3. **Dark theme first**; light is a regression pass, not a parity target.
4. **Structure over content**: match the reference's composition with real
   Plexy data, not its titles or artwork.
5. **Four-up desktop episode row**, 2.2-up mobile.
6. **No trial/marketing content.**
7. **Settings keeps its information architecture**; it inherits tokens, not the
   StreamVista dashboard structure.

## 9. Risks

- The library reference is a long marketing page; copying every section would
  invent features Plexy does not have. The plan limits it to data Plexy can
  derive (genres, top 10, recently added, continue).
- Anton changes the hero's width behavior; test long titles and missing logos.
- The mobile app has no profile/account step, so the Netflix onboarding flow is
  a rhythm reference, not a screen-for-screen copy.
- The player is the most stateful surface; chrome changes can break keyboard
  shortcuts, PiP, fullscreen, and the mpv surface. The loop must run the full
  player state inventory, not just the hero shot.
- The desktop app adds a transparent mpv layer under the page; visual changes
  must not paint an opaque background over it.
