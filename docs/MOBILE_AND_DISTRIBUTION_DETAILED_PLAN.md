# Detailed Implementation Plan: Plexy Client, Plexy Server, and Combined App

## 1. Objective and scope

Formalize three separately buildable targets and build a mobile client UI that connects to a separately running Plexy Server:

| Target | Includes | Does not include |
| --- | --- | --- |
| **Plexy Client** (desktop UI-only) | Desktop-oriented UI, API client, connection and pairing UX | Local server process, server database, media scanner/transcoder |
| **Plexy Server** (backend-only) | Compiled server/API and server-owned runtime assets/configuration | Electron, desktop UI shell |
| **Plexy** (combined desktop app) | Current Electron UI shell, frontend assets, bundled backend executable | A second implementation of server features in the UI |

Use these names consistently in package metadata, installers, documentation, and release assets. Keep **Plexy** for the combined app to preserve its current identity.

Mobile is a client-only UI. The server remains authoritative for media files, libraries, scans, metadata, playback routing/transcoding, persistence, and authorization. The mobile UI should use existing API and authentication mechanisms. If an API change is necessary, record the specific blocker and keep that change narrowly scoped to server compatibility.

## 2. Current project baseline

- `apps/web`: React/Vite web client, built to `dist/web`; hosted-client flow already supports entering a server URL and pairing.
- `packages/api-client`: shared typed API client and browser capability helpers.
- `apps/server`: Elysia API server; currently serves the SPA in the server process for the single-process/headless deployment.
- `apps/desktop`: Electron shell; desktop build packages the frontend and compiled backend executable together.
- Root scripts include `build:web`, `build:executable`, `build:desktop`, and `build` (web plus combined desktop packaging).

The desired work should extend these boundaries rather than fork the API client or duplicate the server. In particular, existing server-hosted SPA behavior may remain useful for direct server access; the independent UI-only client is a separate distribution mode.

## 3. Architecture and mode selection

### Shared client foundation

Keep one API/query layer in `packages/api-client` and one React client where possible. Add explicit runtime/build configuration for:

- **Bundled mode:** Electron starts its bundled server, obtains its address/credentials, then loads the UI (current combined app behavior).
- **Remote-client mode:** UI requests a server URL, connects and pairs, and never launches or expects a local server.
- **Server-hosted mode:** the server serves its bundled SPA as it does today.

Avoid scattered environment checks. Put mode selection and server URL resolution behind a small client configuration/provider. The API client should accept the resolved base URL and credential strategy. Keep secure token handling aligned with the existing paired-device flow; do not put bearer tokens in media URLs or logs.

### Mobile UI

Build the mobile app as a dedicated Expo React Native client in `apps/mobile`, separate from the shared browser app. Reuse API contracts where React Native compatible, but use native navigation, secure credential storage, touch-first screens, and native video playback. See [the detailed Expo mobile plan](MOBILE_APP_BUILD_PLAN.md). Mobile screens include:

1. Server address entry, validation/status probe, saved server selection, and reconnect/error states.
2. Pairing using the existing one-time code flow and secure persistence supported by the browser platform.
3. Library/home, browse, search, title details, continue watching, and playback.
4. Playback controls and progress reporting using existing server endpoints and media delivery behavior.

Do not expose admin operations to remote clients unless existing server authorization explicitly allows them. UI visibility is not an authorization boundary; server enforcement remains authoritative.

### Desktop UI-only target

Provide a desktop-format **Plexy Client** build that connects to a server and has no dependency on `apps/server` at runtime. Choose the delivery container after confirming product expectations: hosted/static web app or a thin desktop shell without the backend. In either case, the target must not bundle/start the server binary. Reuse the same remote-client mode and connection/pairing flow as mobile.

### Names and visual identity

1. Retain **Plexy** for the current combined desktop app.
2. Name the client-only desktop product **Plexy Client**.
3. Name the standalone backend product **Plexy Server**.
4. Create distinct Client and Server icon variants based on the existing Plexy visual identity, with simple cues that distinguish a client/device from a server. Keep them recognizable as one product family.
5. Generate platform assets from approved source artwork (`.icns`, `.ico`, Linux PNG sizes, and web/PWA icons as applicable); keep source and generated assets organized and document regeneration.
6. Apply the appropriate variant to the app launcher, installer, window/dock icon, and package metadata. For a headless binary, use Plexy Server in command help/version output rather than implying it has a GUI icon.

**Exit condition:** names are consistent and Client/Server icons are distinguishable at normal launcher sizes.

### Backend-only target

Keep the existing executable build path and document/package it as a first-class output. Confirm that its artifact includes everything the server needs at runtime (migrations, static web assets if still required by server-hosted mode, and any native media runtime assets). It must not depend on Electron. Preserve headless startup and configuration through current environment/config mechanisms.

### Combined target

Preserve the current Electron workflow and artifact naming unless a build-system constraint requires adjustment. Make combined mode an explicit selection, so remote-client behavior cannot accidentally start the bundled server and bundled mode still launches reliably.

## 4. Workstreams and implementation steps

### A. Inventory and contracts

1. Trace the current server URL, status probe, pairing, credential persistence, API base URL, playback URLs, and Electron server lifecycle.
2. List user-facing routes/screens and mark each viewer/client or server administration.
3. Confirm which APIs required by the mobile viewer already exist. Record any gaps separately before changing server code.
4. Write down target names, icon source/ownership, supported operating systems, minimum server version, and expected outputs.

**Exit condition:** a short mode matrix and API checklist exist; no client assumes a local server unless running in bundled mode.

### B. Explicit client runtime configuration

1. Add a typed runtime configuration with mode (`bundled`, `remote`, or server-hosted), optional initial server URL, and supported capability flags.
2. Centralize base URL selection and status probe in the shared client layer.
3. Ensure changing server clears/partitions server-scoped query caches and credentials appropriately.
4. Handle unreachable, unsupported, unauthorized, and incompatible server responses with actionable UI states.
5. Preserve existing desktop loopback authentication and browser device pairing without leaking credentials into URLs.

**Exit condition:** a remote-client build works against a server on another host and does not invoke Electron/server process APIs.

### C. Expo React Native mobile client

1. Add a dedicated Expo app at `apps/mobile`; do not wrap the browser UI in a WebView.
2. Reuse the API contract where compatible and implement native connection, pairing, browsing, details, search, and settings screens.
3. Store device credentials securely and isolate cache by connected server.
4. Prove authenticated media requests, `expo-video` playback, orientation handling, and progress persistence on physical iOS/Android devices.
5. Use Plexy Client app identity and icon variants; create repeatable development, preview, and production build profiles.

**Exit condition:** a phone can connect and complete the primary browse-to-play flow without server-side work occurring on the phone.

### D. Desktop UI-only distribution

1. Choose web/PWA or a thin shell based on installation/update requirements.
2. Create a dedicated command/build configuration separate from `build:desktop` combined packaging.
3. Exclude server executable, migrations, and server-only dependencies from this artifact.
4. Set remote-client mode as the default and provide first-run server URL entry (optionally prefilled by build-time default).
5. Document how to configure HTTPS/LAN access and pair the client.

**Exit condition:** artifact inspection and runtime observation show no backend process or server binary is included/launched.

### E. Backend binary distribution

1. Retain `build:executable` as the build implementation and introduce/clarify a user-facing backend-only command if needed.
2. Define output paths and filenames by OS/architecture; do not promise cross-platform support beyond currently verified Bun/native media targets.
3. Include migration and runtime files in the release layout, with data stored outside the artifact.
4. Document foreground service operation, environment configuration, shutdown, and connecting a separately distributed UI.
5. Verify server-owned static SPA behavior remains intentional and does not make the binary depend on the Electron UI.

**Exit condition:** standalone binary starts, serves API, and runs with no Electron installation.

### F. Combined app continuity

1. Preserve the existing `build:desktop`/`build` behavior as the combined target.
2. Keep Electron server startup, readiness checks, port selection, shutdown, and secure token storage in bundled mode.
3. Ensure UI refactoring does not replace bundled server URL/auth resolution with the remote entry flow.
4. Verify packaged artifact still contains the expected frontend and matching backend binary.

**Exit condition:** existing combined app launches and performs its primary current workflow.

### G. Build scripts and documentation

Use descriptive commands (final names may follow repository conventions), for example:

```sh
bun run build:client:desktop  # Plexy Client, UI-only desktop client
bun run build:mobile          # Expo React Native app (see separate mobile plan)
bun run build:server          # Plexy Server, backend binary only
bun run build:desktop         # Plexy combined Electron app (existing)
```

Keep the native mobile app build separate from the desktop UI-only web artifact. Update the root README build matrix with target, command, output, required server, and runtime responsibilities. Avoid changing `bun run build` semantics without a clear migration note.

## 5. Recommended sequence and dependencies

1. Complete workstream A (inventory and API contracts).
2. Implement B (runtime mode separation); this unlocks both UI-only distributions and isolates risk to the combined app.
3. Implement C as a separate Expo client against the remote-client API contract; desktop UI-only work remains in the browser client.
4. Implement D and clarify E artifact contracts.
5. Run F continuity checks and update G documentation/build matrix.

Expo scaffolding can begin after the API audit, but native playback validation depends on proving the authentication and streaming contract. Desktop UI-only and mobile both use remote-client semantics, while the mobile app has its own native UI and build pipeline. Backend-only packaging is largely independent after artifact/runtime inventory.

## 6. Validation plan

Validation should be run during implementation and release preparation; no new test suite is required to approve this plan. At minimum verify:

- **Remote client:** points to another host; server status probe, pairing, refresh/reconnect, library fetch, playback, and progress work.
- **Mobile:** narrow viewport, touch targets, soft keyboard, portrait/landscape player, and representative iOS Safari/Android Chrome behavior.
- **Desktop UI-only:** opens the client, accepts a server address, and operates without a backend process or server binary in the deliverable.
- **Backend-only:** starts headlessly from its output folder, applies migrations, serves API, and does not require Electron.
- **Combined:** packaged Electron app still starts its bundled server, authenticates, serves the UI, and shuts down cleanly.
- **Build isolation:** each output has a documented command and contains only the responsibilities in the target matrix.

Also verify mismatched server versions and unauthenticated requests fail with understandable client states. Browser security constraints (HTTP/HTTPS mixed content, LAN networking, cookies, and CORS) must be documented for the chosen deployment mode.

## 7. Risks and mitigations

| Risk | Mitigation |
| --- | --- |
| Current UI assumes same-origin/server-hosted assets | Centralize API origin and asset/media URL resolution before distribution work. |
| Browser mixed-content or cookie policy blocks hosted HTTPS client to local HTTP server | Prefer server HTTPS or same-origin server UI where necessary; explain constraints in connection UX/docs. |
| Device pairing/token persistence differs across browsers | Reuse existing paired-device contract; test platform storage and provide clear re-pair flow. |
| Electron refactor breaks bundled startup | Keep bundled and remote modes explicit and preserve combined-artifact validation. |
| “Desktop UI-only” is ambiguous as a format | Decide static web vs thin desktop shell before packaging work; both must omit backend process. |
| Backend binary may have platform/native media limits | Publish only verified OS/architecture artifacts and state playback limitations. |
| UI-only app accidentally duplicates server/admin behavior | Keep mutations server-owned and limit UI to API client responsibilities. |

## 8. Decisions to record before implementation

- Desktop UI-only delivery format: static installable web client or thin desktop shell.
- Mobile target: dedicated Expo React Native app; confirm app-store release timing and supported OS versions.
- Whether the mobile/desktop clients use a separately hosted UI origin or are served by Plexy server.
- Minimum supported Plexy API/server version and compatibility response behavior.
- Confirm names: Plexy Client (desktop client-only), Plexy Server (backend-only), and Plexy (combined app).
- Approve differentiated Client and Server icon variants derived from the Plexy visual identity.
- Supported platform/architecture matrix for standalone server binary.

The defaults recommended here are a dedicated Expo React Native app for mobile, shared browser client for desktop UI-only, explicit server URL and pairing for remote clients, differentiated Plexy Client/Plexy Server icon variants, and preservation of the existing combined Plexy Electron app as the default bundled distribution. See [the separate mobile app build plan](MOBILE_APP_BUILD_PLAN.md) for mobile-specific scope and sequencing.
