# Plexy Server, Android, and macOS rollout

Ship Plexy Server as a standalone bundle with the existing web UI. Add access to external Plexy Server libraries in the current Android app using its existing browsing and playback screens. Keep stable Electron available while the native Rust app is tested as Plexy Beta. Promote Rust to stable only after the upgrade from Electron and the agreed Mac feature set pass verification.

## Decisions to confirm

| Decision | Options and implementation impact |
| --- | --- |
| Where Android selects Plexy Server | A fourth **Plexy Server** mode gives the server its own onboarding and catalog. A **library source** selector keeps the three existing modes and requires explicit rules for how server libraries interact with Local only, Hybrid, and Fully online. Confirm whether any view should combine device and server libraries. |
| What the stable Rust Mac app supports | **Local only** keeps the present Beta runtime. **Local and external server** adds native sign-in, server browsing, and authenticated libmpv playback. **Local, external server, and hosting** also adds management of the Plexy Server process and its web administration panel. |
| How existing Mac users upgrade | **Check for Updates** requires a Rust package compatible with the installed Electron updater. **Manual DMG** requires a tested drag-to-replace path and clear update instructions. Both need a confirmed list of data to preserve and rules for users with both Electron and Beta data. |

## 1. Plexy Server

1. Use the existing full bundle for Linux x64 and Apple Silicon macOS. It contains the server executable, FFmpeg, SQL migrations, and the built web assets. Keep server state and media paths outside the application bundle. [Backend packaging](../../scripts/package-backend.sh) · [Release workflow](../../.github/workflows/build.yml)
2. Document the full setup path for a fresh installation and the move from an existing Electron-hosted library. Create the owner through the bundled UI on the host, add media roots, enable LAN HTTPS, and confirm the server address from a second device. When moving an existing server, identify its actual data directory, stop the old process, and use a consistent database backup. Verify media paths on the destination and keep the old installation available for rollback. [Server setup](../../README.md#running-the-server) · [Server data paths](../../apps/server/src/paths.ts)
3. Reuse the existing HTTP API for accounts and devices, catalog and artwork, playback and subtitles, and per-user progress, history, flags, and collections. Check the Android flows against the current contract before adding endpoints. If an endpoint needs to change, preserve compatibility with the bundled web UI and stable Electron. [API reference](../../docs/API.md) · [Shared API client](../../packages/api-client/src/index.ts)
4. Verify a fresh install and an upgrade using the packaged artifact. Cover owner and viewer sign-in, device pairing and revocation, library scanning, playback and byte-range seeking, subtitles, and persistence across a restart. Run the server typecheck and test suite plus `bun run smoke:playback` under the repository’s Bun workflow. [Testing guide](../../docs/TESTING.md)

## 2. Bundled web UI

1. Package the current `apps/web` build with the server. Keep the web source intact. Use the bundled browser app for owner setup, user and device management, library administration, and browser playback. [Web API configuration](../../apps/web/src/server-config.ts) · [Server app assembly](../../apps/server/src/app.ts)
2. Test the bundle on loopback for first-run owner setup and on LAN HTTPS for sign-in as an existing account. Check that refreshing a page preserves the session and that artwork, subtitles, playback, and seeking use the same browser session.
3. After any API change, verify web browsing and playback against the packaged server. Test as both the owner and a viewer with access to only one library.

## 3. Android

1. Add the confirmed entry point in onboarding and Settings. Implement server address entry, status and server ID checks, and sign-in or device pairing through the existing API. Store the credential in the app’s protected store and scope it to the server and account. Give users a way to disconnect and recover from a revoked session or a changed server address. Verify the existing LAN HTTPS certificate flow on a physical device. [Onboarding](../../apps/mobile/src/features/onboarding/onboarding-screen.tsx) · [Settings](../../apps/mobile/src/features/settings/settings-screen.tsx)
2. Add a server-backed catalog adapter behind the current client and catalog interfaces. Load Home, libraries, search, title and episode details, artwork, and watch state from the selected server. Reuse the current screens and keep local folder scanning tied to the device catalog. Hide or disable device-only actions on server items when the server offers no equivalent. [Mobile client provider](../../apps/mobile/src/core/client/client-provider.tsx) · [Catalog interface](../../apps/mobile/src/core/library/catalog-api.ts)
3. Reuse the existing player UI with a server playback source. Fetch the playback manifest and authenticate stream, artwork, and subtitle requests as required. Verify seeking, episode transitions, resume, and useful errors when the server is unreachable or preparing a playable version. Keep any offline downloads outside the initial milestone unless selected for that release. [Android player](../../apps/mobile/src/features/player/player-screen.tsx) · [Playback API](../../docs/API.md#playback-endpoints)
4. Send server watch updates to the signed-in account. Keep queued writes and caches scoped to their original server and account so switching sources cannot replay progress into another library. Verify progress recorded on Android appears in the bundled web UI and that the Android player resumes from progress recorded in the browser. [Mobile progress queue](../../apps/mobile/src/core/client/progress-queue.ts)
5. Run the mobile typecheck, tests, and Android bundle checks, then verify on an actual Android development client or the emulator workflow. Cover existing Local only, Hybrid, and Fully online behavior, server setup, source switching, a second account, access restrictions, network loss, and offline local playback. [Android testing](../../docs/TESTING.md#android-e2e)

## 4. Plexy Beta and the stable Rust app

1. Keep the current native Beta build and its independent release channel during testing. Establish a baseline on a clean Apple Silicon Mac and an existing Beta installation. Test local scan, play and resume, seeking, tracks and subtitles, watch history, collections, app updates, and offline use. Record any Electron features users depend on before deciding which ones are required for stable. [Beta testing and releases](../../apps/player-gpui/README.md)
2. If stable Rust will connect to a server, build the feature behind a Rust HTTP client using the public Plexy API. Keep connection, catalog, and playback views in GPUI. Use Keychain for credentials and validate how libmpv receives authorized stream and subtitle requests. The existing local playback path stays available for device media. [Native player](../../apps/player-gpui/src/mpv.rs)
3. If stable Rust will also host a server, define how it starts, stops, and upgrades the server and whether that process remains available after the Mac UI quits. Verify port conflicts, data ownership, and takeover of an Electron-hosted instance. The app remains native, and the server’s web administration opens in the system browser.
4. Create a stable packaging target only for the cutover. Build `Plexy.app` with the stable bundle ID `com.plexy.desktop` and verify its version ordering against published Electron releases. Prepare the DMG and, if using the in-app upgrade, a compatible ZIP and checksum. Test the signing and Gatekeeper behavior of the downloaded artifacts on a clean Mac. Confirm the Rust stable update channel can discover a subsequent stable release. [Rust packaging](../../scripts/package-player-macos.ts) · [Electron package identity](../../apps/desktop/electron-builder.json)

## 5. Stable Electron replacement

1. Leave the Electron stable release available during the Beta test period. Before publishing Rust stable, inventory the Electron server database and config, desktop connection preferences, and the Rust Beta SQLite store. Map libraries, roots, progress and history, favorites and ratings, collections, and supported settings to the agreed stable behavior. For Electron’s server-owned accounts and shared watch state, preserve the server store for continued hosting or define what the local-only Rust app can import. Resolve which profile to import or how to handle duplicates when both stores exist. [Electron server data](../../apps/desktop/src/main/server.ts) · [Rust catalog schema](../../apps/player-gpui/src/catalog.rs)
2. Make first-launch migration repeatable. Read from a consistent backup, apply changes to staging or in a transaction, validate the result, and record completion after the data is usable. Preserve original stores for recovery. Exercise the case where the existing Electron bundle hosts Android or web clients and confirm where those clients should connect after the upgrade.
3. For **Check for Updates**, test against already-installed Electron releases. The existing updater expects a ZIP that contains `Plexy.app`, checks its bundle ID and checksum, and swaps the bundle at the installed path. Test selecting the correct release, granting or denying macOS approval, replacing the app in both system and user Applications folders, and first Rust launch. If an installed updater cannot support the transition, decide whether to ship an Electron bridge update or direct those users to the DMG. [Electron updater](../../apps/desktop/src/main/updater.ts)
4. For **manual DMG**, verify that dragging the stable Rust build into Applications replaces the existing `Plexy.app`. Document how to quit Electron before replacement and launch Rust afterward. Keep the separate Beta bundle and its data intact through migration testing. [Beta package identity](../../apps/player-gpui/README.md#package-for-macos)
5. Rehearse the cutover with an Electron-only Mac, a Beta-only Mac, a Mac with both, and a clean install. Include a populated catalog with films and episodes, unavailable media paths, and an interrupted first launch. Verify the supported settings and watch state, a subsequent Rust update, and recovery by restoring the last Electron build and its original or backed-up data.
6. Publish Rust stable only after the agreed upgrade path passes end to end. Point stable Mac downloads at Rust and retain the final Electron artifact for rollback. Keep the backend and Android releases independently installable.

## Order and effort

| Work | Estimated engineering time |
| --- | --- |
| Full server bundle and existing web UI verification | 1–2 days |
| Android server-backed browsing, playback, and resume with one agreed source-selection flow | 5–10 days |
| Rust Beta verification and stable Mac cutover with data migration and rollback | 5–10 days, depending on data scope and updater compatibility |
| Native Rust support for an external server, if selected | 5–10 additional days |
| Native Rust hosting, if selected | 3–6 additional days |

The baseline is roughly **11–22 engineering days** for server and web verification, Android integration, and the Mac cutover. Android work and Mac release preparation can overlap after confirming the API and migration scope. Time spent gathering Beta feedback is separate from these estimates.
