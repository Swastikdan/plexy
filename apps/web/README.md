# Web (`@plexy/web`)

Browser frontend for Plexy. React 19 + TanStack Router/Query + Video.js + Tailwind 4/HeroUI, built to a single file and **served by the server process** — there is no separate web server or deployment.

## Run / build

```sh
bun run dev                       # root: server + Vite dev (proxy follows PORT)
bun run --filter @plexy/web dev   # Vite alone (vite --host, strictPort 5173)
bun run build:web                 # root: vite build → dist/web (consumed by server/desktop builds)
```

`PORT` / `PLEXY_PORT` (default `8765`) point the Vite proxy at the backend. `VITE_DEV_SERVER_URL` points the desktop shell at Vite during `dev:desktop`.

## Layout (`src/`)

| Area | Responsibility |
| --- | --- |
| `src/routes/` | Pages: setup, connect, home, libraries, search, title detail, `watch/$fileId`, settings |
| `src/components/videojs/` | Player + chrome + menus (`ui/menu-styles.ts` owns shared menu classes) |
| `src/components/server/` | Settings panels, preparation-cache UI, device management |
| `src/components/native/` | Watch logic shared with the desktop mpv path |
| `src/lib/` | Client helpers (`skip-segments.ts`, subtitle-label shim over `@plexy/media-text`, play-card hook) |
| `src/electron.d.ts` | `window.electronAPI` types — imports from `@plexy/desktop-bridge`, never redeclared |

## Notes

- `--no-ui` / `PLEXY_NO_UI=1` on the server disables UI routes and assets; the API keeps running.
- Browser playback authenticates via HttpOnly session cookie (not Bearer) because `<video>` can't set headers.
- Verify with `bun run --filter @plexy/web typecheck` (runs after `transit` + `build` in Turbo).
