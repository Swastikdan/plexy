# Embedded native playback (desktop, libmpv)

Plexy's desktop app plays media with **libmpv embedded in the main window**. This
exists because the browser has to repack MKV files and cannot decode HEVC, Dolby
audio or PGS subtitles; mpv plays the original file directly, so no preparation
is involved.

The video surface lives *inside* the Plexy window, under Chromium's compositor;
the player controls are the ordinary Video.js skin. Browsers and the website
always keep the existing React + Video.js player.

Native playback is **macOS arm64 first**.

## What the viewer sees

- Clicking Play opens the original file in the app window. There is no second
  window and no preparation screen.
- The player chrome is the same Video.js skin as the website: play/pause, ±10s,
  volume popover, time slider with buffered range, audio track menu, captions
  menu, settings (audio, speed, captions), fullscreen, and the same auto-hide
  behaviour. Left/right arrow keys seek ±10s and accelerate while held (up to
  120s per step); double-tap left/right still seeks.
- Fullscreen expands the native window. HTML element fullscreen is deliberately
  not used: Chromium puts the page in its own opaque compositor surface, which
  hides the embedded video surface (a black screen).
- Plexy still records watch progress, resume points, watched state and next
  episode from the playback position.
- Native errors remain visible without falling back to browser preparation.

### How the video is drawn in the window

Chromium cannot composite another process's window into its view tree, so the
player is libmpv, not the `mpv` application:

1. `apps/desktop/native/mpv-embed` is a small N-API module that loads libmpv at
   runtime, renders with libmpv's OpenGL render API into an `NSOpenGLView`, and
   reports properties/events to JavaScript.
2. The view is inserted into the window's content view **below Chromium's
   compositor view**. The window is transparent and the player route makes the
   page transparent, so video shows through where the page has no chrome.
3. `apps/web/src/components/native/mpv-media.ts` implements the HTMLMediaElement
   shape Video.js expects (`currentTime`, duration, paused, volume, text tracks,
   DOM events). The existing Video.js skin, controls, hotkeys and gestures drive
   mpv through that adapter; there is no second control surface to keep in sync.

A `CAOpenGLLayer` looked like the natural fit, but on current macOS it is never
asked to draw when it sits below Chromium's compositor view. An `NSOpenGLView`
composites correctly there. The renderer never touches decoded frames.

Clicking the video surface does not toggle playback on desktop. macOS delivers
the click that focuses an inactive window to the page, which would otherwise
resume a paused player whenever the viewer switched windows or Spaces and came
back. Play/pause stays on the button and Space/K.

The loopback relay keeps working exactly as before: libmpv receives a
short-lived `127.0.0.1` URL and never the backend cookie or token.

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
- `GET /api/stream/:fileId?audio=N` — the prepared copy for language N.

Both are covered by `apps/server/tests/native-playback.test.ts` and
`apps/server/tests/audio-variants.test.ts`.

## Which player is running?

The desktop app always uses the embedded player; there is no engine chip to
configure. Hover prefetches use the native manifest too, so pointing at Play
never starts browser optimization in the desktop app.

## Desktop architecture

- `apps/desktop/src/main/native-player.ts` — one active session, manifest fetch,
  relay registration, sidecar subtitles, event mapping, stale-session rejection,
  cleanup on stop/quit.
- `apps/desktop/src/main/native-relay.ts` — loopback HTTP relay (Range requests,
  backpressure, active-server-only).
- `apps/desktop/native/mpv-embed` — N-API module: libmpv handle, render context,
  `NSOpenGLView` surface, property observations and typed commands.
- `apps/desktop/src/preload/index.ts` — typed bridge (`native:info`,
  `native:play`, `native:command`, `native:stop`, `native:event`).
- `apps/web/src/components/native/native-watch.tsx` — the player route: the
  Video.js skin plus Plexy's back/title/skip chips and progress wiring.
- `apps/web/src/components/native/mpv-video.tsx` + `mpv-media.ts` — the media
  component and adapter that connect the session to the Video.js player store.

The renderer names a file id, never a URL or executable. The main process
fetches the manifest with Chromium's session cookies, validates that the server
belongs to the trusted window (or is loopback), and only then starts a session.

## Development

```bash
# Homebrew libmpv is picked up automatically
brew install mpv
bun run dev:desktop

# or point at a specific engine
PLEXY_LIBMPV=/path/to/libmpv.2.dylib bun run dev:desktop
```

`bun run build:main` compiles the native module with the system toolchain (no
node-gyp, no Electron rebuild). Outside the desktop app the bridge is absent and
the browser player is used.

## Packaging

Packaging requires a libmpv build. `scripts/bundle-libmpv.ts` copies libmpv and
its non-system dylib closure into `dist/bin/mpv-libs`, rewrites install names to
`@loader_path`, and ad-hoc signs the result; `after-pack-mpv.cjs` copies it into
`Contents/Resources/bin/mpv-libs` and re-signs it inside the bundle.

1. Set `PLEXY_LIBMPV_SOURCE` to a `libmpv.2.dylib`, **or** install mpv with
   Homebrew (the default search path).
2. `bun run package:mac` builds the desktop shell and native module, bundles
   libmpv, and packages the app.
3. The renderer loads `Resources/bin/mpv-libs/libmpv.2.dylib`; in development it
   falls back to `dist/bin/mpv-libs` and Homebrew paths.

The mpv CLI remains bundled for the server's media inspection; the player itself
never spawns it. Keep engine changes documented and include the required license
notices with the build.

## Checks

```bash
bun test apps/desktop/tests          # manager (fake engine) + relay
bun test apps/server/tests/native-playback.test.ts
bun run typecheck
```

Manual checks that need real media and a display: H.264/AAC MP4, H.264 MKV,
HEVC MKV, multiple audio tracks, SRT/ASS/PGS subtitles, seek/resume, audio and
caption menus, fullscreen, local and authenticated remote servers, rapid title
changes, leaving the player mid-playback, and a packaged app with no Homebrew
mpv present.
