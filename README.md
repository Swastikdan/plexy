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
- Optional native mpv window that streams the original over an authenticated loopback relay, bypassing browser preparation.

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
| Shared | `packages/api-client` (HTTP contracts, capability probing, transport policy), `packages/local-library` (scan/match/metadata/skip logic), `packages/tsconfig` (presets) |

```text
apps/
  web/        Browser frontend embedded into desktop and server builds
  server/     Bun backend and HTTP API
  desktop/    Electron shell, API proxy, mpv relay, updater
  mobile/     Expo Router Android app (independent device library)
packages/
  api-client/     HTTP contracts, browser capability probing, transport policy
  local-library/  Device-local catalog, scanning, metadata, and skip-marker logic
  tsconfig/       Shared TypeScript presets
```

Mobile app code further splits into `apps/mobile/src/core` (infrastructure), `src/features` (screen logic), and `src/shared` (reusable controls). See `docs/MONOREPO.md` before adding packages or moving shared code.

## Development

Requires Bun 1.4.4, then `bun install`.

| Command | Purpose |
| --- | --- |
| `bun run dev` | Backend + frontend dev servers |
| `bun run dev:desktop` | Electron shell (build UI first, or set `VITE_DEV_SERVER_URL`) |
| `bun run dev:mobile` | Expo dev server |
| `bun run android:mobile` | Generate and run the Android dev app |
| `bun run typecheck` | Server, web, desktop, shared packages, root scripts |
| `bun run typecheck:native` | Mobile types |
| `bun run test:server` | Isolated backend tests |
| `bun run test:desktop` | Desktop API proxy tests |
| `bun run test:packages` | Shared-package tests |
| `bun run test:native` | Local-library + mobile logic tests |

Key docs: `docs/API.md` (auth, playback, download, HLS, subtitles, progress), `docs/PLAYBACK_PREPARATION.md` (remux/transcode, storage modes, replacement + Trash policy), `docs/MOBILE_LOCAL_LIBRARY.md` (offline catalog, TMDB/IntroDB caching, previews), `docs/native-playback.md`, `apps/mobile/README.md`.

## Build

| Command | Output |
| --- | --- |
| `bun run build:desktop` | Apple Silicon app, DMG + ZIP under `dist/mac` |
| `bun run build:server` | `dist/server/plexy-server` + `ffmpeg`, `migrations/`, `web/` |
| `bun run build:mobile` | ARM64 Android APK under `.build/native` |
| `bun run build` | All three (reuses one frontend build) |
| `bun run build:web` | Internal frontend build at `dist/web` |

Desktop packaging needs macOS; server builds target the host; Android builds need JDK 17 + Android SDK (`PLEXY_ANDROID_ARCHITECTURES`, `PLEXY_GRADLE_WORKERS` tune ABIs/workers). Icons are generated from SVG for desktop; mobile icon/splash stay checked in for Linux CI.

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

The workflow rebuilds only what changed (mobile / backend+desktop / desktop / all for shared contracts, lockfile, or workflow changes; docs-only builds nothing). Manual dispatch: `mobile`, `desktop`, `backend`, `all`. The frontend builds once and feeds backend + desktop jobs. Backend archives ship for Linux x64 and macOS ARM64; Android APKs use `versionCode = 50000 + build number`, preview APKs keep the repo test signature while EAS production uses release signing. macOS releases are ad-hoc signed — on first launch use **System Settings → Privacy & Security → Open Anyway**; the desktop updater verifies checksums before installing.
