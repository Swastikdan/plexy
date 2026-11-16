# Mobile app

A standalone Android library and player. Files and watch progress stay on the device. No Plexy backend, accounts, server connection, remote downloads, or casting are needed or included. Optional metadata/artwork and skip-marker lookups use TMDB and IntroDB; app updates use GitHub releases.

## Source layout

- `src/app`: thin Expo Router adapters. `(tabs)` contains Home, Libraries, Search, and Settings; title details and playback use the root stack.
- `src/features/<feature>`: each screen with its own `components`, `hooks`, and `lib` where needed. Home, Library, Search, Title, Player, Settings, and Library Report each have a named `*-screen.tsx` entry.
- `src/features/catalog`: artwork, rows, title browsing, and playback-label logic shared by the catalog screens.
- `src/core/library`: local runtime, catalog API adapter, and device database.
- `src/core/client`: app-wide client provider, preferences, and watch-progress queue.
- `src/core/resources`: resource loading and invalidation.
- `src/core/mobile-provider.tsx`: startup, fonts, splash readiness, and app lifecycle.
- `src/shared/ui`: individual reusable controls such as `button.tsx`, `media-card.tsx`, `poster-image.tsx`, and `page-header.tsx`.
- `src/shared/hooks`, `src/shared/lib`, `src/shared/navigation`: helpers genuinely shared across features.
- `src/shared/theme.ts`: colors, typography, and shape tokens.
- `tests`: mobile regression and architecture checks.

Use `@/` for imports from mobile `src` (for example, `@/shared/theme`). Shared code comes from real workspace packages: import `@plexy/api-client`, `@plexy/api-client/types`, `@plexy/local-library/library`, or `@plexy/local-library/metadata`. Do not add path aliases for those names; Expo Metro and Bun resolve them through the workspace links created by `bun install`. Keep asset/configuration filesystem paths relative.

Use kebab-case for files and folders. React component symbols remain PascalCase. Expo Router keeps its required `_layout.tsx` and `index.tsx` names; dynamic routes use `[id].tsx` and `[file-id].tsx`. The player still opens at `/player/<id>`.

Keep routes focused on URL parameters and navigation. Put a screen's components and playback, settings, or catalog logic in that feature. Extract a component when it has its own responsibility or is reused; import shared UI directly from its file. Avoid catch-all `ui.tsx` files and feature code in generic client folders. File import logic belongs to Library, so Library Report never imports the Settings screen.

`packages/local-library` owns reusable indexing, metadata, and persistence contracts. `packages/api-client/src/types.ts` supplies shared media data types. No mobile UI is imported from another app or shared package. The local API runs in process; `/api/...` strings are dispatch keys, never network requests.

## Build and verify

From the repository root:

```sh
bun install
bun run typecheck:native
bun run test:native
bun run bundle:native
bun run build:mobile
```

APK builds use JDK 17 and Android SDK tooling. `expo prebuild` generates the ignored Android project. Keep native configuration in `app.config.ts` and config plugins. The shared-inputs plugin tracks local-library and media type changes for Gradle bundle caching.

CI and local preview builds target `arm64-v8a`. Override `PLEXY_ANDROID_ARCHITECTURES` for other devices. APKs use the repository's preview signing key; production signing belongs to the EAS production profile. Build output is ignored under `.build/native`.

Check folder/file access, manual identification, embedded/imported subtitles, watch progress after restart, next-episode playback, Android Back, the landscape player lock (portrait shell restored on exit), and PiP on a real device before release.

## Player interaction

The player is landscape-only: the device locks to landscape the moment the
player opens and the app shell (portrait) is restored on exit. The chrome
follows the reference design (its portrait mockups read as this layout when
rotated upright): the seek bar runs along the bottom with the elapsed time at
its left end and the remaining time at its right end, Speed / Lock / Episodes
/ Audio & Subtitles / Next Episode sit in a bottom row just under it, the
episode title is top-center, fit / PiP / settings sit top-left and the close
button top-right. Pinch with two fingers to zoom (75–300%); fit mode stays
independent of zoom. Swipe up or down on the left half of the video to adjust
brightness (in-app dimming) and on the right half to adjust volume; each
indicator is a vertical bar hugging its screen edge and is only visible while
the gesture is in progress. Double-tap the left or right side to seek backward
or forward; the double tap skips one interval (10 seconds by default), and every
further same-side tap within about a second adds another interval, so repeated
taps accumulate a larger skip. Seek feedback appears on the tapped side with
the running total. Hold anywhere on the video to play at 2×; releasing restores
the previous speed. A single tap still toggles the controls. Scrubbing previews
the selected timestamp with a trick-play thumbnail and commits a single seek on
release; dragging back near the starting position shows "Release to cancel"
and releasing keeps the original position. Embedded MP4 `chpl` and
Matroska/WebM chapter markers appear on the timeline with their title while
scrubbing, and crossing a chapter boundary while scrubbing gives a haptic tick.
Controls
stay available while buffering. During the credits the next-episode countdown
runs behind "Watch credits" / "Next Episode" pills in the bottom-right.

Local-file read-ahead targets 30% of the duration, bounded to 30–120 seconds and
64 MB. Playback can resume once one second is buffered. The native decoder may
reach the memory limit before the time target; this is not a guarantee that a
third of a large movie is held in memory. The timeline displays actual buffering.

## UI and bundled metadata

Mobile styling uses Tailwind CSS v4 through Uniwind. Keep `global.css` at the app root and import it from the root layout. HeroUI Native supplies native controls; use granular imports such as `heroui-native/button`. Icons live in `src/shared/ui/icons.tsx` and use individual Hugeicons imports so unused icons stay out of the bundle.

Set `TMDB_TOKEN` or `EXPO_PUBLIC_TMDB_TOKEN` in the build environment. Preview APK builds and EAS builds fail when it is missing. GitHub Android builds read the repository secret of the same name (with `TMDB_ACCESS_TOKEN` and `VITE_PUBLIC_TMDB_ACCESS_TOKEN` supported as aliases). Credentials are embedded in Expo config; they are readable from the distributed app, so use a TMDB client credential.

Collections and credits are cached with metadata and backfilled on the next online scan. Collection and person views show only local titles. Skip Intro appears during a valid saved intro window when automatic skipping is off; titles without community markers do not show a skip button. Cached markers and local playback remain available offline.

## Versions and startup updates

`bun run build:mobile` allocates the next mobile patch version before creating
an APK (`1.0.8` → `1.0.9`). It reads published mobile versions, CI draft
reservations, and `.build/native/mobile-version`; it needs an authenticated
GitHub CLI with repository release access (or `GH_TOKEN`) and network access to
avoid silently reusing a release version. Development starts and bundle checks
do not increment versions. Failed new builds can leave gaps. Use
`PLEXY_VERSION_BUMP=minor` or `major`, or an explicit newer
`PLEXY_MOBILE_VERSION`, when needed. Android's internal versionCode is derived
from that semantic version. Patch/minor components are limited to 99; bump the
next component instead of overflowing. Existing Android codes remain ordered
below the next semantic version.

Configure `mobile-release.json` before pushing:

- `optional`: dismissible update notice.
- `feature`: dismissible notice highlighting the release notes.
- `necessary`: the new version becomes the minimum supported version. Users on
  an older version cannot enter the app until they update. A cached requirement
  remains enforced offline, after installer cancellation, and after restart.

Set `message` and `releaseNotes` for user-facing copy. Optional/feature releases
inherit the previously published minimum; lowering the configured minimum does
not remove a known requirement. A new installation with no cached requirement
continues offline when the update service cannot be reached. Notices wait until
playback exits. Settings shares the same updater and provides manual retry.

The GitHub workflow offers update-type and patch/minor/major inputs for manual
runs. Push builds use the config file. Local builds and CI reserve `mobile-vX.Y.Z` as a draft
before building; retries of that run reuse the version, while a published
version cannot be rebuilt in place. Once the APK exists, the release job
publishes it and its SHA-256 manifest, then updates the `mobile-latest` policy
asset. Keep the preview signing key stable for in-place installation. Direct
EAS production builds remain a separate signing/distribution path; publish
startup-update APKs through the repository's mobile build workflow.

The first release containing this coordinator enables startup enforcement;
older installed APKs cannot be forced to adopt behavior they do not contain.
Verify optional dismissal, required-update Back behavior, offline restart,
unknown-app permission denial, cancellation, and successful upgrade on a device.
