# Server (`@plexy/server`)

Bun + Elysia backend and HTTP API. One process serves the JSON API and the built web UI; FFmpeg-heavy work runs in two child workers. See `docs/ARCHITECTURE.md` for the system view and `docs/API.md` for the endpoint reference.

## Run

```sh
bun run dev            # from repo root: server (watch) + web dev servers
bun run --filter @plexy/server dev    # server alone: bun --watch src/main.ts
bun run --filter @plexy/server start  # bun src/main.ts
```

`PORT` (default `8765`) sets the port. `PLEXY_DATA_DIR` selects the database dir, `PLEXY_LOG_LEVEL` the log level. `--no-ui` / `PLEXY_NO_UI=1` serves API only. `--version` / `--help` exit without booting.

## Layout (`src/`)

| File(s) | Responsibility |
| --- | --- |
| `main.ts`, `app.ts`, `runtime.ts` | Boot, route assembly, listeners, shutdown |
| `db.ts`, `migrations/` | Schema + migrations + query helpers |
| `config.ts`, `paths.ts` | Config file, data-dir paths, redacted browser view |
| `auth.ts`, `access.ts`, `accounts.ts`, `routes-auth.ts` | Pairing, Bearer/session auth, loopback-only admin guard |
| `scan.ts`, `parse.ts`, `episode-files.ts`, `media-facts.ts` | Library walk, filename parsing, probing state |
| `matcher.ts`, `tmdb.ts`, `hydrate.ts`, `artwork.ts` | TMDB match + metadata/artwork backfill |
| `ffmpeg.ts`, `media-worker.ts`, `worker-host.ts` | Probing worker |
| `optimize.ts`, `optimize-host.ts`, `optimize-worker.ts` | Preparation queue worker (remux / transcode) |
| `playback.ts`, `routes-media.ts`, `routes-catalog.ts`, `routes-collections.ts`, `routes-matching.ts` | Play/stream/download, catalog, collections, manual match |
| `subtitles.ts`, `trickplay.ts`, `skip-segments.ts`, `mkv-subtitles.ts` | WebVTT, scrub previews, skip markers, embedded sub extraction |
| `routes-admin.ts`, `routes-logs.ts`, `routes-diagnostics.ts` | Settings, logs, diagnostics (loopback-only where admin) |
| `lan-tls.ts`, `discovery.ts` | LAN HTTPS cert, mDNS advertisement |
| `trash.ts` | Trash-first deletion policy |
| `essentials.ts`, `logger.ts`, `crash.ts` | Shared error shape, logging, crash handling |

## Notes

- LAN mode (`bindAddress: "0.0.0.0"`) adds an HTTPS listener on `PORT+1` and advertises it via mDNS; cleartext stays loopback-only.
- The optimizer runs one job at a time; playback of a queued file bumps it to the front.
- Live remux/transcode and HLS routes exist only to return `409` — playback is direct or prepared MP4.
- Verify with `bun run test:server` and `bun run --filter @plexy/server typecheck`.
