# Performance, memory, and architecture budgets

How large each Plexy deliverable is, where the cost is, what changed in this
pass, and how to prove it stayed fixed. Measured on Apple Silicon (M4), macOS,
Bun 1.4.4; web boot uses headless Chrome 157 against the real server.

Sizes are decimal MB (10^6 B) unless marked MiB (2^20 B), matching the tool that
produced them.

## Method

| What | Command |
| --- | --- |
| All artifact budgets + runtime probe | `bun run perf:check` |
| Same, machine-readable | `bun scripts/perf-check.ts --json` |
| Architecture guard (one-way deps, platform-neutral packages, no cycles) | `bun run arch:check` |
| Server boot / RSS / throughput | `PLEXY_DATA_DIR=.perf/data PORT=8898 ./dist/server/plexy-server --no-ui`, then `ab -n 3000 -c 50`, `ps -o rss=` |
| Web first-load transfer | `curl -sI -H 'Accept-Encoding: gzip' http://127.0.0.1:8898/` |
| Web boot heap/CPU | Chrome DevTools Protocol, procedure below |
| Desktop bundle composition | `du -sh "dist/mac/mac-arm64/Plexy Beta.app/Contents/"*` |
| Desktop memory | launch the packaged app with `PLEXY_DATA_DIR`, sum `ps -o rss=` for its processes |
| Mobile APK composition | `unzip -lv .build/native/*.apk`, `aapt2 dump resources`, `apksigner verify` |
| Mobile startup/memory | `adb shell am start -W`, `adb shell dumpsys meminfo app.plexy.mobile` |

Generated reports (`baseline`, `perf-check`, CDP profiles, per-app audits) live
in `.perf/`, which is gitignored. Only this document, the check scripts, and the
budgets are tracked.

## Baseline → after

| Deliverable | Before | After | Change |
| --- | ---: | ---: | ---: |
| Web document, raw | 3.00 MB | **1.95 MB** | −35% |
| Web document, gzip | 873 KB | **542 KB** | −38% |
| Web document, brotli | 726 KB | **434 KB** | −40% |
| — inline JS | 2.10 MB | **1.53 MB** | −27% |
| — inline CSS (incl. fonts) | 904 KB | **417 KB** | −54% |
| — inline fonts | 190 KB (9 files) | **54 KB** (2 files) | −72% |
| — CSS rules | 4,818 | **3,086** | −36% |
| First load on the wire | 3.00 MB, no encoding, no validator | **434 KB brotli / 542 KB gzip, 304 on repeat** | −85% first / 0 repeat |
| Server binary | 85.9 MiB | 85.9 MiB | unchanged (Bun runtime bound) |
| Server + FFmpeg (default) | 143 MB | 143 MB | unchanged |
| Server + FFmpeg (minimal FFmpeg) | 143 MB | **98.6 MB** | −31% |
| Server boot | 91 ms | 84 ms | unchanged |
| Server idle RSS | 48.1 MB | 48.6 MB | unchanged |
| Server RSS after 4,000 static requests | 74.5 MB | **64.6 MB** | −13% |
| Server CPU for 4,000 static requests | 2.15 s | **0.77 s** | −64% |
| Desktop `.app` (default FFmpeg) | 560.2 MiB | **451.2 MiB** | −19.5% |
| Desktop DMG (default) | 241.3 MiB | **199.0 MiB** | −17.5% |
| Desktop `.app` (minimal FFmpeg) | 560.2 MiB | **399.7 MiB** | −28.7% |
| Desktop DMG (minimal FFmpeg) | 241.3 MiB | **178.0 MiB** | −26.2% |
| Desktop payload (`Resources/bin`) | 307.3 MiB | **198.9 MiB** | −35.3% |
| Desktop idle RSS (sum of processes) | ~364 MiB | **349 MiB** | unchanged (payload never mapped) |
| Mobile APK | 58.16 MB / 55.47 MiB | **41.77 MB / 39.84 MiB** | −28% |
| Mobile installed size | 55.3 MiB | **39.7 MiB** | −28% |
| Mobile code PSS | 62.6 MB | **42.2 MB** | −33% |
| Mobile total PSS (30 s idle, AVD) | 146.1 MB | **128.0 MB** | −12% |
| Mobile cold start (AVD, 3 runs median) | 972 ms | **630 ms** | −35% |

Boot and heap numbers are single-screen comparisons with the same API state;
artifact sizes are exact byte counts from the built files.

## What changed

### Web: stop shipping CSS and parsers nobody runs

`apps/web/src/styles.css` imported `@heroui/styles` wholesale (every HeroUI
component, the full theme, `tw-animate-css`) and both fontsource packages. The
app imports 13 HeroUI components. The stylesheet now declares the same cascade
and imports Tailwind + only the components those 13 compose (including
`popover`, `menu`, and `scroll-shadow`, which are the surfaces for
Select/Dropdown/Tooltip), plus Latin-only woff2 fonts.

`apps/web/src/routes/watch/$fileId.tsx` had a lazy `@videojs/react/media/hlsjs-video`
branch guarded by `streamUrl.includes(".m3u8")`. The server never emits HLS
(`/api/hls`, `/remux`, `/transcode` return 409; `api.streamUrl` always builds
`/api/stream/:id`), so the branch was unreachable and pulled hls.js (1.31 MB of
source across 19 modules) into the single-file bundle. It is removed; the native
`<Video>` path is unconditional.

Result: JS 2.10 → 1.53 MB, CSS 904 → 417 KB, fonts 190 → 54 KB. On the
authenticated home screen, three cold runs against the same API measured
main-thread task time 127 → 99 ms, JS heap 7.30 → 6.32 MB, and
DOMContentLoaded 69 → 57 ms. The `/`, `/settings`, and `/setup` screenshots are
pixel-identical at 1280×800, and a live Select on `/settings` resolves the
popover surface, radius, shadow, and scroll container from the selected CSS.

### Server: one compressed, validated document

`apps/server/src/app.ts` cached nothing: every navigation read
`dist/web/index.html` from disk, sent 3.00 MB with `Cache-Control: no-cache`, and
had no validator or encoding. It now:

- caches the document, keyed by path + mtime + size (a rebuild is picked up
  without restart),
- serves a strong ETag and answers `If-None-Match` with **304, 0 bytes**,
- reads the build-time `index.html.br` / `.gz` siblings emitted by
  `scripts/precompress-web.ts` and serves brotli (434 KB) or gzip (542 KB) with
  `Vary: Origin, Accept-Encoding`; if a checkout predates those files it gzips
  once in memory,
- gives static assets weak `mtime+size` ETags and 304s, keeping their cache
  lifetimes.

The same handler serves the browser, the desktop shell, and LAN clients. First
load is 540 KB instead of 3.00 MB; repeat navigations are one 304. Static
throughput improved from 1,459 req/s (identity, c=10) to **9,277 req/s** (gzip,
c=10) and **39,173 req/s** for 304s; CPU for an identical 4,000-request run fell
64%.

Also in this pass: the FTS index is verified once per process instead of via two
COUNTs on every search (~2.3 ms saved per search at 20k items), no-op scans no
longer rebuild it (40 ms + WAL churn), deleted titles remove their index row,
and the optimizer's child process is released after five idle minutes instead of
staying resident at ~40 MB.

### Desktop: stop copying an mpv build the app never runs

Native playback loads `libmpv.2.dylib` in-process from `Resources/bin/mpv-libs`
(`apps/desktop/src/main/native-player.ts`); nothing in `apps/desktop` or
`apps/server` spawns the bundled `mpv` CLI. `scripts/after-pack-mpv.cjs` was
copying that CLI plus its 98 MB dylib closure as well. It now copies only
`mpv-libs/` (+ `vulkan/`, licences), strips and re-signs the dylibs
(`strip -x -S` saves 8.8% of the libmpv closure), and `scripts/build-desktop.ts`
no longer bundles the CLI. Native playback was verified end-to-end with the
stripped library, and `codesign --verify --deep --strict` passes on the `.app`
and the mounted DMG.

Removed: 107,822,842 B (102.83 MiB) — `mpv` 5,523,680 B + `lib/` 102,299,136 B
+ version file. The `.app` is 109.0 MiB smaller and the DMG 42.3 MiB smaller.

The desktop port probe now asks the real question — is anything listening on
`127.0.0.1:<port>` — before binding, then binds the same loopback address the
server uses. Probing `0.0.0.0` succeeded on macOS while another process held
`127.0.0.1:8765`, which is how two backends ended up on one port. Two new tests
hold a port on loopback and on the wildcard address and assert both are
rejected.

The updater also streamed the update ZIP to disk with an incremental SHA-256
instead of `Buffer.concat`-ing the whole archive. Installing a 196 MiB update
used to add ~196 MiB of peak RSS; it now holds one stream chunk (plus the
unchanged 5 MB app). Same hash check, same install script, same progress events.

**Optional 4.8 MB FFmpeg.** `scripts/build-minimal-ffmpeg.sh` now builds a
4,782,680 B binary (from 59,806,336 B, −92%) with only the decode/transcode
surface Plexy uses. Verified against a generated H.264/AAC/SRT Matroska: probe,
remux, audio transcode, full VideoToolbox transcode, trickplay sprite, and
WebVTT subtitle extraction all succeed. The decoder list covers H.264, HEVC,
VP8, VP9, AAC, AC3/E-AC3, TrueHD, DTS, FLAC, MP3, Opus, Vorbis, ALAC and PCM;
subtitle decoders cover SubRip, ASS/SSA, WebVTT and mov_text. It is opt-in
because it drops AV1/WMA/PCM-float coverage and the `libx264` software fallback:

```sh
bun run ffmpeg:minimal          # -> dist/bin/ffmpeg-custom
bun run build:desktop:minimal   # -> 399.7 MiB app / 178.0 MiB DMG
bun run build:server:minimal    # -> 98.6 MB dist/server
```

The default desktop package still uses node-av until the release workflow
builds and pins the minimal binary.

### Mobile: R8, bundle compression, per-weight fonts

The release build had `android.enableMinifyInReleaseBuilds=false` and
`android.enableShrinkResourcesInReleaseBuilds=false`; R8 was off. A new Expo
config plugin (`scripts/native/with-release-optimizations.cjs`) turns on R8,
resource shrinking, and Hermes bundle compression without editing generated
`android/`. R8 cut dex from 6 files / 58.7 MB raw to **3 files / 20.1 MB**; bundle
compression stores the 5.98 MB Hermes bundle as **2.24 MB**; importing the four
used Archivo weights from per-weight paths instead of the package barrel removed
14 unused faces (3.25 → 1.46 MB of TTF). The release APK still renders and
starts correctly on an arm64 AVD; cold start fell from 972 ms to 630 ms and code
PSS from 62.6 MB to 42.2 MB.

## Architecture: one contract, split by lifecycle

The shape is already right and should be kept:

```text
packages/api-client (wire types + transport policy)
        ▲                    ▲
        │                    │
   apps/web ──────────► apps/server (one Bun process, 2 child workers)
        ▲                    ▲
        │                    │
 apps/desktop ───────────────┘        apps/mobile (no server; own SQLite)
```

- **One transport.** `createPlexyClient` owns URL building, retries, deadlines,
  credentials, and error normalization. Screens do not hand-roll API fetches.
  Mobile is deliberately separate: local-library actions are in-process and must
  not grow a network transport (guarded by `apps/mobile/tests/architecture.test.ts`).
- **One IPC contract.** `packages/desktop-bridge` is the only declaration of the
  Electron surface; main, preload, and the web UI import it.
- **One web artifact.** The server serves the same `dist/web` document the
  desktop shell embeds. There is no second UI build.
- **Two worker processes.** Probing and preparation run in children so a native
  codec crash cannot take the API down. They are pooled, not spawned per job
  (measured: 10.9–12.5 ms spawn + first probe vs 0.1–0.2 ms reuse).

`bun run arch:check` now enforces the dependency direction at build time: no
app-to-app edges, no package-to-app edges, shared packages stay platform-neutral
(no `node:`/`Bun.` in their source), the web app talks to Electron only through
`desktop-bridge`, and the package graph has no cycles. It runs as the first step
of `bun run build:check`.

## Next steps, ordered by measured payoff

### P1 — next

1. **Mobile boot parse — measured, not the bottleneck.** Parsing 2,000 records
   / 1.1 MB of JSON costs ~1 ms in Bun on this machine (`JSON.parse` + the
   `id → json` map), so the earlier 100–300 ms estimate does not hold. A
   column migration is not worth it until a device profile shows otherwise;
   the remaining cost is the folder walk and hydration below.
2. **Defer the launch scan and hydrate in batches.** `mobile-provider.tsx`
   starts a full `stat` walk immediately after restore, then awaits metadata and
   skip markers one record at a time. Defer the walk to idle and batch hydration.
3. **Ship the minimal FFmpeg by default.** The opt-in build is measured at
   4.8 MB and verified (above). Remaining work: add the build step to the
   release workflow, then flip `build-desktop.ts` to prefer
   `ffmpeg-custom`; keep node-av as the fallback until AV1/WMA coverage is
   confirmed on the target libraries.
4. **Mobile download-only variant.** `-Pexpo.useLegacyPackaging=true` builds a
   **25.04 MB** APK (native libs deflated) but raises installed size to ~50 MB
   and install time. Consider an AAB/per-ABI split instead of making it default.
   Disabling RN's Fresco GIF/WebP support saves another 0.87 MB; all app images
   use `expo-image`, but validate third-party `Image` usage first.

### P2 — later

5. **Web `cn` runtime.** `cn/dist/config2.js` is 119 KB of source for the player's
   class merge. Replacing it with `tailwind-merge`'s `extendTailwindMerge` is an
   estimated 30–45 KB minified (10–15 KB gzip), at the cost of re-testing player
   menu class merging.
6. **SQLite memory tuning — measured, no win at 20k items.** A synthetic
   catalog with 20k items, metadata and media rows is 9.3 MB; 800 catalog
   queries took 921 / 907 / 915 ms at 16 / 32 / 64 MiB cache (no measurable
   difference) and the DB fits in the smallest cache. Revisit only for 100k+
   file libraries, where 64 MiB cache + 256 MiB mmap could be capped.
7. **Worker memory.** Two child Bun processes cost ~40 MB each while active.
    Evaluate `worker_threads` for media probing (same process, separate isolate)
    and keep one process for FFmpeg preparation.
8. **Desktop window first.** `openMainWindow` awaits backend health and
    `ensureDesktopAuth` before creating the window; show the shell first and
    navigate when ready. Also exclude the duplicated `mpv_embed.node` from
    `app.asar` (82 KB; runtime resolves the extraResource).
9. **Service worker shell.** The ETag/304 contract is verified and the browser
    receives brotli through the registered worker. A dedicated conditional
    fetch inside `navigate()` is not needed while the HTTP cache revalidates;
    revisit if a browser starts bypassing it for worker responses.
10. **Home screen memory.** All shelf rows live in one `ScrollView` with
    `removeClippedSubviews={false}` and `expo-image` keeps decoded bitmaps; trim
    hero prefetch (24 → 6–10) and virtualize sections before raising the image
    cache budget.

## Budgets

`scripts/perf-check.ts` encodes a ceiling for every artifact and for the server
runtime probe. Defaults are the post-change size plus roughly 8–15%, so a
regression fails loudly without making a patch release red. Adjust a budget in
the same change that knowingly alters an artifact, and include before/after
numbers in the commit message.

The check skips an artifact that has not been built (and says so); run it after
`bun run build` for the full table, or after one app's build for one row. The
server probe warms the 86 MB binary first so boot is not measured from a cold
page cache.

## Measuring web boot (repeatable)

1. Build and start the server:
   `bun run build:web && PLEXY_DATA_DIR=.perf/data PORT=8898 ./dist/server/plexy-server`
2. Start headless Chrome:
   `"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" --headless=new --disable-gpu --remote-allow-origins='*' --user-data-dir=.perf/chrome-profile --remote-debugging-port=9222 about:blank`
3. Navigate with a cold cache, wait 4 s, force GC, and read
   `Performance.getMetrics` (`ScriptDuration`, `TaskDuration`, `JSHeapUsedSize`),
   DOM counters, and resource entries.

Compare the same screen and the same API state; a different screen changes node
count and heap without any bundle change. `.perf/cdp-measure.ts` and
`.perf/static-boot.ts` are the scratch harness used for this report (gitignored
because they depend on a local Chrome install).

## Anti-goals

- Do not split cohesive screens to reduce line count; line count is not a
  performance metric.
- Do not add a second HTTP client, a second IPC contract, or a second UI build.
- Do not trade offline-first mobile for a server dependency.
- Do not split the single-file web build into per-route chunks without measuring
  boot: the design deliberately trades one larger parse for zero request
  waterfalls.
- Do not remove Electron's GPU/network processes or the mpv payload's runtime
  libraries to win a size metric; they are used.
