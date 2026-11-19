# Build, dev, and code health

This is the current audit of how Plexy runs and builds, what the codebase actually
costs, and the order to reduce it. Numbers are measured from the working tree with
`cloc`; they exclude `node_modules`, `dist`, `.build`, and the generated Android
project.

## Short version

- Authored TypeScript is **59,179 lines**. All authored code, including JSON, CSS,
  SQL, workflows, and native headers, is **72,530 lines**. The 500k–600k figure is
  the dependency tree: `node_modules` alone contains **235,828 JS/TS files**.
- Cross-file duplication is already low. An exact-clone scan (12 normalized lines
  or more) found about **1,000 physical lines**, roughly 1.4% of authored code.
- The build system is not short of orchestration; it is short of a single name per
  action. The changes below removed the duplicate entry points and the drifted
  contracts. Further LOC reduction is a series of focused 20–40 line refactors,
  not a rewrite.

## What was fixed

### One command per action

The root `package.json` had grown to 33 scripts with chain aliases:

| Removed | Why |
| --- | --- |
| `build:backend` | alias of `build:server` |
| `build:native:preview` | alias of `build:mobile` |
| `dev:server`, `dev:web` | narrower versions of `turbo run dev --filter=…` |
| `apps/desktop` `package` | a second packaging path that skipped the web build, FFmpeg, mpv, and libmpv setup |

`bun run test` used to mean "server tests only", which contradicted the name and
the CI split. It now runs every non-E2E workspace suite; the per-area commands
remain for a tight loop.

The root script list is now 29 entries, grouped into dev, build, check, test,
typecheck, release, and native E2E families. There are no aliases.

### One port

Three names drove one port: the server read `PORT`, the Vite proxy read
`PLEXY_PORT`, and the browser read `VITE_PLEXY_PORT`. `PORT=9000 bun run dev`
started the backend on 9000 and proxied the UI to 8765.

`apps/web/vite.config.mjs` now resolves `PLEXY_PORT ?? PORT ?? 8765` once and
uses it for the proxy and for `import.meta.env.VITE_PLEXY_PORT`, which the
desktop shell uses to reach the backend for native playback. The dev server also
sets `strictPort`, so a busy 5173 fails loudly instead of silently moving to
5174 and breaking the native-player port check.

### One contract for the Electron bridge

The `ElectronAPI`, `NativePlayback*`, `UpdateStatus`, and `UpdateProgress` shapes
existed three times: `apps/desktop/src/types.ts`, `apps/desktop/src/main/native-player.ts`
(and `updater.ts`), and `apps/web/src/electron.d.ts`. They had already drifted:
the main process required `serverOrigin` on native play requests while the
renderer contract did not, and the main process event type omitted the
`fullscreen` event the web player handles.

`packages/desktop-bridge` is now the only declaration. `types.ts` re-exports it,
`native-player.ts` and `updater.ts` import from it, and `electron.d.ts` imports
the types for the global `window.electronAPI`.

### One set of player menu classes

Seven in-player menus repeated the same trigger, content, back-item, and icon
class lists eight times. `apps/web/src/components/videojs/ui/menu-styles.ts`
owns them. The component files keep only their own markup and labels.

### One set of language and subtitle labels

`apps/web/src/lib/subtitle-label.ts` and `apps/mobile/src/shared/lib/media-language.ts`
carried the same 50-line language table, the same `cleanSubtitleName`, and the
same display-name function. `packages/media-text` now owns language names,
options, identity matching, title cleaning, and the `Name · Language` label. The
two app modules are thin re-export shims, so screens did not need a rename.

### Deleted dead code

- `apps/mobile/src/features/title/components/season-tabs.tsx` (85 lines) was
  replaced by the season picker and had no importers.
- `apps/mobile/src/features/title/components/title-quick-actions.tsx` (47 lines)
  had no importers.
- Repeated poster-skeleton markup in `shared/ui/skeleton.tsx` became two small
  components (`PosterCardSkeleton`, `PosterShelfSkeleton`).
- The "Remove this title" confirmation is now one helper
  (`shared/ui/hidden-title-action.ts`) used by both the device and online sheets.

Net effect: about **620 lines removed** after counting the two new shared
packages, with no behavior change.

### Shared behavior extracted in the second pass

- **Skip markers.** `routes/watch/$fileId.tsx` and
  `components/native/native-watch.tsx` both matched intro/recap/outro windows and
  built the "Skip ending" label. Both now use `apps/web/src/lib/skip-segments.ts`;
  the watch-only "this viewer usually skips it" counters stayed in the route.
- **Play from a card.** Home and Search had byte-identical `handlePlay`
  callbacks. `shared/hooks/use-play-card.ts` owns the rule: play a known file,
  otherwise fetch the detail and pick the first unwatched episode.
- **Popover chrome.** The tooltip, volume popover, and settings menu repeated the
  same anchored-popup animation and side-origin classes. They share
  `popoverChromeClass`, `popoverBridgeClass`, and `popoverSurfaceClass` from
  `videojs/ui/menu-styles.ts`.
- **Route errors.** Every `Response.json({ error: … }, { status })` in the route
  modules, the global handler, and the access guards now calls
  `apiError(message, status?)` in `server/src/essentials.ts`. This one is a
  consistency win more than a line win: the response shape has one definition.

These shrank the duplicated blocks but moved some code into small modules, so the
measured line count moved by only a few dozen lines. That is expected: extraction
is about one source of truth, not about hiding code.

## Where the lines actually are

| Area | TypeScript lines |
| --- | ---: |
| Mobile (`apps/mobile`) | 23,556 |
| Web (`apps/web`) | 15,920 |
| Server (`apps/server`) | 13,253 |
| Desktop (`apps/desktop`) | 3,171 |
| Shared packages | 1,886 |
| Scripts | 1,393 |

Two files inflate a naive count without being authored source:
`apps/mobile/src/features/settings/data/open-source-licenses.json` (7,412 lines,
generated) and `apps/desktop/native/mpv-embed/include/mpv/*.h` (2,818 lines,
vendored). `apps/mobile/android` is generated and ignored by Git; it is not in
the table.

The largest authored files are large screens, not duplicated logic:

| File | Lines |
| --- | ---: |
| `apps/web/src/components/server/panels.tsx` | 2,350 |
| `apps/mobile/src/features/title/title-screen.tsx` | 1,846 |
| `apps/web/src/routes/watch/$fileId.tsx` | 1,412 |
| `apps/mobile/src/features/player/playback-screen.tsx` | 1,421 |
| `apps/server/src/optimize.ts` | 1,390 |

Splitting these files improves navigation but does not reduce lines. Only sharing
behavior does.

## Remaining reduction

The clone scan is now clean for exact cross-file blocks above 14 normalized
lines, apart from destructuring and repeated JSX prop lists. What is left is
behavior that looks similar but has different rules:

1. **Server id validation (deferred).** About twenty handlers do
   `Number(params.id)` with inconsistent validation. A `positiveId(raw)` helper
   would be smaller and stricter, but it changes 400-vs-404 behavior on routes
   around auth and deletion. Do it as its own change with route tests for each
   status code.
2. **Mobile action labels.** "Continue watching" and the watched/unwatched label
   are still written in both title action sheets. The shared helper can grow to
   cover them, but the two sheets differ in destructive actions and should not be
   merged wholesale.

The earlier scan also flagged `use-player-controls.ts` and `playback-screen.tsx`,
but the matching block was only the hook's destructuring assignment. The auto-hide
loop already lives in the hook; there is nothing to merge there.

Anything larger requires deleting a feature or merging an app. Do not split large
screens for the line count; the top files are cohesive screens, not duplication.

## Build model

```
bun run build
  build:web            dist/web (once)
  assemble:server      server compile -> dist/server + ffmpeg + migrations + web
  package:desktop      server compile (reused) + Electron main/preload + mpv
  build:mobile         Expo prebuild -> Gradle APK -> .build/native
```

`bun run build:server` and `bun run build:desktop` each rebuild the web artifact
they need; `bun run build` builds it once. Mobile stays opt-in because it needs
JDK 17 and the Android SDK.

CI mirrors this: one `verified-web` artifact, composite actions for the macOS and
server packaging, and a release job that only downloads artifacts. There is no
second packaging path left in the repo.

## Guardrails

- One script name per action. If a narrower command is needed, use
  `bun run --filter @plexy/<name> <script>`; do not add an alias.
- New cross-app display logic goes in a package (`media-text` today). New
  Electron IPC shapes go in `desktop-bridge`.
- A file split is not a line reduction. Share behavior only when the two copies
  can be shown to agree.
- Before handoff: `bun run typecheck`, `bun run test`, and
  `bun run build:check:mobile` (the last one also runs lint and the Metro export).
