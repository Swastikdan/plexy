# GeekNative frontend feasibility and release plan

Assessed 6 November 2026 against the linked documentation and current Plexy source. This is a proposed implementation plan, not a completed native app or deployment.

## Recommendation

Yes: use GeekNative to build **Plexy Client** for iOS and Android while Plexy Server remains a separately installed backend. Keep the existing React/Vite web client initially. Do not replace the working web app just to adopt GeekNative.

GeekNative is a spec-driven development framework for three separate implementations: SwiftUI, Kotlin/Jetpack Compose, and React/TanStack Start. It does not compile the current React frontend into native apps. Shared contracts generate identity, configuration, design tokens, strings and icons; feature implementations still need work in each language.

The architecture documentation explicitly supports replacing local repositories with remote API implementations. However, the roadmap lists backend API contracts, generated network clients, and remote repository implementations as future work. Plexy's integration must be implemented and tested by us.

For a web-only frontend, the current static client is already a simpler fit. GeekNative becomes attractive when native iOS and Android quality is the goal. The existing `MOBILE_APP_BUILD_PLAN.md` proposes Expo/React Native; this document is an alternative, not a silent replacement of that decision.

## Client/server boundary

- Server owns SQLite, media files, FFmpeg/ffprobe, scanning, metadata-provider credentials, authentication, access checks, playback preparation/transcoding and authoritative watch progress.
- Client owns presentation, server selection, secure session storage, native decoding, playback controls and temporary UI/cache state.
- Clients access catalog, artwork, subtitles and streams through authenticated server endpoints. No database, media directory access, backend executable, migration or FFmpeg is packaged in a client.
- Server setup and filesystem administration remain on the server computer. Hiding client controls is only presentation; server-side authorization remains authoritative.
- Frontend-only does not mean zero local state: credentials, preferences and bounded caches still live on the device. Offline media downloads are a separate future feature.

## Existing Plexy fit

The repository already separates `apps/server`, `apps/web` and `packages/api-client`. `bun run build:client` produces a static client and checks for accidentally included server files. Runtime configuration already distinguishes remote and server-hosted clients.

The web client uses Eden/TypeScript types and browser cookies. Swift and Kotlin cannot directly reuse these TypeScript clients or DOM-based video components. Implement native HTTP repositories and explicit wire models, with one documented API contract and compatibility fixtures. A type-only server import in the web client does not itself embed a running backend.

The server accepts bearer tokens and browser session cookies. Confirm current login/pairing response shapes before implementing native credentials; the older mobile plan predates current account changes in the workspace. Store native credentials in iOS Keychain and Android Keystore-backed storage. Native player requests need authentication too, including every HLS playlist, segment, key if used, subtitle and artwork request. Proving this is a release gate.

## Requirements from GeekNative

- Node.js 22+, with 24 LTS recommended, and `make`.
- iOS builds require macOS, Xcode 26+ and an installed iOS simulator runtime. Minimum supported iOS: 17.
- Android requires Android SDK, compile API 37 and a bootstrap JDK 17+; Gradle downloads JDK 21 for its build. Minimum runtime: Android 7/API 24.
- Web minimums documented: Safari 16.4, Chrome 111 and Firefox 128.
- Linux supports Android/web builds. Windows is explicitly untested.
- These are published requirements, not a verification that this machine has the toolchains. Check locally before scheduling implementation.

## Implementation stages

### 1. Isolated evaluation

Create a disposable project outside Plexy's existing `apps/web` path using the documented command:

```sh
npm create geeknative@latest plexy-client-evaluation -- --name "Plexy Client" --id com.plexy.client
cd plexy-client-evaluation
make doctor
make check
```

Use the bundle ID only if it is available and belongs to the publishing account. Record and pin the resulting GeekNative and toolchain versions. Inspect generated agent instructions before integration. Do not overwrite the root package manager, scripts, existing contracts or web application.

Define the product and design specs around a remote media client. Configure public default API URLs through `contracts/config.json`; add runtime server profiles because Plexy users have different home servers. A compiled production URL alone is insufficient.

Exit: blank iOS/Android builds succeed, repository integration boundaries are understood, and no backend is included.

### 2. Connection and authentication slice

Implement server URL entry, identity/status probing, account sign-in, single-use pairing, secure storage, logout and revoked-session recovery. Scope caches and credentials by server identity and user. Start with manual URL entry; discovery is optional follow-up work.

Use remote repository interfaces wired through GeekNative's AppContainer. Preserve access restrictions, account isolation and local-only administration. Do not reuse Electron-specific trust or filesystem bridges on mobile.

Exit: both platforms connect to a real standalone Plexy Server, retain sessions after relaunch and correctly handle revocation, wrong credentials and an unreachable server.

### 3. Playback proof before a full UI build

Use AVPlayer on iOS and Media3/ExoPlayer on Android behind platform adapters. Prove direct playback and server-prepared HLS, authenticated nested requests, seeking/range handling, resume updates, audio/subtitle selection and session expiry. Test an unsupported source requiring server conversion.

Report native capabilities to the server rather than reusing browser capability probes. Native support for codecs, HDR, audio and subtitle formats differs by OS and device. Keep conversion decisions on the server.

Exit: playback works on physical devices over LAN and an actual remote HTTPS connection. A simulator-only success is insufficient.

### 4. Viewer features

Build home/continue-watching, libraries, search, title/season/episode detail and next-episode playback. Reuse API semantics, copy, visual direction and feature acceptance criteria. Add loading/error/empty states, accessibility and platform navigation.

Defer offline downloads, casting, background playback and advanced picture-in-picture until the basic playback matrix passes. GeekNative does not supply these Plexy features automatically.

### 5. Integration and release checks

After the evaluation succeeds, bring native targets into the monorepo with explicit scripts and ownership. Preserve the Bun web/server workflow; adapt GeekNative workspace assumptions deliberately. Keep its sample web app separate or remove it only after checking generator/build dependencies. Do not assume running its default scaffolder in this repository is safe.

Run contract checks and each applicable platform build/test command. Add CI for generated contracts, Swift/Kotlin builds and API compatibility; the roadmap says generated-project CI is not yet supplied. Test the oldest supported and current OS versions on physical devices, permissions, certificate failures, Wi-Fi changes, reconnects and interrupted playback.

## Publishing and hosting

### Web client

Keep `bun run build:client` and deploy `dist/web` to an HTTPS static host such as Cloudflare Pages, Netlify or Vercel static hosting. Configure SPA route fallback to `index.html`; `/connect` is the client entry. No server database or media belongs on that host.

Prefer serving web UI and API from the same HTTPS origin when practical. A separately hosted UI needs its exact origin in `PLEXY_ALLOWED_ORIGINS`; CORS alone does not overcome third-party-cookie restrictions, mixed-content blocking, private-network restrictions or an untrusted home-server certificate. Test the intended browser/network combination. Never cache authenticated media as part of the public app shell.

If adopting GeekNative's TanStack Start web app later, explicitly prove a client-only/static deployment configuration first. The documented starter can use server functions/API routes; do not assume its default output is equivalent to Plexy's existing static SPA. Keep shared business logic on Plexy Server.

### iOS client

Set an owned bundle ID, signing team, icons, privacy declarations and usage descriptions, including local-network permission if applicable. Archive/sign on macOS with Xcode, upload to App Store Connect, distribute through TestFlight, then submit for App Store review. Supply a reachable review/demo server and account so review does not depend on access to a private home LAN. Apple Developer membership and store approval are external prerequisites.

### Android client

Set an owned application ID, release signing and required permissions. Produce a signed Android App Bundle; use Play internal testing, then applicable closed/production tracks. Complete Data safety, privacy policy, content-rating and account-specific testing requirements. An APK can also be distributed directly, but requires an update/distribution strategy. Recheck current Play target-SDK requirements when releasing; compile SDK and store target requirements are separate.

### Plexy Server

Keep the backend on the user's Mac, home server or another supported host with media access. The existing build documents an Apple Silicon artifact; Linux/VPS packaging is a separate verification task. Store publication does not provide server hosting or remote connectivity.

For off-LAN access, use a configured VPN or properly authenticated HTTPS reverse proxy with a trusted certificate. Preserve streaming range requests, long response lifetimes and any event streams. Review proxy trust and local-only route detection before proxy deployment: a loopback proxy must not accidentally make remote callers appear local. Do not assume the existing LAN certificate is publicly trusted. Native trust/pinning requires platform-specific implementation; never disable certificate verification globally.

## Benefits

- Native controls, accessibility and platform media integrations, without shipping a WebView UI.
- Existing server investment and media pipeline stay usable by all clients.
- Shared tokens, strings, identity and feature specs can reduce visual/behavioral drift.
- Clients can update independently of server releases if API compatibility is maintained.
- Apache 2.0 licensing documented by the project; retain required notices and review dependencies separately.

## Caveats and decision gates

- Three UI implementations mean more engineering and QA. Shared specs are not shared executable feature code.
- Current React screens and browser player need native rewrites; Eden's TypeScript typing does not generate Swift/Kotlin clients.
- The published roadmap describes a 0.1.0 foundation with upgrades/migrations, API integration, screenshot/E2E parity and generated-project CI still planned. Do not treat those as existing guarantees.
- GeekNative does not solve server reachability, TLS trust, media compatibility, discovery, store signing or publication.
- Mobile embedded configuration and API keys are extractable; private provider credentials remain on the server.
- A client connected to a home server stops functioning when that server is asleep, offline or inaccessible. A CDN-hosted frontend cannot fix that.
- The existing Expo plan offers more TypeScript reuse and one mobile UI implementation. Choose GeekNative if platform-specific polish/control justifies maintaining Swift and Kotlin. Choose the existing PWA for the fastest frontend-only distribution.

Proceed to full implementation only after native authentication and real-device streaming pass. No delivery estimate is justified until that proof and toolchain check finish.

## Sources

- https://geekyants.github.io/geeknative/docs/start-here/quick-start/
- https://geekyants.github.io/geeknative/docs/start-here/requirements/
- https://geekyants.github.io/geeknative/docs/concepts/architecture/
- https://geekyants.github.io/geeknative/docs/concepts/project-structure/
- https://geekyants.github.io/geeknative/docs/reference/contracts/
- https://geekyants.github.io/geeknative/docs/project/roadmap/
- Local evidence: `README.md`, `apps/web/src/runtime-config.ts`, `apps/web/src/client.ts`, `apps/server/src/auth.ts`, `packages/api-client/package.json`, `docs/MOBILE_APP_BUILD_PLAN.md`.
