# Plexy

A personal, local-first home media server: point it at folders of movies and TV shows, and it organises them into a Netflix-style library with posters, backdrops, cast, trailers, watch progress, and intelligent browser playability routing.

The repository is structured as a clean **monorepo**:
- **`apps/desktop`**: Full native Electron desktop application for macOS, featuring integrated lifecycle management for the backend server, macOS `hiddenInset` traffic lights, native Finder directory selection, and menu bar shortcuts.
- **`apps/server`**: Elysia backend API server with FFmpeg/ffprobe probe & transcode, SQLite storage, TMDB matcher, and embedded SPA static serving.
- **`apps/web`**: Netflix-style web app built with React 19, TanStack Router & Query, Tailwind CSS 4, and Lucide icons.
- **`packages/api-client`**: Typed RPC client powered by `@elysiajs/eden` Treaty, shared types, and browser capability probes.
- **`dist/mac/mac-arm64/Plexy.app`**: Complete macOS Electron application bundle packaging both the compiled native backend binary and the optimized React UI.
- **`dist/mac/Plexy-0.1.0-arm64.dmg`**: Production Apple Silicon macOS installer disk image with `/Applications` drag-and-drop link.
- **`dist/mac/Plexy-0.1.0-arm64.zip`**: Portable macOS app zip archive.
- **`/Applications/Plexy.app`**: Installed application bundle on your Mac.
- **`dist/web`**: Statically exportable web build for hosting on any web host or CDN.

---

## Quick Start

### 1. Development (Concurrent Server + Web)

```sh
bun install
bun run dev
```

- Starts the Elysia API server on `http://localhost:8765` with watch mode.
- Starts the Vite frontend on `http://localhost:5173`, with proxy strictly routing `/api/*` to the backend.
- Typed RPC via `@elysiajs/eden` Treaty connects frontend queries with zero manual boilerplate while keeping standard REST endpoints available for curl or network devices.

### 2. Full Build (macOS Electron App + DMG + Standalone Server + Web)

```sh
bun run build
# Or build specifically for macOS desktop:
bun run build:desktop
```

This compiles:
1. `bun run build:web` → builds production SPA into `dist/web`.
2. Copies database migrations to `dist/migrations`.
3. Compiles self-contained native backend server executable (`dist/bin/plexy-server`) with Bun.
4. Compiles Electron main & preload scripts (`apps/desktop/build.ts`).
5. Packages with `electron-builder`:
   - `dist/mac/Plexy-0.1.0-arm64.dmg` (macOS Installer Disk Image)
   - `dist/mac/mac-arm64/Plexy.app` (macOS Application Bundle)
   - `dist/mac/Plexy-0.1.0-arm64.zip` (macOS Archive)

### 3. Launching Plexy

- **From DMG**: Open `dist/mac/Plexy-1.0.0-arm64.dmg` and drag `Plexy` to `Applications`.
- **Desktop Development Mode**:
  ```sh
  bun run dev:desktop
  ```
- **From Terminal (Headless server mode)**:
  ```sh
  ./dist/bin/plexy-server
  # Or: bun run start
  ```
  Open `http://localhost:8765`. Both the web UI and API are served from that single process.

### First launch on macOS (Gatekeeper)

Download the latest **Apple Silicon DMG** from the project's GitHub Releases
page. Open the DMG, drag **Plexy** to **Applications**, wait for it to finish
copying, then eject the DMG. Do not run Plexy from inside the DMG.

Release builds are ad-hoc signed but are **not Developer ID signed or
notarized** — notarization requires an Apple Developer Program membership — so
macOS may block the first launch and show:

> Apple could not verify "Plexy" is free of malware that may harm your Mac or compromise your privacy.

After trying to open Plexy from **Applications**, allow it once:

1. Open **System Settings → Privacy & Security**.
2. Scroll to **Security** and click **Open Anyway** next to the Plexy message.
3. Confirm with your password or Touch ID, then open Plexy again from
   **Applications** and choose **Open** in the confirmation dialog.

On some macOS versions, you can instead Control-click **Plexy.app** in
Applications, choose **Open**, then confirm **Open**. If macOS still blocks it,
use the Privacy & Security steps above. Only do this for a copy downloaded
from the official Plexy GitHub Releases page. Advanced Terminal alternative:

```sh
xattr -dr com.apple.quarantine /Applications/Plexy.app
```

Only bypass Gatekeeper for builds you produced yourself or downloaded from this
repository's releases.

### Updating Plexy

On the Apple Silicon desktop build, choose **Help → Check for Updates…** from
the macOS menu, or open **Plexy → Preferences… → Settings** and click
**Check for updates** in the Plexy app updates section. Settings shows the
installed and latest app version, then offers **Install update** when a
download is available. Plexy checks the latest GitHub release, downloads the
app ZIP, verifies its SHA-256 digest (from the release checksum file or GitHub
asset metadata), then asks before quitting and replacing the app.
macOS may request administrator approval when Plexy is installed in
`/Applications`. Your library and settings remain in Application Support.

The updater works with the current ad-hoc signed, non-notarized build. macOS
may still block the first launch of a downloaded release or show a security
prompt after updating. This updater does not make the app notarized or provide
the same seamless trust experience as a Developer ID signed and notarized app.
If an update cannot be installed, download the DMG and replace the app manually.
Release builds use numbered tags in the form `v<version>-build.<run>`; the
current app version is `1.0.0`.

Your data is not part of the `.app` bundle. Everything writable lives outside
it, so replacing the app keeps your library, watch state, and paired devices:

| Path | Contents |
| --- | --- |
| `~/Library/Application Support/Plexy/library.sqlite` | Catalog, watch state, settings, auth tokens (hashed) |
| `~/Library/Application Support/Plexy/backups/` | Automatic snapshot taken before any schema migration |
| `~/Library/Application Support/@plexy/desktop/` | Persistent client cookies and trusted server fingerprints |
| `~/Library/Logs/Plexy/` | Logs |

Because the build is not signed, macOS may block the replacement app again;
repeat the Gatekeeper step above (or `xattr -dr com.apple.quarantine
/Applications/Plexy.app`). The bundled server runs migrations on startup and
takes a database snapshot first, so an interrupted upgrade can be rolled back by
copying the newest file from `backups/` over `library.sqlite` while Plexy is
stopped.

### Accounts, setup, and pairing

- **Server setup:** open `/setup` on the server computer. Create the first
  administrator with a username and a password of at least 12 characters, then
  configure metadata and libraries or skip those steps. Completion is stored in
  SQLite; changing metadata settings, restarting, or updating does not reopen
  setup. An interrupted setup resumes from the saved step.
- **Client sign-in:** open `/connect` to choose a server, then sign in with a
  username/password or a pairing key. There is no automatic local admin login.
- **My account:** open `/account` to manage your own devices, change your
  password, or create a pairing key after confirming your current password.
  Keys are random, expire in ten minutes, work once, and always sign in as the
  issuing user. Administrators cannot request another user's pairing key.
- **Users and permissions:** administrators manage accounts from My account.
  New users have no content access until explicitly granted a library, folder,
  or title. Exclusions override grants. Maturity limits and blocking unrated
  content apply to catalog, search, artwork, subtitles, downloads, and streams.
  Watch progress is private to each account. Administrators have full content
  access; server filesystem and diagnostic operations additionally require a
  direct local connection.
- Passwords use Argon2id; only hashes of session tokens and pairing keys are
  stored. Password changes revoke other sessions and pending keys. The account
  migration invalidates old account-free device tokens, preserves libraries,
  and assigns existing watch progress to the first owner account.

### Secure local network access

Enable LAN access in server settings and restart. The HTTP listener stays on
loopback for this computer. Other devices use a separate HTTPS listener on
`PORT + 1` (default `8766`, override with `PLEXY_LAN_PORT`).

The server generates and saves a private local certificate and owner-only key.
Find its SHA-256 fingerprint in **My account**. The desktop client's Choose a
server screen discovers `_plexy._tcp` services with Bonjour/mDNS and asks you to
compare the fingerprint before trusting a local certificate. A changed pinned
certificate is rejected. To intentionally re-pair a replaced server certificate,
quit the client and remove that host's entry from `trusted-servers.json` in the
client's userData directory, then verify the new fingerprint.

Browsers cannot browse mDNS services directly. Open the server's HTTPS client
link from Settings, trust its local certificate in that browser after checking
the fingerprint, then sign in. Browser certificate trust is separate from Plexy
account authentication. Alternatively supply a certificate already trusted by
clients using both `PLEXY_TLS_CERT` and `PLEXY_TLS_KEY`.

Discovery announces only server identity and transport. It never grants access.
Multicast isolation and guest Wi-Fi can prevent discovery; manual server
addresses remain supported. No bundled public tunnel or relay is started.

### Automatic library discovery

While the server is running, Plexy starts an incremental scan two minutes after
launch and repeats every 15 minutes. It walks library folders and checks file
size and modification time; unchanged files are skipped without probing or
matching again. Newly added or changed titles are processed in the background,
and open catalog views refresh when the scan finishes. Scheduled scans defer
when another scan is already in progress.

### 4. Hosted Web Build

`bun run build:web` produces `dist/web`, a static SPA that can be hosted on an
HTTPS static server with an `index.html` fallback for routes. `/connect` is the
client entry link; `/setup` belongs to the actual server installation.

For a separately hosted HTTPS client, list its exact origin in
`PLEXY_ALLOWED_ORIGINS` on the server. Cross-site browser cookie policies can
still affect sign-in and media; opening the server's own HTTPS URL avoids that
dependency. `VITE_API_URL` can seed an initial server address.

#### Installing Plexy Client on a phone (PWA)

`dist/web` is an installable **Plexy Client**. The manifest in
`apps/web/public/manifest.webmanifest` names it Plexy Client, launches it
standalone in portrait or landscape, and ships 192/512 plus maskable icons.
`apps/web/public/sw.js` caches only the app shell and hashed static assets;
libraries, authentication, artwork and video always come from the server, and
every other `/api/*` request is left untouched so media byte ranges keep
working.

- **iPhone / iPad:** open the client in Safari, then Share → **Add to Home
  Screen**. iOS only installs PWAs from Safari.
- **Android:** open it in Chrome, then menu → **Install app**.
- Installation needs a secure context: serve the client over HTTPS, or open the
  server's own `http://localhost` address. For a local HTTPS address on a phone,
  trust the server certificate in the browser before installing the client.
- Regenerate the icons with `bun run icons:pwa` after editing
  `apps/web/public/client-icon.svg` or `client-icon-maskable.svg`.

## Planned Client and Server targets

The product split is described in [the detailed distribution plan](docs/MOBILE_AND_DISTRIBUTION_DETAILED_PLAN.md): **Plexy Client** is the desktop UI-only app, **Plexy Server** is the standalone backend, and **Plexy** remains the combined Electron app. The separate [mobile app build plan](docs/MOBILE_APP_BUILD_PLAN.md) specifies an Expo React Native movie client that connects to Plexy Server. Client and Server use distinct icon variants.

## Scripts

| Command | Action |
| --- | --- |
| `bun run dev` | Run server and Vite web client concurrently |
| `bun run dev:server` | Run Elysia server alone (`apps/server`) with watch mode |
| `bun run dev:web` | Run Vite web dev server alone (`apps/web`) |
| `bun run dev:desktop` | Run native Electron desktop application in development |
| `bun run build` | Build web UI and package full macOS Electron app |
| `bun run build:web` | Build the web bundle to `dist/web` |
| `bun run build:client` | Build **Plexy Client** (UI-only) and verify no server-owned files are included |
| `bun run build:server` | Build **Plexy Server**: standalone backend binary, migrations and FFmpeg |
| `bun run build:executable` | Build the single-file server plus a macOS app bundle installed to `/Applications` |
| `bun run build:desktop` | Build standalone backend server and package macOS `.app` + `.dmg` |
| `bun run icons:pwa` | Regenerate the PWA and apple-touch icons from the source SVGs |
| `bun run package:mac` | Package macOS Electron app, `.dmg`, and `.zip` distribution |
| `bun run start` | Run server from source with Bun |
| `bun run test` | Run backend test suite (`apps/server/tests`) |
| `bun run typecheck` | Typecheck all packages with strict TypeScript |

## Client and distribution targets

| Target | Command | Artifact | Needs a Plexy Server |
| --- | --- | --- | --- |
| **Plexy** (combined Electron app) | `bun run build` / `build:desktop` | `dist/mac/Plexy-<version>-arm64.dmg` | Bundled — starts its own |
| **Plexy Client** (desktop UI-only) | `bun run build:client` | `dist/web` static client | Yes — enter its address |
| **Plexy Client** (mobile PWA) | `bun run build:client` | the same `dist/web` artifact, installable | Yes — enter its address |
| **Plexy Server** (backend only) | `bun run build:server` | `dist/server/plexy-server` + `migrations/` + `ffmpeg` | — |

Mobile and desktop UI-only are one responsive artifact, so there is one client
build; only the shell around it differs. `bun run build:client` fails if the
output contains a server binary, migrations or FFmpeg, which is what keeps the
split honest instead of by convention.

Client runtime mode is explicit in `apps/web/src/runtime-config.ts`: `bundled`
when Electron started the server, `server-hosted` when the page is served by the
server it talks to, and `remote` for a separately hosted UI. Administration
stays loopback-only, and the mobile navigation hides those screens for remote
viewers because the server rejects them anyway.

`bun run build:server` is now the backend-only target. `bun run build:executable`
keeps the older behaviour of also assembling and installing a macOS app bundle;
`bun run build:desktop` remains the full combined app. `plexy-server --version`
and `--help` identify the build without starting the database.

The plans in [docs/](docs/) also list work that is deliberately not built yet:
native app-store wrappers, a thin desktop shell, notarization, and applying the
separate Client/Server icon artwork to installers. `apps/web/public/client-icon.svg`
and `server-icon.svg` are the source marks for that; only the client icons are
generated and shipped so far.

---

## Configuration & Environment

- The version is maintained in `apps/server/src/config.ts` (`version: "0.1.0"`).
- Supported environment variables in `.env`:
  - `VITE_PUBLIC_TMDB_ACCESS_TOKEN` / `TMDB_TOKEN`: Read-access token for TMDB. Automatically bound by default if present; user is only prompted if missing or invalid.
  - `VITE_PUBLIC_TMDB_API_URL`: TMDB API base URL (default: `https://api.themoviedb.org/3`).
  - `PORT`: Server listen port (default `8765`).
  - `PLEXY_DATA_DIR`: Data and database directory (default: macOS `~/Library/Application Support/Plexy`, dev `/tmp/plexy-dev`).
  - `PLEXY_LOG_LEVEL`: Log level (`debug`, `info`, `warn`, `error`).
  - `PLEXY_ALLOWED_ORIGINS`: Comma-separated exact HTTPS frontend origins allowed to make credentialed cross-origin requests. Same-origin requests do not need this setting. Running from source (`bun dev`) already trusts browser origins on this machine's own addresses (the Vite page and the LAN URL it prints), so local development needs no entry here.
- The desktop app prefers port `8765` so LAN bookmarks stay valid; it falls back to a random free port only when `8765` is already taken.
- LAN access is off by default (`bindAddress: "127.0.0.1"`). Enable it in **Server → Settings → Network & Access**, then restart Plexy. That page lists the exact `https://<lan-ip>:<lan-port>` addresses to open on phones and TVs.

---

## CI/CD (GitHub Release)

`.github/workflows/build.yml` builds the static web client and Apple Silicon
macOS artifacts and publishes a GitHub Release. Static hosting is configured
separately. The TMDB token belongs to the server and is configured in server
settings or its environment; it is never baked into the client.

---

## Key Features

- **RPC & REST Endpoints**: Frontend connects via `@elysiajs/eden` Treaty typed RPC client, while all individual REST endpoints (`/api/items`, `/api/home`, `/api/stream/:fileId`, `/api/subtitles/:fileId/:track.vtt`, `/api/local-folders`, `/api/settings/tmdb/test`, etc.) remain fully accessible.
- **Smart Setup Flow**:
  - Hosted web clients show a server connection screen when no API is reachable, verify the address, and remember it on the device.
  - Automatically redirects to `/setup` on initial launch if setup is incomplete, and returns to Home (`/`) once completed.
  - Automatically verifies TMDB connection if configured via environment, showing a verified badge without asking for redundant input.
  - File browser with quick shortcuts (`Movies`, `Downloads`, `Desktop`, `Home`, `Drives`), direct path input field, breadcrumbs navigation, and "+ Add this folder" button.
- **Netflix-Style Clean UI**:
  - Featured hero banner with backdrop, title logo, year, rating, runtime, overview, and Play / Trailer / Details actions.
  - Continue Watching carousel with Netflix-style red progress bars.
  - Horizontal scrolling carousels with smooth arrow paging and hover zooms.
  - PRD Page 3 Title detail screen with technical media specs, playability badge (Direct, Remux, Transcode), season/episode selectors, and cast list.
  - Fullscreen video player with custom controls, skip ±10s, volume slider, playback speed, WebVTT subtitle track switcher, and next episode button.
- **Branding**:
  - Medusa logo icon integrated in TopNav, browser tab favicon, and native macOS Application iconset.
- **Comprehensive Backend Tests**:
  - 23 unit and integration tests across 5 test suites covering config, filename parsing (Emby/Jellyfin naming), candidate scoring, playability classification, and Elysia API routes.

This product uses the TMDB API but is not endorsed or certified by TMDB.
