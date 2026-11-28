# Plexy Server, macOS, and Android rollout

Ship three apps from one backend contract:

1. **Plexy Server** — a standalone Swift menu bar app that runs the existing backend and opens the web UI for setup and administration.
2. **Plexy** — the stable Mac client for local libraries and external Plexy Server libraries.
3. **Plexy Android** — the existing mobile app with local, online, and Plexy Server sources.

The Mac client never bundles or hosts the server. The server app owns the server process and its data; the client only reads the public API.

## Confirmed decisions

- **Server app:** A Swift AppKit menu bar app with no Dock icon. Right-clicking the status item opens **Open Library**, **Open Server Setup**, **Copy Server Address**, **Start/Stop Server**, **Start at Login**, and **Quit Plexy Server**. Setup happens in the web UI. The app can start at login as an optional setting.
- **Server data:** The server app uses the existing `~/Library/Application Support/Plexy` store, the standard logs directory, and the bundled FFmpeg, migrations, and web assets. It reuses an already-running server on the same port instead of opening the database twice.
- **Mac client:** `Plexy` at version 1.1.0 with bundle ID `com.plexy.desktop`. It keeps its native catalog in `~/Library/Application Support/Plexy/Player` and connects to an external server with a pairing code or username/password. Server titles appear in Home, Movies, TV Shows, and Search with an **All / This Mac / Plexy Server** source filter. The title page offers the other copy when a title exists locally and on the server.
- **No Plexy Local:** The stable Mac lineup is the Plexy client and the Plexy Server app. Plexy Beta remains the local-only preview channel.
- **Android:** Plexy Server is a source available in every watching mode, not only Hybrid. The library source picker offers **All**, **This device**, **Plexy Server**, and **Online** (where the mode allows online). Onboarding and Settings expose server setup; existing Local only, Hybrid, and Fully online behavior stays intact.
- **Mac upgrade:** Existing Electron users move to Plexy through a manual DMG. The first launch imports libraries and roots, progress and history, favorites and ratings, collections, and supported settings from the Electron server store.

## 1. Plexy Server backend

1. Use the existing full bundle for Linux x64 and Apple Silicon macOS. It contains the server executable, FFmpeg, SQL migrations, and the built web assets. Keep server state and media paths outside the application bundle. [Backend packaging](../../scripts/package-backend.sh) · [Release workflow](../../.github/workflows/build.yml)
2. Document the full setup path for a fresh installation and the move from an existing Electron-hosted library. Create the owner through the bundled UI, add media roots, enable LAN HTTPS, and confirm the server address from a second device. [Server setup](../../docs/SERVER_SETUP.md) · [Server data paths](../../apps/server/src/paths.ts)
3. Reuse the HTTP API for accounts and devices, catalog and artwork, playback and subtitles, and per-user progress, history, flags, and collections. Preserve compatibility with the bundled web UI, the Mac client, and Android. [API reference](../../docs/API.md) · [Shared API client](../../packages/api-client/src/index.ts)
4. Verify a fresh install and an upgrade using the packaged artifact. Cover owner and viewer sign-in, device pairing and revocation, library scanning, playback and byte-range seeking, subtitles, and persistence across a restart. [Testing guide](../../docs/TESTING.md)

## 2. Plexy Server menu bar app

1. Build `Plexy Server.app` as a Swift AppKit status-item app (`LSUIElement`) with bundle ID `com.plexy.server` and version 1.0.0. The menu opens the server library or setup page in the browser, copies the address, starts or stops the bundled process, toggles **Start at Login**, and quits. [Menu bar source](../../apps/server-macos/Sources/main.swift) · [Packaging](../../scripts/package-server-macos.ts)
2. Bundle `plexy-server`, FFmpeg, migrations, and `web/` under `Contents/Resources/server`. Start the process with `PORT`, `PLEXY_DATA_DIR`, `PLEXY_LOG_DIR`, `PLEXY_FFMPEG`, and `PLEXY_RESOURCES_DIR`. Detect an existing Plexy server on the preferred port and attach to it instead of opening the same store twice.
3. Test the first launch, web setup, LAN HTTPS, menu actions, start-at-login registration, quit shutdown, and restart on a clean Mac. Keep the ad-hoc signing limitation and Gatekeeper approval in the release notes.

## 3. Bundled web UI

1. Package the current `apps/web` build with the server. Keep the web source intact. Use it for owner setup, user and device management, library administration, and browser playback. [Web API configuration](../../apps/web/src/server-config.ts) · [Server app assembly](../../apps/server/src/app.ts)
2. Test the bundle on loopback for first-run owner setup and on LAN HTTPS for sign-in as an existing account. Check that refreshing a page preserves the session and that artwork, subtitles, playback, and seeking use the same browser session.
3. After any API change, verify web browsing and playback against the packaged server as both the owner and a viewer with access to only one library.

## 4. Plexy Mac client

1. Keep Plexy Beta as the local-only preview channel. Build the stable `Plexy.app` without the server bundle. It imports the Electron library and the owner’s progress, marks, ratings, and collections on first launch. [Rust packaging](../../scripts/package-player-macos.ts) · [Rust catalog schema](../../apps/player-gpui/src/catalog.rs)
2. Add the Plexy Server connection in Settings: address entry, status and server ID checks, pairing or username/password sign-in, Keychain storage, disconnect, and recovery from a revoked session. [Server client](../../apps/player-gpui/src/server_client.rs) · [Settings](../../apps/player-gpui/src/settings_ui.rs)
3. Fetch server Home, movies, series, episodes, artwork, and watch state through the public API. Convert them into display items and merge them with the local catalog. Add the **All / This Mac / Plexy Server** source filter to the library page. [Server UI](../../apps/player-gpui/src/server_ui.rs) · [Display merge](../../apps/player-gpui/src/library_ui.rs)
4. Play authenticated server streams through libmpv with `http-header-fields`. Keep local playback unchanged. Route remote progress to the server and keep remote playback out of the local progress database. [Native player](../../apps/player-gpui/src/mpv.rs) · [Playback routing](../../apps/player-gpui/src/app.rs)
5. Test local-only use, server connection, source switching, server movies and episodes, resume, seeking, network loss, a revoked token, and a server ID change. Verify the Mac client on a clean Apple Silicon Mac and alongside the server app.

## 5. Plexy Android

1. Keep the existing Plexy Server connection in onboarding and Settings: address and server-ID checks, pairing or username/password, protected credential storage, disconnect, and retry. [Onboarding](../../apps/mobile/src/features/onboarding/onboarding-screen.tsx) · [Settings](../../apps/mobile/src/features/settings/settings-screen.tsx)
2. Expose the source picker in every mode: **All** merges device and server, **This device** is local-only, **Plexy Server** is server-only, and **Online** is the online catalog where the watching mode allows it. Keep device-first duplicate handling and the title-page server copy. [Mobile client provider](../../apps/mobile/src/core/client/client-provider.tsx) · [Merged catalog](../../apps/mobile/src/core/server/merged-catalog.ts)
3. Reuse the player UI with the authenticated server stream, subtitles, resume, and original-quality downloads. Keep queued writes and caches scoped to the server and account. [Android player](../../apps/mobile/src/features/player/player-screen.tsx) · [Mobile progress queue](../../apps/mobile/src/core/client/progress-queue.ts)
4. Run mobile typecheck, tests, and Android bundle checks. Verify on a physical device or the emulator: server setup, certificate installation, source switching, playback, downloads, a second account, access restrictions, network loss, and offline local playback. [Android testing](../../docs/TESTING.md#android-e2e)

## 6. Release and migration

1. Leave Electron stable available during the Beta period. Before publishing Plexy, inventory the Electron server database and config, desktop connection preferences, and the Rust Beta SQLite store. Keep the server store for the Plexy Server app and import the signed-in owner’s watch state into the Plexy client. [Electron server data](../../apps/desktop/src/main/server.ts)
2. Make first-launch migration repeatable. Read from a consistent backup, apply changes in a transaction, validate the result, and record completion after the data is usable. Preserve original stores for recovery.
3. For the manual DMG, verify that dragging `Plexy.app` into Applications replaces Electron, that the old server store is still usable by `Plexy Server.app`, and that rollback restores the last Electron build and its data.
4. Rehearse with an Electron-only Mac, a Mac with Electron and Beta, and a clean install. Include a populated catalog with films and episodes, unavailable media paths, an interrupted first launch, server connection, and a subsequent client update.
5. Publish the Plexy client and Plexy Server independently. Retain the final Electron artifact and the Beta channel for rollback. Keep the backend, client, server app, and Android releases independently installable.

## Order and effort

| Work | Estimated engineering time |
| --- | --- |
| Server bundle and web UI verification | 1–2 days |
| Plexy Server menu bar app, login item, and lifecycle | 2–4 days |
| Mac client server connection, merged source, and remote playback | 5–10 days |
| Electron-to-Plexy migration and cutover | 3–6 days |
| Android server source in every mode, downloads, and device verification | 3–6 days |

The first implementation pass covers the server bundle, the Android server source, the Plexy Server menu bar app, and the Mac client connection/merged library foundation. Physical-device verification, full Mac remote playback testing, and the release cutover remain.

## Implementation status

- Standalone server bundle, platform data paths, setup guide, and certificate endpoint are in place.
- `Plexy Server.app` is a Swift menu bar app that launches the bundled backend, opens the library/setup web UI, and optionally starts at login.
- The Plexy Mac client connects to an external server, merges server titles into the local library, offers the All / This Mac / Plexy Server filter, and plays authenticated streams through libmpv.
- Android exposes the Plexy Server source in every mode, with onboarding, pairing/password sign-in, merged or server-only catalogs, playback, progress scoping, and downloads.
- The Plexy client's **Update now** path downloads a release DMG, replaces the running bundle after exit, and relaunches it. A local-feed test upgraded a 1.1.0 build to 1.1.1 end to end.
- Remaining verification: clean-Mac server setup and login-item behavior, real-server Mac playback/seek/subtitle checks, physical Android certificate and playback checks, and the Electron cutover rehearsal.
