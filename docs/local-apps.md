# Standalone local apps

Android mobile and macOS own independent libraries. Media stays in the folders selected on that device. There is no library sync, casting, LAN listener, or remote-server selection in standalone mode. The separate headless server and Android TV retain their existing behavior.

## Android

The existing React Native interface and expo-video player now use an in-process `LocalApi`. `packages/local-library/src/library.ts` owns the device index, movie/series grouping, incremental scans, metadata age, and watch progress. The index is persisted in device storage. The mobile adapter in `apps/mobile/local.tsx` handles Android's persisted folder grants, TMDB, artwork files, and cached IntroDB markers. No Bun runtime or HTTP server is required on the phone.

On first launch, Settings opens. Add movie or series folders using the Android folder picker. Add a TMDB API read access token to obtain posters, descriptions, cast, and episode information. A library can be indexed and played without a token; titles initially come from filenames. Cached artwork and metadata remain available offline. Ambiguous TMDB searches stay unmatched instead of choosing an arbitrary title.

The app checks selected folders at startup, when returning to the foreground, and every five minutes while active. A complete scan removes records for deleted files. An unreadable or incompletely walked folder keeps its cached records. Metadata older than seven days is retried when online; reconnecting also triggers a check. Original media is never moved, copied, converted, or deleted by the indexer. Removing a folder removes only its library index.

The player retains seeking, saved progress, speed and fit controls, next episode, picture-in-picture, sidecar SRT/VTT, embedded subtitles, native audio-track selection, and cached intro/credit markers. Server conversion, generated qualities, casting, and duplicate downloads are unavailable in local mode. Seek-preview thumbnails are decoded on demand from the local source without generating another video file. Native embedded subtitle rendering is controlled by the platform player; overlay styling and timing controls apply to sidecar subtitles.

## macOS

The existing Electron UI and bundled backend are retained for the quickest migration. The launcher sets `PLEXY_LOCAL_ONLY=1` and `PLEXY_DIRECT_PLAY_ONLY=1`. These force loopback-only listening and disable video preparation, remuxing, transcoding, and generated downloads, including attempts through direct API calls. Original file bytes are streamed locally to the player. The UI ignores previously saved remote addresses and hides network sharing and video-preparation controls.

The existing local database, artwork cache, authentication, folder picker, scanner, metadata matcher, and player are reused. Startup checks the library; the existing scheduled scanner also checks while the backend is running. Stale known TMDB IDs refresh in bounded batches after scans when connectivity is available. Probe, subtitle extraction, and thumbnail tooling are retained; they do not create converted video copies.

Direct-play format support differs between the Android native player and the desktop Chromium player. In particular, files previously requiring remuxing or transcoding can be unsupported on desktop. Broad MKV/codec support and identical native audio/subtitle capabilities would require a separate native desktop playback engine. This preview does not claim complete player feature parity across platforms.

## Verification and packaging

- `bun run test:native` includes local-library regression tests.
- `bun run test:server` includes standalone conversion-route and preparation-queue checks.
- `bun run typecheck` and `bun run typecheck:native` check all current clients.
- `bun run build:mobile` produces the Android internal preview APK.
- `bun run build:desktop` packages the Apple Silicon macOS app, DMG, and ZIP.

Both artifacts require playback testing with real media on their target devices before publication. The Android preview uses the repository's internal test signing identity; the macOS package uses its existing ad-hoc signing configuration.
