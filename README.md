# Plexy

Plexy is a self-hosted personal media server for your own movie and TV collection. Point it at folders of video files and it scans, identifies, organizes, and streams them to a browser, a desktop app, or an offline Android app — with no account, no cloud, and no subscription.

It exists because personal video libraries are messy in practice: files live in odd containers and codecs browsers can't play, metadata is missing, subtitles are embedded or scattered, and you still want intro-skip, resume, scrub previews, and offline playback. Plexy handles all of that locally.

## Repository map

```text
apps/
  server/     Bun + Elysia backend and HTTP API (SQLite catalog, scanner,
              TMDB hydration, FFmpeg preparation pipeline)
  web/        Browser frontend (React 19 + TanStack Router/Query + Video.js),
              built to a single file and served by the server process
  desktop/    Electron shell (API proxy, mpv relay, updater) — bundles the
              web UI and a child backend process
  mobile/     Fully independent offline Android app (Expo Router, on-device
              SQLite, no server/login required)
packages/
  api-client/     Shared HTTP contracts, browser capability probing,
                  transport policy (dependency-free, source-only)
  local-library/  Device-local catalog/scan/metadata/skip logic for mobile
                  (depends only on api-client types, source-only)
  media-text/     Language names + subtitle labels shared by web and mobile
  desktop-bridge/ Electron IPC contract shared by main, preload, and web UI
  tsconfig/       Shared TypeScript presets (base, bun, react)
scripts/      Build, release, test, and license tooling (Bun)
docs/         Feature and operations docs (see "Docs index" below)
```

Dependency direction is strict: `apps/* → packages/*`, never the reverse. See `docs/MONOREPO.md`.

New to the codebase? Read in this order:

1. This README (what it is, how to run it)
2. `docs/ARCHITECTURE.md` — system diagram, request flows, data model
3. `docs/CODEBASE_TOUR.md` — directory-by-directory file tour
4. Per-app READMEs: `apps/server/README.md`, `apps/web/README.md`, `apps/desktop/README.md`, `apps/mobile/README.md`
5. Feature docs in the index below as needed

## What it does

**Server (`apps/server`) — the core.** See `apps/server/README.md`.

- Scans media folders into a SQLite catalog of movies, series, seasons, and episodes.
- Matches files against TMDB (titles, posters, backdrops, logos, cast, trailers, certifications, episode names/stills), with manual matching for ambiguous results.
- Makes anything playable in a browser: fast-start MP4 remux (lossless, seconds), audio-only transcode, and full H.264/AAC transcode, prepared ahead of playback by a single background queue. HLS/ABR and live remux/transcode are **not** implemented (`GET /api/stream/:fileId/remux`, `/transcode`, and `/hls/:asset` return `409`); see `docs/APP_FEATURE_AUDIT.md` and `docs/API.md`.
- Serves direct streams with byte-range seeking, resumable source downloads, subtitles as WebVTT (embedded + sidecar), trickplay sprites/VTT for scrub previews, and community intro/recap/credits skip markers (opt-in via `skipSegmentsEnabled`).
- Tracks watch progress and exposes playback manifests (`GET /api/play/:fileId`) so any client can build its own player.
- Authenticates clients by device pairing codes → Bearer tokens (native/API clients) or HttpOnly session cookies (browser `<video>`, which can't set auth headers). First run creates the owner in the local UI; LAN access, TLS, and allowed origins are opt-in settings.
- Optional storage optimization: keep prepared copies in the app-data folder (`optimizeStorage: "data"`, default) or beside media (`.plexy/optimized`, scanner-skipped), with opt-in original replacement and Trash-first deletion (macOS Trash / `gio trash` / `.plexy/trash` fallback).

**Browser frontend (`apps/web`) — embedded, not deployed separately.** See `apps/web/README.md`.

- React 19 + TanStack Router/Query + Video.js + Tailwind 4/HeroUI single-file build, served as static files by the backend process itself. There is no separate UI server.
- `bun run dev` runs backend + Vite dev servers; `--no-ui` / `PLEXY_NO_UI=1` disables UI routes and assets while keeping the API and media jobs running (headless mode).

**Desktop (`apps/desktop`) — Electron shell.** See `apps/desktop/README.md`.

- Bundles the same frontend and a child backend process. **Run local server** toggles between running its own backend and acting as a client to another Plexy server via an authenticated API proxy (cookies/credentials are never forwarded across servers).
- Native mpv video window with the Plexy player chrome (matching the browser player) that streams the original over an authenticated loopback relay, bypassing browser preparation.

**Mobile (`apps/mobile`) — fully independent offline Android app.** See `apps/mobile/README.md`.

- Expo Router app with its own on-device SQLite library (`plexy-library.db`). No Plexy server, account, pairing, or remote playback involved.
- Plays original file URIs with expo-video, imports external SRT/VTT, generates local scrub-preview JPEGs (2s buckets, 50 MB cache), and caches TMDB metadata/artwork and IntroDB skip markers for offline use. Videos stay in their picked folders.

## Why it's built this way

- **Your files stay yours.** No cloud relay, no telemetry-gated playback. The server runs on your machine (`:8765` by default); remote access is explicit LAN/TLS configuration, not a default.
- **Browsers can't play everything.** MKV/HEVC/odd audio tracks are the norm in personal libraries, so preparation (remux → transcode → prepared MP4) is a first-class pipeline, not an afterthought, with safe original-replacement semantics.
- **One API, many players.** The HTTP contract (`/api/*`, typed in `packages/api-client`) drives the web player, desktop proxy, mpv relay, and documents the native playback flow — so clients stay thin.
- **Offline-first mobile.** Phones with local files shouldn't need a server or login to watch them; metadata and skip data are optional cached enrichments.
- **Monorepo with strict boundaries.** Apps are shippable deliverables; `packages/*` is shared source only. Dependencies flow `apps → packages`, never the reverse.

## How it works

```text
media folders ──► scanner ──► SQLite catalog ──► TMDB matcher ──► artwork/subtitle/skip hydration
                                                    │
originals ──► FFmpeg (remux / transcode / trickplay) ──► cache (.plexy/optimized or data dir)
                                                    │
                              Elysia HTTP API (/api) + static web UI ──► browser / desktop proxy / mpv relay
                              pairing auth (Bearer / session cookie)

Android (separate): Storage Access folders ──► local SQLite ──► expo-video + cached TMDB/IntroDB
```

| Piece | Stack |
| --- | --- |
| Backend | Bun 1.4.4, Elysia, SQLite, FFmpeg, Zod, Bonjour/mDNS discovery |
| Web | React 19, Vite (singlefile), TanStack Router + Query, Video.js, Tailwind 4 + HeroUI |
| Desktop | Electron 45 + electron-builder (macOS ARM64 DMG/ZIP, ad-hoc signed) |
| Mobile | Expo 57 / React Native 0.86, expo-router, expo-video, expo-sqlite, Reanimated |
| Shared | `packages/api-client` (HTTP contracts, capability probing, transport policy), `packages/local-library` (scan/match/metadata/skip logic), `packages/media-text` (language names and subtitle labels), `packages/desktop-bridge` (Electron IPC contract), `packages/tsconfig` (presets) |

Mobile app code further splits into `apps/mobile/src/core` (infrastructure), `src/features` (screen logic), and `src/shared` (reusable controls). See `docs/MONOREPO.md` before adding packages or moving shared code.

## Prerequisites

- **Bun 1.4.4** (`packageManager: bun@1.4.4`) — all server/web/desktop/packages scripts run on Bun.
- **FFmpeg** — bundled into `dist/server` by `bun run build:server`; for `bun run dev` it must be on `PATH`.
- **macOS** — required for desktop packaging (`electron-builder`, ad-hoc signed DMG/ZIP).
- **JDK 17 + Android SDK** — required only for `bun run build:mobile` (ARM64 APK under `.build/native`). Tune with `PLEXY_ANDROID_ARCHITECTURES`, `PLEXY_GRADLE_WORKERS`.
- **TMDB token** — set in Settings UI (server) or `TMDB_TOKEN`/`EXPO_PUBLIC_TMDB_TOKEN` at build time (mobile preview/EAS builds fail without it).

Install once: `bun install` (links all `apps/*` + `packages/*` workspaces).

## Quickstart

```sh
bun install
bun run dev            # backend :8765 + web dev server :5173 (PORT moves both)
```

Then open the printed URL (`http://localhost:8765/setup` on first run) to create the owner, add a library folder, and let the scanner + TMDB hydration run.

| Command | Purpose |
| --- | --- |
| `bun run dev` | Backend + frontend dev servers (`PORT` moves both; the Vite proxy follows it) |
| `bun run dev:desktop` | Electron shell (run `bun run dev` first and set `VITE_DEV_SERVER_URL=http://localhost:5173`) |
| `bun run dev:mobile` | Expo dev server |
| `bun run android:mobile` | Generate and run the Android dev app |
| `bun run typecheck` | Server, web, desktop, shared packages, root scripts |
| `bun run typecheck:native` | Mobile types |
| `bun run test` | Every non-E2E suite (server, desktop, mobile, shared packages) |
| `bun run test:server` | Isolated backend tests |
| `bun run test:desktop` | Desktop API proxy tests |
| `bun run test:packages` | Shared-package tests |
| `bun run test:native` | Local-library + mobile logic tests |

## Build

| Command | Output |
| --- | --- |
| `bun run build:desktop` | Apple Silicon app, DMG + ZIP under `dist/mac` |
| `bun run build:server` | `dist/server/plexy-server` + `ffmpeg`, `migrations/`, `web/` |
| `bun run build:mobile` | ARM64 Android APK under `.build/native` |
| `bun run build` | All three (reuses one frontend build) |
| `bun run build:web` | Internal frontend build at `dist/web` |

Desktop packaging needs macOS; server builds target the host; Android builds need JDK 17 + Android SDK (`PLEXY_ANDROID_ARCHITECTURES`, `PLEXY_GRADLE_WORKERS` tune ABIs/workers). Icons are generated from SVG for desktop; mobile icon/splash stay checked in for Linux CI.

## Release

Open [Actions → Build & Release](https://github.com/Swastikdan/plexy/actions/workflows/build.yml), click **Run workflow**, and select **main**. Check any combination of **macOS desktop**, **Linux backend**, **macOS backend**, and **Android**. A push or merge does not launch a release.

- **Desktop** builds the web UI and server executable it embeds, then publishes the macOS DMG and ZIP.
- **Backend** defaults to a self-contained archive with the executable, web UI, migrations, and FFmpeg. Select **binary** for an archive containing only the executable, then supply its runtime files separately. Select either or both backend platforms.
- **Android** publishes an OTA update when compatible and otherwise builds an APK. Select **Force APK** to request a new installable build.
- **macOS runner** defaults to **auto**. Each macOS target starts on GitHub Actions. If its worker is still queued after five minutes, the release waits for GitHub to confirm cancellation and then uses CircleCI for that target. Select **github** or **circleci** to use one provider only.
- **Release version increment** defaults to **patch**. For example, `1.0.8` becomes `1.0.9`. Select **minor** for a feature release or **major** for a breaking release. **Release highlights** adds your notes to GitHub.

For example, to publish just the two backend executables:

```sh
gh workflow run build.yml --ref main \
  -F linux_backend=true -F macos_backend=true -f backend_contents=binary
```

The desktop app, its package filenames, and the general release tag use the version selected by the workflow. A local desktop package uses the higher of the root package's version and the latest general release tag. Local desktop and Android packaging use your authenticated `gh` session to reserve numbers in this repository, and hosted packaging uses the same Git tags. Android APKs keep their own semantic version and Android version code. Reservations can leave gaps after failed or local-only builds.

### macOS download CDN

The release workflow publishes the DMG and ZIP to GitHub. To serve those files through Gcore, configure an HTTPS CDN resource with `github.com` as its HTTPS origin and Origin Host header. Enable **Redirection from origin** for HTTP 302. Limit delivery to this repository's versioned release download paths. Keep the account within Gcore's free traffic allowance and leave billing disabled.

Set the GitHub Actions variable `PLEXY_DESKTOP_CDN` to the CDN's HTTPS URL. The workflow adds Gcore links to the release notes after confirming that the CDN serves bytes from each installer directly. The GitHub assets remain available.

### Android download mirror

To serve Android release downloads from Cloudflare R2, connect an HTTPS custom domain to a dedicated R2 bucket. In GitHub Actions set the variables `PLEXY_UPDATE_ORIGIN` (the HTTPS origin) and `PLEXY_UPDATE_R2_BUCKET` (the bucket name). Set the secrets `CLOUDFLARE_ACCOUNT_ID`, `PLEXY_R2_ACCESS_KEY_ID`, and `PLEXY_R2_SECRET_ACCESS_KEY` with a bucket-scoped R2 credential.

The next **Force APK** release uploads the APK first, then the manifest, and removes older Android APKs from the bucket. GitHub Releases keeps the full history. The Android app tries R2 first for the current manifest and installer, and falls back to GitHub. It checks the APK size and SHA-256 before opening the installer.

## Running the server

Keep `web/`, `migrations/`, and FFmpeg next to the executable:

```sh
./plexy-server
./plexy-server --no-ui
PLEXY_NO_UI=1 ./plexy-server
```

`PORT` (default `8765`) overrides the port. `PLEXY_DATA_DIR` selects the database/library-data dir; `PLEXY_LOG_LEVEL` controls logging; `--version` / `--help` exit without starting. First run: open the local UI to create the owner and add libraries; restart with `--no-ui` for headless. Enable LAN access in settings before connecting other machines (use the reported HTTPS address); `PLEXY_ALLOWED_ORIGINS` gates separately hosted web clients.

In desktop **Settings** (or the connection screen), **Run local server** starts/stops only the bundled backend — it never stops an external server. Off = this window becomes a client to a remote Plexy.

## Docs index

| Doc | What it covers |
| --- | --- |
| `docs/ARCHITECTURE.md` | System diagram, process model, auth flows, playback pipeline |
| `docs/CODEBASE_TOUR.md` | File-by-file tour of `apps/*`, `packages/*`, `scripts/` |
| `docs/API.md` | HTTP API: auth, playback, catalog, settings (contract reference) |
| `docs/PLAYBACK_PREPARATION.md` | Remux/transcode, storage modes, replacement + Trash policy |
| `docs/MOBILE_LOCAL_LIBRARY.md` | Offline catalog, TMDB/IntroDB caching, previews |
| `docs/native-playback.md` | Native playback contract details |
| `docs/MONOREPO.md` | Workspace layout, dependency rules, adding apps/packages |
| `docs/CODE_HEALTH.md` | Build/dev layout, line budget, guardrails |
| `docs/APP_FEATURE_AUDIT.md` | Current feature status (what is/isn't implemented) |
| `docs/TESTING.md` | How to run each test suite |
| `apps/mobile/README.md` | Mobile source layout, build/verify, OTA + APK versioning |

## CI and releases

Release builds use the targets selected in GitHub Actions. Preview APKs use the repo test signature and EAS production uses release signing. macOS releases are ad-hoc signed. On first launch use **System Settings → Privacy & Security → Open Anyway**. The desktop updater verifies checksums before installing.
