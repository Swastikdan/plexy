# Plexy

A personal, local-first home media server: point it at folders of movies and TV shows, and it organises them into a Netflix-style library with posters, backdrops, cast, trailers, watch progress, and intelligent browser playability routing.

The repository is structured as a clean **monorepo**:
- **`apps/server`**: Elysia backend API server with Mediabunny probe/transcode, SQLite storage, TMDB matcher, and embedded SPA static serving.
- **`apps/web`**: Netflix-style web app built with React 19, TanStack Router & Query, Tailwind CSS 4, and Lucide icons.
- **`packages/api-client`**: Typed RPC client powered by `@elysiajs/eden` Treaty, shared types, and browser capability probes.
- **`dist/plexy`**: Standalone local executable that runs both the web server and backend API in a single process.
- **`/Applications/Plexy.app`**: Native macOS application bundle built with the Medusa app icon; double-clicking launches the server and opens Plexy in your default browser.
- **`dist/web`**: Statically exportable web build for hosting on any web host or CDN.

---

## Quick Start

### 1. Development (Concurrent Server + Web)

```sh
bun install
bun run dev
```

- Starts the Elysia API server on `http://localhost:8765` with watch mode.
- Starts the Vite frontend on `http://localhost:5173`, with proxy strictly routing `/api/*` to the backend.
- Typed RPC via `@elysiajs/eden` Treaty connects frontend queries with zero manual boilerplate while keeping standard REST endpoints available for curl or network devices.

### 2. Full Build (Web + Standalone Executable + macOS App)

```sh
bun run build
```

This compiles:
1. `bun run build:web` → builds production SPA into `dist/web`.
2. `bun run build:executable` →
   - Generates standalone executable `./dist/plexy` (which bundles web server and backend).
   - Generates `dist/Plexy.app` macOS application bundle using the Medusa icon (`AppIcon.icns`).
   - Automatically installs `Plexy.app` into `/Applications/Plexy.app`.

### 3. Launching Plexy

- **From macOS Applications / Spotlight / Dock**: Open `Plexy` in `/Applications`. It will start the server and open `http://localhost:8765` in your browser.
- The packaged app stores its database, settings, artwork, and playback cache in `~/Library/Application Support/Plexy`, with logs in `~/Library/Logs/Plexy`. On first launch, newer data from the old `/tmp/plexy-dev` location is moved into Application Support; any previous Application Support folder is kept as a timestamped backup.
- **From Terminal**:
  ```sh
  ./dist/plexy
  # Or: bun run start
  ```
  Open `http://localhost:8765`. Both the web UI and API are served from that single process.

### 4. Hosting Web Version on the Web

The frontend in `dist/web` is a static Single Page Application and can be hosted on Vercel, Netlify, Cloudflare Pages, S3, or Nginx:
- Set `VITE_API_URL=https://your-plexy-server.com` in `apps/web/.env.production` or your build environment.
- The backend has CORS enabled to accept requests from web-hosted clients with credentials support.

---

## Scripts

| Command | Action |
| --- | --- |
| `bun run dev` | Run server and Vite web client concurrently |
| `bun run dev:server` | Run Elysia server alone (`apps/server`) with watch mode |
| `bun run dev:web` | Run Vite web dev server alone (`apps/web`) |
| `bun run build` | Build `dist/web`, `dist/plexy`, and install `/Applications/Plexy.app` |
| `bun run build:web` | Build web client to `dist/web` |
| `bun run build:executable` | Build local standalone executable and macOS `.app` bundle |
| `bun run start` | Run server from source with Bun |
| `bun run test` | Run backend test suite (`apps/server/tests`) |
| `bun run typecheck` | Typecheck all packages with strict TypeScript |

---

## Configuration & Environment

- The version is maintained in `apps/server/src/config.ts` (`version: "0.1.0"`).
- Supported environment variables in `.env`:
  - `VITE_PUBLIC_TMDB_ACCESS_TOKEN` / `TMDB_TOKEN`: Read-access token for TMDB. Automatically bound by default if present; user is only prompted if missing or invalid.
  - `VITE_PUBLIC_TMDB_API_URL`: TMDB API base URL (default: `https://api.themoviedb.org/3`).
  - `PORT`: Server listen port (default `8765`).
  - `PLEXY_DATA_DIR`: Data and database directory (default: macOS `~/Library/Application Support/Plexy`, dev `/tmp/plexy-dev`).
  - `PLEXY_LOG_LEVEL`: Log level (`debug`, `info`, `warn`, `error`).

---

## Key Features

- **RPC & REST Endpoints**: Frontend connects via `@elysiajs/eden` Treaty typed RPC client, while all individual REST endpoints (`/api/items`, `/api/home`, `/api/stream/:fileId`, `/api/subtitles/:fileId/:track.vtt`, `/api/local-folders`, `/api/settings/tmdb/test`, etc.) remain fully accessible.
- **Smart Setup Flow**:
  - Automatically redirects to `/setup` on initial launch if setup is incomplete, and returns to Home (`/`) once completed.
  - Automatically verifies TMDB connection if configured via environment, showing a verified badge without asking for redundant input.
  - File browser with quick shortcuts (`Movies`, `Downloads`, `Desktop`, `Home`, `Drives`), direct path input field, breadcrumbs navigation, and "+ Add this folder" button.
- **Netflix-Style Clean UI**:
  - Featured hero banner with backdrop, title logo, year, rating, runtime, overview, and Play / Trailer / Details actions.
  - Continue Watching carousel with Netflix-style red progress bars.
  - Horizontal scrolling carousels with smooth arrow paging and hover zooms.
  - PRD Page 3 Title detail screen with technical media specs, playability badge (Direct, Remux, Transcode), season/episode selectors, and cast list.
  - Fullscreen video player with custom controls, skip ±10s, volume slider, playback speed, WebVTT subtitle track switcher, and next episode button.
- **Branding**:
  - Medusa logo icon integrated in TopNav, browser tab favicon, and native macOS Application iconset.
- **Comprehensive Backend Tests**:
  - 23 unit and integration tests across 5 test suites covering config, filename parsing (Emby/Jellyfin naming), candidate scoring, playability classification, and Elysia API routes.

This product uses the TMDB API but is not endorsed or certified by TMDB.
