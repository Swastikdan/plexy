# Desktop (`@plexy/desktop`)

Electron shell for Plexy (macOS ARM64). Bundles the web UI and a child backend process, with a remote-client mode, an mpv video window, and a checksum-verified updater.

## Modes

- **Run local server (on):** spawns the bundled `plexy-server` as a child process; stopping it never touches an external server.
- **Run local server (off):** this window becomes a client to a remote Plexy via an authenticated API proxy. Cookies/credentials are never forwarded across servers.

The mpv window reuses the Plexy player chrome and streams the original over an authenticated loopback relay, bypassing browser preparation.

## Develop on Apple Silicon macOS

Install Bun, Node.js, and FFmpeg as described in the [root setup](../../README.md#develop-locally).
From the repo root:

```sh
bun run build:web
PLEXY_DATA_DIR="$PWD/.data/desktop" bun run dev:desktop
```

Electron starts a local backend that serves the built UI. Open a local title to
verify the window and API work together. Install mpv (for example with Homebrew)
before testing native playback. Rebuild the web assets after editing the renderer
or start `bun run dev` with separate web/server state and set
`VITE_DEV_SERVER_URL=http://localhost:5173` on the desktop command to load Vite
and its API proxy.

`bun run build:desktop` packages a macOS ARM64 DMG and ZIP under `dist/mac`.
See the [release guide](../../README.md#release) for version reservation and
first-launch instructions.

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
