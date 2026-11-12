# Plexy

Plexy has three deliverables:

- **Desktop app** (`apps/desktop`): Electron with the browser frontend and a bundled backend. **Run local server** starts or stops the bundled backend. With it off, the desktop connects to another Plexy server, including servers started with `--no-ui`.
- **Backend server** (`apps/server`): a standalone Bun executable with FFmpeg, migrations, and the built browser UI. Open its address in a browser, or disable UI serving with `--no-ui`.
- **Mobile app** (`apps/mobile`): Expo Router app for files on the Android device. No Plexy server, account, pairing, remote playback, or server downloads. Metadata, artwork, community skip markers, and app updates can use their external services.

`apps/web` is the frontend source embedded into desktop and backend releases. It is not a separate release artifact. `packages/api-client` contains browser API contracts/client logic; mobile reuses the data contracts. `packages/local-library` contains device indexing and metadata logic. Mobile app infrastructure lives in `apps/mobile/src/core`, screen-specific UI and logic in `apps/mobile/src/features`, and reusable controls in `apps/mobile/src/shared`.

## Development

Use Bun 1.4.4, then run `bun install`.

| Command | Purpose |
| --- | --- |
| `bun run dev` | Backend and frontend development servers |
| `bun run dev:desktop` | Electron shell (build the UI first, or set `VITE_DEV_SERVER_URL`) |
| `bun run dev:mobile` | Expo development server |
| `bun run android:mobile` | Generate and run the Android development app |
| `bun run typecheck` | Backend, browser, and desktop types |
| `bun run typecheck:native` | Mobile types |
| `bun run test:server` | Isolated backend tests |
| `bun run test:desktop` | Desktop API proxy tests |
| `bun run test:native` | Local-library and mobile logic tests |

See [mobile structure and build instructions](apps/mobile/README.md), [local library behavior](docs/MOBILE_LOCAL_LIBRARY.md), and [API documentation](docs/API.md).

## Build

| Command | Output |
| --- | --- |
| `bun run build:desktop` | Apple Silicon app, DMG and ZIP under `dist/mac` |
| `bun run build:server` | `dist/server/plexy-server`, `ffmpeg`, `migrations/`, and `web/` |
| `bun run build:mobile` | ARM64 Android APK under `.build/native` |
| `bun run build` | All three deliverables; reuse one frontend build |
| `bun run build:web` | Internal frontend build at `dist/web` |

Desktop packaging requires macOS. Server builds target the host platform. Android builds need JDK 17 and the Android SDK. APK previews retain the repository's test signing identity; EAS production builds use release signing.

The desktop build generates its PNG/ICNS icons and installer artwork from SVG sources. Mobile's app icon and splash mark remain checked in so Linux CI can prebuild without macOS image tools. Generated binaries, native projects, exports, logs, captures, and scratch plans are ignored.

## Backend operation

Extract the backend archive and keep its `web/`, `migrations/`, and FFmpeg alongside the executable:

```sh
./plexy-server
./plexy-server --no-ui
PLEXY_NO_UI=1 ./plexy-server
```

The default HTTP port is 8765. `PORT` overrides it. `PLEXY_DATA_DIR` chooses the database and library-data directory; `PLEXY_LOG_LEVEL` controls logging. `--version` and `--help` exit without starting the database.

The browser UI consists of static files served on demand by the same backend process. There is no separate UI process or rendering service. `--no-ui` disables UI paths and static assets while keeping API endpoints available. It does not disable the server's media processing or library jobs.

On first run, open the local UI to create the owner and configure libraries. To run headless afterward, restart with `--no-ui`. Enable LAN access in server settings before connecting other machines; use the reported HTTPS address. Remote clients still authenticate. Configure `PLEXY_ALLOWED_ORIGINS` for separately hosted browser clients; the desktop uses its own authenticated API proxy.

In desktop **Settings**, or on its server connection screen, change **Run local server**. The preference survives restarts. Disabling it stops the child backend process and reopens the window as a client. Enabling it clears the remote selection and starts the bundled server. It never stops a separately running backend.

## CI and releases

The workflow detects changed files across the whole push or pull request:

| Changed source | Release artifacts rebuilt |
| --- | --- |
| Mobile, mobile build scripts, local-library | Mobile |
| Backend or browser frontend | Backend and desktop |
| Desktop shell | Desktop |
| Shared API contracts | All three |
| Root dependency lockfile or build workflow | All three |
| Documentation only | None |

Manual dispatch selects `mobile`, `desktop`, `backend`, or `all`. The frontend is built and verified once, then passed to the backend and desktop jobs. Releases attach only selected deliverables; backend archives are produced for Linux x64 and macOS ARM64.

Android CI caches Bun packages, Gradle dependencies/task outputs, and native compilation outputs. Builds use Gradle's build cache and parallel execution, and target ARM64 phones by default. Set `PLEXY_ANDROID_ARCHITECTURES=armeabi-v7a,arm64-v8a` for older ARM devices, or include `x86_64` for emulators. `PLEXY_GRADLE_WORKERS` adjusts worker concurrency. Cold builds still compile native dependencies; timing improvements depend on cache hits.

macOS release builds are ad-hoc signed, not notarized. Install the DMG from this repository's releases, then use **System Settings → Privacy & Security → Open Anyway** if macOS blocks the first launch. The desktop updater verifies release checksums before installing the Apple Silicon ZIP.
