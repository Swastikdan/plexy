# Android local library

The mobile entry point uses an on-device SQLite library with no Plexy server,
account or sign-in. Videos stay in their selected folders. The bottom navigation
contains Home, Libraries, Search and Settings.

## Metadata and matching

The Android build embeds the TMDB read access token from `EXPO_PUBLIC_TMDB_TOKEN`,
`TMDB_TOKEN`, or `VITE_PUBLIC_TMDB_ACCESS_TOKEN`, in that order. Supply this in the
build environment (the repository-root Bun build loads the local `.env`). No token
value is committed to source. A previously saved device token is a fallback for
older/custom development builds. Users do not need to enter a token.

Metadata hydration caches the artwork and fields consumed by the native UI:
movie/series posters and backdrops, transparent title logos, the first 12 cast
profiles, trailers, genres, overview, rating, runtime, tagline and certification.
TV series additionally load season posters and per-episode names, synopses,
runtimes, ratings and stills. Episode stills are distinct from series posters.
Existing records refresh to metadata schema 2 on upgrade. Failed artwork downloads
retain text and existing images and remain eligible for retry. Profile downloads
run in batches of three; identical concurrent artwork requests share a download.

Episode filename patterns are recognized even in a movie folder. Ambiguous TMDB
results are deliberately left for manual selection. Settings → Library report
supports adding individual videos, excluding titles without deleting media,
choosing a movie or TV result, changing classification, and editing season/episode
numbers in the Files view. Series-wide identification preserves each episode's
numbering and watch progress. Removed files stay excluded from automatic scans.
Android document IDs normalize file-picker and folder-picker URIs to avoid indexing
the same file twice.

Settings → Metadata & episode markers includes metadata language, region, poster
size, a metadata/artwork refresh, TMDB response-cache clearing and connection test.
These preferences persist in SQLite; refresh applies them to existing titles.
The build continues to supply the token without a token-entry screen.

IntroDB markers are optional and cached in SQLite (30 days when found, seven days
when empty). Scans and playback hydrate missing/stale data; manual refresh checks
all identified titles. Cached markers remain available offline, transient failures
keep previous timings, and changing a title's identity clears its old markers.
Playback validates timings against the actual duration. Available intro, recap and
credits windows show skip buttons; automatic skipping is a separate preference,
off by default. Community coverage varies by title and episode.

## Persistence and automatic updates

`plexy-library.db` stores catalog rows, root folders, watch progress and subtitle
references. Existing AsyncStorage library data migrates on first launch; its old
value remains as a backup. Artwork, imported SRT/VTT subtitles and scrub previews
are app-private files.

Scans run on launch, return to the foreground, reconnect, and every five minutes
while active. New files appear before metadata completes. Changes publish to
visible screens automatically; refreshes retain mounted player instances.
Resource caches preserve query types and object identity and are isolated by hook
instance, preventing Home/Search/status payloads from being mixed.

## Playback and previews

Playback uses original file URIs; codec support depends on Android and the device.
Embedded audio/subtitle tracks use expo-video's native APIs. External SRT/VTT files
can be imported from the player's subtitle menu and survive app restarts.

Scrubbing immediately starts a bounded, serialized preview worker. New pointer
positions replace the pending target; the current thumbnail remains visible while
the next image is generated. Continuous dragging no longer resets a debounce until
the preview disappears. JPEGs use two-second buckets and persist across launches,
keyed by file ID, size and modification time. The 50 MB cache evicts old images.
Unvisited timestamps are not generated ahead of time.

The player has no loading spinner over the video. Central playback/skip controls
are hidden while loading, scrubbing or showing the end screen. Back and settings
remain accessible. The mobile splash uses Expo's square icon and preserves its
aspect ratio; the TV-only legacy wide bitmap override is not applied on mobile.

## Updates and builds

Updates use the installed Android package version. Only releases tagged `build.N`
with a mobile APK and a build greater than the installed one are offered.
`versionCode = 50000 + build number`. The mobile version name comes from `apps/mobile/package.json`. Local preview APKs use `Plexy-mobile-v<version>-Android.apk`; the internal Android version code continues to increase for upgrade installation.

Build from the repository root with the token in the environment:

```
JAVA_HOME=/opt/homebrew/opt/openjdk@17 \
ANDROID_HOME=/opt/homebrew/share/android-commandlinetools \
GITHUB_RUN_NUMBER=31 PLEXY_ANDROID_ARCHITECTURES=arm64-v8a bun run build:mobile
```

CI builds must supply the token through the same environment configuration.
Native Gradle bundle inputs include both shared native-client and local-library
source so incremental builds pick up library changes.

## Verification

Run `bun run test:native` and `bun run --filter @plexy/mobile typecheck`.
Build 31 is version `1.0.1-beta.3`, Android version code `50031`, ARM64.
Emulator checks cover Home/Search navigation, movie and TV manual matching,
persistent movie/series artwork and cast photos, and local playback/scrub previews.
Phone testing is still needed for its actual video/audio/subtitle codec combinations
and the Android package install permission flow.

The current mobile preview is `1.0.1-beta.4` (Android version code `51001`), containing ARM64 and ARMv7 libraries. Install it over the existing app to keep the library. APK signature verification and upgrade installation are checked on the Android emulator.
