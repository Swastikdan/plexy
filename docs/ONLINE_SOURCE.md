Check if the feature can be implemented now and if yes then # Online source (mobile)

An optional TMDB catalog in `apps/mobile`. It is **additive**: when online is on,
local library rows stay and online rows are added. Playback uses the existing Vidy
embed (`www.vidy.st`) through a WebView player.

## Turning it on

Settings → **Online catalog**. The toggle only changes how the tabs are composed;
it never hides the local library.

## Hybrid browsing

| Tab | Online off | Online on |
|---|---|---|
| Home | local rows + hero | local and online titles blended into the same shelves and hero |
| Search | local titles and episodes | local and TMDB results blended into the same result grid |
| Library | local library tabs | saved online titles mixed into the grids, plus an **Offline only** filter |
| Local title | local detail | local detail + TMDB seasons/episodes + recommendations |
| Online title | — | the same title screen as local, with TMDB data |

Local cards are still the source of truth for anything downloaded. TMDB is only
used to fill gaps. Online cards use the same card size and style as local cards;
a globe icon in the top-left marks them as online.

The **hero** alternates local and online featured titles, so a non-empty local
library no longer hides the online catalog. A TMDB title that already exists
locally is not repeated in the online rows or recommendations.

## One title screen

`/item/[id]` and `/remote/[media-type]/[tmdb-id]` render the same component. A
downloaded copy always wins; an online title that is also in the library opens the
offline page with its online seasons available.

Shared UI:

- the same hero card, logo, metadata and trailer action,
- Episodes / Cast & Details tabs,
- season tabs **and** swipe paging between seasons,
- cast, recommendations and the play action bar.

Only genuinely local features are hidden online: file quality, episode
multi-select, and Delete from device.

## Missing seasons and episodes

A matched local title exposes its TMDB id (`ItemCard.tmdbId`). When online is on,
the title screen merges:

- local seasons and episodes, and
- TMDB seasons and episodes.

Downloaded episodes keep local playback, progress, watched state and selection.
Missing episodes appear in the same season list and open the Vidy player for that
TMDB season/episode. The main Play button also follows the selected season:
downloaded episodes first, then the next online-only episode.

## Actions

Cards and title pages use one action vocabulary:

| Action | Offline | Online |
|---|---|---|
| Continue watching | yes | yes |
| Mark finished / Mark unwatched | yes | yes |
| Add to library / Remove from library | — | yes |
| Delete from device | yes | — |
| Episode multi-select / delete files | yes | — |

Online watched state and resume positions are stored on this device
(`plexy.remote.progress`). A finished episode does not mark the whole series
watched; the title-level Mark finished does.

## Recommendations

Every matched title asks TMDB for `/recommendations` and renders the result below
the detail page with the normal media cards.

- **Online on:** all TMDB recommendations are shown. Titles that exist locally
  open the local title page; the rest open the online title page. Online cards
  use the globe indicator.
- **Online off:** only recommendations already present in the local library are
  shown. If TMDB is unreachable, the section is simply hidden.

## Saved online titles

The **Add to library** action on an online title (action sheet or title menu)
stores it in AsyncStorage (`plexy.remote.library`). Saved titles are mixed into
the normal **All**, **Movies** and **TV Shows** grids with the globe indicator. A
downloaded copy wins, so the same title is never shown twice. The Library filter
sheet has an **Offline only** switch that hides online titles. Removing is the
same menu action.

## Online catalog cache

The TMDB catalog is cached on the device in SQLite (`plexy-remote.db`):

- **Home** paints the last saved rows first, then refreshes from TMDB every time
  Home opens. Pull-to-refresh forces a new request. This is the only online
  screen that refreshes on open.
- **Titles** (`detail`, season episodes, recommendations, movie collections)
  open from the database immediately. If the saved copy is more than ten minutes
  old, a background request updates the memory and database copies for the next
  open; it never replaces the page the user is currently reading.
- **Search** stays live because it answers a new query each time.

Cached titles remain browsable while offline, and a failed refresh keeps the
previously saved data instead of blanking the screen.

## Movie collections

A movie that belongs to a TMDB collection gets a **Collection** tab after
**Details**. It lists every part of the collection in the same poster grid used
by **More Like This**, and each part opens its own online title page.

## Playback

The online player is a full-bleed, landscape Vidy embed in a `WebView`:

```
https://www.vidy.st/{movie|tv}/{tmdbId}[/{season}/{episode}]
```

The URL is populated from app state:

| Param | Source |
|---|---|
| `color` | the app accent color |
| `autoplay` | Settings → Autoplay online |
| `episodeSelector` | Settings → Online episode picker |
| `nextEpisode` | Settings → Play next episode |
| `autoplayNextEpisode` | Settings → Play next episode |
| `progress` | the saved resume position in seconds |

Vidy posts `PLAYER_EVENT` time updates to the parent window. The wrapper forwards
them to React Native, which records progress (debounced) and resumes the next
session with `progress`. Both players share a landscape orientation lock. The
iframe owns its fullscreen UI, so the wrapper only adds a floating back control
over the embed. Posters, backdrops, title logos and the next episode's stills are
prefetched so shelves and title pages open without blank image tiles.
