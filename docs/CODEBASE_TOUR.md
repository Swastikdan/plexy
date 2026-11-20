# Codebase tour

Where things live and which file owns what. Start with `README.md` (what/why/how to run) and `docs/ARCHITECTURE.md` (how it fits together), then use this as an index.

## `apps/server/src` — backend (Bun + Elysia + SQLite)

Entry: `main.ts` (boot, listeners, shutdown) → `app.ts` (route assembly + static UI + CORS).

| File(s) | Owns |
| --- | --- |
| `main.ts`, `app.ts`, `runtime.ts` | Boot order, HTTP listeners (loopback + LAN TLS), graceful shutdown |
| `db.ts`, `migrations/` | SQLite schema, migrations, query helpers |
| `config.ts`, `paths.ts` | `config.json` load/save, data-dir resolution, redacted browser view |
| `auth.ts`, `access.ts`, `accounts.ts`, `routes-auth.ts`, `server-identity.ts` | Owner setup, pairing codes, Bearer/session guards, server ID |
| `scan.ts`, `parse.ts`, `episode-files.ts`, `media-facts.ts`, `search-index.ts` | Folder walk, filename parsing, episode linking, FTS5 search |
| `matcher.ts`, `tmdb.ts`, `hydrate.ts`, `artwork.ts`, `routes-matching.ts` | TMDB matching, metadata/artwork backfill, manual match endpoints |
| `ffmpeg.ts`, `media-worker.ts`, `worker-host.ts`, `mkv-subtitles.ts` | Probing, media child worker, embedded subtitle extraction |
| `optimize.ts`, `optimize-host.ts`, `optimize-worker.ts` | Preparation queue (remux/audio/full transcode), one-job-at-a-time scheduling |
| `playback.ts`, `routes-media.ts`, `routes-catalog.ts`, `routes-collections.ts` | `/api/play`, `/api/stream`, `/api/download`, catalog/collection endpoints |
| `subtitles.ts`, `trickplay.ts`, `skip-segments.ts` | WebVTT serving, scrub-preview sprites, intro/recap/credit markers |
| `routes-admin.ts`, `routes-logs.ts`, `routes-diagnostics.ts`, `playback-diagnostics.ts` | Loopback-only settings/logs/diagnostics, playback capability reporting |
| `lan-tls.ts`, `discovery.ts` | LAN certificate, mDNS advertisement |
| `essentials.ts`, `logger.ts`, `crash.ts` | Shared API error shape, logging, crash handlers |
| `trash.ts`, `optimize-host.ts` | Trash-first deletion (macOS Trash / `gio trash` / `.plexy/trash`) |

Tests live next to the code (`bun run test:server` runs `scripts/test-server.ts`).

## `apps/web/src` — browser frontend (React 19, served by the server)

Entry: Vite single-file build (`vite.config.mjs`, `vite-plugin-singlefile`) → `dist/web`, embedded into `dist/server` at package time. No separate deploy.

| Area | Owns |
| --- | --- |
| `src/routes/` | TanStack Router pages: setup, connect, home, libraries, search, title detail, `watch/$fileId` player, settings |
| `src/components/videojs/` | Video.js player, chrome, menus (`ui/menu-styles.ts` owns shared menu classes) |
| `src/components/server/` | Settings panels (`panels.tsx`), preparation cache UI, device management |
| `src/components/native/native-watch.tsx` | Shared watch logic reused by the desktop mpv path |
| `src/lib/` | Client helpers: `skip-segments.ts`, subtitle labels (re-export of `@plexy/media-text`), play-card hook |
| `src/electron.d.ts` | Web-side view of the Electron bridge (imports types from `@plexy/desktop-bridge`) |

Dev: `bun run dev` starts server + Vite; Vite reads `PLEXY_PORT ?? PORT ?? 8765` for its API proxy.

## `apps/desktop/src` — Electron shell

| Area | Owns |
| --- | --- |
| `src/main/` | Window lifecycle, child backend spawn/stop, API proxy to remote servers, mpv relay, updater |
| `src/preload/` | Context-isolated bridge exposing only `packages/desktop-bridge` shapes |
| `src/types.ts` | Re-export of `@plexy/desktop-bridge` (single source of truth) |
| `native/mpv-embed/` | Vendored mpv headers + embed glue (`README.md` inside) |

Packaging: `bun run build:desktop` → `scripts/build-desktop.ts` → `dist/mac` DMG/ZIP (macOS only, ad-hoc signed). Dev: `bun run dev` in this workspace after starting root `bun run dev` with `VITE_DEV_SERVER_URL` set.

## `apps/mobile/src` — offline Android app (Expo)

Full layout rules live in `apps/mobile/README.md`. Short version:

| Area | Owns |
| --- | --- |
| `src/app/` | Thin Expo Router adapters (`(tabs)` + root stack; player at `/player/<id>`) |
| `src/features/<feature>/` | Screen logic per feature, each with own `components`/`hooks`/`lib` and a `*-screen.tsx` entry |
| `src/features/catalog/` | Artwork, rows, browsing, playback-label logic shared by catalog screens |
| `src/core/library/` | Local runtime + catalog adapter + device DB (wraps `@plexy/local-library`) |
| `src/core/client/`, `src/core/resources/` | App-wide client provider, preferences, watch-progress queue; resource loading |
| `src/core/mobile-provider.tsx` | Startup, fonts, splash, lifecycle |
| `src/shared/ui/`, `src/shared/hooks/`, `src/shared/lib/`, `src/shared/navigation/` | Genuinely shared controls/helpers only |
| `tests/` | Regression + architecture (dependency-graph) tests |

Imports: `@/` for mobile `src`; `@plexy/api-client`, `@plexy/local-library/library`, `@plexy/local-library/metadata` for shared code. No path aliases for workspace names.

## `packages/*` — shared source (no builds, imported as TypeScript)

| Package | Owns | May depend on |
| --- | --- | --- |
| `api-client` | HTTP wire contracts (`src/contracts/`), `caps.ts` (browser probing), `transport.ts` (URL/retry/deadline/error policy) | nothing |
| `local-library` | Device-local indexing/metadata/skip contracts (`library.ts`, `metadata.ts`); I/O injected via `LocalIO`/`MetadataIO` | `api-client` types only |
| `media-text` | Language names, subtitle-label formatting (was duplicated in web + mobile) | nothing |
| `desktop-bridge` | Electron IPC contract (main ↔ preload ↔ web) | nothing |
| `tsconfig` | `base.json` (packages), `bun.json` (Bun apps/scripts), `react.json` (web) | nothing |

Rules (`docs/MONOREPO.md`): packages never import from `apps/*`; add new subpaths via explicit `exports` in the package's `package.json`; declare every third-party import in the consuming workspace.

## `scripts/`, root config

- `scripts/build-server.ts` — compile server + stage `ffmpeg`, `migrations/`, `web/` into `dist/server`.
- `scripts/build-desktop.ts` — package DMG/ZIP into `dist/mac`.
- `scripts/native/build-preview.ts` — preview APK into `.build/native`.
- `scripts/test-server.ts`, `scripts/test-native.ts` — backend / native test runners.
- `scripts/native/generate-licenses.ts` — open-source license manifest for mobile.
- `turbo.json` — task graph (web build once, server/desktop/mobile consume it); `turbo run <task> --filter=@plexy/<name>` for scoped work.
- Root `package.json` — workspace tooling + scripts only; no app runtime dependencies.
