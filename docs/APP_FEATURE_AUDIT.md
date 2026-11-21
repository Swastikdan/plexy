# Plexy Feature Audit — Implemented, Improvable, Adjacent

Audit date: **20 November 2026** · Status update: **21 November 2026**
Scope: `apps/server`, `apps/web`, `apps/desktop`, `apps/mobile`, `packages/*`
Companion document: [`MEDIA_SERVER_FEATURE_RESEARCH.md`](./MEDIA_SERVER_FEATURE_RESEARCH.md) (382 competitor features)

## 0. Method and confidence

This is a **code audit**, not a runtime QA pass. I read the route modules, database schema/migrations, scanner,
matcher, hydration, playback/optimizer, all web routes, the desktop main process, and the mobile feature tree.
"Implemented" below means the behavior exists in code and is wired to at least one client surface. "Partial"
means the data model or one client has it, but another required piece is missing. "Missing" means no
implementation was found.

The README and `docs/API.md` are treated as **claims to verify**, not as truth. Several claims no longer match
the code (see §8).

Confidence: high for route/feature presence; medium for UX quality; low for performance and reliability without
running a large library.

## Implementation progress — 20–21 Nov 2026

Landed in this pass:

- **Certifications fixed:** TMDB `release_dates`/`content_ratings` are fetched, regional values are stored, a
  startup + admin backfill exists, and parental controls now have real ratings to filter.
- **Anime inconsistency removed from the server:** the API/UI now advertise only Movies/TV; local anime roots
  remain a mobile-only feature.
- **Docs corrected:** README/API no longer claim HLS, `maxHeight` generated downloads, live remux/transcode,
  or the 2-transcode limit. The desktop audit points at this document for current status.
- **New users get the current libraries** by default; the admin can narrow access in the same dialog.
- **Web library:** server-side pagination + Load More, unwatched filter, and the existing genre cards now use
  server-filterable data.
- **Search:** FTS5 index with bm25 ranking, prefix matching, parent-series/episode matching, people results,
  genre matching, unmatched-title matching, pagination, web People cards, and truthful “people” copy.
- **Per-user flags:** watchlist, favorites, hidden titles, and 1–5 star ratings are now server-backed with
  home rows, title/hero controls, `/list/watchlist`, `/list/favorites`, and `/list/hidden`.
- **Collections:** server tables/API, a `/collections` page, create/delete/remove, and an Add to collection
  picker on every movie/series title page.
- **Similar titles:** local affinity from shared genres/cast with a “More like this” shelf.
- **Chapters + versions:** chapters are returned in the play manifest and exposed in the player menu; multiple
  file versions can be switched without leaving playback.
- **Subtitle search/download:** server-side OpenSubtitles proxy, saved VTT tracks in track discovery, and a
  title-page “Find subtitles” modal.
- **More videos:** all TMDB trailers/teasers/featurettes/clips are stored and exposed as a “More videos”
  section, not just one trailer.
- **Download original:** a first-class action on the title page.
- **Watch history:** `/history` lists every movie and episode the account has started, with per-entry removal and
  a “Clear history” action; episode cards now carry their series name everywhere.
- **Multi-episode files:** a file named `S01E01-E02` now creates both episode items; the later episode resolves
  the shared file for detail, next-up, and playback.
- **Mobile Next Up:** the row is restored and taps start playback directly.
- **Active sessions dashboard:** live playback per user/device, progress, stop requests, and device
  revoke/remove from Server Settings. Stopping pauses the browser and native players on their next heartbeat.
- **Per-library metadata language:** the library wizard/editor sets it; matching, hydration, logos, and
  episode names use it, with a background refresh when changed.
- **Scrub thumbnail pre-generation:** Server Settings shows coverage and can queue every missing or failed
  trickplay strip.
- **Mobile watchlist & search:** a local watchlist page and home row, plus local search across parent series
  names.
- **Connection resilience:** faster mDNS discovery with reachability/latency, retrying probes, smarter API
  retry/health thresholds, and direct remote native playback with a local-proxy fallback.

Still open from the audit (next passes): local `Extras/` folder indexing/UI, artwork picker,
theme music, local intro detection/manual marker editor, backup/restore, activity stats, mobile Plexy-server
mode + downloads, desktop 10-foot mode, hardware transcoding/HDR tone mapping, HLS/ABR, playlists, and the
music/photos/books/Live TV product surfaces.

---

## 1. Snapshot

| Area | State | What already works | Main limiting factor |
| --- | --- | --- | --- |
| Library & scanning | **Good** | Movies/TV, multiple roots, incremental + periodic scans, path parsing, NFO ID, local sidecar art, missing-file cleanup, Trash deletion, multi-version and multi-episode files | Only movies/TV; no music/photos/books/live TV; no per-library scan options |
| Metadata & artwork | **Partial** | TMDB title/overview/genres/rating/tagline, regional certifications, posters/backdrops/logos, 12 cast + 3 crew, all TMDB videos, episode names/stills, manual match + review queue | No artwork picker/upload, NFO metadata, local extras, crew UI, theme media, or local metadata editing |
| Browse & discovery | **Good** | Home hero + shelves, library grid with server pages/filters, title/season/episode pages, cast pages, FTS search with people/genres, similar shelf, watch history, continue/next, offline cache | No per-user recommendation rows or playlists; collection pages are manual |
| Playback | **Strong for prepared MP4** | Direct/remux/transcode preparation, audio variants, trickplay, skip markers, next episode, resume, chapter/version menus, rich web/mobile/mpv players | No HLS/ABR, no hardware transcoding outside macOS, no tone mapping, no quality ladder beyond file versions |
| Subtitles | **Good** | Embedded + sidecar SRT/VTT/ASS extracted to WebVTT, sync, position, server-side OpenSubtitles search/download, mobile SRT/VTT import | PGS/VobSub skipped, no burn-in, no per-user caption styling |
| Collections & watch state | **Good foundation** | Server-backed watchlist/favorites/hidden/ratings, collections, per-user resume/played state, continue watching, next up, mobile custom collections + TMDB collection tab | No playlists/smart collections; no watch-event history; mobile custom collections remain device-local |
| Users & access | **Good foundation** | Multi-user accounts, admin/user roles, per-library/folder/item allow/deny rules, maturity limit, block unrated, avatars, devices, pairing codes; certifications now hydrate correctly | No sessions/remote control, concurrent limits, schedules, 2FA, or invite links |
| Admin & ops | **Partial** | Settings, library CRUD, SSE scan progress, match queue, user admin, logs + live follow, crashes, Electron system usage, optimizer control, TMDB cache | No active-session dashboard, playback stats, backup/restore, scheduled-task UI, notifications/webhooks, plugins, per-library settings |
| Mobile | **Strong for local-first** | On-device scan/catalog, offline playback, TMDB metadata, local chapters, subtitle import/search, gestures, sleep timer, cast, family PIN, hidden titles, custom collections, episode calendar, online TMDB/Vidy catalog, saved online titles, in-app updates | No Plexy-server mode, no Next Up row, no watchlist page, no profiles, no server downloads |
| Desktop | **Strong shell** | Local server toggle, remote server proxy, mDNS discovery, cert trust, native mpv original playback, updater with checksum, menus, folder picker | macOS-only native player/build; no 10-foot mode, downloads, watchlist/collections, tray/media keys |
| Documentation | **Corrected** | README/API now describe prepared MP4 only; desktop audit points at this document | Keep docs in sync as the remaining backlog lands |

**One-line verdict:** Plexy is a **playback-first media server with an unusually strong offline mobile app**.
The weakest layers are the shared catalog/social layer (collections, watchlist, ratings, history) and the
administrative trust layer (sessions, stats, backups), not the transcoding pipeline.

---

## 2. What is implemented

### 2.1 Library, scanning, files

- **Movies and TV libraries** with multiple root folders per library (`apps/server/src/routes-admin.ts`,
  `migrations/001_init.sql`). Library types are `movies`, `tv`, `anime` in the API, but the DB CHECK only allows
  `movies`/`tv` and the web wizard only offers Movies/TV — see §8.
- **Incremental scanning** keyed on size + mtime, with a scheduled pass every 15 minutes and an initial delay
  (`apps/server/src/scan.ts:126-166`).
- **Parallel probing** through a worker pool (`createProbePool`), with FFmpeg/ffprobe facts stored in
  `media_files` (`media-facts.ts`).
- **Filename parsing** for `S01E02`, `1x02`, `E05`, absolute numbers, anime groups, years, release noise,
  explicit `[tmdbid-...]` tags (`apps/server/src/parse.ts`).
- **NFO support is partial:** only the TMDB ID is read from the first NFO in a folder
  (`scan.ts:52-77`); NFO titles/plots/artwork are not imported and nothing is written back.
- **Local sidecar artwork** (`poster.jpg`, `folder.jpg`, `fanart.jpg`, `logo.png`, season posters) is attached
  when TMDB art is missing (`scan.ts:82-127`).
- **Missing-file cleanup** only after a complete, issue-free walk, so an unmounted NAS does not erase the
  library (`scan.ts:286-305`).
- **Title deletion** verifies size/mtime, sends originals to Trash by default, and removes catalog rows
  (`routes-catalog.ts:577-627`, `trash.ts`).
- **Multi-version files** in one movie folder become one item with several `media_files` rows; the play
  manifest returns a `versions` array (`routes-media.ts:374-392`).
- **Multi-episode ranges** are detected (`S01E01-E02`) and stored as an `episode_range` tag, but only the first
  episode gets an item; the range is not expanded (`scan.ts:579-584`, `ensureEpisode`).
- **Extras folders are skipped** by the scanner (`scan.ts:356`), so behind-the-scenes/deleted scenes are not
  indexed.
- **Chapters are probed and stored** in `media_files.chapters_json`, but the server never returns them in the
  play manifest and no client shows a chapter menu (mobile parses chapters locally).
- **Trickplay** is generated lazily on first play, 10–15s intervals, 160×90 sprites, with a VTT track
  (`trickplay.ts`).
- **Community skip markers** (intro/recap/credits) are fetched from IntroDB, cached in `skip_segments`, and
  served only when enabled (`skip-segments.ts`).
- **Prepared playback copies** (remux/transcode) are queued by the optimizer, can live in app data or beside
  media, can replace the original, and use Trash-first deletion (`optimize.ts`, `optimize-worker.ts`).
- **Hardware encoding is macOS-only** (`h264_videotoolbox` in `optimize-worker.ts:162-196`); there is no
  QSV/NVENC/VAAPI/AMF path and no tone mapping.

### 2.2 Metadata and artwork

- **TMDB matching** with explicit-ID shortcut, Jaro-Winkler title/year scoring, runtime refinement,
  auto-match/review/unmatched thresholds (`matcher.ts`).
- **Manual match** and **review queue** with candidates, confidence, matched-by, and lock-on-manual-match
  (`routes-matching.ts`, `MatchersPanel` in web).
- **Core metadata**: overview, tagline, runtime, TMDB rating, genres, poster/backdrop, logo, trailer, cast (12),
  director/creator/screenplay crew (3), episode names/overviews/runtimes/ratings/stills (`hydrate.ts`).
- **Person pages** with photo and every locally available title the person appears in (`routes-catalog.ts:541-569`).
- **Artwork proxying/caching** with resized derivatives (`routes-media.ts:606+`, `artwork.ts`), so images work
  offline after first fetch.
- **Metadata refresh** per item and during scan (`routes-matching.ts:254+`, `hydrate.ts`).
- **Certifications are not hydrated** — `hydrateItemMetadata` writes `null` and the TMDB detail call does not
  request `release_dates`/`content_ratings` (`hydrate.ts:23-31`, `tmdb.ts:373-380`). This is a real bug.
- **No artwork selection/upload/crop**, no alternative posters/backdrops, no banner/disc/clearart, no field
  locks, no full metadata editor.
- **Only one trailer** is stored/returned (`videos` table has type columns, but only the best trailer is
  written); no extras.

### 2.3 Browsing, home, search

- **Home**: deterministic best-rated movie hero, Continue Watching, Next Up, Recently Added Movies, Recently
  Added Shows (`routes-catalog.ts:336-392`). The web hero also includes recent movies/shows; mobile uses a
  5-item carousel.
- **Library grid** with All/Movies/TV tabs and sort by Name, Recently Added, Year, Rating
  (`web/routes/library/$kind.tsx`).
- **Title page** with logo/backdrop, rating, overview, play/resume, trailer, watchlist/favorite flags, mark
  watched, clear progress, fix match, refresh metadata, delete, seasons, episodes, cast, technical file info
  (`web/routes/title/$itemId.tsx`).
- **Person page** with photo and local filmography.
- **Search** over local titles and episodes, split into sections, debounced 250ms, with offline fallback
  (`web/routes/search.tsx`, `routes-catalog.ts:636-691`).
- **Offline catalog cache** in IndexedDB + Cache Storage + service worker, so the catalog, title pages, cast
  pages, and artwork render when the internet is down (server still reachable) (`web/lib/library-cache.ts`,
  `asset-prefetch.ts`, `app-shell-sw.ts`).
- **No pagination**: the web library always requests `limit: 200`; the server supports `limit`/`offset` but the
  UI does not use it (`web/queries.ts:85`, `routes-catalog.ts:394-424`).
- **No web filters** beyond kind/sort, although the server accepts `year`, `q`, and `unwatched`.
- **Search is `LIKE`**, not fuzzy, and only searches matched items. `score DESC` is the TMDB match score, not a
  relevance rank. People are not searched even though the header placeholder says "Search titles, people,
  episodes" (`routes-catalog.ts:646-663`, `web/components/topnav.tsx:235`).
- **No similar titles, recommendations, collections, playlists, watchlist page, ratings, or history page** on
  web.
- **Home rows are fixed**; no "Because you watched", genre rows, watchlist row, recently played, or per-user
  row customization.
- **Watchlist/favorite are `localStorage` flags** on the web hero/title page; they are not server state, not
  listed anywhere, and not shared across devices (`use-stored-flag.ts`, `title/$itemId.tsx:180-181`).

### 2.4 Playback

- **Classification**: direct / remux / transcode / unsupported based on probed facts + browser caps
  (`playback.ts`).
- **Prepared copies** are created before playback; opening a title preempts the queue; direct play is preferred.
- **Audio track variants**: selecting a non-default audio track creates a per-track prepared copy
  (`routes-media.ts:324-365`, `optimize.ts`), with a clear "preparing" state.
- **Subtitle tracks**: embedded text + sidecars extracted to WebVTT, cached on disk (`subtitles.ts`).
- **Resume and progress**: per-user `watch_state`, monotonic played state, progress reporting every 10s and on
  pause/leave (`routes-catalog.ts:693-780`, `web/routes/watch`).
- **Next episode**: server computes the next available file and returns title/poster; web/mobile/native show a
  next prompt.
- **Skip markers**: web/mobile/native show a skip button and auto-skip after repeated manual skips.
- **Trickplay** scrub previews on the web seek bar.
- **Web player**: Video.js 10 + custom skin, play/pause, ±10s, volume, mute, fullscreen, PiP, AirPlay, cast,
  settings menu (quality, audio, speed, captions, subtitle sync/position), keyboard shortcuts, double-tap seek,
  buffering/error states, stats-for-nerds overlay, context menu for native playback (`videojs/*`,
  `watch/$fileId.tsx`).
- **Native mpv player** on desktop: original file over authenticated loopback relay, audio/subtitle tracks,
  speed, volume, seek, skip markers, next episode, progress sync, F-key fullscreen
  (`native-player.ts`, `native-watch.tsx`).
- **Mobile player**: local original playback, audio/subtitle tracks, speed panel, sleep timer, skip markers,
  next-episode countdown, resume prompt, PiP, cast, screen lock, gestures (double-tap seek, brightness/volume,
  pinch zoom, fit modes), subtitle timing/size/position, OpenSubtitles search + SRT/VTT import
  (`features/player/*`).
- **No HLS/ABR** despite README/API claims; the server never emits `hls`, and live `/remux`/`/transcode` routes
  return `409` (`playback.ts:11-13`, `routes-media.ts:586-604`).
- **No quality selector semantics**: the `QualityMenu` exists, but prepared MP4 has no variants; `versions` is
  returned and ignored by the web player.
- **No chapter menu**: chapters are stored but not exposed by the server.
- **No sleep timer / still-watching / pass-out protection on web or desktop**; mobile has a sleep timer.
- **No remote control / SyncPlay / watch-together**; no session model exists.
- **No hardware transcoding except macOS VideoToolbox**, no tone mapping, no AV1 encode.
- **Download original** is now a title-page action; there is still no download queue, offline library, or
  `maxHeight` generated download.

### 2.5 Subtitles

- Embedded text subtitle extraction (SRT/ASS/SSA/mov_text/WebVTT/TTML) into cached WebVTT, including Matroska
  packet parsing (`mkv-subtitles.ts`, `subtitles.ts`).
- Sidecar `.srt`/`.vtt` discovery with language suffixes and per-episode matching (`subtitles.ts:370-440`).
- Subtitle sync (±0.1/±0.5s), vertical position, caption track menu, default language preference.
- Mobile OpenSubtitles search via the Stremio OpenSubtitles endpoint, filtered by language, downloaded and
  imported into the local library (`mobile/features/player/lib/subtitle-search.ts`).
- **Image subtitles (PGS/VobSub) are deliberately skipped** (`subtitles.ts:207-215`, `isTextSubtitle`), and there
  is no burn-in path.
- **No subtitle search on web or server**; mobile-only.
- **No per-user caption size/color/background**; web only has offset/position.
- **No subtitle upload/edit/delete** on web; mobile can import a local file.

### 2.6 Users, auth, access

- Owner setup with Argon2id, username/password validation, first-run wizard (`accounts.ts`, `setup.tsx`).
- Password change, avatar upload, profile display.
- Device pairing codes, Bearer tokens for native clients, HttpOnly session cookies for browsers (`auth.ts`).
- Device list, revoke, delete; admin can list all devices (`routes-auth.ts:206-253`).
- Multi-user accounts with roles, disable, maturity limit (`maxAge`), block-unrated.
- Per-library, per-folder, per-item allow/deny rules with deny-overrides semantics (`access_rules`,
  `access.ts`).
- Access enforcement on viewer routes, media files, images, people, subtitles, and streams (`accessGuard`).
- **Parental controls are undermined by the certification bug**: `maxAge` with `blockUnrated` sees everything
  as unrated and blocks non-container items. New users default to `block_unrated = 1`.
- **No active sessions**, remote control, concurrent-stream limits, access schedules, time limits, 2FA, LDAP,
  OIDC, invites, or password reset.
- **New users are created with no access rules**, so they see nothing until the admin explicitly grants a
  library/folder/title.

### 2.7 Admin and operations

- Server status: version, uptime, bind address, LAN URLs, restart-required, scan state, recent scans, optimizer
  state, setup state (`routes-admin.ts:96-139`).
- Settings: metadata language/region, image size, audio language, log level, LAN bind, auto-optimize, skip
  markers, optimizer cache size/storage, replace-original, Trash, probe concurrency, TMDB token, prefetch
  limits (`routes-admin.ts:140-204`).
- Libraries: list with counts, create/update/delete, folder browser, scan one/all, SSE progress
  (`routes-admin.ts:348-553`).
- Match review queue: filters, search, candidates, preview, apply, refresh (`routes-matching.ts`).
- Users: list/create/edit/disable, maturity, access rules (`routes-auth.ts:310-414`).
- Logs: filter by level/component/search, tail, live SSE stream; crash list/detail (`routes-logs.ts`).
- Diagnostics: playback error/rebuffer events, opt-in consent, server keeps latest 100 in memory
  (`routes-diagnostics.ts`).
- Optimizer: status, queue, cancel, resume, clear cache, manual run (`routes-admin.ts:275-310`).
- Artwork cache: storage stats, cache-all endpoint.
- Database reset: clears catalog/watch/matches/scans/TMDB cache/art, keeps libraries and originals.
- Desktop: system usage graph, update check/download/install with checksum, logs/data directory shortcuts.
- **No active-session dashboard**, playback reporting, activity table, scheduled-task UI, backup/restore,
  notifications, webhooks, plugins, metrics, or per-library settings.

### 2.8 Web and desktop

- Web: responsive shell, desktop top nav with ⌘K search, mobile bottom nav, server gate/pairing, setup wizard,
  settings dashboard, offline library cache, PWA service worker, artwork prefetch, connection health.
- Desktop: Electron shell, local server toggle, remote server proxy, mDNS discovery, certificate trust,
  native folder picker, native mpv player, updater, single-instance lock, macOS traffic-light-aware chrome,
  fullscreen.
- **Desktop packaging is macOS ARM64 only** (`scripts/build-desktop.ts`, `electron-builder.json`); Windows/Linux
  builds are not produced, and native playback is `darwin`-only.
- **No TV/HTPC mode, tray, mini-player, global media keys, drag-and-drop import, or multi-window.**

### 2.9 Mobile

- **Three modes**: Local only, Hybrid, Fully online (`core/client/watching-mode.ts`).
- **Local library**: SAF folder scanning, on-device SQLite (`plexy-library.db`), filename parsing, TMDB
  metadata/artwork caching, local chapters (MP4 `chpl`, MKV), local subtitle import.
- **Offline playback** of local originals with expo-video; no server needed.
- **Online catalog**: TMDB home/search/detail/recommendations/collections, family certification filtering,
  SQLite cache, Vidy iframe playback, saved online titles, remote progress.
- **Family mode**: four levels, region-specific certificates, unrated blocking, 4-digit PIN hashed on device.
- **Hidden titles**, **custom collections** (AsyncStorage), **episode calendar**, **library report/identify**,
  **storage review**, **app updates** (OTA/APK), **open a video**/import, **external player handoff**.
- **Player**: resume prompt, audio/subtitle menus, per-show language memory, subtitle search/import, timing,
  size, position, speed, sleep timer, skip markers, next countdown, PiP, cast, screen lock, gestures, fit modes.
- **No Plexy server mode** — mobile is not a client for a Plexy server; its "remote" source is TMDB + Vidy.
- **Next Up is restored** on the mobile home screen and plays the next episode directly.
- **Watchlist exists only as a title flag** on mobile (`setWatchlist` on the local catalog) and is not browsable;
  the web/server watchlist is a separate per-user surface.
- **Online "saved" titles are bookmarks, not downloads** (`remote-state.ts` stores metadata only).
- **Custom collections live in AsyncStorage**, not SQLite, and are not exportable/synced.

---

## 3. Implemented but can be made better

> **Status note:** the “Original baseline” lines below are kept for context. See §3.0 for the
> current implemented/partial/missing status as of 21 Nov 2026; the “Better” lists remain the roadmap.

This is the core of the audit: the gap between "the code works" and "this is competitive".

### 3.0 Current status (21 Nov 2026)

| Area | Implemented | Remaining |
| --- | --- | --- |
| Search | FTS5 titles/episodes/people/genres, prefix matching, unmatched titles, pagination, bm25 ranking, web People cards | Typo/fuzzy fallback, filters inside search, recent searches, shared search core with mobile |
| Library browse | Server filters + pagination + Load More, unwatched, genre/year/rating/runtime/user-rating filters | Saved views, resolution/HDR/audio-language facets, mobile server filtering |
| Home | Continue, Next Up, Watchlist, Favorites, Recently Added, hero playback | Personalized “Because you watched”, row order/visibility, collections row, upcoming row |
| Flags & history | Server watchlist/favorites/hidden/ratings, list pages, `/history`, clear/remove | True `watch_events` timeline (start/pause/finish/device), bulk actions |
| Collections | Manual collections, picker, page, add/remove/delete | **Playlists**, smart rule-based collections, artwork/description/sort order, Play all/shuffle, M3U |
| Similar | Local genre/cast affinity shelf | Blend with TMDB recommendations, keywords/director, per-user affinity |
| Metadata | Regional certifications + backfill, all TMDB videos, episode stills, manual match, per-library metadata language | Artwork picker/upload, NFO read/write, field locks, full crew UI, theme music |
| Playback | Prepared MP4/audio variants, chapters, versions menu, trickplay pre-generation, skip markers, next episode | HLS/ABR, hardware encode outside macOS, HDR→SDR tone mapping, PGS burn-in, per-title quality cap |
| Subtitles | Embedded/sidecar/downloaded VTT, server OpenSubtitles search/download, web modal | Caption styling, upload/edit/delete, image-subtitle burn-in, auto-download tasks |
| Extras | All TMDB trailers/teasers/featurettes/clips in “More videos” | Local `Extras/` folder indexing and playback |
| Sessions/admin | Active session list, stop requests, device revoke/remove, scan SSE, match queue, logs/crashes, optimizer | Playback stats, activity log, backup/restore, scheduled tasks, webhooks |
| Mobile | Local-first scan/play, Next Up, watchlist page + row, parent-series search, local chapters/subtitles, family PIN, hidden titles | Plexy-server mode, server downloads, sync collections |
| Desktop | Server toggle, remote proxy, improved mDNS discovery, native mpv (direct remote with proxy fallback), updater | 10-foot mode, tray/mini-player/media keys, Windows/Linux native player |
| Access | Multi-user, roles, library/folder/item rules, maturity filters, default grants | Per-request `IN (...)` enumeration performance, concurrent limits, schedules/time limits, 2FA/invites |
| New surfaces | — | Music, photos, books, Live TV/DVR, TV/console clients, relay/remote access, plugin runtime |

**Implemented and verifiable now:** the 20 Nov pass (see the progress section at the top) plus multi-episode
expansion, watch history, hidden-series filtering, and the corrected API docs.

**Next code that fits the current architecture:**
1. **Playlists + smart collections** — the largest remaining catalog gap; collections already provide the
   table/route/UI pattern.
2. **Local extras indexing** — scan `Extras/` folders into a local-video table, merge with TMDB videos, play
   through the existing file/stream pipeline.
3. **Artwork picker** — store provider candidates, add a `selected` flag, and expose a title-page picker; the
   artwork cache/derivatives already exist.
4. **Backup/restore and playback stats** — sessions/history now provide the raw activity; add snapshots and a
   compact dashboard.

**Not sensible as a “small next pass”:** HLS/ABR, hardware transcoding/HDR, image-subtitle burn-in, mobile
server mode + downloads, desktop 10-foot mode, relay/remote access, and music/photos/books/Live TV. These need
new pipelines, platform work, or a separate product surface.

### 3.1 Global search — the example, expanded

**Original baseline (20 Nov 2026):** `GET /api/search` runs `name LIKE %q%` on titles and episodes, requires `match_status='matched'`,
caps at 24 titles + 40 episodes, and sorts by `items.score` (TMDB match confidence). People are not searched.
The top nav says "Search titles, people, episodes" and the empty state says "Type a title, an actor, or an
episode name", so the UI promises something the API does not do. Mobile local search is also a lowercase
`includes` check on title/episode names; it does not search parent series names, people, genres, or collections.

**Better:**
1. **FTS5 index** (`items_fts` with title, original title, overview, people names, genres, studio, year,
   episode parent title) maintained by triggers/scan hooks. Use `unicode61` + prefix queries.
2. **Fuzzy fallback** with trigram or Levenshtein for 1–2 typos, accent folding, punctuation folding, and
   "the/a/an" handling. Keep FTS for speed; fall back only when FTS returns too few results.
3. **Relevance ranking** — exact title > title prefix > title token > person match > overview match; boost
   rating/popularity/recency; never use the TMDB match score as search rank.
4. **Search groups** — Titles, People, Episodes, Collections, Genres, Years. A single mixed grid is fine on
   mobile, but the API should return typed groups.
5. **Filters in search** — type, library, year/decade, genre, watched/unwatched, 4K/HDR, audio/subtitle
   language. Reuse the same filter model as the library.
6. **Recent searches and suggestions** — store the last 10 on-device; show "Continue watching", "Recently
   added", and top people when the query is empty. The web already shows Continue/Recent; make it
   query-aware.
7. **Keyboard-first web search** — ⌘K already focuses the field; add arrow-key result navigation, Enter to
   open, Esc to clear, and a `/` shortcut outside inputs.
8. **Search unmatched items** — current `match_status='matched'` hides newly added unmatched files. Either
   include them with an "Unmatched" badge or add a "Needs fixing" search scope.
9. **Pagination** — `limit`/`offset` or cursor; 24/40 is a hard cap today.
10. **Search highlight** and "did you mean" for the web/mobile result cards.
11. **Shared search core** — move tokenization/ranking into `packages` so web and mobile cannot drift again.

**Why it matters:** search is the primary navigation for a library over a few hundred items, and the current
copy actively over-promises. This is the highest-leverage polish item in the app.

Effort: **M** · Impact: **High**

### 3.2 Library browse — filters and pagination

**Original baseline (20 Nov 2026):** web library always fetches 200 items and has only kind + sort. Server supports `year`, `q`,
`unwatched`, `libraryId`, `limit`, `offset`. Mobile has genre, runtime, unwatched, and offline filters, but
they are client-side over the current page and not shared with web.

**Better:** a shared filter model (`type`, `library`, `genre`, `decade`, `minRating`, `runtimeMax`, `resolution`,
`hdr`, `audioLanguage`, `subtitleLanguage`, `watched`, `downloaded`) backed by indexed columns/JSON tables;
server-side filtering; infinite scroll with `limit`/`offset`; saved filter presets ("Unwatched 4K", "Short
films", "Kids"); a count/facets response so the UI can show "Action (42)".

Effort: **M** · Impact: **High**

### 3.3 Home — fixed shelves to a personalized surface

**Original baseline (20 Nov 2026):** deterministic best-rated movie hero + 4 fixed shelves. Web merges recent movies/shows into the
hero; mobile shows a 5-item carousel. No "Because you watched", genre rows, watchlist row, recently played,
or per-user row order.

**Better:** a server-computed home payload with configurable row definitions, per-user visibility/order, and
cheap local signals: Continue, Next Up, Recently Played, Recently Added, Watchlist, Favorites, Because You
Watched (genre/cast similarity), Collections, Genres, Upcoming. Cache rows and refresh on progress changes.
Make the hero prefer an in-progress title on TV/desktop, and fall back to a curated/featured row.

Effort: **M** · Impact: **High**

### 3.4 Similar titles and recommendations

**Original baseline (20 Nov 2026):** web has no similar shelf. Mobile "More Like This" uses TMDB recommendations in online mode; local
mode only shows titles already in the library. No server-side similarity.

**Better:** compute local similarity from genres, keywords, cast, director, year, and rating; blend with TMDB
recommendations when online; show a "More like this" shelf on every title page. Use the existing
`item_people`/`item_metadata` tables; no new provider needed.

Effort: **S–M** · Impact: **Medium–High**

### 3.5 Collections and playlists — the biggest catalog gap

**Original baseline (20 Nov 2026):** no server collections or playlists. Mobile has custom collections stored in AsyncStorage and a
TMDB movie-collection tab. Web has nothing. There is no collection page, no add-to-collection action, no
playlist queue, no M3U import/export.

**Better:**
1. `collections` + `collection_items` tables; manual and smart collections (filter rules).
2. Auto collections from TMDB `belongs_to_collection` (mobile already reads it) and from user rules.
3. `playlists` + `playlist_items`, per-user or shared; queue persistence; M3U import/export.
4. Collection artwork, description, sort order, and "Play all/Shuffle".
5. Add-to-collection from every card context menu; a "Collections" tab on library/home; collection detail page.
6. Migrate mobile custom collections from AsyncStorage to SQLite and sync to the server when a server mode
   exists.

Effort: **M–L** · Impact: **High**

### 3.6 Watchlist, favorites, ratings, history

**Original baseline (20 Nov 2026):** watchlist and favorite are per-device `localStorage` flags on web; mobile has a watchlist flag on
local records and a separate "saved" list for online titles. No favorites page, no user rating, no watch
history table.

**Better:**
1. `user_watchlist` and `user_favorites` tables (or one `user_flags` table), with API + optimistic UI; migrate
   local flags once.
2. `user_ratings` (1–5 or 1–10) per title, editable on the title page and in a "Rate" action; sort/filter by
   rating.
3. A Watchlist page/row, a Favorites row, and a "My List" tab on mobile.
4. `watch_events` table for history (started/paused/finished, device, timestamp) and an activity/history page.
5. Bulk actions: mark season/series played, add to watchlist/collection, remove from continue watching.

Effort: **M** · Impact: **High**

### 3.7 Metadata correctness and depth

**Original baseline (20 Nov 2026):** TMDB only; certification is always `null`; NFO is only used for the TMDB ID; artwork is a single
best pick; one trailer; 12 cast + 3 crew; no field locks or editor; no local metadata write.

**Better:**
1. **Fix certifications first.** Request `release_dates` (movies) / `content_ratings` (TV), store the selected
   region's certification, backfill existing libraries, and add a test that a PG-13/R title is filtered
   correctly.
2. **Provider abstraction** — TMDB first, TVDB/IMDb/Fanart fallbacks; per-library provider order.
3. **Full NFO read/write** — title, original title, plot, tagline, year, ratings, genres, studios, cast, art,
   and `uniqueid`; write on metadata edit when enabled.
4. **Field locks** (`metadata_locks` table) so refresh-only-missing does not overwrite manual edits.
5. **Metadata editor** — all fields, bulk edit, image picker/upload/crop, language variants.
6. **Extras** — index `Extras/` subfolders into `videos` with type (behind the scenes, deleted scenes,
   interview, featurette, clip, blooper), show an Extras tab, and return all trailers not just one.
7. **Theme music** — scan `theme.mp3`, serve it, play on the detail page, with a user setting.
8. **Full credits** — all cast/crew (not 12/3), character names, multiple roles, person biography/filmography.
9. **Editions and multi-part** — preserve edition labels instead of stripping them; expand `S01E01-E02` into
   two episode items or a range-aware player; join `cd1`/`cd2` deliberately rather than treating them as
   versions.
10. **Anime** — fix the DB CHECK/UI or remove the type; add AniDB/AniList ordering if the type stays.

Effort: **M–L** · Impact: **High**

### 3.8 Artwork picker — a small feature with a big visual payoff

**Original baseline (20 Nov 2026):** TMDB best poster/backdrop/logo + local sidecars only when missing. No choice, upload, crop, or
language variants. The artwork cache/derivative pipeline already exists.

**Better:** return all artwork candidates from the provider + local files; let the owner pick per kind; upload
an image; crop/zoom; lock the choice; prefer local art when present; add banner/disc/clearart kinds. This is
mostly UI + a `selected` flag, because the storage and resizing already exist.

Effort: **S–M** · Impact: **Medium–High**

### 3.9 Chapters and versions — data already exists, UI does not

**Original baseline (20 Nov 2026):** `media_files.chapters_json` is populated; the play manifest does **not** return chapters. The play
manifest returns `versions`, but neither web nor desktop uses it. Mobile local playback parses and displays
chapters; server clients cannot.

**Better:** add `chapters` to the play manifest (from `chapters_json`); render chapter marks on the timeline and
a chapter list; add "next/previous chapter"; use the existing trickplay sprites for chapter thumbnails; add a
version selector in the play/title UI ("4K HDR", "1080p", "Director's cut") using the returned `versions`.
This is one of the cheapest visible upgrades in the app.

Effort: **S–M** · Impact: **High**

### 3.10 Playback quality and format coverage

**Original baseline (20 Nov 2026):** prepared MP4 only; no HLS/ABR; quality menu has no variants; `versions` ignored; hardware encode
only on macOS; no tone mapping; image subtitles skipped; live remux/transcode routes return 409.

**Better:**
1. **Expose versions as quality choices** immediately (cheap, uses existing data).
2. Add **HLS/ABR** only if needed for remote/mobile/bandwidth; otherwise a clear "source quality" label and
   version picker may be enough for a local-first product.
3. Add **hardware encode paths** (QSV/VAAPI/NVENC/AMF) with a capability probe and a settings UI; fall back to
   software. Add **HDR→SDR tone mapping** for SDR clients.
4. Add **image subtitle burn-in** (PGS/VobSub) or a client-side PGS renderer; currently those tracks are
   invisible.
5. Add **per-title quality cap** ("play at 720p") and remember it per device.
6. Add **sleep timer**, **still watching**, **autoplay next on/off + countdown**, and **resume prompt** to web
   and native desktop to match mobile.

Effort: **M–L** · Impact: **High** (hardware/HDR), **Medium** (quality picker)

### 3.11 Subtitles

**Original baseline (20 Nov 2026):** text subtitles are strong; mobile has OpenSubtitles search/import; web has sync/position but no
search; image subs are skipped; no per-user caption styling.

**Better:**
1. Move OpenSubtitles search/download into the **server** (`/api/subtitles/:fileId/search`, `/download`) so web
   and desktop get it too; cache results; respect per-user language preferences.
2. Auto-download per library (language list) and a scheduled task.
3. Add **caption styling** (size, color, background, edge) per user, persisted server-side.
4. Add **subtitle upload/edit/delete** on web.
5. Add **image-subtitle burn-in** or PGS rendering.
6. Add **subtitle search history** and "previously downloaded" state.

Effort: **M** · Impact: **High**

### 3.12 Users, family, and sessions

**Original baseline (20 Nov 2026):** good account/access foundation; certification bug; no sessions; no PIN on web/desktop; no
concurrent limits/schedules/time limits; no invites; no 2FA.

**Better:**
1. Fix certification hydration and backfill.
2. Add `sessions` API: active device, current media, position, client, IP, started at; admin can stop, send a
   message, and **remote-control** playback. This unlocks "Play on", "Stop", and a real dashboard.
3. Add per-user **concurrent stream limit**, **access schedules**, **daily time limit**, and **PIN** for
   web/desktop profiles.
4. Add **invite links** with a default access grant (library or folder) so new users are not created with zero
   access.
5. Add **password reset** (admin-generated one-time code) and optional **2FA**.
6. Add server-side **per-user playback preferences** (audio/subtitle/autoplay/quality/theme), so settings follow
   the profile across devices.

Effort: **M** · Impact: **High**

### 3.13 Admin dashboard and operations

**Original baseline (20 Nov 2026):** settings pages, scan SSE, match queue, user admin, logs/crashes, optimizer, DB reset. No active
sessions, playback stats, activity log, backup/restore, notifications, webhooks, plugins, task UI, per-library
settings, or server metrics.

**Better:**
1. **Dashboard**: active streams, transcoder/optimizer queue, CPU/GPU/RAM/disk (server-side, not just
   Electron), scan status, recent errors, storage by library.
2. **Playback reporting**: watch time by user/title/day, top titles, transcode vs direct ratio, rebuffer count.
   Requires a `watch_events` table, which also gives users a history page.
3. **Activity log**: append-only events for logins, playback, library changes, user changes, settings changes;
   filter/export.
4. **Backup/restore**: scheduled database+config+metadata snapshot with retention; restore flow; export/import
   for migration.
5. **Scheduled tasks UI**: scan, metadata refresh, trickplay, marker refresh, optimizer, backup, DB optimize,
   with run-now and history.
6. **Notifications/webhooks**: email/webhook/Discord/Telegram on scan complete, playback start/stop, user
   created, storage low.
7. **Plugin/extension points**: at minimum, a server-side event/webhook API and a metadata provider interface;
   a full plugin runtime can come later.
8. **Per-library settings**: language, provider order, scan schedule, subtitle languages, chapter/trickplay/
   marker generation, folder access.
9. **Access SQL performance**: replace the per-request "visible item IDs" enumeration with SQL joins/CTEs;
   current `accessSql()` runs `canAccessItem()` per item and builds an `IN (...)` list
   (`access.ts:180-202`).

Effort: **M–L** · Impact: **High**

### 3.14 Search and access consistency bugs

> Most entries in this list were fixed in the 20 Nov pass; the remaining ones are marked **Open**.

- ✅ New users now receive access to every existing library by default.
- ✅ Unmatched items are searchable (with a review badge).
- ✅ Web watchlist/favorites/hidden/ratings and history are server-backed per user.
- ✅ Mobile `Next Up` is restored.
- ✅ Web search finds people and parent series names.
- ✅ Search ranks by FTS relevance, not TMDB match score.
- ✅ `quality` uses file versions; chapters and versions are surfaced in the player.
- ✅ Certifications hydrate and backfill, so maturity filters work.
- ✅ Anime was removed from the server API/UI.
- **Open:** mobile custom collections are AsyncStorage, not exportable or synced.
- **Open:** mobile search does not search parent series names for episodes (server does).
- **Open:** mobile local watchlist is still a simple title flag, not a browsable list.

Effort: mostly **S** · Impact: **High** (trust/usability)

---

## 4. Adjacent features — leverage what already exists

These are features that are close to current code, not new subsystems.

| Adjacent feature | Builds on | Why it is cheap | Effort |
| --- | --- | --- | --- |
| **Version/quality selector** | `versions` in play manifest, `media_files` rows | Data already returned; add a menu and `play(fileId)` navigation | S |
| **Chapter menu + timeline marks** | `chapters_json`, trickplay sprites | Add `chapters` to the manifest, render marks; reuse sprites for thumbnails | S–M |
| **People search** | `people`, `item_people` tables | Add a join to the search query; return typed Person results | S |
| **Genre/studio/year search** | `item_metadata.genres`, `items.year`, `studios` (add column/table) | Add FTS fields and filter clauses | S–M |
| **Watchlist row/page** | Existing `watch_state` pattern + `user_flags` | New table + endpoint + one row/page; migrate localStorage flags | S–M |
| **Favorites + user ratings** | `item_metadata.rating` exists for TMDB; add user table | New table + star control + filter/sort | S–M |
| **Hidden titles server-side** | Mobile `hidden-titles` concept | Add `user_hidden` table/API; web/desktop/mobile share it | S |
| **Extras tab** | `videos` table already has `type` | Index `Extras/` folders into `videos`; render a tab | S–M |
| **Artwork picker** | `artwork` table + derivative cache | Add candidates + `selected` flag + upload endpoint | S–M |
| **Theme music** | `theme.mp3` not scanned; audio serving exists | Scan sidecar, serve, play on details | S |
| **Chapter thumbnails** | Trickplay sprite cache | Map chapter times to frame indices | S |
| **Local intro detection** | `skip_segments` + FFmpeg audio/black-frame detection | Add a local detector fallback when IntroDB misses | M |
| **Manual skip-marker editor** | `skip_segments` table | Add edit/save UI + API | S |
| **Download original from detail page** | `/api/download/:fileId` | Add a button + progress; no transcoding needed | S |
| **Pre-transcode downloads** | Optimizer/prepared copies + download endpoint | Add a "prepare then download" flow; docs already claim it | M |
| **QR pairing** | Pairing code flow | Generate QR for the `/connect` URL + code | S |
| **Server switcher in header** | `/connect` + desktop server preference | Surface it instead of hiding in settings | S |
| **Library health panel** | `/libraries` counts, scans, review queue | Add a "Needs attention" card linking to matches | S |
| **"Open in Finder"** | Desktop `shell.openPath` exists for logs/data | Add current media path action from admin title page | S |
| **Playback diagnostics export** | `routes-diagnostics`, logs, crashes | Bundle into a ZIP/JSON download | S |

---

## 5. Mobile-specific opportunities

**What mobile is for:** the personal phone/tablet, often offline, on a commute or in bed, casting to a TV.
It is not a miniature admin console. Its strongest differentiators are the **on-device library**, the
**gesture-first player**, and the **online catalog**. Keep those.

### Keep and strengthen
- **Offline local library** — scanning, local SQLite, TMDB cache, local chapters, subtitle import. This is the
  best part of the app and should stay first-class.
- **Gesture player** — double-tap seek, brightness/volume swipe, pinch zoom, fit modes, screen lock, sleep
  timer, next countdown. Add a caption size/background preset and a "stats for nerds" overlay.
- **Family mode + PIN** — good device-level control. Add per-profile PIN and a "kids home" launcher shortcut.
- **Online catalog** — TMDB + Vidy is a useful "watch something now" path. Keep it clearly separated from the
  local library and label provider content.
- **Subtitle search/import** — move the same capability to web/desktop via the server; reuse the UI concepts.
- **Custom collections and hidden titles** — move persistence from AsyncStorage to SQLite, add export/import,
  and sync when a server mode exists.

### Add, in order
1. **Plexy server mode (P1, large).** The app currently cannot connect to a Plexy server at all. Add
   "Connect to server" with pairing code/Bearer token, server library browsing, remote playback, progress sync,
   and downloads. Reuse `packages/api-client`; the server contract already exists. This is the single biggest
   mobile gap versus Jellyfin/Plex/Emby clients.
2. **Downloads from a server (P1).** Add a download queue using `/api/download/:fileId`, storage selection,
   progress, pause/resume (original files support Range), and "download next episodes". The mobile app already
   has local storage/import patterns.
3. **Next Up row + resume prompt (P1, small).** Stop filtering `next` out of home; normalize episodes to series
   cards only where appropriate. Add "Continue watching" remove.
4. **Watchlist / My List page (P1).** Surface the existing local watchlist flag; merge server watchlist when
   server mode lands.
5. **Fuzzy local search + people (P1).** Add an FTS/SQLite index over title, parent series, cast, genre; keep
   the current instant search feel.
6. **Profiles (P2).** Device-wide family mode is good; add named profiles with separate progress, hidden
   titles, and collections. Reuse the family PIN.
7. **Tablet and TV layouts (P2).** A two-pane library/title layout on tablets; a D-pad-first Android TV target
   would be a separate app but shares the catalog.
8. **Local backup/export (P2).** Export library state/collections/progress as JSON and restore; currently a
   reinstall loses AsyncStorage-only data.
9. **Player stats + caption styling (P2).** Parity with web's stats overlay; caption background/edge styling.
10. **"Send to TV" polish (P2).** The native cast bridge exists; add a clear cast sheet with device names,
    session state, and volume/seek controls.

### Avoid on mobile
- A full admin dashboard, plugin management, or server logs. Phone screens are for consumption; expose a
  read-only "server health" card at most.
- Desktop-style multi-column navigation. Keep the four-tab model.

---

## 6. Desktop-specific opportunities

**What desktop is for:** the machine that hosts the server, a laptop on the LAN, a living-room HTPC, and the
admin console. It should be the best place to **manage** and the best place to **watch on a big screen**.

### Keep and strengthen
- **Local server toggle + remote server client** — this is a strong, unusual capability. Make the current
  server visible in the header and offer a quick switch.
- **Native mpv playback** — original files, all codecs, subtitles, audio tracks. Add chapter/version menus and
  subtitle search to the same chrome.
- **Admin surface** — libraries, matches, users, logs, crashes, optimizer. Add sessions, stats, backups, and
  scheduled tasks.
- **Updater with checksum verification** — solid. Add a periodic background check and a "what's new" note.
- **mDNS discovery + certificate trust** — keep; add a QR code for phone pairing.

### Add, in order
1. **10-foot / HTPC mode (P1, large).** Larger type and posters, focus rings, fewer controls, a focusable hero
   action row, and a "TV layout" toggle. This is the biggest desktop UX gap.
2. **Spatial/keyboard navigation (P1).** Arrow keys move focus between nav, rows, and actions; `g h`, `g l`,
   `g s`; `?` opens a shortcut sheet. ⌘K already exists.
3. **Offline downloads for laptop use (P1).** Download original (and later prepared) files, show a downloads
   screen, and mark downloaded titles in the library.
4. **Watchlist/collections/ratings (P1).** Add the same server-side pages as web; desktop should not depend on
   `localStorage`.
5. **Native player parity (P1).** Chapters, versions, subtitle search/download, sleep timer, still-watching,
   and a "stats for nerds" overlay in the mpv player.
6. **Tray / mini-player / media keys (P2).** Global play/pause/next, close-to-tray, a compact now-playing
   window, and a menu-bar control.
7. **Drag-and-drop import (P2).** Drop a folder on the window to start the add-library flow.
8. **Detached player window / multi-window (P2).** Useful for a second monitor; PiP already exists in the
   browser player.
9. **Diagnostics export (P2).** One button for logs + crashes + playback diagnostics + system usage.
10. **Remote quality/transcode controls (P2).** Per-title cap and "prepare for this device" once the server
    exposes quality variants.
11. **Windows/Linux builds (P2, strategic).** The Electron shell is cross-platform in code, but only macOS ARM64
    is packaged and native playback is `darwin`-only. Decide whether desktop is a macOS product or a
    cross-platform one.

### Avoid on desktop
- A phone-style bottom nav; use the existing top nav + keyboard.
- Autoplay trailers with sound; keep hover previews muted and behind reduced-motion.

---

## 7. Missing feature groups (from the 382-item catalog)

| Catalog group | State in Plexy | Notes |
| --- | --- | --- |
| Music (`AUD-*`) | **Missing** | No music library, artist/album hierarchy, audio metadata, lyrics, sonic analysis, Plexamp-style audio. |
| Photos (`LIB-01`, `AUD-*`) | **Missing** | No photo library, timeline, albums, slideshow, camera upload. |
| Books/comics/audiobooks (`LIB-11`, `MET-25`) | **Missing** | No EPUB/PDF/CBZ reader, chapters, authors, page count. |
| Live TV & DVR (`TV-*`) | **Missing** | No tuners, EPG, recordings, timeshift, guide. |
| Collections/playlists (`COL-*`) | **Mostly missing** | Mobile custom/TMDB collections only; no server model. |
| Watchlist/favorites/ratings/history (`COL-10…20`) | **Partial** | Local flags only; no server model or pages. |
| SyncPlay / watch together (`PLAY-31`) | **Missing** | No group session or synchronization. |
| Remote control / sessions (`USER-16`) | **Missing** | No session API; no "Play on" or stop playback. |
| Downloads/offline video (`PLAY-48…53`) | **Partial** | Server original download endpoint, no UI; no quality cap. |
| HLS/ABR (`PLAY-04`) | **Missing** | Prepared MP4 only; docs claim HLS. |
| Hardware transcoding/tone mapping (`PLAY-07/08`) | **Partial** | macOS VideoToolbox only; no QSV/NVENC/VAAPI/AMF, no tone mapping. |
| Image subtitles/burn-in (`SUB-03/07`) | **Missing** | PGS/VobSub skipped; no burn-in. |
| Plugins/webhooks/notifications (`ADMIN-10…16`, `INT-*`) | **Missing** | No plugin runtime, webhook, or notification targets. |
| Sharing/invites/social (`SOC-*`) | **Missing** | Users can be created, but no invite links, friends, lists, discussions. |
| TV/console clients (`CLIENT-06…12`) | **Missing** | Web/desktop/mobile only; no Roku/TV/console/iOS. |
| Remote access/relay (`ADMIN-21`) | **Partial** | LAN + TLS + reverse-proxy guidance; no relay/NAT traversal. |
| Backup/restore (`ADMIN-08`) | **Partial** | Pre-migration DB snapshots only; no owner backup/restore. |
| Notifications (`ADMIN-15`) | **Missing** | No email/push/webhook events. |

---

## 8. Bugs and correctness issues found

These are not "nice to haves"; they undermine features that look present.

1. ✅ **Fixed (P0) — Certifications are always `null`.** TMDB `release_dates`/`content_ratings` are fetched,
   regional values are stored, a startup/admin backfill exists, and the selection logic is unit-tested.
2. ✅ **Fixed (P0) — Anime library creation is broken/inconsistent.** The server `anime` type was removed from
   the API, validation, and web wizard; local anime roots remain a mobile-only concept.
3. ✅ **Fixed (P0) — Docs promise HLS, `maxHeight` downloads, live remux/transcode, and a 2-transcode cap.**
   README/API now describe the prepared MP4/audio pipeline that actually exists.
4. ✅ **Fixed (P1) — Web search copy promises people.** The API and UI both search and display people now.
5. ✅ **Fixed (P1) — Web library silently caps at 200 items.** Server pagination, Load More, and filter-aware
   totals are wired to the library grid.
6. ✅ **Fixed (P1) — Mobile hides Next Up.** The row is restored and taps play the next episode.
7. ⚠️ **Open (P1) — Mobile "saved" is not downloaded.** Saving still stores metadata/bookmark state, not media
   bytes; the audit wording now says “saved”, not “downloaded”.
8. ✅ **Fixed (P1) — Watchlist/favorites are per-device localStorage.** They are server-backed per user, with
   dedicated Watchlist/Favorites/Hidden pages.
9. ✅ **Fixed (P1) — New users start with no access.** Account creation now grants access to every existing
   library, which the admin can narrow afterwards.
10. ❌ **Open (P1) — Access control scales poorly.** `accessSql` still enumerates visible items and builds an
    `IN (...)` list per request. Move the rules into SQL joins/CTEs for large libraries.
11. ✅ **Fixed (P1) — Multi-episode files are only tagged.** `S01E01-E02` now creates both episode items and
    `fileForEpisode()` resolves the shared file for the second episode's detail, next-up, and playback.
12. ⚠️ **Partial (P1) — Extras.** All TMDB trailers/teasers/featurettes/clips are stored and shown in “More
    videos”, but `Extras/`/`Featurettes/` folders on disk are still skipped by the scanner.
13. ✅ **Fixed (P1) — Chapters are dead data.** Chapters are returned in the play manifest and exposed in the
    web/native player menus.
14. ✅ **Fixed (P1) — Versions are dead data.** The player menu switches between file versions without leaving
    playback.
15. ✅ **Fixed (P1) — `search` sorts by TMDB match score.** Search now ranks with FTS5 bm25 (with a LIKE
    fallback), so exact titles outrank weak matches.
16. ✅ **Fixed (P1) — New unmatched titles are unsearchable.** The index includes unmatched titles, and the
    UI labels them instead of hiding them.
17. ✅ **Fixed (P2) — `playback.ts` and docs disagree about HLS.** Docs now match the prepared-MP4 contract.
18. ❌ **Open (P2) — `trickplay` is lazy and has no admin control.** No per-library pre-generation or scheduled
    task yet.
19. ⚠️ **Partial (P2) — `quality` menu is a no-op for prepared MP4.** File versions now provide a real choice,
    but there is no HLS/bitrate ladder.
20. ❌ **Open (P2) — `metadataLanguage` is global.** Per-library language is still not supported.

---

## 9. Recommended sequence

> **Status:** the P0 list and most of P1 landed in the 20 Nov pass. Treat the sequence below as the original
> roadmap; the progress section and §8 statuses show what remains.

### P0 — correctness and trust (1–2 weeks)
1. Fix certification hydration + backfill + tests (unblocks parental controls).
2. Fix or remove the `anime` type (DB CHECK/UI/API consistent).
3. Correct README/API claims (HLS, `maxHeight`, live transcode, 2-transcode cap) or implement them.
4. Fix search copy (people) or implement people search.
5. Add web library pagination/load-more (use `limit`/`offset`).
6. Add mobile Next Up row.
7. Make watchlist/favorites server-backed or clearly label them device-only.
8. Default new users to library access (or require a grant in the create flow).

### P1 — catalog cohesion (3–6 weeks)
1. Server `user_flags` (watchlist/favorites/hidden) + ratings + watch history.
2. Server collections + playlists + collection pages/rows + add-to-collection.
3. Search FTS + fuzzy + people/genres + filters + suggestions + shared search core.
4. Library filters + saved views + pagination on web/mobile.
5. Versions + chapters in the manifest and UI.
6. Extras indexing + trailers list.
7. Subtitle search/download server endpoint + web UI + auto-download.
8. Download queue/UI + quality-cap policy (or correct the docs).
9. Sessions API + admin dashboard + remote control.
10. Backup/restore + scheduled-task UI.

### P2 — differentiation (6–12 weeks)
1. Hardware transcoding (QSV/VAAPI/NVENC/AMF) + HDR tone mapping.
2. HLS/ABR if remote/mobile bandwidth needs it; otherwise version-based quality selection.
3. Local intro/credit detection + manual marker editor.
4. SyncPlay/watch-together.
5. Music library (then lyrics/sonic), photos, books, live TV/DVR — each is a separate product surface; pick
   deliberately.
6. Plugin/webhook/notification framework.
7. Mobile Plexy-server mode + server downloads + profiles/tablet layouts.
8. Desktop 10-foot mode + tray/mini-player/media keys + Windows/Linux decision.
9. Remote access/relay + invites/sharing.

---

## 10. Evidence index

| Concern | Files |
| --- | --- |
| DB schema, users, rules, watch state | `apps/server/src/migrations/001_init.sql`, `012_skip_segments.sql`, `013_accounts.sql` |
| Scanning / parsing / NFO / sidecar art | `apps/server/src/scan.ts`, `apps/server/src/parse.ts` |
| Matching / hydrate / TMDB | `apps/server/src/matcher.ts`, `hydrate.ts`, `tmdb.ts` |
| Catalog/home/search/title | `apps/server/src/routes-catalog.ts` |
| Playback/streams/subtitles | `apps/server/src/routes-media.ts`, `playback.ts`, `subtitles.ts`, `mkv-subtitles.ts` |
| Optimizer/transcode | `apps/server/src/optimize.ts`, `optimize-worker.ts` |
| Trickplay/markers | `apps/server/src/trickplay.ts`, `skip-segments.ts` |
| Auth/users/devices | `apps/server/src/routes-auth.ts`, `auth.ts`, `accounts.ts` |
| Access rules | `apps/server/src/access.ts` |
| Admin/settings/libraries | `apps/server/src/routes-admin.ts` |
| Logs/crashes/diagnostics | `apps/server/src/routes-logs.ts`, `diagnostics.ts`, `routes-diagnostics.ts` |
| Web shell/routes | `apps/web/src/routes/*`, `components/*`, `queries.ts`, `client.ts` |
| Web player | `apps/web/src/routes/watch/$fileId.tsx`, `components/videojs/*`, `components/native/*` |
| Web offline cache | `apps/web/src/lib/library-cache.ts`, `asset-prefetch.ts`, `app-shell-sw.ts` |
| Web user/admin UI | `apps/web/src/components/user-management.tsx`, `components/settings/*`, `components/server/panels.tsx` |
| Desktop shell | `apps/desktop/src/main/index.ts`, `menu.ts`, `native-player.ts`, `remote-api.ts`, `updater.ts`, `discovery.ts` |
| Mobile catalog/library | `apps/mobile/src/core/library/*`, `packages/local-library/src/*` |
| Mobile screens | `apps/mobile/src/features/*`, `apps/mobile/src/app/*` |
| Mobile player | `apps/mobile/src/features/player/*` |
| Mobile online source | `apps/mobile/src/features/remote/*` |
| API contracts | `packages/api-client/src/contracts/*.ts` |
| Existing desktop audit | `docs/DESKTOP_FEATURE_AUDIT.md` |
| API/README claims | `README.md`, `docs/API.md` |
