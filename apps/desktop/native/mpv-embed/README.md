# mpv-embed

N-API module that embeds libmpv in the Plexy desktop window.

- `src/mpv_embed.mm` — libmpv handle, OpenGL render context, `NSOpenGLView`
  surface, property observations and typed commands.
- `include/node_api*.h` — N-API headers, vendored so the module builds without
  `node-gyp` or Electron headers.
- `include/mpv/*.h` — libmpv 0.42 client/render headers (LGPL-2.1-or-later).

## Build

`bun run --filter @plexy/desktop build:main` compiles the module to
`apps/desktop/dist/native/mpv_embed.node` with `xcrun clang++` (macOS only). It is
an N-API bundle: no Electron ABI rebuild is needed.

The module loads libmpv at runtime, so the same binary works with a system
engine (`/opt/homebrew/opt/mpv/lib/libmpv.2.dylib`) or the packaged bundle
(`Contents/Resources/bin/mpv-libs/libmpv.2.dylib`).

## Surface

The module intentionally exposes only what the main process needs:

- `attach(windowHandle, x, y, width, height)` / `setBounds` / `setVisible`
- `load(url, startSeconds, title, audioLanguage)`
- `setProperty`, `getPropertyString`, `command`
- `destroy`

It never receives filesystem paths or credentials; media arrives through the
loopback relay in `apps/desktop/src/main/native-relay.ts`.

## Rendering

libmpv's OpenGL render API draws into an `NSOpenGLView` placed below Chromium's
compositor view. The player page is transparent over the surface, so the
Video.js chrome renders above the video in the same window. `CAOpenGLLayer` was
tried first and is not drawn below the compositor on current macOS.
