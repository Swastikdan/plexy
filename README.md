# Plexy

Plexy is a self-hosted personal media server for your own movie and TV collection. Point it at folders of video files and it scans, identifies, organizes, and streams them to a browser, a desktop app, or an offline Android app — with no account, no cloud, and no subscription.

It exists because personal video libraries are messy in practice: files live in odd containers and codecs browsers can't play, metadata is missing, subtitles are embedded or scattered, and you still want intro-skip, resume, scrub previews, and offline playback. Plexy handles all of that locally.

## What it does

**Server (`apps/server`) — the core**

- Scans media folders into a SQLite catalog of movies, series, seasons, and episodes.
- Matches files against TMDB (titles, posters, backdrops, logos, cast, trailers, certifications, episode names/stills), with manual matching for ambiguous results.
- Makes anything playable in a browser: fast-start MP4 remux (lossless, seconds), audio-only transcode, full H.264/AAC transcode, prepared HLS with variants, plus live remux/transcode fallbacks (max 2 concurrent, `503` + `Retry-After` beyond that).
- Serves direct streams with byte-range seeking, resumable source downloads, quality-capped generated downloads (`maxHeight` 360–2160), subtitles as WebVTT (embedded + sidecar), trickplay sprites/VTT for scrub previews, and community intro/recap/credits skip markers.
- Tracks watch progress, exposes playback manifests (`GET /api/play/:fileId`) so any client can build its own player.
- Authenticates clients by device pairing codes → Bearer tokens (native) or HttpOnly session cookies (browser `<video>`, which can't set auth headers). First run creates the owner in the local UI; LAN access, TLS, and allowed origins are opt-in settings.
- Optional storage optimization: keep prepared copies in the app-data folder or beside media (`.plexy/optimized`, scanner-skipped), with opt-in original replacement and Trash-first deletion (macOS Trash / `gio trash` / `.plexy/trash` fallback).

**Browser frontend (`apps/web`) — embedded, not deployed separately**

- React 19 + TanStack Router/Query + Video.js + Tailwind/HeroUI single-file build served as static files by the backend process itself. There is no separate UI server.
- `--no-ui` / `PLEXY_NO_UI=1` disables UI routes and assets while keeping the API and media jobs running (headless mode).

**Desktop (`apps/desktop`) — Electron shell**

- Bundles the same frontend and a child backend process. **Run local server** toggles between running its own backend and acting as a client to another Plexy server via an authenticated API proxy (cookies/credentials are never forwarded across servers).
- Native mpv video window with the Plexy player chrome (matching the browser player) that streams the original over an authenticated loopback relay, bypassing browser preparation.

**Mobile (`apps/mobile`) — fully independent offline Android app**

- Expo Router app with its own on-device SQLite library (`plexy-library.db`). No Plexy server, account, pairing, or remote playback involved.
- Plays original file URIs with expo-video, imports external SRT/VTT, generates local scrub-preview JPEGs (2s buckets, 50 MB cache), and caches TMDB metadata/artwork and IntroDB skip markers for offline use. Videos stay in their picked folders.

## Why it's built this way

- **Your files stay yours.** No cloud relay, no telemetry-gated playback. The server runs on your machine (`:8765` by default); remote access is explicit LAN/TLS configuration, not a default.
- **Browsers can't play everything.** MKV/HEVC/odd audio tracks are the norm in personal libraries, so preparation (remux → transcode → HLS) is a first-class pipeline, not an afterthought, with safe original-replacement semantics.
- **One API, many players.** The HTTP contract (`/api/*`, typed in `packages/api-client`) drives the web player, desktop proxy, mpv relay, and documents the native playback flow — so clients stay thin.
- **Offline-first mobile.** Phones with local files shouldn't need a server or login to watch them; metadata and skip data are optional cached enrichments.
- **Monorepo with strict boundaries.** Apps are shippable deliverables; `packages/*` is shared source only. Dependencies flow `apps → packages`, never the reverse.

## How it works

```text
media folders ──► scanner ──► SQLite catalog ──► TMDB matcher ──► artwork/subtitle/skip hydration
                                                    │
originals ──► FFmpeg (remux / transcode / HLS / trickplay) ──► cache (.plexy/optimized or data dir)
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

```text
apps/
  web/        Browser frontend embedded into desktop and server builds
  server/     Bun backend and HTTP API
  desktop/    Electron shell, API proxy, mpv relay, updater
  mobile/     Expo Router Android app (independent device library)
packages/
  api-client/     HTTP contracts, browser capability probing, transport policy
  local-library/  Device-local catalog, scanning, metadata, and skip-marker logic
  media-text/     Language names and subtitle labels shared by web and mobile
  desktop-bridge/ Electron IPC contract shared by main, preload, and the web UI
  tsconfig/       Shared TypeScript presets
```

Mobile app code further splits into `apps/mobile/src/core` (infrastructure), `src/features` (screen logic), and `src/shared` (reusable controls). See `docs/MONOREPO.md` before adding packages or moving shared code.

## Development

Requires Bun 1.4.4, then `bun install`.

| Command | Purpose |
| --- | --- |
| `bun run dev` | Backend + frontend dev servers (`PORT` moves both; the Vite proxy follows it) |
| `bun run dev:desktop` | Electron shell (run `bun run dev` and set `VITE_DEV_SERVER_URL=http://localhost:5173`) |
| `bun run dev:mobile` | Expo dev server |
| `bun run android:mobile` | Generate and run the Android dev app |
| `bun run typecheck` | Server, web, desktop, shared packages, root scripts |
| `bun run typecheck:native` | Mobile types |
| `bun run test` | Every non-E2E suite (server, desktop, mobile, shared packages) |
| `bun run test:server` | Isolated backend tests |
| `bun run test:desktop` | Desktop API proxy tests |
| `bun run test:packages` | Shared-package tests |
| `bun run test:native` | Local-library + mobile logic tests |

Key docs: `docs/API.md` (auth, playback, download, HLS, subtitles, progress), `docs/PLAYBACK_PREPARATION.md` (remux/transcode, storage modes, replacement + Trash policy), `docs/MOBILE_LOCAL_LIBRARY.md` (offline catalog, TMDB/IntroDB caching, previews), `docs/native-playback.md`, `docs/CODE_HEALTH.md` (build/dev layout and line budget), `apps/mobile/README.md`.

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

### Android download mirror

To serve the latest installer and update manifest from Cloudflare R2, connect an HTTPS custom domain to a dedicated R2 bucket. In GitHub Actions set the variables `PLEXY_UPDATE_ORIGIN` (the HTTPS origin) and `PLEXY_UPDATE_R2_BUCKET` (the bucket name). Set the secrets `CLOUDFLARE_ACCOUNT_ID`, `PLEXY_R2_ACCESS_KEY_ID`, and `PLEXY_R2_SECRET_ACCESS_KEY` with a bucket-scoped R2 credential.

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

## CI and releases

Release builds use the targets selected in GitHub Actions. Preview APKs use the repo test signature and EAS production uses release signing. macOS releases are ad-hoc signed. On first launch use **System Settings → Privacy & Security → Open Anyway**. The desktop updater verifies checksums before installing.
