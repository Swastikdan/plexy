# Online source (mobile)

An optional TMDB catalog in `apps/mobile`. It is **additive**: when online is on,
local library rows stay and online rows are added. Playback uses the existing Vidy
embed (`www.vidy.st`) through a WebView player.

## Turning it on

Settings → **Online catalog**. The toggle only changes how the tabs are composed;
it never hides the local library.

## Hybrid browsing

| Tab | Online off | Online on |
|---|---|---|
| Home | local rows + hero | local rows + hero, then TMDB rows |
| Search | local titles and episodes | local results, then TMDB results |
| Library | local library tabs | local grids include saved online titles with an **Online** badge |
| Local title | local detail | local detail + TMDB seasons/episodes + recommendations |
| Online title | — | TMDB detail, seasons and recommendations |

Local cards are still the source of truth for anything downloaded. TMDB is only
used to fill gaps.

## Missing seasons and episodes

A matched local title exposes its TMDB id (`ItemCard.tmdbId`). When online is on,
the title screen merges:

- local seasons and episodes, and
- TMDB seasons and episodes.

Downloaded episodes keep local playback, progress, watched state and selection.
Missing episodes appear in the same season list and open the Vidy player for that
TMDB season/episode. The main Play button also follows the selected season:
downloaded episodes first, then the next online-only episode.

Titles are matched during the normal metadata scan; unmatched titles keep the
local-only experience because there is no TMDB id to query.

## Recommendations

Every matched title asks TMDB for `/recommendations` and renders the result below
the detail page with the normal media cards.

- **Online on:** all TMDB recommendations are shown. Recommendations that exist
  locally open the local title page (which can add online seasons); the rest open
  the online title page.
- **Online off:** only recommendations already present in the local library are
  shown. If TMDB is unreachable, the section is simply hidden.

## Saved online titles

The **Add to library** action on an online title stores it in AsyncStorage
(`plexy.remote.library`). Saved titles are mixed into the normal **All**,
**Movies** and **TV Shows** grids with an **Online** badge. A downloaded copy
wins, so the same title is never shown twice. Removing is the same menu action.

## Playback

The online player is a Vidy embed in a `WebView`:

```
https://www.vidy.st/{movie|tv}/{tmdbId}[/{season}/{episode}]
```

It uses the app's `autoNext` preference for the provider's next-episode control.
The local player keeps playing downloaded files, and when a downloaded season
runs out without a local next episode it hands the next TMDB episode to the Vidy
player (only while online mode is on and the title is matched). The same handoff
fills a gap when the next local file skips an episode.
