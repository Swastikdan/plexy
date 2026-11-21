# Architecture

How Plexy's processes, data, auth, and playback fit together. For a file-by-file tour, see `CODEBASE_TOUR.md`. For the HTTP contract, see `API.md`.

## System overview

```text
┌─────────────┐     ┌──────────────────────────────┐     ┌────────────────┐
│ media       │     │        PLEXY SERVER          │     │  clients       │
│ folders     │     │  (Bun single process +       │     │                │
│             │     │   2 FFmpeg child workers)    │     │  web UI (SPA)  │
│ .mkv/.mp4/  │────▶│                              │────▶│  desktop shell │
│ .avi …      │     │  scanner → SQLite catalog    │     │  mpv window    │
└─────────────┘     │  TMDB matcher + hydration    │     │  LAN browser   │
                    │  optimizer (remux/transcode) │     └────────────────┘
                    │  trickplay generator         │
                    │  Elysia API + static web UI  │     ┌────────────────┐
                    │  pairing auth (Bearer/cookie)│     │  mobile (own   │
                    └──────────────────────────────┘     │  device DB,   │
                                                         │  no server)   │
                                                         └────────────────┘
```

- The **server** (`apps/server`) is one Bun process serving the API and the built web UI. CPU-heavy work (media probing, remux/transcode, trickplay) runs in two child worker processes (`--worker=media`, `--worker=optimize`) so HTTP stays responsive.
- The **web UI** (`apps/web`) is a static single-file build embedded into (and served by) the server. In development, Vite serves the web UI and proxies `/api/*` to the server.
- The **desktop app** (`apps/desktop`) is an Electron shell that either spawns the bundled server as a child (local mode) or proxies to a remote server (client mode).
- The **mobile app** (`apps/mobile`) is architecturally separate: its own on-device SQLite library, no network dependency on the server.

## Process model (server)

Boot order (`apps/server/src/main.ts`): crash handlers → migrations (`src/db.ts`, `src/migrations/`) → config (`src/config.ts`, `PLEXY_DATA_DIR/config.json`) → HTTP (`src/app.ts`) → background jobs (optimizer resume, unprobed-file scan, artwork/logo/certification/skip backfills).

| Process | Entry | Job |
| --- | --- | --- |
| Main | `src/main.ts` → `buildApp()` in `src/app.ts` | HTTP API, static UI, scheduled scans/backfills |
| Media worker | `src/media-worker.ts` via `src/worker-host.ts` | `ffprobe` analysis, subtitle extraction |
| Optimize worker | `src/optimize-worker.ts` via `src/optimize.ts` | Remux, audio/full transcode, trickplay sprites |

State lives in SQLite (`PLEXY_DATA_DIR`, see `src/paths.ts`). Prepared MP4s live either in the data dir (`optimizeStorage: "data"`, default) or beside media (`<folder>/.plexy/optimized`, always scanner-skipped). Config is a JSON file read/written atomically (`src/config.ts`); secrets never leave that module except to the TMDB client, and browsers only ever see `redactedView()`.

Two listeners exist when LAN is enabled (`bindAddress: "0.0.0.0"`): loopback cleartext HTTP on `PORT` (default `8765`) plus an HTTPS listener on `PORT+1` (`PLEXY_LAN_PORT`) with a generated LAN certificate (`src/lan-tls.ts`), advertised over mDNS (`src/discovery.ts`, Bonjour). Cleartext never leaves the machine.

## Auth model

1. First run: owner account is created in the local UI (`/setup`).
2. Owner creates a short-lived pairing code in device settings (`src/routes-auth.ts`).
3. Client sends `POST /api/auth/pair { code, name }` → receives a long-lived Bearer `token` + stable `serverId`.
4. API/artwork/subtitle/stream requests carry `Authorization: Bearer <token>`.
5. Browser `<video>` elements can't set headers, so browser playback uses an HttpOnly session cookie minted at login instead. Native tokens are never stored by the browser client.

Guards: `src/access.ts` (loopback-only admin routes), `src/auth.ts` (Bearer/session verification). Cross-origin browser access additionally requires an exact origin in `PLEXY_ALLOWED_ORIGINS` and a browser that accepts the server cert + cross-site cookie. Clients should pin `serverId` from `GET /api/server/status` after pairing and warn on mismatch.

## Playback pipeline

```text
GET /api/play/:fileId ──► manifest: path, resume, versions, chapters,
                          audio/subs tracks, trickplay URLs
        │
        ├─ direct play (browser-can-play) ──► GET /api/stream/:fileId (byte ranges)
        ├─ prepared MP4 (remux/audio/full) ──► optimizer queue ──► cache ──► stream
        ├─ subtitles ──► GET /api/subtitles/:fileId[/:track] (WebVTT; embedded + sidecar)
        ├─ scrub previews ──► trickplay VTT + JPEG sprites (src/trickplay.ts)
        ├─ skip ──► community intro/recap/credits markers (src/skip-segments.ts, opt-in)
        └─ progress ──► POST /api/progress
```

Key rules (see `API.md`, `PLAYBACK_PREPARATION.md`):

- The scanner queues every file that can't stream as-is; the optimizer works the queue one job at a time in a child process. Opening a title bumps its file to the front — it never starts the system.
- `GET /api/stream/:fileId/remux`, `/transcode`, and `/hls/:asset` return `409`. There is no live conversion, no HLS, no quality-capped `?maxHeight=` download. Playback is direct or prepared MP4 only.
- `replaceOriginal: true` (opt-in) promotes a verified prepared MP4 to library source (first video + first audio track only) and Trash-first deletes the original per `moveOriginalsToTrash`.
- Downloads (`GET /api/download/:fileId`) serve the existing source with `HEAD`/range support for native resume; the client owns storage and progress.

## Data model (SQLite)

Core tables (see `src/db.ts` + `src/migrations/`):

- `items` — movies, series, seasons, episodes (kind, parent links, match status, TMDB ids, flags: watchlist/favorite/hidden/rating).
- `media_files` — probed files (path, container, video/audio codecs, analysis status, preparation state).
- `artwork` — posters/backdrops/logos/stills per item (TMDB URLs + local cache state).
- `subtitles` / sidecar rows — embedded + external tracks surfaced as WebVTT.
- `watch_progress`, `history` — resume positions and watched entries per user.
- `collections`, `devices`/`tokens`, `skip_segments`, `tmdb_cache` — user collections, paired-device credentials, community markers, TMDB response cache.

Search runs on SQLite FTS5 with a `LIKE` fallback (`src/search-index.ts`). Matching is TMDB-first with a manual-override path (`src/matcher.ts`, `src/routes-matching.ts`, `src/hydrate.ts`).

## Desktop shell

Electron main (`apps/desktop/src/main/`) spawns the bundled `plexy-server` binary as a child in local mode and tears it down with the window (`PLEXY_DESKTOP` stdin-watch in `main.ts`). In remote mode the shell proxies API calls to the remote server without forwarding cookies/credentials across servers. The mpv window (`native-player`) streams the original over an authenticated loopback relay so desktop playback bypasses browser preparation. The updater verifies checksums before installing. The IPC surface is versioned once in `packages/desktop-bridge`; main, preload, and the web UI all import it.

## Mobile (separate device library)

`apps/mobile` never talks to the server. Storage Access folders → on-device `plexy-library.db` (`packages/local-library` owns indexing/metadata/skip contracts; `src/core/library` adapts them to Expo SQLite) → expo-video playback of original URIs. TMDB artwork/metadata and IntroDB skip markers are cached enrichments that work offline after first fetch. Import paths: `@/` for mobile `src`, workspace package names for shared code — never relative paths into another workspace, never `/api/...` network strings (they're in-process dispatch keys on mobile).
