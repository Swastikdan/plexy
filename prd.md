# Plexy: Personal Media Server (PRD)

Working title · Draft 0.2 · 22 October 2026 · Owner: Swastik

## 1. Summary

Plexy is a self-hosted media server that runs as a single Bun-compiled binary on the owner’s PC or laptop. It scans local movie and TV folders that follow standard Emby/Jellyfin naming, identifies each title against TMDB, probes media codecs during scanning, flags files that need conversion, and serves a web app (TanStack Router) for browsing, trailers and playback. For a file the browser cannot decode, Plexy converts it on demand on the server when the owner’s Mac can sustain playback. A separate admin area configures the server, libraries and the matching engine, and shows live logs.

**Goals**

- One executable, no installer, no Docker. On macOS, launch it directly or configure run-at-login.
- Point it at folders, and get a Netflix-style library with posters, backdrops, cast, trailers and watch progress.
- Accurate automatic matching, with a clear review queue for the titles it is unsure about.
- Everything the server does is logged. Every crash leaves a report that is enough to debug without reproducing it.
- Personal use on macOS first, with optional unauthenticated viewing from the owner’s trusted LAN.

**Non-goals for v1**

Music, photos, live TV/DVR, remote (WAN) access, guaranteed real-time transcoding of every 4K file, native mobile/TV apps, plugins, DRM content, multi-server federation. Software or hardware-assisted on-demand conversion for browser-incompatible files is in scope, subject to M0 performance limits.

## 2. Feasibility verdict

**Overall: feasible with a deliberately narrow v1.** M0 must prove macOS packaging and the actual playback path against representative files from the owner’s library. The first packaged build targets the owner’s Mac CPU architecture. Browser codec support, native media bindings, and transcoding determine playback coverage; the scanner, metadata workflow, and local web UI are lower risk.

| Area | Verdict | Notes |
| --- | --- | --- |
| Single binary with Bun | Yes | `bun build --compile` outputs one executable and can cross-compile for Windows, macOS and Linux. `bun:sqlite` and `Bun.serve` are built in. |
| Metadata extraction (duration, tracks, codecs, resolution, subtitle tracks, chapters) | Yes | Mediabunny reads MP4, MKV, WebM and more in pure TypeScript. No decoding needed. |
| Remux MKV to fragmented MP4 without re-encoding | Yes | Mediabunny’s conversion API can copy packets between containers. No decoder involved. |
| Server-side media decoding and encoding | Supported by the library; packaging needs proof | Mediabunny’s official `@mediabunny/server` extension supports Node, Bun, and Deno by registering FFmpeg-backed decoders/encoders. Node is not required solely because Bun lacks browser WebCodecs. **M0:** prove the native binding works in the target macOS build and that the single-executable packaging goal remains practical. |
| TMDB identification | Yes | Bearer read-access token, search + details + videos + credits + images. Rate limit is generous; the client still throttles and caches. Attribution is required in the UI. |
| Trailers | Yes | TMDB returns YouTube video keys. Play them with an embed (needs internet). Trailers are not downloaded. Local `-trailer` files are also supported. |
| Direct play | Partly | Browsers play MP4 (H.264/AAC) and WebM directly. Many MKV, HEVC, AC3 and DTS files do not play as-is. |
| On-demand video/audio conversion | Required fallback in v1 for detected browser-incompatible files | Native decoding/encoding exists in `@mediabunny/server`; M0 must verify packaging and representative 1080p/4K performance. Do not promise real-time 4K conversion unless measured. |
| TanStack Router + Query | Yes | Static single-page app served by the same binary. |
| Crash logging in dev and prod | Yes, with a caveat | JavaScript crashes are catchable. A native crash (segfault) in a media library kills the whole process and cannot be caught. Run native media work in a child process so the server survives and logs the exit code. |

**Recommendation:** keep Bun and Elysia unless M0 exposes a concrete incompatibility. Use Mediabunny plus `@mediabunny/server` for server-side decode/encode if its native binding works in the macOS package. Direct-play compatible files, remux container-only incompatibilities, and transcode unsupported audio/video on demand to a browser-compatible stream. Remuxing alone cannot fix an unsupported codec. Scan and display likely compatibility before playback, then confirm against the current browser’s capabilities. M0 must measure conversion speed on representative 1080p and 4K files and set a clear limit for files that cannot be converted in real time.

## 3. Users and primary jobs

- **Owner:** runs Plexy on a Mac, sets the TMDB token, adds folders, fixes bad matches, reads logs, and watches from that Mac or an optionally enabled device on the same LAN.

There is one owner and no accounts or profiles in v1. LAN mode allows unauthenticated browsing and playback on the trusted local network; it does not grant access to administrative actions. Playback progress is shared across devices.

Core jobs: “Show me what I own”, “Find something to watch”, “Resume where I stopped”, “Why was my movie matched wrongly?”.

## 4. Architecture

```
Browser: TanStack Router + Query (SPA)
   │  JSON API · SSE (progress, logs) · HTTP Range (video)
Plexy binary (Bun)
 ├─ HTTP server: API + embedded static UI
 ├─ Scanner → Parser → Matcher → TMDB client (cached)
 ├─ Media worker (child process): probe, supported remux, on-demand audio/video conversion, optional thumbnails
 ├─ SQLite (bun:sqlite)
 └─ Logger + crash reporter
```

| Concern | Choice |
| --- | --- |
| Runtime, package manager, bundler | Bun |
| Language | TypeScript, strict |
| HTTP framework | Elysia. Keep request and response schemas explicit and share types with the SPA where practical |
| Validation | Zod on every request and on TMDB responses |
| Database | SQLite via `bun:sqlite`, WAL mode, migrations as numbered SQL files |
| Media | `mediabunny` for probing; optional `@mediabunny/server` only if M0 passes |
| Frontend | Vite + React + TanStack Router (file-based, typed search params) + TanStack Query |
| Live updates | Server-Sent Events: scan progress, log tail, library changes |
| Config | JSON file in the OS app-data folder; secrets never sent to the browser |

## 5. Functional requirements

Priority: **M** must, **S** should, **C** could.

### 5.1 Server and configuration

- M: First-run setup wizard: first library and, in packaged use, TMDB token. Development may source `TMDB_TOKEN` from `.env`. No account creation in the single-owner v1.
- M: Settings for port (default 8765), bind address (default `127.0.0.1`, explicit opt-in for LAN viewing), data directory, log level, metadata language and region. Admin mutation APIs are loopback-only; LAN clients can use viewer/read APIs only.
- M: “Test TMDB token” button that calls TMDB’s configuration endpoint and shows success or the exact error.
- M: Start, stop and restart from the admin UI; graceful shutdown finishes in-flight writes.
- S: Run on login on macOS, using a LaunchAgent or clear generated instructions. Other operating systems follow after v1.
- C: LAN discovery through mDNS.

### 5.2 Libraries and scanning

- M: Library types: Movies, TV Shows. Each library has one or more root folders.
- M: Folder picker in the admin UI with path validation (exists, readable, not already covered by another library).
- M: Full scan on demand and incremental rescan using file size + modified time. Scheduled scans are S priority; the initial release can rely on a manual scan plus the file watcher.
- S: File watcher for add, rename and delete, debounced. Manual scan is the reliable recovery path if the watcher misses changes or a drive was offline.
- M: Supported containers: `.mkv .mp4 .m4v .webm .avi .mov .ts`. Ignore samples, `extras`, `featurettes`, `behind the scenes` folders as titles (they become extras).
- M: Missing files are marked unavailable, not deleted, for 30 days. A missing root folder or disconnected volume must never be interpreted as every file being deleted; scans report the root as unavailable and preserve its records.
- S: Per-library options: preferred metadata language, “prefer local artwork”, “ignore folders matching pattern”.

### 5.3 Naming conventions (Emby/Jellyfin compatible)

Movies:

```
Movies/Avatar (2009)/Avatar (2009).mkv
Movies/Avatar (2009)/Avatar (2009) [tmdbid-19995].mkv
Movies/Heat (1995)/Heat (1995) - 1080p.mkv
Movies/Heat (1995)/Heat (1995)-trailer.mp4
```

TV:

```
Shows/Severance (2022)/Season 01/Severance - S01E01 - Good News About Hell.mkv
Shows/Severance (2022)/Season 01/Severance - S01E01-E02.mkv
Shows/Severance (2022)/Season 00/Severance - S00E01.mkv
```

Rules:

- Explicit ID tags win: `[tmdbid-123]`, `[tmdbid=123]` and `{tmdb-123}` in a folder or file name skip searching entirely.
- Accept `S01E02`, `s1e2`, `1x02`, and multi-episode `S01E01-E02`. `Season 00` and `Specials` are specials.
- Sidecar files: `poster.jpg`, `backdrop.jpg`, `*.nfo` (read `<tmdbid>`), `.srt`/`.vtt` subtitles sharing the video’s base name.

### 5.4 Matching engine

Pipeline per file or folder:

1. **Classify** by library type and folder depth (movie folder, series folder, season folder, file).
2. **Parse** the name into `title`, `year`, `season`, `episode(s)`. Strip release noise: resolution, source, codecs, audio tags, release group, bracketed tags, dots and underscores.
3. **Shortcut** if an explicit TMDB id or NFO id exists. Verify it exists on TMDB, then stop.
4. **Search** TMDB: `search/movie` with `query` + `year`, or `search/tv` with `query` + `first_air_date_year`. If empty, retry without year, then with a simplified title (drop subtitle after a colon, strip articles).
5. **Score** every candidate from 0 to 1:
   - Title similarity against title, original title and aliases (Jaro-Winkler on normalised strings): 0.50
   - Year match: exact 0.20, off by one 0.10
   - Runtime match for movies only, using file duration against TMDB runtime (within 5%): 0.15; omit this component when runtime is unavailable or for episodes
   - Original language and country hints: 0.05
   - Popularity prior, used only to break close ties and never enough to auto-match by itself: 0.10
6. **Decide:** 0.85 or above is auto-matched; 0.60 to below 0.85 goes to review with up to three candidates; below 0.60 is unmatched. Explicit IDs still require type and existence validation. A score is a ranking signal, not a calibrated probability.
7. **TV:** match the series first (series folder), then resolve an episode by season and episode number. If TMDB has no matching episode, leave it unresolved for review. Air date or absolute order are not inferred automatically in v1.
8. **Persist** the match with `confidence`, `matched_by` (id-tag, nfo, search, manual) and a `locked` flag. Manual matches are locked and a rescan never overwrites them.
9. **Explain:** every decision stores a short reason (“Title 0.97, year exact, runtime within 2%”) shown in the admin UI.

Acceptance target: evaluate on a documented, manually labeled sample of up to 200 files from the owner’s library. Report coverage (auto-matched share), precision (correct auto-matches / all auto-matches), and review/unmatched counts. Do not claim 90% coverage as a release gate until the sample is labeled and measured; prioritize at least 98% precision among auto-matches. Any uncertain result goes to review.

### 5.5 TMDB metadata

- M: Fetch title and episode essentials: overview, release/air date, runtime where available, genres, rating, certification where available, cast, poster/backdrop, and trailer references. Tagline, logos, full crew, and external IDs are S priority; fetch them only where the relevant TMDB endpoint returns them.
- M: Image base URL and available sizes come from TMDB’s configuration endpoint, cached for 24 hours. Request the largest available source size (`original`) for retained originals.
- M: Cache TMDB responses in SQLite (7 days for details, 24 hours for search). Use a conservative configurable request throttle, honor `Retry-After`, and use bounded retry with backoff on 429 and transient 5xx responses. Do not retry indefinitely.
- M: Download selected artwork at TMDB’s largest available `original` size and retain that source file unchanged. Store it in Plexy’s app data directory (`~/Library/Application Support/Plexy/artwork/originals/` on macOS), never in a movie/series folder. Include posters, backdrops, logos, and other artwork actually selected for display; do not bulk-download every unused TMDB gallery image.
- M: Serve selected artwork from Plexy’s local app-managed store so repeat browsing works offline and does not depend on TMDB image URLs. First-time metadata and uncached artwork require internet access; show last successful refresh and an offline state.
- M: Generate appropriately sized display derivatives on demand under `~/Library/Application Support/Plexy/artwork/derived/` on macOS when useful, using `Bun.Image` for resize/re-encode. Keep the original as the archival source; derivatives must be reproducible and must not replace or downscale it. Prefer WebP when supported by the target runtime/browser and fall back to JPEG when an optional encoder is unavailable.
- M: Import preferred local sidecar artwork into the same app-managed store instead of writing to, moving, or modifying files in the media folders.
- M: Download to a temporary file, validate response type, size, and image dimensions, then atomically move it into the artwork store. Record failed downloads for retry without breaking the title page. Protect image processing with a pixel-count limit and clean up orphaned derivatives after replacement. Deduplicate identical originals by content hash.
- M: Required attribution in the UI footer and About page: “This product uses the TMDB API but is not endorsed or certified by TMDB.”
- M: “Fix match” on any unmatched or incorrectly matched item: search TMDB by title/year, show candidate identity and artwork, preview the selected result, and apply it as a locked manual match. Rescans never replace a locked manual match.
- S: Manual “Refresh metadata” per title or library.

### 5.6 Media analysis and thumbnails

- M: Probe each file with Mediabunny: container, duration, bitrate, video codec/profile/resolution/frame rate/HDR flag, audio tracks (codec, channels, language, default), subtitle tracks, chapters.
- M: Store source codec facts per file, including video/audio codec, profile, bit depth, resolution, channel layout, and subtitle type. After each scan, show likely direct-play, remux, or conversion-needed status from these facts; refine the result for the current browser before playback. Do not store one universal browser verdict.
- M: Before playback, compare those facts with the current browser’s reported capabilities and classify the path as `direct`, `remux`, `transcode`, or `unsupported`. Where browser capabilities are unavailable, use a conservative codec compatibility table.
- S: Episode thumbnails: one frame at about 10% of runtime, cached as JPEG (width 480), only if M0 proves a supported macOS extraction path. Artwork from TMDB remains the required poster fallback.
- S: Scrub previews (trickplay): one frame every 10 seconds into sprite sheets (160 px wide), shown while dragging the seek bar.
- S: Chapter thumbnails when chapters exist.
- Probing and frame work run in the media worker with a concurrency limit (default 2) and a per-file timeout (60 seconds).

### 5.7 Trailers

- M: Title page shows the best trailer (TMDB type Trailer, official first, then newest) in a modal player using a YouTube embed (`youtube-nocookie.com`).
- M: If offline or no trailer exists, hide the button instead of showing an error.
- S: Local `-trailer` file plays in the Plexy player.
- C: Muted backdrop trailer preview on the home hero after a short delay, off by default.

### 5.8 Playback

- M: HTTP Range streaming of the original file for `direct` items.
- M: On-the-fly remux when only the container is incompatible and the target browser supports the contained codecs. Verify seeking in M0.
- M: On-demand server conversion for detected unsupported audio and video codecs into a browser-compatible stream. Preserve the source file; never transcode in place. M0 selects and validates the streaming format and measures real-time performance. The conversion UI shows startup delay and whether the current source is playing in real time or slower than real time. Cache temporary segments with bounded disk use and clean them up after playback or expiry.
- M: If a file cannot be converted reliably or fast enough on the target Mac, explain that before playback and offer direct play only when supported; never silently claim it will play.
- M: Player: play/pause, seek, ±10 seconds, volume, speed, fullscreen, supported audio track selection, subtitle selection, “Next episode”, resume from saved position, keyboard shortcuts.
- M: Subtitles: sidecar SRT/VTT and embedded text tracks converted to WebVTT. Styled ASS is converted to plain text in v1.
- S: Skip intro/credits using chapter markers when present.
- C (v2): Image-based subtitles (PGS).
- M: One installation-wide watch state: position, played flag (90% rule), last-played time. Reported every 10 seconds and on pause or close.

### 5.9 Browsing and search

- M: Home rows: Continue watching, Next up, Recently added movies and shows. Genre rows are optional and may be omitted when metadata is unavailable.
- M: Library grid with sort (title, year, date added, rating), filter (genre, year, unwatched), and a compact codec/playback badge showing direct play or likely server conversion. Refine the badge using the current browser’s capabilities.
- M: Search titles. Cast and genre search are S priority and should ship only if indexing and result quality remain within the search latency target.
- S: Collections from TMDB (for example, a film series).

### 5.10 Access and watch state

- M: No user, account, PIN, or profile system in v1. Localhost can access the admin UI. When LAN viewing is explicitly enabled, non-loopback clients can browse and play media without a sign-in; watch progress is shared across the installation.
- M: All admin and configuration endpoints are loopback-only, including settings reads/writes, library management, manual matching, metadata refresh, scan controls, logs, crash reports, and restart. The only LAN state-changing endpoint is playback progress, which updates the one shared watch state. Enforce these rules on the server, not only by hiding UI controls.
- M: Bind to localhost by default. LAN mode binds to the selected interface and displays the device URL plus a persistent warning that anyone on the trusted LAN can view the library. No WAN access or router setup is supported.
- C (later): Profiles and per-profile watch state only if household use becomes a requirement.

## 6. Logging and crash reporting

**Logging**

- Structured JSON lines with timestamp, level, component (`scanner`, `matcher`, `tmdb`, `media`, `http`, `player`), message and context (file path, item id, duration).
- **Dev:** pretty console output at `debug` plus the same JSON file.
- **Prod:** JSON file only, default `info`, rotated at 10 MB, keep 5 files, plus a separate `crash/` folder that is never auto-rotated for 30 days.
- Location for v1: macOS `~/Library/Logs/Plexy`; later platform locations can follow OS conventions.
- Every HTTP request is logged with method, path, status and latency. Every TMDB call logs endpoint, status and cache hit or miss.
- The TMDB token and other secrets are redacted at the logger level. v1 has no account passwords or session cookies.
- Level can be changed at runtime from the admin UI without restart.

**Crash handling**

- Handlers for `uncaughtException` and `unhandledRejection` write `crash/crash-<timestamp>.json`, flush logs, then exit with a non-zero code.
- A crash report contains: stack trace, app version and build id, Bun version, OS and architecture, uptime, memory use, active job, last 200 log lines (ring buffer), and the current config with secrets removed.
- Build the binary with `--sourcemap` so production stack traces point at real source lines.
- Native crashes cannot be caught in-process. The media worker runs as a child process. The parent records exit code or signal, the file being processed, and marks that file as `analysis_failed` so it is not retried in a loop.
- Restart policy: a small supervisor loop (in the binary, `--supervise` flag) restarts after crashes with exponential backoff and stops after 5 crashes in 10 minutes, logging why.
- The localhost admin UI shows a banner “Plexy restarted after a crash” with a button to open or download the crash report.

## 7. Build and distribution

```
bun install
bun run dev            # bun --watch server + vite dev server (proxy /api)
bun run build:web      # vite build → dist/web
bun run build:server   # bun build --compile --minify --sourcemap src/server/main.ts --outfile dist/plexy
```

- Targets: macOS first (architecture selected at M0 from the owner’s machine), then Windows and Linux after the macOS package and playback path are stable.
- The built SPA is embedded in the executable. Runtime state, logs, cached artwork, and the database live in the app data directory, so “single executable” describes the app package, not a file with no writable storage.
- Embed version and git SHA at build time and print them on startup and in crash reports.
- Code signing and notarization are out of scope for the first personal-use build; document any macOS Gatekeeper steps needed to launch it. Revisit signing before public distribution.
- Dev and prod run the same code path. Only log level, log sinks and source maps differ.

## 8. Data model (SQLite)

| Table | Purpose |
| --- | --- |
| `libraries`, `library_paths` | Library name, type, language, root folders |
| `media_files` | Path, size, mtime, source probe facts, analysis status, conversion/cache state |
| `items` | Movie, series, season or episode; parent id; TMDB id; title; year; match info |
| `item_metadata` | Overview, tagline, runtime, rating, certification, genres |
| `people`, `item_people` | Cast and crew with role and order |
| `artwork` | Kind, provider path, original local path, dimensions, MIME type, byte size, content hash, fetch status, and optional derivative paths |
| `videos` | Trailer provider, key, name, type, official flag |
| `match_candidates` | Candidate TMDB ids, scores and reasons for review |
| `thumbnails` | Optional frame thumbnails and sprite sheet info, if supported by M0 |
| `scan_jobs` | Status, counts, errors, timestamps |
| `watch_state` | One shared playback position and played state per item |
| `tmdb_cache` | URL hash, body, expiry |
| `settings` | Server config key/values that are safe to store |

## 9. API surface (v1)

- `GET /api/server/status`, `POST /api/server/restart`, `GET/PUT /api/settings`, `POST /api/settings/tmdb/test` (settings, tests, and restart are loopback-only)
- `GET /api/local-folders?path=` (localhost-only server-side folder browsing), `GET/POST/PUT/DELETE /api/libraries`, `POST /api/libraries/:id/scan`, `GET /api/scans/:id/events` (SSE)
- `GET /api/items` (filters), `GET /api/items/:id`, `GET /api/search?q=`
- `GET /api/matches/review`, `POST /api/items/:id/match` (search, preview, and apply a locked manual TMDB match), `POST /api/items/:id/refresh`
- `GET /api/stream/:fileId` (direct Range), `GET /api/stream/:fileId/remux?start=`, `GET /api/stream/:fileId/transcode` (on-demand browser-compatible stream; transport chosen at M0), `GET /api/subtitles/:fileId/:track.vtt`
- `GET /api/images/:id` (serve app-managed original or an allowed display derivative by artwork id/size; never accept a filesystem path), `GET /api/thumbs/:fileId`, `GET /api/trickplay/:fileId/:n` (thumbnails/trickplay only when generated)
- `POST /api/progress` (LAN allowed for shared playback state), `GET /api/home`
- `GET /api/logs/stream` (SSE), `GET /api/logs?level=&component=`, `GET /api/crashes`, `GET /api/crashes/:id` (localhost-only because logs and crash reports can contain sensitive local details)

## 10. UI requirements

The UI is part of the v1 web app. These are acceptance requirements for required screens and states; optional rows and polish may follow after the core workflows work.

**Current prototype coverage (static review of `public/index.html` and `src/server.ts`, 22 October 2026):** the prototype is a local library setup/review screen, not yet the complete browsing and playback UI in this PRD. This status is informational; the requirements below define the intended v1.

| Area | Current prototype | Gap to v1 requirement |
| --- | --- | --- |
| Setup/configuration | Token field, language, typed folder paths, save/remove library controls | No guided first-run flow, token test action, or server-side folder browser |
| Scanning | Scan/reload actions, basic counts and scan status | Needs clearer per-library errors, recovery states, and compatibility results |
| Matching | Displays automatically returned candidates and can apply/change a selection | Needs an explicit TMDB search for any item, preview details/artwork, and durable locked manual-match behavior surfaced in UI |
| Browsing | Search/filter and a basic media list | No home rows, title detail screens, collections, continue-watching flow, or viewer navigation |
| Playback | No media player UI | Direct play, remux/conversion, subtitles, progress/resume, and phone playback remain to be built |
| Codec support | Shows some probed codec/resolution metadata | No per-browser compatibility classification or conversion status before playback |
| Mobile/accessibility | Admin layout has basic responsive CSS | Phone-oriented viewer/player, touch behavior, accessibility states, and systematic keyboard/screen-reader checks remain to be implemented |
| Branding | Prototype heading says “PlexyMedia” | Align visible product name with the working name “Plexy” |

### 10.1 First-run setup

- M: Show setup on first launch and provide a visible way to resume incomplete setup. Steps: verify or enter the TMDB token, test the connection, add the first movie/TV library paths, start the first scan, and show progress and errors.
- M: In development, use `TMDB_TOKEN` from `.env` without asking the developer to paste it again. In packaged use, accept the token in setup and never echo it after saving.
- M: Explain that the server scans paths on the Mac running Plexy. The folder chooser is a server-side path browser rooted at allowed locations, with a manual path field and validation; it must not imply that a browser file picker can select a path on the server.
- M: Provide clear states for missing/invalid token, TMDB offline, unreadable or missing folder, unsupported root, scan in progress, scan complete, and scan failure with retry guidance.

### 10.2 Home and library

- M: Hero for one featured title: backdrop, logo or title, one-line synopsis, Play and More info actions. Do not autoplay video/audio by default.
- M: Rows: Continue watching (with progress bars), Next up, Recently added movies and shows. Genre rows are optional when metadata supports them.
- M: Persistent navigation for libraries and search. Show the admin entry only on localhost; do not show a profile menu because v1 has no profiles.
- M: Empty library state has one call to action to add a library. Search has loading, no-results, and service-error states.
- M: Library grid supports sorting and filters from section 5.9, responsive poster sizing, and a compact compatibility badge showing direct play or likely server conversion. Refine the badge for the current browser when available.
- M: Show newly added/scanning state without blocking browsing of already scanned items. Keep horizontal rows keyboard operable and touch scrollable.

### 10.3 Title detail

- M: Movie: backdrop, poster, title, year, runtime, certification/rating/genres where available, overview, Play/Resume, Trailer, Mark watched, file info (resolution, codecs, audio, subtitles, size), and predicted play path for the current browser (direct, remux, server conversion, or unsupported).
- M: Show: same header, season selector, episode list with episode number, title, runtime, overview and progress. Show a predicted play path per episode; use episode thumbnails only if extraction is supported.
- M: Show cast when available. Provide “Fix match” on localhost for unmatched and incorrectly matched items.
- M: An unmatched item has an explicit “Not identified yet” state and a Fix match action. Missing metadata or artwork must not make the title inaccessible.

### 10.4 Player

- M: Full-screen-capable video with play/pause, seek, ±10 seconds, volume, speed, fullscreen, audio/subtitle selection, playback position and keyboard controls. Controls must also work with touch and must not depend on hover.
- M: Show direct/remux/server-conversion status and a plain-language reason. During conversion, show startup/loading state, whether playback is real-time, and a recoverable error if conversion stalls or fails.
- M: Keep resume progress, seeking and subtitle selection usable on phone-sized screens. Respect mobile safe areas and avoid placing essential controls under system browser chrome.
- S: Scrub preview thumbnail and chapter ticks when data is available; otherwise use a functional seek bar.
- M: Offer “Next episode” when a next episode exists; do not cover essential controls or interrupt playback without user action.

### 10.5 Admin

Admin UI is localhost-only. LAN clients receive the viewer UI without a sign-in; playback progress is saved to the shared watch state.

- M: Dashboard shows server status, uptime, version, scan state, matched/review/unmatched counts, likely conversion-needed count, and last crash banner.
- M: Libraries: list, add/edit paths, scan now, scan progress, errors, and per-library options. Warn before removing a library and explain the difference between removing a library and deleting its media (Plexy never deletes media).
- M: Matching: required review and manual-fix workflow with candidate cards, score/reason, TMDB details and artwork preview, search, apply, and lock. Show parsed fields on unmatched items. Include “Test a file name” without saving.
- M: Metadata: token status and test action, language, region, image quality, and cache controls. Never display the saved token value.
- M: Playback: detected formats, per-browser compatibility explanations, measured conversion limits, temporary-cache use, and worker concurrency.
- M: Logs and crash reports: filtered live tail, search, download, and open/download reports. This page and its APIs are localhost-only.
- M: About page shows version, build, and TMDB attribution.

### 10.6 Shared interaction and accessibility

- M: Every primary workflow has loading, success, empty, and failure states with clear recovery actions; destructive actions require a specific confirmation and explain the effect.
- M: Keyboard navigation, visible focus, accessible names for controls, captions/subtitle controls with labels, reduced-motion support, and WCAG AA contrast. Touch targets should be at least 44 CSS px where practical. Do not use color alone for playback compatibility or scan status.
- M: Responsive layout supports the owner’s Mac browser and phone browsers over LAN, including portrait and landscape playback. No separate native app is required.
- M: LAN pages must not expose admin actions, token/configuration data, logs, crash reports, or local filesystem paths.

### 10.7 UI preference questionnaire

Choose one option per question. Until answered, use the **default** shown below; these choices affect presentation, not the core feature scope.

| Question | Options | Default if unanswered |
| --- | --- | --- |
| Theme | System / dark / light | System |
| Home hero selection | Continue watching / recently added / deterministic featured title | Deterministic featured title; no autoplay |
| Library poster density | Comfortable / compact | Comfortable, responsive to screen width |
| Default audio and subtitle preference | Prefer browser/file default / prefer a selected language / ask each playback | Browser/file default, with in-player selectors |
| Folder path entry | Server-side folder browser / type paths only / both | Both, with server-side browsing limited to accessible locations |
| Other UI feature or screen you need | Free text | None assumed; add only after owner specifies it |

Owner answers can be recorded in section 14 and defaults updated before M2 UI implementation.

### 10.8 Phase 2: Sutro player UI and local streaming

**Goal:** replace only the player controls/theme inside the existing viewer shell and route. Preserve existing player state, props, and stream-selection logic. Do not rebuild the page layout or add cloud upload, Mux, or Next.js integration.

- P2: Use `MediaThemeSutro` from `player.style/sutro/react` as the theme wrapper, sized responsively to full width and a 16:9 aspect ratio. Set the theme’s primary/accent CSS variables to match Plexy’s visual tokens where needed.
- P2: Use `HlsVideo` from `hls-video-element/react` with `slot="media"` when the selected transcode response is an HLS manifest (`.m3u8`). For direct byte-range streams, remux streams, or non-HLS fMP4/WebM transcodes, use a standard `<video slot="media">` unless HlsVideo is verified to support that source mode correctly.
- P2: Set `playsInline` and `crossOrigin="anonymous"` on the media element. Serve streams and WebVTT from the same Plexy origin by default; if separate origins are ever used, configure narrowly scoped CORS headers for the Plexy UI origin.
- P2: Render each available subtitle as a standard `<track kind="subtitles">`, sourcing `/api/subtitles/:fileId/:track.vtt` and mapping its language, label, and default flag. The Sutro captions menu must discover and toggle those tracks.
- P2: Preserve selection among direct (`/api/stream/:fileId`), remux (`/api/stream/:fileId/remux?start=`), and transcode (`/api/stream/:fileId/transcode`) modes. Keep playback position and resume state in sync with the underlying media element via refs/events. For non-range sources, implement seeking using only the start-offset or manifest/segment behavior actually supported by the API; do not assume that appending `?start=` to an HLS manifest works.
- P2: Resolve React/TypeScript JSX typings for `MediaThemeSutro` and `HlsVideo` in the Vite/TanStack Router app without suppressing errors broadly.
- P2: Add `player.style` and `hls-video-element`; do not add Mux upload plugins, run `npx next-video init`, or add Next.js config wrappers such as `withNextVideo`.

**Package-manager decision before P2:** the supplied task specifies `pnpm add player.style hls-video-element`, while this repository currently uses Bun and `bun.lock`. Decide whether P2 migrates dependency management to pnpm (Bun remains the runtime) or adapts the command to Bun. Do not mix package managers or commit competing lockfiles. If pnpm is selected, use the requested `pnpm add player.style hls-video-element` and update setup documentation.

**P2 acceptance:** existing routes and page layout remain intact; direct, remux, HLS, and non-HLS transcode sources select the correct media element; seeking/resume works for each supported mode; WebVTT tracks appear in Sutro’s captions menu; player works inline on phone browsers; and the TypeScript build has no player-element typing errors. Unsupported endpoint behavior is shown clearly rather than silently switching to a different source.

## 11. Non-functional requirements

- Cold start to serving requests in under 2 seconds with a 10,000-item library.
- Home screen API under 150 ms and search under 100 ms on that library.
- Initial scan of 1,000 files (probe + match) in under 10 minutes on a typical laptop, limited by TMDB throttling and disk.
- Idle memory under 250 MB. Media worker memory capped and restarted if exceeded.
- Server never writes to or modifies media folders. Read-only access to media, read-write only to the data directory. Store artwork originals and derivatives in the OS app-data directory under a dedicated `artwork/originals/` and `artwork/derived/` folder; downloaded artwork must never be placed beside media files.
- Keyboard accessible UI, visible focus, reduced-motion respected, contrast at least WCAG AA.
- Security: bind to localhost by default. Optional LAN viewing is unauthenticated; allow browsing, playback, and shared playback-progress updates only. Enforce loopback-only admin APIs server-side. Validate Origin/Host for browser mutations, protect against CSRF, apply safe response headers, and never expose filesystem paths in public API responses. Resolve media through database ids and canonicalized paths constrained to configured roots.

## 12. Milestones

| Milestone | Scope | Done when |
| --- | --- | --- |
| M0 Spike | Run on macOS: compile and launch the Bun binary with `@mediabunny/server`; verify native binding and single-executable packaging; confirm the selected Bun version supports `Bun.Image` for the artwork inputs; probe representative MKV/MP4 files; test direct play, remux, and on-demand conversion in Safari, Chrome, and a mobile browser; benchmark representative 1080p and 4K files. | Package starts reliably; codec-to-playback matrix is documented; conversion throughput and a clear real-time limit are measured; output transport and fallback behavior are selected |
| M1 Core | Config, SQLite, logger and crash reporter, scanner, parser, TMDB client with cache, matcher, API | Labeled sample results report coverage and at least 98% precision among automatic matches; crash test produces a report |
| M2 Web app | First-run setup, responsive viewer shell, home, library, title detail, search, localhost admin libraries, matching review, and logs | All M-priority non-player screens and flows in section 10 work against real data on desktop and phone-sized viewports; S/C items may follow later |
| M3 Playback | Direct play, supported remux paths, on-demand audio/video conversion, subtitles, shared watch state, next episode | Playback matrix verifies direct/remux/transcode/unsupported paths on representative MP4, MKV, and WebM files, including conversion failure and cleanup |
| M4 Polish | Artwork original/derivative pipeline, optional thumbnails/trickplay, trailers, chapters, file watcher, crash recovery, macOS packaging | Selected full-resolution artwork is stored under app data, survives restart/offline use, derivatives serve at display sizes, no media folder is modified, and worker recovery succeeds on the target Mac |
| P2 Player integration | Replace player controls with the Sutro theme and wire direct, remux, HLS/non-HLS transcode, and WebVTT subtitle sources into the existing routes | P2 acceptance criteria in section 10.8 pass without rebuilding the viewer shell or adding cloud/Next.js integrations |

## 13. Risks

| Risk | Impact | Mitigation |
| --- | --- | --- |
| Native FFmpeg bindings do not load inside the compiled binary | Server-side conversion may not fit the single-executable goal | M0; first try the documented Bun integration, then test a Node-based packaged runtime or bundled FFmpeg fallback before reducing conversion scope |
| Browser codec support varies by browser and device (HEVC, AV1, AC3, DTS) | Some files need conversion or cannot play in real time | Probe codec facts during scan, check current browser capability before playback, convert on demand, disclose measured 4K limits, and explain unsupported cases |
| Messy file names cause wrong matches | Wrong posters and metadata | Confidence thresholds, review queue, runtime check, locked manual matches |
| TMDB outage or rate limiting | Missing metadata | Cache, retry with backoff, show last known data |
| Large libraries slow the first scan | Poor first impression | Incremental scan, concurrency limits, progress UI, run work in the worker |
| Full-resolution artwork increases app-data usage | Extra storage use and slower first-time setup | Download only selected artwork, deduplicate by content hash, show artwork storage usage, keep display derivatives regenerable, and report per-image download failures |
| Native crash in media worker | Server instability | Child process isolation, failed-file quarantine, crash report |

## 14. Decisions and remaining questions

Decisions supplied by the owner:

- **Primary OS:** macOS. M1 and the first packaged build target macOS. Add a macOS LaunchAgent or clear run-at-login instructions; Windows and Linux follow after the macOS path works.
- **Library:** approximately 100–200 GB, mixed movies and TV, mostly MKV, mostly 1080p with some files up to 4K. Detect browser compatibility before playback and use on-demand server conversion for unsupported codecs. M0 measures which files can be converted in real time on the owner’s Mac.
- **Audience and network:** one owner. Default to localhost. Optional LAN viewing is unauthenticated for devices on the owner’s trusted network, with browsing, playback, and shared progress updates only. Admin routes stay localhost-only. No profiles, password, or WAN access in v1.
- **HTTP framework:** Elysia.
- **Product name:** Plexy (working name). Check name availability before public distribution; no clearance is implied here.
- **TMDB token:** during development, load the raw TMDB read-access token from `TMDB_TOKEN` in a local `.env` file; send it to TMDB as `Authorization: Bearer <token>`. Ignore `.env` in Git and provide only a placeholder in `.env.example`. In packaged use, enter the token in first-run setup. Store it in the macOS Keychain if practical, otherwise in a private config file readable only by the owner. Never return it to the browser or include it in logs/crash reports. `.env` is not required in production; packaged token settings take precedence over environment variables.

Remaining Phase 2 prerequisite: the existing viewer shell, TanStack Router route, player component state/props, and final transcode transport from M0 must be available before swapping the player controls. The current prototype audit shows the player UI is not built yet, so Phase 2 begins only after that prerequisite is delivered.

Remaining M0 decision: confirm the owner’s Mac CPU architecture and build that architecture first. Add the other macOS architecture only if needed. M0 also records which codecs play directly, which can be remuxed, which can be converted in real time, and which remain unsupported or exceed the measured real-time limit.
