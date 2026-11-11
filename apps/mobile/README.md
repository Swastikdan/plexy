# Mobile app

A standalone Android library and player. Files and watch progress stay on the device. No Plexy backend, accounts, server connection, remote downloads, or casting are needed or included. Optional metadata/artwork and skip-marker lookups use TMDB and IntroDB; app updates use GitHub releases.

## Source layout

- `src/app`: Expo Router route adapters. `(tabs)` contains Home, Libraries, Search, and Settings. Title details and playback use the root stack.
- `src/screens`: mobile screen implementations.
- `src/components`: reusable mobile UI, thumbnails, update controls, and library attention.
- `src/ui`: presentation tokens and formatting helpers.
- `src/providers`: fonts, library restoration, and state lifecycle.
- `src/navigation`: stable media identifiers mapped to file routes.
- `src/lib`: device database, local runtime, and mobile logic in `client/`. The catalog adapter calls the local library in process; `/api/...` strings here are dispatch keys, never network requests.
- `tests`: mobile logic regression tests.

`packages/local-library` owns reusable indexing, metadata, and library persistence contracts. `packages/api-client/src/types.ts` supplies shared media data types. No mobile UI is imported from another app or shared package.

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
