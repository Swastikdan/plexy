# Plexy React Native Mobile and TV Build Plan

## Implementation status

Native mobile/TV clients and shared code are now implemented. Read [NATIVE_CLIENT_README.md](NATIVE_CLIENT_README.md) for build/install commands, supported behavior, known gaps and the outstanding physical-device release matrix. Native builds and automated checks are separate from device-verified parity; do not treat the remaining release gates below as completed. The implementation also adds authenticated download source metadata and ETag/If-Range validation on the server.

## Product goal

Build **Plexy Client** as two React Native Android applications: a mobile app and a TV app that connects to a separately running Plexy Server. The app should cover the everyday features people expect from a movie and TV streaming client, including a capable player and offline downloads. Preserve the current Plexy visual identity and player appearance/features, adapting layout and input for touch on mobile and remote navigation on TV. iOS and Apple TV are out of scope.

The app owns native presentation, device storage, playback controls, and download management. Plexy Server remains responsible for the media library, metadata, playback decisions, media conversion, authentication, and watch progress.

## Confirmed architecture and visual requirements

This plan supersedes the GeekNative/Kotlin/Jetpack Compose frontend proposal. The existing reference app is React/Vite with TanStack Router, not Next.js. Use the checked-in app as the design source of truth; “Obsidian” is not a separate identified frontend in the inspected source.

Ship separate mobile and TV artifacts, sharing TypeScript API models, repositories, authentication rules, playback state, preferences and visual tokens. Use `apps/mobile` for Android phones/tablets, `apps/tv` for Android TV/Google TV, and `packages/native-client` for genuinely shared native code. Evaluate Fire TV with the same TV client on physical hardware; do not claim Samsung Tizen/LG webOS support. No server process is packaged in either app.

Use Expo/React Native for mobile and React Native for TV (`react-native-tvos`) with Expo TV configuration where supported. Pin a compatible React Native/Expo/TV dependency set after a minimal build and playback proof. Keep separate native build directories and dependency resolution so the TV React Native alias cannot silently replace the mobile runtime. Do not assume every Expo library supports TV; verify navigation, secure storage, video, orientation and downloads before choosing shared adapters.

### Preserve the current appearance

Extract the actual colors, typography, spacing, corners, artwork ratios and icon conventions from `apps/web/src/styles.css`, `apps/web/src/theme.ts` and current screens. Preserve the dark cinema theme, title hierarchy, poster/backdrop presentation, rows, progress indicators, labels and button treatments. Preserve the player gradient, timeline, time labels, icon meanings and menu grouping from `apps/web/src/components/videojs` and `apps/web/src/routes/watch/$fileId.tsx`. Recreate these in native views; DOM/CSS/Video.js components cannot be imported into native screens.

Mobile uses touch-sized controls, safe areas, compact navigation, responsive grids and touch-friendly player menus. TV uses readable couch-distance text, larger cards, a landscape navigation rail, visible focus rings and deterministic D-pad navigation. Restore focus to the selected card after returning from details/player; support Back, Select, media keys, long lists and modal focus containment. Every essential action must work without touch or a mouse. Keep the same identity rather than scaling the phone screen up.

Create a route/action parity checklist from the current app before screen implementation. Include account and server connection, home, libraries, search, title/season/episode details, collections/watchlists where present, watched state, settings and supported remote actions. Preserve existing features rather than silently narrowing scope to this document's examples. TV may use different interactions for the same action.

### Player parity and acceptance

Inventory visible and conditional player controls in the existing watch route, settings menu and playback preferences. Track each control as implemented, device-verified or blocked with a concrete reason. Required behavior includes play/pause, 10-second seeks, timeline and trickplay previews, elapsed/remaining time, resume/restart, progress/completion sync, audio tracks, captions on/off, subtitle timing and placement, speed, source/quality selection, skip markers, next episode, loading/error recovery and diagnostics where currently available. Retain PiP and casting in the checklist; AirPlay is outside Android scope. Platform gaps require explicit implementation or a recorded decision, not an unnoticed omission.

Use a native video surface with custom React Native controls to match the existing player. A default system player alone does not satisfy visual parity. Validate external subtitles and timing/placement overlays, server track switching and authenticated HLS descendants early. Provide a player adapter so TV compatibility or missing advanced capabilities can be addressed without rewriting all controls. TV scrubbing uses remote input with seek previews; mobile uses touch scrubbing. Keep TV controls visible while a menu or scrubber has focus.

Mobile fullscreen must rotate horizontally into landscape, as explicitly confirmed by the user. Test entry/exit, Back, system navigation, orientation restoration and background/resume. Opening a settings menu must not exit fullscreen or reset playback.

### Delivery and verification for both apps

First build installable minimal apps on mobile and TV and prove authenticated direct/HLS/converted playback. Then implement shared tokens and the mobile/TV shells, followed by catalog parity, matching player controls, downloads and remaining settings. Compare representative mobile and TV screens against the current app using the same title/artwork and playback state. Verify readable layouts, focus traversal, touch targets and player overlays at actual device resolutions.

Release gates are two installable Android builds, real-server feature parity, real-device media tests, mobile landscape restoration, TV remote-only end-to-end navigation and reproducible signed APK/AAB instructions. Offline download behavior from this plan remains in scope, with TV storage/capability policy verified explicitly. Do not imply that a plan, scaffold or mock catalog is a completed app.

References: [Expo TV guide](https://docs.expo.dev/guides/building-for-tv/), [React Native TV](https://github.com/react-native-tvos/react-native-tvos), [Expo Video](https://docs.expo.dev/versions/latest/sdk/video/).

## Reuse and platform approach

- Build separate `apps/mobile` and `apps/tv` applications with React Native and TypeScript. Use Expo Router where the chosen TV-compatible dependency set passes the feasibility gate.
- Use React Native-specific screens and controls. The current Video.js/React player is browser code that depends on DOM and `HTMLVideoElement`; its components are not reusable as native UI.
- Reuse API contracts, server playback decisions, track metadata, skip markers, trickplay assets, progress behavior, and product rules where they are independent of the browser.
- Use `expo-video` for native Android decoding, seeking, and native tracks. Keep an adapter around it so a different native player can be evaluated without changing the rest of the app.
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
- Mobile fullscreen explicitly enters landscape and hides system chrome; exiting, Back, unmounting or playback failure restores the previous orientation policy and system UI. Support both landscape directions, safe insets and resume after backgrounding. TV remains landscape. Include system volume/brightness conventions, lock-screen behavior where supported, and picture-in-picture after device testing.
- Buffering, reconnect, retry, unsupported media, expired credentials, and server conversion-limit errors with understandable recovery actions.
- Audio track selection and subtitle selection with language/label metadata. Support subtitle off, timing offset, and readable placement/style controls where the native platform permits.
- Playback speed choices where supported by the selected native player and source.
- Video quality choices from server-provided HLS variants or alternate source files. Show resolution and HDR labels; offer Auto when adaptive HLS is available.
- Intro/recap/outro markers and skip actions from `/api/skip-segments/:fileId`; keep automatic-skip preferences local to the app.
- Next episode action and optional countdown using the server-provided next-episode details.
- Trickplay seek previews using the server's VTT and sprite endpoints when available; ordinary scrubbing must still work if trickplay is absent.
- Periodically save progress and flush on pause, backgrounding, playback end, and leaving the player. Avoid excessive writes and handle temporary offline progress safely.
- Optional playback diagnostics showing the selected path, resolution, audio/subtitle selection, buffer state, and dropped-frame data without exposing credentials.

Native track support differs between Android devices and between progressive MP4 and HLS. Implement a player adapter and validate embedded and external subtitle behavior on mobile and TV. A custom subtitle overlay may be needed for Plexy's separately served WebVTT tracks.

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
- Localize user-facing labels and use accessible names, font scaling, TalkBack focus, adequate touch targets, and reduced-motion-aware transitions.
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

Add the TV and shared code alongside this mobile structure:

```text
apps/tv/
  app/                 # TV routes and remote-first screens
  src/focus/           # focus restoration, rail/grid traversal, modal containment
  src/player/          # remote controls and TV video adapter
  app.config.ts        # TV manifest, banner, identifiers and build configuration
packages/native-client/
  api/                 # platform-independent requests and API models
  session/             # server-scoped sessions; injected credential storage
  playback/            # progress, track preferences, skip/next-episode rules
  theme/               # tokens derived from the web app
  components/          # native primitives with touch/focus variants where useful
```

Keep credential storage, native file transfers, orientation and video surfaces behind platform adapters. Share logic and primitives when their behavior matches; keep screen composition and navigation specific to mobile or TV. Extract shared API types only when importing them does not pull DOM, CSS, or browser globals into React Native.

## Delivery phases and acceptance criteria

### Phase 0 — Native playback and download feasibility

- Pair a development build to a Plexy Server and fetch a title, artwork, play manifest, and versions.
- Play one direct file and one prepared HLS stream with Bearer auth on physical Android mobile and TV devices.
- Validate range requests, redirects, HLS child requests, audio selection, embedded subtitles, external WebVTT, seeking, and progress.
- Download one existing source file with range/resume behavior and play it with the server disconnected.
- Generate one capped quality through the download endpoint, play it offline, and verify failure/retry behavior on network interruption.
- Record minimum OS and server versions plus HTTP/HTTPS requirements.

**Gate:** do not commit to a full player/download UX until the authenticated native playback and file-download paths work on mobile and TV.

### Phase 1 — App shell and connection

- Create both workspace apps, separate build profiles, navigation, server profiles, status probe, pairing, secure credential adapters, and shared native design tokens. Include TV launcher configuration and remote focus primitives.
- Acceptance: can pair, reconnect, switch server profiles, and load a scoped catalog on Android mobile and TV.

### Phase 2 — Catalog and discovery

- Add home rows, libraries, search, movie/show/episode details, versions, and continue-watching actions.
- Acceptance: users can find and select a movie or episode with loading, empty, and failure states. TV users complete this with only a remote and return to the same focused card; mobile layouts work on narrow phones and tablets.

### Phase 3 — Playback

- Add native player, resume/progress, track selection, quality choices, trickplay, skip markers, next episode, and playback recovery.
- Acceptance: representative direct, HLS, and server-converted playback work on mobile and TV with authenticated requests.

### Phase 4 — Downloads and offline use

- Add source quality choices, generated-quality consent flow, local download queue and index, storage management, offline player, and progress reconciliation.
- Acceptance: source downloads resume after a transfer interruption; generated downloads report their restart-from-zero limitation; completed files play offline and can be removed by the user.

### Phase 5 — Release readiness

- Complete accessibility, localization, privacy text, app identifiers, icons/splash, signing, EAS profiles, minimum-server messaging, and support diagnostics.
- Acceptance: reproducible Android mobile and TV builds with documented install, server setup, pairing, and troubleshooting instructions.

## Build and platform notes

Use development builds for native modules and EAS Build for repeatable signed artifacts. Keep mobile scripts separate from root web/desktop build semantics. Decide app identifiers, signing ownership, minimum OS, update policy, and store metadata before release. Re-check current Expo documentation when implementation begins: [Expo Video](https://docs.expo.dev/versions/latest/sdk/video/), [Expo SecureStore](https://docs.expo.dev/versions/latest/sdk/securestore/), [Expo Router](https://docs.expo.dev/router/introduction/), and [EAS Build](https://docs.expo.dev/build/introduction/).


## Concrete parity checklist

Before implementation, turn this table into an issue checklist with links to the exact source actions. “Required” describes planned behavior, not completed work. Collections/watchlists and other conditional features enter the checklist only when present in the current source.

| Existing source | Mobile target | TV target | Completion evidence |
| --- | --- | --- | --- |
| `routes/connect.tsx`, `routes/account.tsx` | Server entry, account/device connection, reconnect and sign-out | Remote-friendly entry/pairing and account actions | Real server; expired/revoked session recovery |
| `routes/index.tsx`, `routes/library/$kind.tsx` | Home rows and responsive catalog grids | Focusable rows/grids and navigation rail | Same content, order, progress and empty/error states |
| `routes/search.tsx` | Keyboard-friendly search and cancellation | Remote keyboard and predictable results focus | Search, open title, Back to previous results |
| `routes/title/$itemId.tsx` | Title, versions, seasons, episodes and actions | Couch-readable details and remote actions | Movie and multi-season show walkthrough |
| `routes/watch/$fileId.tsx`, `components/videojs` | Matching custom controls; landscape fullscreen | Matching visual controls with D-pad/media-key operation | Playback matrix below and control-by-control checklist |
| `lib/playback-preferences.ts` | Persist supported player preferences | Persist supported player preferences | Restart app and verify settings are restored |
| Setup/library/admin routes | Server administration remains on the server/web interface | Same boundary | List excluded administrative actions explicitly |

If inspection finds a normal viewer action in an administrative route, evaluate that action separately; route placement alone must not remove viewer functionality.

## Playback and layout validation matrix

Use a real Plexy server and representative media rather than relying only on mock responses. Record the tested device, Android version, app/server versions and result for every release candidate.

- Media: direct MP4, range-seek source, prepared adaptive HLS and server remux/transcode; multiple audio tracks; embedded and external subtitles; HDR/unsupported codec fallback; unavailable trickplay; movie completion and episode continuation.
- Network: LAN HTTP where configured, trusted HTTPS, revoked token, server restart, network loss/reconnect and interrupted source/generated downloads. Check authorization on child playlists, segments, artwork, subtitles and sprite requests.
- Mobile: narrow phone, tablet, portrait browsing, both landscape fullscreen directions, Back/exit orientation restoration, background/resume, process restart and PiP where supported.
- TV: emulator plus at least one physical Android TV/Google TV device, remote-only pairing-to-playback flow, long grids, edge focus, modal focus return, repeated seeking, media keys and Back behavior. Add physical Fire TV results before claiming Fire TV support.
- Appearance: compare home, library, title, player and player menus with the web reference using identical artwork/state. Preserve palette, typography hierarchy and control grouping while allowing touch/TV sizing and navigation changes.
- Offline: completed local media with the server unreachable, local progress reconciliation, low storage, cancel/delete, app restart and server-profile isolation. Verify TV storage and transfer support before declaring TV download parity; unresolved support blocks that scope rather than silently dropping it.

Use unit tests for shared playback/progress and queue state transitions, contract tests for API adapters, and device end-to-end checks for native playback, orientation and focus. A JavaScript test pass cannot establish hardware codec or remote-input compatibility.

## Publishing and server deployment

1. Keep Plexy Server deployed independently on the user's server/NAS/host. The apps connect to its configured address; installing an APK does not install or expose a backend. Document server startup, persistent media/configuration storage, HTTPS/private-network access and pairing.
2. Assign separate Android application IDs for mobile and TV, plus separate development/preview/production profiles. Keep signing keys in controlled release storage and retain the same signing identity for updates. Do not commit secrets or keystores.
3. Produce signed APKs for direct installation and AABs for Google Play distribution. First distribute preview builds to test devices, then use Play internal/closed testing before production. Submit the mobile and TV apps separately under this plan; provide platform-appropriate screenshots, TV banner/icon assets, remote-navigation demonstrations where required, privacy information and reviewer connection instructions.
4. Verify current Play target-API, TV quality, privacy and testing requirements at submission time; they can change. Document direct APK update installation as well as the store update path. Fire TV/Amazon distribution is a separate validation/submission step after device support is established.
5. Ship a release checklist containing both artifact versions, supported server versions, dependency lockfile, reproducible build commands, tested devices and known limitations. OTA JavaScript updates, if enabled, must stay within the installed native runtime's compatibility; native dependency changes require a new binary.

## Benefits and caveats

| Area | Benefit | Cost or caveat |
| --- | --- | --- |
| Existing React/TypeScript | Reuses API types, product rules and team knowledge | Browser screens, CSS and Video.js controls need native implementations |
| Mobile plus TV | Shared sessions, playback rules and tokens reduce duplicated work | TV needs its own composition, focus system and testing; two artifacts still need release maintenance |
| Current appearance | Keeps Plexy recognizable across devices | Exact pixel equivalence would harm TV readability and touch usability; preserve identity and grouping at appropriate sizes |
| Native playback | Uses Android decoding and integrates with device playback behavior | Codec/HDR/audio capabilities vary by device; advanced subtitles, casting and PiP require specific implementation and tests |
| Expo tooling | Simplifies configuration and repeatable build profiles | TV library support and React Native version alignment constrain dependency choices; development builds are required |
| Separate backend | Keeps scanning, metadata and conversion off clients | Remote playback depends on server reachability, bandwidth, credentials and conversion capacity |
| Downloads | Enables local playback without a live connection | Large files consume device storage; background execution needs validation; generated downloads restart after disconnect |

## Effort and implementation order

Planning estimate for one experienced React Native developer familiar with this repository: **roughly 8–14 developer-weeks** for both clients and release validation, assuming the current server contracts work as described. This is an estimate, not a commitment; replace it after the native feasibility milestone. Advanced subtitle handling, casting, durable background downloads or device-specific codec failures can extend it.

| Milestone | Estimated effort | Exit result |
| --- | --- | --- |
| Native feasibility and complete feature inventory | 1–2 weeks | Installable phone/TV proofs; compatibility decisions and measured gaps |
| Shared core, pairing and both app shells | 1–2 weeks | Server-scoped sessions, visual tokens and working remote/touch navigation |
| Catalog and details parity | 1–2 weeks | Existing viewer browse/search/detail actions on both devices |
| Matching player and feature parity | 2–4 weeks | Authenticated playback and controls verified against the web checklist |
| Downloads and offline progress | 1–2 weeks | Verified transfer/storage/recovery behavior on supported target devices |
| Device hardening and release preparation | 1–2 weeks | Signed artifacts, install/deployment guide and release evidence |

The ranges overlap and sum to approximately 7–14 weeks; reserve at least one additional week at the low end for integration, yielding the 8–14-week planning range. Do not treat shared React code as proof that the TV UI or native video behavior is already solved.

The first implementation deliverable is the two installable feasibility clients and the feature inventory, followed by a revised estimate based on actual devices. Full screen-building starts after the player, authentication and TV dependency risks are resolved.
