# Local Media Asset Prefetch Plan

## Goal

Make likely-next artwork and playback previews ready before the user needs them, while keeping the feature local-only, bounded, cancellable, and independent of media generation. Prefetch may retrieve an asset that the server already serves; it must never queue trickplay extraction or create thumbnails.

## Repository findings

- Server configuration is validated and persisted atomically in the data directory's `config.json` by `apps/server/src/config.ts`. The generic SQLite `settings` table is not used for these server preferences. Keep prefetch preferences in the existing config model.
- The current loopback-only settings API is `GET /api/settings` and `PUT /api/settings` in `apps/server/src/routes-admin.ts`. There is no `/api/admin/settings/prefetch` route. The config schema and safe response already contain six prefetch fields and defaults, and `packages/api-client/src/types.ts` already describes them. The current PUT body/schema and patch mapping do not yet accept or save them.
- There is no `apps/web/src/lib/asset-prefetch.ts` or `prefetch-config.ts` yet. Poster hover currently prefetches title/play queries after 100 ms. The title page prefetches play queries on pointer/focus. The watch page already creates `Image` objects for trickplay sprites in the play response.
- Artwork is served at `/api/images/:artworkId?w=...`; thumbs are artwork records, not `/api/thumbs/:fileId`. Artwork URLs in catalog items are already resolved URLs. The trickplay routes are `/api/trickplay/:fileId/track.vtt` and `/api/trickplay/:fileId/:frame`; the VTT uses sprite URLs with `#xywh=` fragments. A missing frame returns 404. A VTT request itself does not enqueue generation.
- `isLocalPage()` in `apps/web/src/auth.ts` checks whether the page hostname is loopback. `isElectron()` and server URL helpers live in `apps/web/src/server-config.ts`. The settings page is part of the existing Settings tab in `apps/web/src/routes/admin/index.tsx`.
- The worktree contains broad unrelated uncommitted changes. Preserve them; this plan only changes `PREFETCH_PLAN.md`.

## Policy and behavior

1. Enable aggressive prefetch only when the viewer is running in Electron or the page itself is served from a loopback hostname. A remotely hosted client connected to a LAN server does not qualify. Do not infer locality from the server's address alone.
2. The server's default preference may remain `true`; the client-side locality gate is authoritative for whether work runs. Do not make a startup request that silently changes the server's saved setting based on User-Agent or Electron detection.
3. Keep existing title/play query prefetch behavior, but make the delay configurable only if there is a real setting for it; the current six settings do not include a hover delay. Avoid adding a 50 ms delay requirement.
4. Only fetch URLs already returned by catalog/title/play data or URLs parsed from an existing trickplay VTT. Never request playback preparation, enqueue trickplay generation, or request a server-side thumbnail generator.
5. Treat speculative work as low priority and cancel/skip it when the feature is disabled, the user leaves the local context, the browser is offline, or an item is already cached/in-flight. Failures, including 404s, do not affect UI flows.

## Settings integration

Use the existing config fields and defaults:

| Field | Default | Bound / meaning |
|---|---:|---|
| `prefetchAggressiveLocal` | `true` | Master preference; locality is still enforced by the client |
| `prefetchMaxConcurrent` | `3` | Config schema currently bounds 1–10 |
| `prefetchMaxCacheMb` | `50` | Config schema currently bounds 10–500 |
| `prefetchOnHover` | `true` | Hover/focus trigger |
| `prefetchOnScroll` | `true` | Near-visible/next-row trigger |
| `prefetchNextCount` | `5` | Number of upcoming items, bounded 1–20 |

Extend `PUT /api/settings`'s validation schema and patch mapping to accept these six fields. Continue using the loopback-only access check and `save()` so settings persist atomically in `config.json`. Do not add duplicate endpoints or SQLite defaults. Verify the Settings UI's save path submits and displays these fields; add a Prefetch subsection to the existing admin Settings panel if absent. Keep browser cache controls in the viewer's settings context only if they can accurately operate on that viewer's cache; server-side settings must not imply shared cache state.

## Cache design requirement

Do not assume `CacheStorage` is used automatically by normal `<img>` or video UI requests: it is not an HTTP interception layer. Choose and implement one coherent read path before integrating:

- **Preferred:** add a small service worker that handles only same-origin Plexy asset GETs, serves a managed cache hit, and otherwise fetches and stores eligible responses. Keep the worker scope/version migration explicit and do not cache VTT responses (`no-cache`) or errors.
- If a service worker is out of scope, expose an asset resolver that checks the Cache API and returns/revokes object URLs, and route all prefetched artwork uses through it. Do not claim ordinary `<img src>` requests benefit from Cache API otherwise.

Maintain an IndexedDB metadata index (URL, byte size, last access, cache version) to enforce an application-level LRU budget and report item/byte counts. Use `Content-Length` when valid and otherwise count a cloned response body; skip opaque or unmeasurable responses if they cannot be safely bounded. Enforce the configured budget before/after inserts and tolerate quota errors. Browser-managed eviction may still remove entries, so reconcile the index with actual cache keys and report estimates rather than exact disk usage. “Clear prefetch cache” must remove only Plexy's managed cache and metadata, never browser-wide cache or server artwork.

## Implementation phases

### Phase 1 — Complete settings plumbing — implemented

- Add all six fields to the existing PUT request schema and patch map in `apps/server/src/routes-admin.ts`.
- Add controls to the existing Prefetch section of the Settings page (or create that subsection if absent): master toggle, concurrency, cache budget, hover/scroll toggles, next count.
- Clamp/validate values through the existing Zod config schema. Invalidate the settings query after save and show save errors.
- Keep settings server-owned and synced through the existing config endpoint. The media cache remains per browser/Electron profile.

### Phase 2 — Locality and client service — implemented

- Add `apps/web/src/lib/prefetch-config.ts` to read the existing settings query data or settings API and expose `shouldPrefetchLocally()`. Reuse `isElectron()`, `isLocalPage()`, and the current settings value. Avoid a second independent settings cache unless query invalidation is wired through.
- Add `apps/web/src/lib/asset-prefetch.ts` with URL normalization, deduplication, in-flight tracking, cancellation, bounded concurrency, cache-hit checks, LRU metadata, stats, and clear operations.
- Only allow same-origin `/api/images/` and `/api/trickplay/` URLs for the managed cache. Reject arbitrary external URLs, `data:` URLs, playback streams, and credentials-bearing URLs.
- For trickplay, fetch the VTT only when the item already has trickplay data or a VTT is known to be useful. Parse cue URL lines, strip fragments only for fetch/cache keys, preserve `?v=` query parameters, deduplicate sprite files, and skip empty tracks/404s. Never cause generation.

### Phase 3 — Wire existing interaction points — implemented

- `apps/web/src/components/poster.tsx`: retain the existing title/play query prefetch. After configured hover dwell, prefetch only assets actually present on the `ItemCard` (poster/backdrop); don't invent thumb or trickplay IDs from an item without file/play metadata.
- `apps/web/src/components/row.tsx`: observe the row's scroller and prefetch a small configured window ahead of the visible item range. Avoid firing on every scroll event; throttle or use `IntersectionObserver`, and don't prefetch the entire row at the 70% threshold.
- `apps/web/src/routes/title/$itemId.tsx`: use an `IntersectionObserver` with a modest root margin on episode cards. Prefetch known episode artwork and, only where existing file/play data supports it, trickplay. Disconnect observers when the season or route changes.
- `apps/web/src/routes/watch/$fileId.tsx`: consolidate or reuse the existing `Image` sprite preload with the managed prefetch service, rather than loading each sprite twice. Preload trickplay only for the active/next playback context, not every row card.

### Phase 4 — Admin visibility and cache lifecycle — implemented

- Show managed cache item count, estimated bytes/budget, and last reconciliation time from the client cache index.
- Make clear-cache action clear managed client cache and index. If the admin UI is unavailable on a remote viewer by design, provide cache management in an accessible local settings surface or omit the control until that surface exists; do not show server-wide cache statistics for browser-local storage.
- Version cache names and metadata schema. On startup, remove stale Plexy-owned cache versions and reconcile missing/evicted entries.

### Phase 5 — Verification — partial (see implementation notes)

- Verify settings GET/PUT round-trip, validation bounds, and persistence across server restart.
- Verify locality behavior for Electron, loopback browser, LAN page/server, and hosted web client connected to a LAN server.
- Verify image prefetch is consumed by the normal UI path, trickplay VTT parsing handles query strings/fragments, 404s are ignored, concurrency is bounded, and LRU eviction meets the configured estimate.
- Verify no prefetch path calls enqueue/generation functions and no server routes or DB migrations were added unnecessarily.
- Verify offline, quota, missing Cache API/IndexedDB, and disabled-setting behavior degrades without breaking rendering.

## Acceptance criteria

1. Existing config fields can be changed from the existing settings UI and persist using `config.json` via `/api/settings`.
2. Prefetch runs only in Electron or when the page is served from loopback, and only when the master preference is enabled.
3. The regular UI can consume prefetched artwork from the managed cache.
4. Only known, existing artwork and trickplay assets are fetched; no server-side generation or stream prefetch is triggered.
5. Hover/focus, near-visible row items, and visible episode cards use bounded, deduplicated, cancellable requests.
6. Concurrency is capped by the saved setting; managed cache enforces an LRU estimate within the configured budget and reports that estimate honestly.
7. Users can inspect and clear only the current viewer's managed cache where a suitable local settings surface exists.
8. Missing assets, offline state, storage quota errors, and unsupported browser storage do not block or visibly break playback or browsing.

## Implementation notes

- Cache read path: a small read-through service worker (`apps/web/public/sw.js`)
  serves managed entries to ordinary `<img>` requests for same-origin
  `/api/images/` and `/api/trickplay/` GETs (VTT excluded). The page remains the
  only writer (`apps/web/src/lib/asset-prefetch.ts`), so the IndexedDB index and
  LRU budget stay authoritative and exact about what Plexy added. Registered
  only for local viewers; if the worker or Cache Storage is unavailable,
  prefetch stays off instead of spending bandwidth the UI cannot reuse.
- Settings live in `config.json` through the existing `PUT /api/settings`
  (bounds mirrored in the TypeBox body schema); the new “Local prefetch”
  Settings section shows this viewer’s cache estimate and clear action.
- No hover-delay preference was added (the existing 100 ms dwell is reused), and
  episode cards warm artwork only — the detail payload carries no trickplay data
  to prefetch without inventing it.
- Server verification: the full server suite passes, including a new
  `PUT /api/settings` round-trip and out-of-range rejection for the six fields.
  Browser-level checks (service-worker consumption on a real library, locality
  matrix, quota/offline behaviour) were not run in this environment.

## Implementation order

1. Complete existing server settings PUT plumbing and UI controls.
2. Decide and implement the cache read-through path plus metadata/LRU accounting.
3. Add local-only client config gating and asset prefetch service.
4. Integrate poster hover and row visibility triggers.
5. Integrate episode visibility and reuse service for active player trickplay sprites.
6. Add per-viewer cache stats/clear controls where accessible.
7. Verify persistence, locality, cache consumption, limits, graceful failures, and no-generation behavior.
