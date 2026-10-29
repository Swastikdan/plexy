# Plexy

A personal, local-first home media server: point it at folders of movies and TV shows, and it organises them into a Netflix-style library with posters, backdrops, cast, trailers, watch progress, and intelligent browser playability routing.

The repository is structured as a clean **monorepo**:
- **`apps/desktop`**: Full native Electron desktop application for macOS, featuring integrated lifecycle management for the backend server, macOS `hiddenInset` traffic lights, native Finder directory selection, and menu bar shortcuts.
- **`apps/server`**: Elysia backend API server with Mediabunny probe/transcode, SQLite storage, TMDB matcher, and embedded SPA static serving.
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

- **From DMG**: Open `dist/mac/Plexy-0.1.0-arm64.dmg` and drag `Plexy` to `Applications`.
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

Release builds are ad-hoc signed but **not notarized** — notarization requires an
Apple Developer Program membership — so macOS shows:

> Apple could not verify "Plexy" is free of malware that may harm your Mac or compromise your privacy.

This is expected. To open the app:

1. Drag **Plexy** into **Applications**.
2. Open **System Settings → Privacy & Security** and scroll to the Security section.
3. Click **Open Anyway** next to the blocked Plexy message, then confirm with
   your password or Touch ID.

On macOS 14 and earlier, right-clicking **Plexy.app** and choosing **Open** also
works. From Terminal:

```sh
xattr -dr com.apple.quarantine /Applications/Plexy.app
```

Only bypass Gatekeeper for builds you produced yourself or downloaded from this
repository's releases.

### Updating Plexy (manual, no in-app updater)

Plexy has **no auto-updater**. The app never downloads or installs a new
version, and release builds are produced with `--publish never`. To update,
download the new DMG and replace `Plexy.app` in **Applications** — the same
drag-and-drop as a first install.

Your data is not part of the `.app` bundle. Everything writable lives outside
it, so replacing the app keeps your library, watch state, and paired devices:

| Path | Contents |
| --- | --- |
| `~/Library/Application Support/Plexy/library.sqlite` | Catalog, watch state, settings, auth tokens (hashed) |
| `~/Library/Application Support/Plexy/backups/` | Automatic snapshot taken before any schema migration |
| `~/Library/Application Support/Plexy/auth-token.bin` | Desktop token, encrypted with the macOS Keychain |
| `~/Library/Logs/Plexy/` | Logs |

Because the build is not signed, macOS may block the replacement app again;
repeat the Gatekeeper step above (or `xattr -dr com.apple.quarantine
/Applications/Plexy.app`). The bundled server runs migrations on startup and
takes a database snapshot first, so an interrupted upgrade can be rolled back by
copying the newest file from `backups/` over `library.sqlite` while Plexy is
stopped.

### Device authentication

Every `/api/*` route now requires a paired device. The only public endpoint is
`/api/server/status`, which the connection screen uses to probe an address.

- **Desktop app** — signs in automatically. On launch it asks its bundled server
  for a token over loopback, stores it with Electron `safeStorage` (macOS
  Keychain), and installs it as an HttpOnly cookie so images, video, HLS
  segments, and event streams authenticate without any URL changes.
- **This machine in a browser** — the pairing screen offers **This is the server
  machine**, which signs in with one click (loopback is the owner boundary here).
- **Phones, TVs, other computers** — open **Settings → Security** on the server,
  click **Generate pairing code**, and enter the six-digit code on the other
  device. Codes are single-use and expire after 10 minutes. A headless server
  with LAN access enabled prints a first-device code at startup when nothing is
  paired yet.
- **Revoking** — Settings → Security lists paired devices and can revoke any of
  them. Changing the database or replacing the app does not sign devices out,
  because only token hashes are stored in `library.sqlite`.

Admin screens (settings, libraries, scans, matching, logs) remain restricted to
the computer running Plexy, independent of the device token.

### 4. Hosted Web Build (Cloudflare Workers)

`bun run build:web` produces `dist/web`, a static SPA. The GitHub Actions
workflow deploys it as a Cloudflare Worker with static assets (see
`wrangler.json`).

A hosted client has no backend of its own. On first launch it shows a
**Connect to your Plexy server** screen and saves the address on the device
(localStorage; Electron also persists it in its userData directory). The Mac app
normally uses its bundled server and never shows this screen.

After connecting, a hosted client must be paired once (see **Device
authentication** above): the server's `/api/*` routes reject unauthenticated
requests, so enter a pairing code from **Settings → Security** on the server.
The cookie is HttpOnly, so images, streams, and HLS segments keep working
without tokens in URLs.

- On the same Wi-Fi, enable LAN access and open the server's printed
  `http://<lan-ip>:<port>` address directly on the phone. That loads the app and
  streams from the laptop over the local network; the hosted HTTPS page cannot
  call that plain-HTTP address because browsers block mixed content. The phone
  must also be paired once.
- For a hosted HTTPS page to call a different HTTPS server, set
  `PLEXY_ALLOWED_ORIGINS` on the server to the exact frontend origin, such as
  `https://plexy.example.com` (comma-separated for multiple origins). Other
  cross-origin browser clients are denied by default. Browser third-party
  cookie restrictions may still affect hosted-to-server sign-in. Opening the
  server's own HTTPS URL or using a native client avoids that dependency.
- Use a private network such as Tailscale for remote personal streaming. A
  public Cloudflare Tunnel hostname proxies media through Cloudflare; Cloudflare
  currently restricts video and large-file delivery over public hostnames on
  Free, Pro, and Business plans. Private-network routes are not subject to that
  restriction.
- `VITE_API_URL` can seed a default address at build time. Viewers can still
  change it from the Server icon in the top bar.
- The backend supports credentialed CORS for exact origins listed in
  `PLEXY_ALLOWED_ORIGINS`.

#### Deploy the web client from your machine

The GitHub Actions workflow deploys automatically on `build`, but you can also
deploy the same static build yourself:

```sh
cp .env.deploy.example .env.deploy   # optional; gitignored
bun run deploy:web                   # build dist/web + wrangler deploy
bun run deploy:web:dry               # build + validate, upload nothing
```

The command reads `.env.deploy`, builds `dist/web`, then runs
`npx --yes wrangler@4 deploy` against `wrangler.json`. You only need Cloudflare
credentials once:

- **Browser login (easiest):** run `npx --yes wrangler@4 login` and leave the
  Cloudflare lines in `.env.deploy` empty. Wrangler stores the session on your
  Mac.
- **API token:** put `CLOUDFLARE_API_TOKEN` (Workers Scripts: Edit) and
  `CLOUDFLARE_ACCOUNT_ID` in `.env.deploy`, or export them in your shell.
  Never commit them.

`PLEXY_DEFAULT_SERVER_URL` is optional. Leave it empty and viewers are asked for
their Plexy server on first launch; set it to pre-fill that field in the hosted
build. It must be `https://` because the hosted page is HTTPS.

If `wrangler deploy` succeeds but no public URL is printed, enable the free
`workers.dev` subdomain once: Cloudflare dashboard → **Workers & Pages** →
`plexy` → **Settings** → **Domains & Routes** → **workers.dev**. The local
command has no release notes, so `PLEXY_SITE_URL` is not used here — it only
tells the GitHub release notes which URL to link to.

---

## Scripts

| Command | Action |
| --- | --- |
| `bun run dev` | Run server and Vite web client concurrently |
| `bun run dev:server` | Run Elysia server alone (`apps/server`) with watch mode |
| `bun run dev:web` | Run Vite web dev server alone (`apps/web`) |
| `bun run dev:desktop` | Run native Electron desktop application in development |
| `bun run build` | Build web UI and package full macOS Electron app |
| `bun run build:web` | Build web client to `dist/web` |
| `bun run build:desktop` | Build standalone backend server and package macOS `.app` + `.dmg` |
| `bun run package:mac` | Package macOS Electron app, `.dmg`, and `.zip` distribution |
| `bun run deploy:web` | Build `dist/web` and deploy it to Cloudflare Workers |
| `bun run deploy:web:dry` | Build and validate the Worker bundle without uploading |
| `bun run start` | Run server from source with Bun |
| `bun run test` | Run backend test suite (`apps/server/tests`) |
| `bun run typecheck` | Typecheck all packages with strict TypeScript |

## Planned client and distribution targets

The planned product split is documented in [MOBILE_AND_DISTRIBUTION_PLAN.md](MOBILE_AND_DISTRIBUTION_PLAN.md), with implementation detail in [docs/MOBILE_AND_DISTRIBUTION_DETAILED_PLAN.md](docs/MOBILE_AND_DISTRIBUTION_DETAILED_PLAN.md). It covers a mobile client UI that connects to a separate server, a desktop UI-only client, the standalone backend binary, and the existing combined Electron app.

---

## Configuration & Environment

- The version is maintained in `apps/server/src/config.ts` (`version: "0.1.0"`).
- Supported environment variables in `.env`:
  - `VITE_PUBLIC_TMDB_ACCESS_TOKEN` / `TMDB_TOKEN`: Read-access token for TMDB. Automatically bound by default if present; user is only prompted if missing or invalid.
  - `VITE_PUBLIC_TMDB_API_URL`: TMDB API base URL (default: `https://api.themoviedb.org/3`).
  - `PORT`: Server listen port (default `8765`).
  - `PLEXY_DATA_DIR`: Data and database directory (default: macOS `~/Library/Application Support/Plexy`, dev `/tmp/plexy-dev`).
  - `PLEXY_LOG_LEVEL`: Log level (`debug`, `info`, `warn`, `error`).
  - `PLEXY_ALLOWED_ORIGINS`: Comma-separated exact HTTPS frontend origins allowed to make credentialed cross-origin requests. Same-origin requests do not need this setting.
- The desktop app prefers port `8765` so LAN bookmarks stay valid; it falls back to a random free port only when `8765` is already taken.
- LAN access is off by default (`bindAddress: "127.0.0.1"`). Enable it in **Server → Settings → Network & Access**, then restart Plexy. That page lists the exact `http://<lan-ip>:<port>` addresses to open on phones and TVs.

---

## CI/CD (`main` → Cloudflare + GitHub Release)

`.github/workflows/build.yml` runs on every push to `main` (manual
`workflow_dispatch` runs are also restricted to `main`). Pushing to `main` is the
release switch.

What it does:

1. Builds `dist/web` and deploys it with `wrangler deploy` to the Worker
   described by `wrangler.json`.
2. Builds the Apple Silicon macOS `.dmg` and `.zip` on `macos-15`.
3. Creates a GitHub Release tagged `v<version>-build.<run>` containing the site
   URL in the notes and both macOS files as assets.

### Repository secrets

| Secret | Purpose |
| --- | --- |
| `CLOUDFLARE_API_TOKEN` | API token with **Workers Scripts: Edit** (and account read) |
| `CLOUDFLARE_ACCOUNT_ID` | Cloudflare account ID |

### Repository variables (optional)

| Variable | Purpose |
| --- | --- |
| `PLEXY_SITE_URL` | Public URL of the Worker or custom domain used in release notes. If omitted, the workflow uses the deployed `workers.dev` URL. |
| `PLEXY_DEFAULT_SERVER_URL` | Optional server address baked into the hosted web build as the default. Viewers can still change it. |
| `RELEASE_ACTORS` | Comma-separated GitHub logins allowed to publish (no spaces). Defaults to the repository owner. |

### One-time setup

1. Create a Cloudflare API token with **Workers Scripts: Edit**.
2. Add the two secrets above.
3. Enable a `workers.dev` subdomain for the account, or set `PLEXY_SITE_URL` to
   a custom domain.
4. Protect the `main` branch so only you can push to it. The workflow also
   checks `RELEASE_ACTORS`.

`wrangler.json` sets the Worker name (`plexy`) and points static assets at
`dist/web` with SPA fallback routing.

### TMDB token

The TMDB token belongs to the Plexy **server**, not the web or Mac client, so it
is not baked into either build. Enter it in the Mac app's first-run setup (it is
stored in the local config) or in the server's `.env` / Settings page. The
Cloudflare Worker serves only static files and never sees the token.

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
