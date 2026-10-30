# Plexy Mobile App Build Plan (Expo + React Native)

## 1. Goal and product boundary

Build **Plexy Client** as an iOS and Android movie library app using Expo and React Native. It connects to a separately running **Plexy Server**. The mobile app owns presentation and user interaction; the server remains responsible for libraries, media files, scanning, metadata, playback decisions/conversion, persistence, and authorization.

The mobile app must not embed, launch, or reimplement the backend. It should call the server's existing APIs and request a narrowly scoped API change only when an identified mobile requirement cannot be met with the current contract. Keep the desktop UI-only client, standalone Plexy Server binary, and combined Plexy desktop app as separate products described in [the distribution plan](MOBILE_AND_DISTRIBUTION_DETAILED_PLAN.md).

## 2. Recommended project shape

Create a dedicated workspace app at `apps/mobile` rather than wrapping the browser app in a WebView. Use Expo with TypeScript and React Native, Expo Router for navigation, and EAS Build for signed iOS/Android artifacts. Reuse `packages/api-client` types and API contract where practical, but do not assume browser-only APIs, DOM components, CSS, localStorage, or the web app's authentication behavior work natively.

Suggested layout:

```text
apps/mobile/
  app/                 # Expo Router route files
  src/
    api/               # server URL, status, pairing, catalog, playback clients
    auth/              # device identity, pairing state, secure credential adapter
    components/        # native controls, cards, navigation, states
    features/          # home, library, search, title, player, settings
    storage/           # non-secret preferences and server profiles
    theme/             # tokens, typography, spacing, Plexy Client icon references
  app.json             # Expo config and native icon/splash settings
```

Keep app-specific types and adapters in `apps/mobile`; extract shared API types only when that does not pull browser dependencies into React Native. Use a server-profile abstraction so multiple server addresses can be saved and switched without mixing cached data or credentials.

## 3. Key technical choices

- **Navigation:** Expo Router with typed route parameters for server setup, pairing, home, library, search, title, playback, and settings.
- **Server data:** TanStack Query can be reused if its native networking/storage needs are handled explicitly; scope query keys by stable server identity and clear or partition cache when switching servers.
- **Secure credentials:** use `expo-secure-store` for device token/refresh material. Store server URLs and harmless UI preferences separately in ordinary app storage. Validate SecureStore behavior on physical devices and define reinstall/restore behavior.
- **Playback:** use `expo-video` for native iOS/Android playback. Start with native controls for the first playable slice, then add Plexy controls for seek, resume, subtitles, audio tracks, and next episode where platform/API support them.
- **Builds:** use Expo development builds for native module work and EAS Build for repeatable device/store builds. Record app identifiers, signing ownership, update channel, and environment configuration before release builds.
- **Visual identity:** name the app Plexy Client and use the Client icon variant, distinct from Plexy Server. Use platform app icon and splash assets for both platforms.

Re-check official Expo docs when implementation starts because SDK package versions change: [Expo Video](https://docs.expo.dev/versions/latest/sdk/video/), [Expo SecureStore](https://docs.expo.dev/versions/latest/sdk/securestore/), [Expo Router](https://docs.expo.dev/router/introduction/), and [EAS Build](https://docs.expo.dev/build/introduction/).

## 4. Architecture and server contract

```text
Plexy Client (Expo app)
  ├─ Server connection and device pairing
  ├─ Native browsing/search/details UI
  ├─ Typed API/data cache scoped to server identity
  ├─ Secure device credential storage
  └─ expo-video player ───────┐
                              │ API, artwork, playback, progress
Plexy Server                  ┘
  ├─ Authorization and device revocation
  ├─ Catalog, metadata, watch state
  ├─ Direct-play/remux/transcode selection
  └─ Media response/streaming
```

Before building the player, document the exact existing API requirements:

1. Status/version probe and supported API compatibility response.
2. Device pairing, token issue/revoke, and authenticated request mechanism.
3. Catalog, artwork, search, title details, and watch-progress endpoints.
4. Playback decision response and media URL/headers, Range or HLS behavior, subtitle/audio track metadata, and resume position.
5. Whether the server address is HTTP or HTTPS and how the app reaches it on a LAN or private remote network.

Native networking does not automatically inherit browser cookie behavior. Confirm how tokens are sent by ordinary requests and by `expo-video`, including redirects, byte-range requests, and HLS segment/key requests. Never put credentials in query strings. If the current cookie contract cannot authenticate native playback safely and consistently, write a narrow server API proposal for a revocable device token accepted through a secure request header. Keep backend changes outside the mobile implementation except for approved compatibility work.

Do not enable broad cleartext HTTP exceptions to make arbitrary servers connect. Prefer HTTPS for remote connections; document LAN HTTP behavior and platform configuration narrowly, based on verified iOS and Android behavior.

## 5. User flows and screens

### First launch and connection

1. Welcome screen explains that Plexy Client connects to a separately running Plexy Server.
2. Add server: enter a URL, normalize it, and run the public status/version probe. QR-code setup can follow later.
3. Show server name/version and connection result; offer edit, retry, save, and switch-server paths.
4. Pair with the existing short-lived code from Plexy Server. Handle invalid, expired, used, revoked, and network-failure states.
5. Save the server profile and device credential separately; return to connection state if authorization expires.

### Viewer experience

- **Home:** continue watching, recently added, and server-provided movie/show collections.
- **Library:** movie/show switcher, poster grid, sort/filter controls, loading/empty/error states.
- **Search:** debounced title search with keyboard-safe results and cancellation.
- **Title details:** artwork, summary, metadata, play/resume action, and available episodes/seasons.
- **Player:** portrait/landscape, fullscreen, play/pause, seek, elapsed/remaining time, resume prompt, and supported audio/subtitle choices.
- **Settings:** active server, switch/add server, reconnect, pairing status, revoke/sign out, app version, and diagnostics that do not expose secrets.

Do not expose server administration pages or actions in this viewer app. Server authorization remains the actual security boundary.

## 6. Phased implementation plan

### Phase 0 — Contract audit and feasibility spike

- Inspect `packages/api-client`, current web auth/client code, server auth/pairing routes, and playback routes.
- Confirm React Native compatibility of shared packages; identify browser-specific imports and avoid bundling web UI code.
- Build a small Expo proof of concept that connects to a development Plexy Server, pairs, fetches one movie, and plays one representative stream through `expo-video`.
- Exercise authenticated artwork, byte ranges/HLS, subtitles, and resume progress before committing to a full player design.
- Record supported server/API version, minimum iOS/Android levels, and dev/prod network policy.

**Gate:** proceed to full app work only after pairing and authenticated playback have a viable native path.

### Phase 1 — Expo app foundation

- Add `apps/mobile` workspace, Expo config, TypeScript config, route skeleton, app identifiers, and Client icon/splash assets.
- Add development, platform run, typecheck, and EAS build profiles without changing root `build` semantics.
- Add API transport adapter and server-profile model; inject base URL and credential provider.
- Establish design tokens and native component conventions using React Native primitives rather than web CSS components.

**Deliverable:** app boots on iOS and Android development builds and renders the connection flow.

### Phase 2 — Connect, pair, and account state

- Implement URL validation/status/version probe, server save/switch, timeouts, cancellation, and useful network errors.
- Implement pairing and store device credentials in SecureStore; persist non-secret server profiles separately.
- Scope API cache keys by server identity; clear sensitive in-memory state on sign-out or revocation.
- Add authorization expiry and re-pair behavior.

**Deliverable:** app can pair, reconnect, switch servers, and fetch an authenticated catalog without cross-server data leakage.

### Phase 3 — Browse and search

- Implement native navigation, home rows, library grids, search, and title/episode details.
- Adapt poster/backdrop loading and fallback behavior to native image components.
- Add pagination/incremental loading, pull-to-refresh where useful, and accessible labels/focus behavior.
- Use cache policies for quick return visits without promising offline playback or fresh catalog data.

**Deliverable:** user can browse and select a movie/episode on both platforms.

### Phase 4 — Playback and progress

- Integrate `expo-video` with the server playback decision and authenticated stream contract.
- Implement loading, buffering, retry, connection loss, unsupported media, and server conversion failure states.
- Add resume prompt, periodic progress save, pause/background/unmount flush, completion handling, and restoration.
- Add available audio/subtitle track selection and next-episode flow only after proving API and platform support.
- Decide separately whether picture-in-picture/background playback is in scope; enable native capabilities only when requirements and device tests support them.

**Deliverable:** representative direct-play and server-converted assets play on supported devices and progress syncs to Plexy Server.

### Phase 5 — Polish, release, and operations

- Finalize Plexy Client icon/splash, permissions, privacy text, store metadata, versioning, and minimum server version messaging.
- Create EAS development, preview, and production profiles; document credential ownership, signing, build numbers, and release steps.
- Define a safe update policy; native module/config changes require a new app binary.
- Add opt-in redacted diagnostics if useful; scrub private hostnames where possible and never record tokens.
- Publish client setup instructions and Plexy Server network/HTTPS requirements.

**Deliverable:** signed Android and iOS builds, reproducible release instructions, and user-facing connection/pairing documentation.

## 7. Suggested commands and outputs

Finalize command names to match repository conventions, keeping mobile builds separate from web and desktop:

```sh
bun run dev:mobile       # Expo development server
bun run mobile:ios       # launch iOS simulator/device workflow
bun run mobile:android   # launch Android emulator/device workflow
bun run build:mobile     # documented EAS or local production build entry point
```

Expected outputs are signed `.ipa`/iOS store build and Android `.aab` for store release, with internal `.apk`/preview builds as needed. EAS credentials belong to the project owner/team, not the repository. The plan does not assume a publishing account or store listing exists.

## 8. Validation and acceptance

- **Connection:** valid/invalid URL, server unavailable, incompatible version, slow connection, HTTP/HTTPS behavior, switching servers.
- **Pairing/security:** success, expired/used code, revoked device, token expiry, sign-out, reinstall behavior; no secrets in URLs/logs.
- **Data:** browse/search/details, image auth, pagination, refresh, cache isolation per server.
- **Playback:** representative H.264/AAC direct play and server-converted streams, seek/Range, HLS if used, interruptions, orientation, subtitles/audio tracks where supported, progress resume/completion.
- **Devices:** physical iPhone and Android device in addition to simulators/emulators; network transition between Wi-Fi and cellular/private VPN.
- **Builds:** development build on both platforms, signed preview/release artifact, app name/icon, permissions, and no backend binary/server implementation in the app bundle.
- **Failure UX:** unreachable/restarted server, revoked pairing, stream failure, unsupported media, and server conversion failure each give a clear next step.

Expo documents platform-specific playback capabilities and configuration for background playback and picture-in-picture. Treat those as explicit scope decisions and verify on physical devices; do not assume web playback parity ([Expo Video docs](https://docs.expo.dev/versions/latest/sdk/video/)).

## 9. Risks and mitigations

| Risk | Mitigation |
| --- | --- |
| Current API client/auth is browser-specific | Audit before scaffolding; isolate native transport and credential adapters. |
| Authenticated media stream rejects native request credentials | Make playback auth a Phase 0 gate; propose a narrow server contract if required. |
| Video behavior differs by OS, codec, or stream format | Prove direct play and server-converted playback on physical devices early. |
| Platform TLS/network rules block some server addresses | Test target URLs/certificates on both platforms and document supported remote setup. |
| Cached results or credentials leak between server profiles | Namespace data by server identity and clear in-memory auth/cache on switching/sign-out. |
| Native module changes cannot ship as a JS-only update | Pin SDK/dependency versions and require a new binary for native changes. |
| Project expands into a full server admin app | Keep initial scope to connect, pair, browse, search, details, playback, and viewer settings. |

## 10. Decisions before implementation

1. Confirm Expo React Native is the shipping mobile client and whether both app stores are in the first release.
2. Which iOS and Android minimum versions will be supported?
3. Which remote transport is supported: HTTPS only, or a narrowly documented private-LAN HTTP case too?
4. Does current device auth work for native API and video requests, or is a minimal API compatibility change required?
5. Are subtitles/audio selection, picture-in-picture, and background playback required in v1 or staged after core playback?
6. Which server/API version is the first mobile release compatible with?
