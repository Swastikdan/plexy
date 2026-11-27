# Five Plexy feature gaps in the Rust player

These findings apply to the standalone macOS player in `apps/player-gpui`. The five features build on the existing local catalog and libmpv playback. Network-backed features should be optional, and cached results should work offline.

## 1. TMDB metadata and manual matching

**Plexy has it.** Plexy can match movies and series to TMDB and use the result for artwork, descriptions, genres, credits, and episode details. The Rust player derives identities from filenames and discovers artwork alongside the files. It has no TMDB matching or manual match flow. [Rust catalog](../apps/player-gpui/src/catalog.rs) · [Shared local metadata](../packages/local-library/src/metadata.ts) · [Plexy TMDB client](../apps/server/src/tmdb.ts)

**Done when** a user can see enriched movie and series details, correct a wrong match from the title page, and reopen cached details offline. A rescan preserves manual matches and local watch progress.

## 2. Next Up shelf, episode preview, and autoplay

**Plexy has it.** Plexy surfaces the next episode in Home and supports a next-episode preview and optional autoplay across its clients. The Rust player can resolve the next local episode, feature it in the Home carousel, and play it from the toolbar. It has no dedicated Next Up shelf, next-episode preview, or autoplay preference. [Rust Home](../apps/player-gpui/src/shell_ui.rs) · [Rust playback](../apps/player-gpui/src/app.rs) · [Plexy web player](../apps/web/src/routes/watch/%24fileId.tsx) · [Plexy mobile player](../apps/mobile/src/features/player/playback-screen.tsx)

**Done when** Home surfaces the next local episode for a series in progress, the player previews it before switching, and an opt-in autoplay countdown can be cancelled. Autoplay fires once after natural completion and only when the next local episode is available.

## 3. Community intro, recap, and credits markers

**Plexy has it.** Plexy can cache community skip timings for episodes. The Rust player offers a chapter-name-based skip action, so an episode with no labeled chapters cannot use community markers. [Rust skip action](../apps/player-gpui/src/app.rs) · [Plexy skip segments](../apps/server/src/skip-segments.ts) · [Plexy mobile settings](../apps/mobile/src/features/settings/settings-screen.tsx)

**Done when** an opted-in user can skip into the next section from a valid cached intro, recap, or credits window, including offline. Invalid and out-of-range markers are ignored, and chapter-based skipping still works as a fallback. Reuse the episode identity from feature 1 when a provider match is needed.

Fetch and cache the timestamps, then seek through the existing libmpv player. This feature needs no FFmpeg executable or media analysis.

## 4. Subtitle search and download

**Plexy has it.** Plexy can search for and download subtitles during playback. The Rust player reads embedded and sidecar tracks and imports existing subtitle files, but has no search or download flow. [Rust subtitle picker](../apps/player-gpui/src/app.rs) · [Plexy subtitle search](../apps/mobile/src/features/player/lib/subtitle-search.ts)

**Done when** a user can search for subtitles for the current file, filter by language, and select a result that downloads and activates without restarting playback. A downloaded track can be loaded again offline.

## 5. Genre and people search

**Plexy has it.** Plexy searches genres and credited people. The Rust player searches local movie, series, and episode text, including filenames, and has watched-state filters. It has no genre or people search. [Rust search and filters](../apps/player-gpui/src/personal_ui.rs) · [Plexy search and browsing audit](APP_FEATURE_AUDIT.md#23-browsing-home-search)

**Done when** a genre or cast-name query returns matching local titles using cached data from feature 1. Title and episode search also works for items that have no metadata match.
