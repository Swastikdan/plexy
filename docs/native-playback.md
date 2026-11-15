# Native playback (desktop, mpv)

Plexy's desktop app plays media with a native mpv window. This exists because the browser has to repack MKV files and
cannot decode HEVC, Dolby audio or PGS subtitles; mpv plays the original file
directly, so no preparation is involved.

Native playback is **macOS arm64 first**. Browsers and the website always keep
the existing React player.

## What the viewer sees

- Clicking Play opens the video in a native mpv window. mpv's own on-screen
  controller is disabled: Plexy draws the player chrome in the app window, using
  the same layout and controls as the Video.js skin (time slider, ±10s, volume,
  audio, subtitles, speed, fullscreen). mpv is only the video surface.
- Seeking, volume, mute, speed, audio and subtitle track selection and
  fullscreen are all driven from that one control surface over mpv's JSON IPC.
- Plexy still records watch progress, resume points, watched state and next
  episode from mpv's position events.
- Desktop always uses mpv, ignoring old browser-player preferences. Native errors
  remain visible without falling back to browser preparation.
- Native playback never shows the "Preparing for playback" blocker. It reads
  the original file even if a prepared MP4 also exists.

### Why the video is not drawn inside the app window

True single-window playback needs libmpv rendered into an app-owned macOS
`NSView`, which means a native Node addon (Objective-C++, AppKit/OpenGL or
Metal), packaging for arm64, and its own signing story. The bundled player is the
`mpv` application, not libmpv. `mpv --wid` exists on macOS, but it takes an
`NSView*` and is not a supported drop-in: it covers the whole window (and the
React UI with it) and is known to produce a black video surface inside Electron.
So the current architecture keeps the video in mpv's window and owns every
control in the Plexy window instead of faking an embedded surface.

Background preparation (`apps/server/src/optimize.ts`) is what removes the
remaining wait: files that cannot stream as-is are converted right after a scan,
not when someone presses Play, so a browser client never sees a preparation
screen for a library that has already settled.

## Backend

- `GET /api/stream/:fileId/original` — original bytes with Range/206/416,
  correct content type per container (MKV is not labelled MP4), and the same
  authentication and library access rules as every other file route.
- `GET /api/play/:fileId?native=1` — a manifest that reports `path: "direct"`,
  includes `native.streamUrl` and the preferred audio language, and never
  enqueues browser preparation. It still returns resume point, title, next
  episode, subtitle tracks and versions.
- `GET /api/play/:fileId?audio=N` — readiness for one audio language, plus a
  short on-demand preparation when that language has no copy yet.
- `GET /api/stream/:fileId?audio=N` — the prepared copy for language N. The
  primary copy only carries the first track, so browsers (which cannot switch
  audio inside one MP4) get a second file per selected language.

Both are covered by `apps/server/tests/native-playback.test.ts` and
`apps/server/tests/audio-variants.test.ts`.

## Which player is running?

Desktop exposes a small engine chip on the title page: **Native player (mpv)**
or **Native player unavailable**. Hover prefetches use the native manifest too,
so pointing at Play never starts browser optimization in the desktop app.

## Desktop architecture

- `apps/desktop/src/main/native-player.ts` — one active session, mpv JSON IPC
  (newline-delimited, request ids, timeouts, stale-session rejection), track
  preference matching, sidecar subtitles, crash/EOF/close events, cleanup on
  quit.
- `apps/desktop/src/main/native-relay.ts` — loopback HTTP relay. mpv never sees
  cookies or tokens: Electron registers the specific stream/subtitle URLs for
  the session and hands mpv unguessable `127.0.0.1` URLs. The relay forwards
  Range requests with backpressure and refuses anything not on the active
  server.
- `apps/desktop/src/preload/index.ts` — typed bridge (`native:info`,
  `native:play`, `native:command`, `native:stop`, `native:event`).
- `apps/web/src/components/native-watch.tsx` — the player surface: the only
  control UI (shaped like the Video.js skin), fed by mpv events and driving mpv
  commands.
- `apps/web/src/components/home-hero.tsx` + the `/home` route — the hero's Play
  button opens the file the server resolved: a movie's own file, or the last
  watched / first episode of a series.

The renderer names a file id, never a URL or executable. The main process
fetches the manifest with Chromium's session cookies, validates that the
server belongs to the trusted window (or is loopback), and only then starts
mpv.

## Development

```bash
# use an installed engine
PLEXY_MPV=/opt/homebrew/bin/mpv bun run dev:desktop
```

`bun run dev:desktop` starts the local backend, so native playback works
against it. Outside the desktop app the bridge is absent and the browser player
is used.

## Packaging

Native playback is required at build time. Packaging fails when no engine is
configured, so desktop releases cannot silently ship with browser-only playback.

1. Pin an engine in `scripts/mpv-manifest.json` (`url` + `sha256`) **or** set
   `PLEXY_MPV_PATH` to a local binary when building.
2. `bun run package:mac` copies it to `dist/bin/mpv`, records
   `dist/bin/mpv.version`, copies sibling dylibs to `dist/bin/mpv-libs`, and
   rpath-fixes the binary best-effort.
3. `scripts/after-pack-mpv.cjs` (electron-builder `afterPack`) copies the engine
   into `Contents/Resources/bin` before DMG/ZIP artifacts are produced.

Downloads are refused without a checksum. The manifest currently pins the
official mpv 0.42.0 macOS 15+ arm64 CI build. It arrives as a zip containing an
`mpv.app`; the build extracts the nested archive, copies the engine's `lib/`
and Vulkan ICD files, and signs them for the app bundle. Document any engine
change in `scripts/mpv-manifest.json` and keep its license notices with the
build.

The macOS workflow caches `.build/mpv`, so the verified archive is downloaded
once per manifest revision.

## Checks

```bash
bun test apps/desktop/tests          # relay + manager (fake mpv)
bun test apps/server/tests/native-playback.test.ts
bun run typecheck
```

Manual checks that need real media and a display: H.264/AAC MP4, H.264 MKV,
HEVC MKV, multiple audio tracks, SRT/ASS/PGS subtitles, seek/resume, local and
authenticated remote servers, rapid title changes, mpv window close, app quit,
and a packaged app with no Homebrew mpv present.
