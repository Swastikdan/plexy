# Desktop (`@plexy/desktop`)

Electron shell for Plexy (macOS ARM64). Bundles the web UI and a child backend process, with a remote-client mode, an mpv video window, and a checksum-verified updater.

## Modes

- **Run local server (on):** spawns the bundled `plexy-server` as a child process; stopping it never touches an external server.
- **Run local server (off):** this window becomes a client to a remote Plexy via an authenticated API proxy. Cookies/credentials are never forwarded across servers.

The mpv window reuses the Plexy player chrome and streams the original over an authenticated loopback relay, bypassing browser preparation.

## Run / build

```sh
bun run dev                  # root: backend + web dev servers (do this first)
VITE_DEV_SERVER_URL=http://localhost:5173 bun run dev:desktop
bun run build:desktop        # root: web build + server compile + DMG/ZIP → dist/mac
```

Packaging needs macOS (`electron-builder`, ad-hoc signed). First launch: System Settings → Privacy & Security → Open Anyway.

## Layout (`src/`)

| Area | Responsibility |
| --- | --- |
| `src/main/` | Window lifecycle, child backend spawn/stop, remote API proxy, mpv relay, updater |
| `src/preload/` | Context-isolated bridge (exposes only `desktop-bridge` shapes) |
| `src/types.ts` | Re-export of `@plexy/desktop-bridge` — the single IPC source of truth |
| `native/mpv-embed/` | Vendored mpv headers + embed glue |

## Notes

- IPC shapes live in `packages/desktop-bridge`. Do not redeclare them here or in `apps/web/src/electron.d.ts`.
- Verify with `bun run test:desktop` and `bun run --filter @plexy/desktop typecheck`.
