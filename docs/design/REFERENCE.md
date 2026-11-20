# Plexy visual reference catalogue

The design references below are the source of truth for the visual-parity work.
They are copied into `docs/design/reference/` so the loop never depends on a
file in `~/Downloads`.

| Surface | Reference | Source | Size |
| --- | --- | --- | --- |
| Home, desktop | `reference/home/desktop.webp` | slothUI, *3 Free Video Streaming App UI* (CC BY 4.0) | 1440 × 960 |
| Home, mobile | `reference/home/mobile.webp` | same kit | 375 × 928 |
| Library, desktop | `reference/library/desktop.webp` + section crops | StreamVista, *Movies & Shows Page* | 1920 × 8955 |
| Library, mobile | `reference/library/mobile.webp` | same page | 390 × 3848 |
| Player, web | `reference/player/web-1…4.webp` | slothUI, *Video Player For Web & Mobile* | ≈1572 × 895 |
| Player, mobile | `reference/player/mobile-1…4.webp` | same kit | ≈838 × 301 |
| Onboarding | `reference/onboarding/00…13.webp` | Netflix iOS onboarding, curated by Mobbin | 590 × 1338 |

## What each reference is actually for

### Home (slothUI)

**Structure to recreate**

- Full-bleed cinematic hero that fills the first viewport; artwork is the
  background, not a card.
- Header floats over the hero: brand left, a wide rounded search field in the
  middle, three circular action buttons on the right.
- Hero copy sits left, over the lower half: genre pills, an oversized condensed
  uppercase title, a one-line episode/meta line, and two pill actions
  (primary indigo, secondary glass).
- Carousel dots sit bottom-left, immediately under the hero copy.
- The shelf header is a single bold line with a sort control on the right.
- Episode cards are 16:9 thumbnails with a border, a duration chip, a
  network/quality badge, the episode title bottom-left, and a circular
  progress/next control bottom-right. Four fit across 1440px.
- Mobile: same composition in one column; the bottom tab bar is five icons with
  the selected icon in an indigo rounded square; the hero title is ~40px.

**Extracted tokens**

| Token | Value | Where |
| --- | --- | --- |
| canvas | `#080808` | page ground below the hero |
| surface | `#191b1d` | cards, nav scrim |
| raised | `#212325` | header over artwork |
| ink | `#f7f8f8` | text |
| muted | `#9aa0a3` | meta text |
| brand | `#5045e6` | Play button, badges, active tab |
| glass | `rgba(255,255,255,.08)` + 1px `rgba(255,255,255,.14)` | secondary pills, chips |
| line | `rgba(255,255,255,.10)` | card borders |
| title face | condensed, uppercase, 800–900, −0.02em | hero title |
| ui face | geometric/neo-grotesque sans | everything else |
| radii | 999px pills, 12px cards, 16px panels | |

### Library (StreamVista)

**Structure to recreate** — the parts Plexy can honestly fill:

- Compact top bar with brand, tab strip, search, and a menu button.
- Hero carousel with a full-bleed still, title, one-line meta, a solid primary
  Play button, and two small icon actions.
- Segmented Movies / Shows control below the hero.
- “Our Genres” — a two-row grid of genre tiles, each a 2-up poster collage with
  the genre name and an arrow.
- “Popular Top 10 in Genres” — ranked poster cards with a large rank numeral,
  a rank badge, and an arrow affordance.
- “Trending Now” and “New Releases” — poster rows with rank/duration badges.
- “Must-Watch” — larger poster cards with rating.
- Do **not** copy the free-trial banner or the marketing footer; Plexy is
  self-hosted and has nothing to sell.

**Extracted tokens** — canvas `#141414`, surface `#1e1e1e`, ink `#f4f4f4`,
muted `#a0a0a0`, accent in the source is Netflix red `#e60000`. Plexy maps the
accent to its indigo brand (see “Conflict resolution”).

### Player (slothUI video player)

**Web chrome**

- Black stage, no app header, rounded 12px video frame on the marketing sheet
  (inside the app the frame is full-bleed).
- A low-contrast bottom scrim. Title at bottom-left with a small subtitle
  below, elapsed / duration at bottom-right.
- Thin seek line across the full width, just above the control row.
- Left cluster: play/pause, rewind 10, forward 10.
- Right cluster: volume, settings, PiP/cast, fullscreen, more.
- Top-right circular controls for fit and PiP in the mobile variant.
- Center controls only appear while paused or scrubbing; ±10s flank the play
  button.
- Scrub preview: a small thumbnail above the timeline with a time chip.
- End state: “Play again” as a dark pill bottom-right.

**Mobile chrome**

- Landscape, pure black, system bars hidden.
- Top-left close, top-right fit / PiP / more in 48px glass circles.
- Center pause or play, with −10 / +10 on either side.
- Bottom title and time; seek bar appears with the chrome.
- No permanent back chrome on the right; Plexy keeps a top-left close because
  Android back is not always available.

### Onboarding (Netflix)

**Structure to recreate**

1. Brand moment: black screen, mark only, no chrome.
2. Value screen: full-bleed collage/still, headline, short proof points, one
   solid CTA, progress dots.
3. Input screen: back chevron, large heading, one field, full-width CTA,
   legal/help line below.
4. Illustration screen: a single centered illustration, small eyebrow, heading,
   short body, bottom CTA.
5. Profile step: a grid of avatars with names, add/edit tiles, and a play/next
   action.
6. Finish: a single centered mark and a spinner, then the app.

Netflix's email, code, and account steps do not apply to Plexy. Plexy's flow is
local-first: **mode → folders → first scan → metadata → done**. Borrow the
screen rhythm (one idea per screen, bottom-anchored CTA, dots, back chevron),
not the account form.

## Conflict resolution (important)

The three references use three different accents (indigo, red, red). Plexy is
one product, so:

1. **One brand accent: indigo `#5045e6`.** Adopt it for primary actions,
   selected tabs, progress rings, and badges across home, library, player, and
   onboarding. Do not introduce Netflix red as a second brand color.
2. **Red is not a section color.** StreamVista's red section marks become
   indigo ticks or neutral rules. Danger stays the existing `--danger`.
3. **Keep Plexy's Archivo UI face.** Add a condensed display face for hero
   titles only. The reference's display face is not Archivo; the closest
   freely available match is **Anton** (SIL OFL). Load it as `--font-display`
   and use it at 800–900 for hero titles, with Archivo for all controls.
4. **Dark is the parity target.** The app keeps light mode; the loop captures
   dark. A light-theme pass follows only after the dark states pass.
5. **Content is Plexy's own.** Do not copy HANDMAIDEN TALES, Avengers, Minions,
   or the “slothui original” wordmark. The same composition must hold with a
   real Plexy library.

## Reference integrity rules

- Never trace or bundle a screenshot as UI. All artwork in a build must come
  from TMDB/local library data.
- The 16:9 cards use the local episode still; the poster rows use the item
  poster. Fallbacks are Plexy's own glyphs.
- Copyright: the slothUI kit is CC BY 4.0. The Netflix frames are used only as
  internal layout reference and are not redistributed in the product. The
  reference folder is documentation, not shipped assets.
