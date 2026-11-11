# Mobile identification, performance, 4K, haptics, and offline plan

Date: 2026-11-11

Status: research and proposed implementation only. App changes require the user's later instruction. This document records the current working tree, including existing uncommitted mobile work; it does not imply those changes were made during this review.

## Goals

- Identify movies and TV reliably, with forgiving filename handling and explainable decisions.
- Accept a user-provided TMDB ID or URL, title, and optional release year. “ER” in the original request meant year, such as 2026.
- Reduce mobile CPU work, memory allocations, storage writes, network traffic, and unnecessary rendering.
- Establish the actual boundaries of 4K playback support.
- Provide more deliberate, perceptible haptic feedback with user control.
- Persist library metadata and all artwork used by the library so cached titles remain usable without internet after an app restart.

## Current findings: identification

The server uses `apps/server/src/parse.ts`, `matcher.ts`, `scan.ts`, and `tmdb.ts`. Mobile uses `packages/local-library/src/library.ts` and `metadata.ts`, with correction UI in `apps/mobile/LibraryReport.tsx`. These are separate policies and can disagree.

Read-only parser reproductions:

- `2001.A.Space.Odyssey.1968.mkv`: mobile returns title `A Space Odyssey`, year 2001. It removes both numeric tokens; the intended title number and release year need separate treatment.
- `1917.mkv`: both parsers interpret 1917 as a year, although it may be the title.
- `Spider-Man (2002)/Spider-Man.mkv`: server returns title `Spider` because trailing-dash cleanup removes legitimate title content.
- `True.Grit.2010.mkv`: server returns `Grit 2010`; release-noise cleanup removes `True` from the title.
- `ER/Season 02/03.mkv`: mobile defaults to season 1, episode 1. Unknown numbering must not silently become a real episode identity.
- A TMDB tag in an episode filename can be missed on mobile when the series folder supplies the parsed title.

Additional issues:

- Server exact-title auto-matching does not require a clear margin over competing candidates; popularity and API ordering can determine identity.
- Server title normalization removes non-Latin text. Original-language exact titles are also discounted by the scoring formula.
- Server Jaro–Winkler uses a fractional matching window; use an integer window and published test vectors.
- Mobile requires exactly one normalized exact-title search result and has no relaxed-year search fallback.
- Manual title-only correction is used for the search title, but the search year still comes from the original path; the UI has no separate year override.
- The mobile correction screen has no direct ID input, although the library API accepts an ID.
- Server explicit-ID errors fall through to search, including temporary request errors.
- Server NFO lookup selects the first `.nfo` file and caches it for the process lifetime. Changes and filename-specific sidecars can be missed.
- Already matched server items can bypass newly supplied identity evidence on rescan.
- One failed server TMDB request rejects the shared promise chain and prevents later uncached requests from executing. Restore queue progress after failures.

## Proposed identification policy

1. Preserve user-confirmed identity across rescans. Keep identity separate from metadata freshness and artwork completion.
2. Resolve explicit IDs first. Accept positive integer TMDB IDs and typed TMDB URLs; record movie/TV type and source. Validate existence and type before replacing a saved identity. Network failure means retry, not a silent alternate match.
3. Collect filename, title-folder, sidecar, and user-supplied evidence independently. Detect conflicts rather than accepting whichever tag appears first in an absolute path.
4. Parse release year conservatively: user override, parenthesized release year, then trailing year after a meaningful title. Preserve numeric titles. Reconcile folder/file disagreement. Treat TV year as the series start year, not the season's broadcast year.
5. Preserve Unicode and legitimate punctuation/title words. Remove technical tokens only in release-metadata positions. Keep raw and normalized evidence for explanation.
6. Search typed title plus year first. If empty or inconclusive, broaden without the year; a contradiction still blocks automatic acceptance. Support original/localized names and aliases without forcing fuzzy matching.
7. Rank on title agreement, year agreement, and available structural evidence. Runtime is supporting evidence, allowing different editions. Popularity is only a final tie-breaker. Use stable tie-breaking for identical candidate data.
8. Auto-match only with sufficient agreement and separation from alternatives. Route remakes, conflicting years, and ambiguous short titles to review. Explain the reason and offer editable type/title/year/ID.
9. Resolve episode identity separately from series identity. Support specials, season-folder numbers, ranges, and explicit numbering corrections. Do not invent S01E01 when unknown. Plan explicit handling for date-based and anime absolute numbering.
10. Persist identity source, evidence, decision/policy version, candidate reasons, and retryable error state. Refreshing metadata must not change identity.

Potential extension: accept IMDb IDs through TMDB `/find`; do not confuse external IDs with TMDB numeric IDs.

## Current findings: mobile resource use

- `LocalLibrary.persist()` clones the entire state. `apps/mobile/src/lib/database.ts` deletes and reinserts all media rows on every save. Playback progress saves approximately every ten seconds, plus lifecycle events; hydration and marker saves amplify this work.
- Scan lookup repeatedly searches the complete record array. Grouping series repeatedly copies arrays.
- Every library notification clears all resource caches and wakes mounted consumers.
- Metadata hydration operates sequentially per record, repeats shared series fields across episodes, and waits for optional artwork. Network requests are deduplicated in memory, but that does not remove per-record processing and persistence.
- Directory walking uses synchronous list/stat operations and yields between directories, not within a very large directory. Subtitle discovery can recursively walk folders again.
- Episode detail lists render within a ScrollView; the main catalog and report already use FlatList.
- Thumbnail cache generation enumerates and sorts the cache after every new preview.
- Reconnection starts a full scan; foreground/periodic scan policy should avoid unnecessary walking and optional network work.

Proposed work:

- Update individual rows, separate progress from catalog metadata, batch writes, and coalesce pending progress saves while preserving pause/background flushes.
- Build file/record indexes once per scan; append to grouping arrays rather than copying each time.
- Use targeted subscriptions and memoized catalog selectors.
- Store series/season metadata once, with per-episode references and independent freshness.
- Publish essential text/identity first. Use bounded, cancellable work for optional images and markers; defer nonessential downloads during playback.
- Chunk large directory work and index sidecars during scanning. Respect successful/incomplete scan deletion safeguards.
- Virtualize long episode lists and profile player rerenders before changing update frequency.
- Maintain cache size accounting and prune periodically instead of sorting the whole cache for every image.

## 4K playback: current support and limits

The local app passes original file URIs through `LocalApi.stream()` to `expo-video` via `player.replaceAsync()`. No local resolution cap is applied. This means the app can attempt 4K playback and can play compatible 4K files on capable devices. It does not establish support for every 4K file or guarantee native-4K display output.

Actual compatibility depends on container, codec/profile/level, bit depth, frame rate, bitrate, audio format, subtitle format, device decoder, available storage throughput, and thermal conditions. HDR10, HDR10+, and Dolby Vision need separate validation; decoding 2160p and displaying HDR correctly are separate capabilities. A lower-resolution phone display can display a scaled 4K source.

The local playback manifest always declares a direct path and does not probe decoder capabilities. It has no local transcoding fallback. The shared player's 2160p server-conversion option is not proof of local 4K compatibility. Current local playback errors are generic.

Proposed work:

- Read available track dimensions, codec, frame rate, and device support from the installed native API; add a small native capability bridge only if necessary.
- Explain unsupported video versus unsupported audio/container where reliable diagnostics exist. Preserve direct playback for compatible files.
- Keep decode/render work native; avoid loading media bytes into JavaScript or generating previews ahead of demand.
- Profile memory, buffering, dropped frames, seek latency, battery/thermal behavior, and audio sync in release builds.
- Test on real lower-end and higher-end phones. Include 2160p H.264, HEVC 8/10-bit, AV1 where supported, 24/30/60 fps, SDR/HDR, MP4/MKV, high-bitrate sources, and common AAC/AC-3/E-AC-3/DTS audio combinations.
- Retain sample-specific results with device/OS/build identifiers. Do not advertise “any 4K video.” Decide on external-player or server fallback only after measuring actual gaps.

No physical-device playback test or 4K capability measurement was performed in this review.

## Haptics: current support and proposed quality improvements

`packages/native-client/src/haptics.ts` exposes selection, Light, and Medium effects, defaults to Light, and skips TV. Calls are concentrated in navigation/catalog/filter actions; there is no user strength preference and no semantic success/error policy. The synchronous try/catch does not catch rejected promises from the async haptic calls.

Proposed work:

- Introduce semantic actions: selection, primary action, toggle, confirmed success, rejected action, and destructive confirmation. Map each action once in a shared service.
- On Android, evaluate `performAndroidHapticsAsync` using meaningful system effects; verify availability against installed Expo SDK 57 types before implementation. On iOS, use the appropriate impact/notification APIs if that platform is shipped.
- Add Off / Standard / Strong preferences with a “Test feedback” action. Strong should select a more perceptible effect where supported, not promise precise hardware amplitude control.
- Give primary confirmations a deliberate effect; avoid vibrating on every scroll item, keystroke, render, or network completion. Rate-limit scrubbing/selection events and prevent duplicate effects.
- Catch async failures explicitly. Unsupported devices and disabled system haptics must remain functional.
- Evaluate on real hardware; an emulator cannot establish perceived haptic quality. Hardware and OS settings set the upper bound, so “Strong” cannot guarantee identical sensation across phones.

## Offline metadata and artwork: current state

This is partly implemented already, not a new storage requirement from zero:

- SQLite persists catalog fields, identity, watch state, cast details, seasons, and subtitle references.
- Mobile artwork downloads use app-private document storage and persist local URIs: posters, backdrops, logos, up to 12 cast profiles, season posters, and stills for local episodes.
- Original local videos remain in the selected source folders; imported subtitles and generated previews are local.
- Skip markers are persisted after lookup. TMDB response promises themselves are only cached in memory.
- Generic shared-client image caching also uses persistent files, but some UI images use plain Image rather than the shared cache component. Server-connected and downloaded-library behavior needs its own offline completeness audit.
- Identification search results use remote poster URLs. YouTube trailers are external links and cannot be assumed playable offline.

## Offline-first implementation requirements

1. Define “saved offline” as all library fields and image assets actually displayed for an indexed title, including episode/season imagery and cast profiles within the supported UI scope. Unavailable source artwork uses local placeholders.
2. Maintain an asset manifest linking stable media identities to local files, sizes, checksums or version keys, and download state. Shared series assets must be deduplicated.
3. Persist sufficient structured metadata to render every saved detail screen without TMDB. Persist response data selectively if needed; a raw API cache is not a substitute for the catalog.
4. Download atomically with bounded concurrency, retries, and disk-space handling. Preserve the last valid local file during refresh. Detect missing/corrupt files and repair when online.
5. Load local data and local image URIs first, including cold launch. Internet refresh must never block navigation or playback. Show whether offline preparation is complete, pending, or failed.
6. Keep saved library artwork pinned while the title remains indexed. Evict disposable thumbnails and unreferenced assets first. Explain storage usage; user-invoked cleanup must distinguish saved artwork from rebuildable previews.
7. Reconcile this requirement with optional cast-image deferral: essential content appears immediately, but do not mark offline preparation complete until all required displayed assets are saved.
8. Keep search/identify network-dependent when uncached and say so clearly. Optional trailers and casting remain online features unless a separately authorized offline workflow is added.
9. Preserve original video references and persisted folder permissions. A cloud-backed document URI may require connectivity even if it looks like a picked file; only mark media offline-ready after confirming local availability. Do not silently copy huge source videos into app storage.
10. For any server-connected/download mode, explicitly persist detail data and every referenced image instead of relying on incidental image cache hits.

Acceptance scenario: prepare a library online; force-stop the app; enable airplane mode; cold-launch; browse Home, Libraries, Search, series seasons/episodes, cast/details, and playback. Verify posters, backdrops, logos, cast images, stills, subtitles, progress, and saved markers without network access. Reboot and repeat with retained folder permissions. Also test partial downloads, no space, missing source media, metadata refresh failure, and app upgrade.

## Implementation sequence and verification

1. Shared parser/evidence model, year correctness, direct-ID correction UI, and explicit error recovery.
2. Matching decision policy and regression corpus; fix server queue recovery and sidecar invalidation.
3. Incremental persistence and targeted resource invalidation.
4. Durable offline asset manifest and offline completeness/repair workflow.
5. Scan/list/metadata download improvements, measured in release builds.
6. Semantic haptics and strength settings, validated on phones.
7. 4K capability diagnostics and sample/device matrix; resolve measured playback gaps.

The order can change after profiling; the plan makes no numerical performance promises without a baseline. Record startup-to-catalog, scan duration, JS stalls, peak memory, database writes during playback, artwork disk use, network calls offline, 4K seek/stability, and perceived haptic quality.

Existing verification during research: 29 tests passed across server matcher and local-library suites (109 assertions), plus read-only filename parser reproductions. These tests do not establish 4K, haptic, or full cold-start offline support. Add targeted regression tests for the reproduced identity bugs, network-error recovery, incremental persistence, and offline asset integrity; use real-device acceptance testing for media and haptics.

## Reference sources

- [TMDB finding data and external-ID lookup](https://developer.themoviedb.org/docs/finding-data)
- [TMDB TV search and year parameters](https://developer.themoviedb.org/reference/search-tv)
- [React Native FlatList optimization](https://reactnative.dev/docs/optimizing-flatlist-configuration)
- [Expo haptics](https://docs.expo.dev/versions/latest/sdk/haptics/) — recommends Android's `performAndroidHapticsAsync`; check installed-version compatibility before implementation.
- [Expo video](https://docs.expo.dev/versions/latest/sdk/video/) — native player and track APIs; latest documentation can differ from the installed SDK.
- [Android supported media formats](https://developer.android.com/media/platform/supported-formats)
- [Media3/ExoPlayer supported devices](https://developer.android.com/media/media3/exoplayer/supported-devices)

Local source entry points: `apps/mobile/src/lib/local.tsx`, `src/lib/database.ts`, `src/components/LocalThumbnail.tsx`, `src/screens/LibraryReport.tsx`; `packages/local-library/src/library.ts`, `metadata.ts`; `apps/mobile/src/screens/Player.tsx`, `apps/mobile/src/screens/Catalog.tsx`; `packages/native-client/src/haptics.ts`, `hooks.ts`, `local-api.ts`, `image-cache.ts`; server matching files listed above. Existing operational notes: `docs/MOBILE_LOCAL_LIBRARY.md`.
