# Plexy Mobile App Build Plan

## Product goal

Build **Plexy Client** as a native iOS and Android app that connects to a separately running Plexy Server. The app should cover the everyday features people expect from a movie and TV streaming client, including a capable player and offline downloads. It does not need to reproduce the desktop screens or copy the desktop player interactions exactly.

The app owns native presentation, device storage, playback controls, and download management. Plexy Server remains responsible for the media library, metadata, playback decisions, media conversion, authentication, and watch progress.

## Reuse and platform approach

- Build the app in `apps/mobile` with Expo, React Native, TypeScript, and Expo Router.
- Use React Native-specific screens and controls. The current Video.js/React player is browser code that depends on DOM and `HTMLVideoElement`; its components are not reusable as native UI.
- Reuse API contracts, server playback decisions, track metadata, skip markers, trickplay assets, progress behavior, and product rules where they are independent of the browser.
- Use `expo-video` for native iOS/Android decoding, seeking, and native tracks. Keep an adapter around it so a different native player can be evaluated without changing the rest of the app.
- Keep credentials in `expo-secure-store`; scope all cached data by stable server ID. Never put tokens in URLs, logs, analytics, or crash reports.
- The server is a separate product and process. The mobile app must not embed or launch it.

## Feature scope

### 1. Connect and pair with Plexy Server

- Add, edit, remove, and switch between saved server profiles.
- Accept a server URL by manual entry and, later, QR or local-network discovery.
- Probe `/api/server/status` before saving a connection; show server identity, version, and useful connection errors.
- Pair with a short-lived server code using `/api/auth/pair`; store the returned device token securely.
- Send `Authorization: Bearer <token>` on API, artwork, subtitle, trickplay, stream, and download requests.
- Handle revoked or invalid credentials with a clear re-pair flow. Support device revocation through server settings.
- Prefer HTTPS for remote access. Support a clearly configured LAN connection where the user explicitly enters an HTTP server URL; do not enable broad cleartext access to arbitrary hosts.
- Show active server and connection state; provide retry, reconnect, sign out, and switch-server actions.

### 2. Browse, find, and inspect the library

- Home rows for Continue Watching, Recently Added, and useful movie/show collections.
- Movie and TV library browsing with poster grids, incremental loading, pull-to-refresh, and empty/error states.
- Search with debouncing, cancellation, keyboard-safe results, and clear-result behavior.
- Title detail pages with poster/backdrop, synopsis, release year, runtime, genres, rating, cast/crew where available, and play/resume actions.
- TV navigation through show, season, and episode; show watched state, episode order, and next episode.
- Show available media versions with resolution, codec, HDR, and size when provided by the server.
- Support trailers where the server returns a usable trailer source; handle unavailable trailers without blocking playback.
- Support correction of a mismatched metadata match only if the existing server workflow can be safely exposed as a viewer action. Server administration itself stays out of the mobile client.

### 3. Playback

Implement a native player surface and controls for the following common streaming features:

- Play, pause, restart, elapsed and remaining time, seek bar, scrubbing, and short forward/backward skips.
- Resume prompt, continue from last position, restart from beginning, and completion handling.
- Orientation/full-screen handling, system volume/brightness conventions, lock-screen behavior where supported, and optional picture-in-picture after device testing.
- Buffering, reconnect, retry, unsupported media, expired credentials, and server conversion-limit errors with understandable recovery actions.
- Audio track selection and subtitle selection with language/label metadata. Support subtitle off, timing offset, and readable placement/style controls where the native platform permits.
- Playback speed choices where supported by the selected native player and source.
- Video quality choices from server-provided HLS variants or alternate source files. Show resolution and HDR labels; offer Auto when adaptive HLS is available.
- Intro/recap/outro markers and skip actions from `/api/skip-segments/:fileId`; keep automatic-skip preferences local to the app.
- Next episode action and optional countdown using the server-provided next-episode details.
- Trickplay seek previews using the server's VTT and sprite endpoints when available; ordinary scrubbing must still work if trickplay is absent.
- Periodically save progress and flush on pause, backgrounding, playback end, and leaving the player. Avoid excessive writes and handle temporary offline progress safely.
- Optional playback diagnostics showing the selected path, resolution, audio/subtitle selection, buffer state, and dropped-frame data without exposing credentials.

Native track support differs between iOS and Android and between progressive MP4 and HLS. Implement a player adapter and validate embedded and external subtitle behavior on both platforms. A custom subtitle overlay may be needed for Plexy's separately served WebVTT tracks.

### 4. Offline downloads

Users can save a movie or episode to the device and play it without a server connection. Downloads are explicit user actions; do not download the library automatically.

#### Quality selection and fallback

1. Request the playback manifest. Its `versions` list identifies source files for the same title, including height, codec, HDR, size, and file ID.
2. Offer the available source versions as download choices. Use the highest-resolution available source as the default “Best available” choice when the user has not selected a quality preference.
3. If the requested quality is not present as a source version, explain that the server can generate a smaller/lower-resolution download while transferring it. Ask before starting that conversion and show the selected output cap and estimated server work.
4. If the user declines generation, let them download the highest-quality source version that exists or cancel.
5. If the server has no alternate source quality, use its original file by default; offer generation only after the user chooses a supported cap.

Supported generated output caps are 360p, 480p, 720p, 1080p, 1440p, and 2160p. “Best available” means highest available source resolution, not a promise that the server can upscale a source. Generated quality is capped at the source dimensions.

#### Download behavior and management

- Download the selected source through `GET /api/download/:fileId`, using authenticated byte ranges for resumable source-file transfers.
- For an on-demand generated version, use `GET /api/download/:fileId?maxHeight=<height>` with Bearer auth. This runs a live transcode and streams the MP4 response to device storage; audio may be selected with `audio=<index>`.
- Show queued/downloading/completed/failed states, progress, size when known, retry, cancel, and delete actions. Store completed media in app-private device storage and index downloads locally for offline browsing.
- Provide a downloads area with file size, chosen quality, episode/title details, available device space, and delete controls. Allow users to remove one download or clear all downloads.
- Support a Wi-Fi-only preference, a low-storage warning, and an optional per-device storage cap. Never delete a user's completed download automatically without an explicit cleanup policy and notice.
- Keep downloaded file access within the app by default. Define whether exports/share-sheet access is supported as a separate product decision.
- Playback must use the local file when offline. Keep local playback progress and reconcile it with the server when connectivity returns.
- Sign-out should offer to keep or remove downloaded media; server switching must not mix metadata or credentials between profiles.

Generated downloads use the current live conversion path: they do not create a persistent server-side quality file. If the network fails, the client must restart that generated download from the beginning. Live conversion is limited to two concurrent server conversions and may return `503` with `Retry-After`; show a retry action. A future durable conversion-job API can add pause/resume across disconnects if actual use calls for it.

### 5. Settings and reliability

- Manage server profiles, pairing state, preferred audio/subtitle language, player defaults, skip preferences, download quality defaults, Wi-Fi-only behavior, and download storage.
- Provide app version, minimum-server-version messaging, connection diagnostics, cache clear, and sign-out.
- Localize user-facing labels and use accessible names, Dynamic Type, VoiceOver/TalkBack focus, adequate touch targets, and reduced-motion-aware transitions.
- Handle app background/foreground transitions, interrupted downloads, process restarts, device low storage, and connectivity changes.
- Do not expose server admin operations, media-library paths, or server filesystem access.

## Backend contract for mobile playback and downloads

The server already provides device pairing and Bearer authentication, playback manifests, source versions, direct range streaming, prepared adaptive HLS, remux/transcode fallback, subtitle and trickplay URLs, skip markers, and progress updates. The live transcode endpoint accepts `maxHeight` as an optional resolution/bitrate cap.

The mobile download path uses:

- `GET /api/play/:fileId` to obtain the chosen playback path, resume state, audio/subtitle tracks, trickplay, next episode, optimization state, and source `versions`.
- `GET /api/download/:fileId` to download an existing source version. It supports HTTP `Range`/`HEAD` and returns an attachment response.
- `GET /api/download/:fileId?maxHeight=720` to download a generated quality while the server transcodes. `audio=<index>` selects the audio track for this generated output.
- `GET /api/stream/:fileId/hls/:asset` for prepared adaptive playback; use variants reported by HLS/native player tracks where available.
- `GET /api/subtitles/:fileId` and `GET /api/subtitles/:fileId/:track` for subtitle discovery and WebVTT.
- `GET /api/trickplay/:fileId/track.vtt` and sprite endpoints for scrub previews.
- `GET /api/skip-segments/:fileId` and `POST /api/progress` for skip markers and watch-state sync.

The source-version list already supports choosing a different-resolution file. The new authenticated download endpoint supports range-based source downloads and one-request generated-quality streams. It does not persist generated versions on the server; generated downloads are not resumable after a disconnect. Do not place auth credentials in query parameters. Verify that Expo Video sends headers on playlist, segment, redirect, and range requests on physical devices before release.

For remote use, configure a trusted HTTPS address or a private network path. LAN HTTP behavior needs narrow platform configuration and real-device validation; do not weaken transport security globally.

## App structure

```text
apps/mobile/
  app/                 # Expo Router route files
  src/
    api/               # typed server API and media/download request adapters
    auth/              # pairing and secure credential storage
    downloads/         # local queue, file index, storage policy, offline playback
    player/            # expo-video adapter, native controls, subtitle/trickplay helpers
    features/          # home, library, search, details, settings
    storage/           # server profiles and non-secret preferences
    theme/             # native design tokens
  app.json             # identifiers, permissions, native config
```

Keep native file handling and platform-specific player behavior inside `apps/mobile`. Extract shared API types only when importing them does not pull DOM, CSS, or browser globals into React Native.

## Delivery phases and acceptance criteria

### Phase 0 — Native playback and download feasibility

- Pair a development build to a Plexy Server and fetch a title, artwork, play manifest, and versions.
- Play one direct file and one prepared HLS stream with Bearer auth on physical iOS and Android devices.
- Validate range requests, redirects, HLS child requests, audio selection, embedded subtitles, external WebVTT, seeking, and progress.
- Download one existing source file with range/resume behavior and play it with the server disconnected.
- Generate one capped quality through the download endpoint, play it offline, and verify failure/retry behavior on network interruption.
- Record minimum OS and server versions plus HTTP/HTTPS requirements.

**Gate:** do not commit to a full player/download UX until the authenticated native playback and file-download paths work on both platforms.

### Phase 1 — App shell and connection

- Create the Expo workspace app, navigation, server profiles, status probe, pairing, SecureStore adapter, and native design system.
- Acceptance: can pair, reconnect, switch server profiles, and load a scoped catalog on iOS and Android.

### Phase 2 — Catalog and discovery

- Add home rows, libraries, search, movie/show/episode details, versions, and continue-watching actions.
- Acceptance: users can find and select a movie or episode with loading, empty, and failure states.

### Phase 3 — Playback

- Add native player, resume/progress, track selection, quality choices, trickplay, skip markers, next episode, and playback recovery.
- Acceptance: representative direct, HLS, and server-converted playback work on both platforms with authenticated requests.

### Phase 4 — Downloads and offline use

- Add source quality choices, generated-quality consent flow, local download queue and index, storage management, offline player, and progress reconciliation.
- Acceptance: source downloads resume after a transfer interruption; generated downloads report their restart-from-zero limitation; completed files play offline and can be removed by the user.

### Phase 5 — Release readiness

- Complete accessibility, localization, privacy text, app identifiers, icons/splash, signing, EAS profiles, minimum-server messaging, and support diagnostics.
- Acceptance: reproducible iOS and Android builds with documented install, server setup, pairing, and troubleshooting instructions.

## Build and platform notes

Use development builds for native modules and EAS Build for repeatable signed artifacts. Keep mobile scripts separate from root web/desktop build semantics. Decide app identifiers, signing ownership, minimum OS, update policy, and store metadata before release. Re-check current Expo documentation when implementation begins: [Expo Video](https://docs.expo.dev/versions/latest/sdk/video/), [Expo SecureStore](https://docs.expo.dev/versions/latest/sdk/securestore/), [Expo Router](https://docs.expo.dev/router/introduction/), and [EAS Build](https://docs.expo.dev/build/introduction/).
