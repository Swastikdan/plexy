# Native playback (desktop, mpv)

Plexy's desktop app can play media with a native mpv window instead of the
browser player. This exists because the browser has to repack MKV files and
cannot decode HEVC, Dolby audio or PGS subtitles; mpv plays the original file
directly, so no preparation is involved.

Native playback is **macOS arm64 first**. Browsers and the website always keep
the existing React player.

## What the viewer sees

- Clicking Play opens a separate mpv window with mpv's own controls: seeking,
  volume, speed, audio tracks and subtitles.
- The Plexy window shows a small session surface: title, position, play/pause,
  ±seek, stop, an audio-language selector, skip intro/recap when markers
  exist, and next-episode handoff.
- Plexy still records watch progress, resume points, watched state and next
  episode from mpv's position events.
- `Use browser player` in the session surface (and `Play in native window` in
  the browser player's right-click menu) switches engines; the choice is
  remembered on the device.
- Native playback never shows the "Preparing for playback" blocker. It reads
  the original file even if a prepared MP4 also exists.

The Plexy overlays do not appear inside the mpv window; that is a deliberate
limitation of the separate-window milestone.

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

Desktop exposes a small engine chip on the title page: **Browser player** or
**Native player (mpv)**, with a one-click switch when mpv is available. The
browser player labels itself in its bottom title block, and the native surface
says "Native playback · separate mpv window". The choice is remembered per
device.

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
- `apps/web/src/components/native-watch.tsx` — the in-app session surface.

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

Native playback is optional at build time; without an engine the app still
ships and simply uses the browser player.

1. Pin an engine in `scripts/mpv-manifest.json` (`url` + `sha256`) **or** set
   `PLEXY_MPV_PATH` to a local binary when building.
2. `bun run package:mac` copies it to `dist/bin/mpv`, records
   `dist/bin/mpv.version`, copies sibling dylibs to `dist/bin/mpv-libs`, and
   rpath-fixes the binary best-effort.
3. `scripts/after-pack-mpv.cjs` (electron-builder `afterPack`) copies the engine
   into `Contents/Resources/bin` before DMG/ZIP artifacts are produced.

Downloads are refused without a checksum. Document the chosen mpv version in
`scripts/mpv-manifest.json` and keep its license notices with the build.

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
