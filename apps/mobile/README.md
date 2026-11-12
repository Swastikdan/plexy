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

Check folder/file access, manual identification, embedded/imported subtitles, watch progress after restart, next-episode playback, Android Back, fullscreen rotation, and PiP on a real device before release.

## Player interaction

Pinch to zoom, or use the manual 5% zoom controls under player settings (75–300%).
Fit mode stays independent of zoom. Double-tap the left or right side to seek
backward or forward 30 seconds. Scrubbing previews the selected timestamp and
commits a single seek on release; controls stay available while buffering.

Local-file read-ahead targets 30% of the duration, bounded to 30–120 seconds and
64 MB. Playback can resume once one second is buffered. The native decoder may
reach the memory limit before the time target; this is not a guarantee that a
third of a large movie is held in memory. The timeline displays actual buffering.

## UI and bundled metadata

Mobile styling uses Tailwind CSS v4 through Uniwind. Keep `global.css` at the app root and import it from the root layout. HeroUI Native supplies native controls; use granular imports such as `heroui-native/button`. Icons live in `src/shared/ui/icons.tsx` and use individual Hugeicons imports so unused icons stay out of the bundle.

Set `TMDB_TOKEN` or `EXPO_PUBLIC_TMDB_TOKEN` in the build environment. Preview APK builds and EAS builds fail when it is missing. GitHub Android builds read the repository secret of the same name (with `TMDB_ACCESS_TOKEN` and `VITE_PUBLIC_TMDB_ACCESS_TOKEN` supported as aliases). Credentials are embedded in Expo config; they are readable from the distributed app, so use a TMDB client credential.

Collections and credits are cached with metadata and backfilled on the next online scan. Collection and person views show only local titles. Skip Intro appears during a valid saved intro window when automatic skipping is off; titles without community markers do not show a skip button. Cached markers and local playback remain available offline.
