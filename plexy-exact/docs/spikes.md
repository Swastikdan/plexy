# Exact Phase 0 evidence — 2026-11-09

Status: **NO-GO pending native integration and device verification**. This is a port foundation, not a working replacement for the existing apps. Phases 1–6 have not been implemented. No native binary was produced.

## Reproducibility

Exact repository and commit are recorded in `../runtime.lock.json`:
`94b8671f70fe2e25b307a40e7fce66dc27c9f802`. Source checkout was inspected at that commit. `tools/setup.ts` checks both HEAD and a clean checkout before generating a launcher. Generated files contain local checkout paths and are excluded from git. The folder is `plexy-exact` because Exact's generator rejects uppercase project folder names. No runtime patches are applied.

The pinned generator's `createApp` API produced the starter manifest and Contract structure; no native build was performed. The placeholder screen explicitly reports pending verification. The pure conversion policy and the specification's SQLite schema are independently tested with Bun; neither is connected to a native runtime yet.

## Commands and observed results

- `git checkout 94b8671f70fe2e25b307a40e7fce66dc27c9f802`: succeeded.
- `bun <runtime>/scripts/exact.mjs new ./PlexyExact`: refused during prerequisites. No rustup or Rust installed; runtime requires Rust 1.97.0. Runtime expects Bun 1.4.2; installed Bun is 1.4.4. Runtime dependencies and Chrome also absent.
- The generator additionally requires a lowercase-hyphenated folder name; `createApp('./plexy-exact', {with:['macos','android'], ...})` succeeded. `mac` is a CLI alias, but the API requires `macos`.
- `adb devices`: no devices connected. No Android model/OS can be recorded or tested.
- `bun test plexy-exact/tests`: 9 passing tests, covering SQL installation, planning, argument construction, verification, and failure ordering before deletion.

## Android player blocker

The pinned `host/android/canvas/src/main/java/dev/exact/canvas/Natives.kt` exposes hosted module input through `click(...)`, which calls only the root view's `performClick()`. It does not dispatch a MotionEvent into child controls. `packages/camera/android/Camera.kt` explicitly documents that hosted views take no touches beyond a click.

A Media3 PlayerView can therefore not be assumed to provide a usable seek bar or audio/subtitle menus. Resolve this with either a narrowly tested host input patch or Contract track/seek controls calling a native module. Prove the surface, lifecycle, accessibility and track switching on a phone before continuing to the UI phases. No patch has been guessed or declared working.

## Remaining Phase 0 acceptance

- Install the pinned Bun and Rust toolchain, runtime dependencies and Hermes bundles (`exact setup`).
- Implement and compile AVPlayerView and Media3 modules using the pinned package interfaces.
- Verify macOS bundled home/doc grants and FFmpeg process access using disposable fixtures.
- Verify MediaStore permissions in the final APK and import a shared-storage video.
- Test native playback, track switching and progress on both platforms.
- Select Android conversion integration only after playback/import pass. Direct-play fallback is not yet accepted or claimed implemented.

## GitHub builds and updates

The existing `build.yml` and in-app updater code are preserved, including the latest fetched `origin/main` changes. `exact.yml` runs the portable safety tests on this branch and PRs. It deliberately does not publish an unverified Exact app.

The user requires GitHub build updates in the new app, overriding the spec's original exclusion of auto-update. This is an outstanding release requirement: add an explicit check/download flow for this repository's releases, platform-specific Exact assets, SHA256SUMS verification, and platform install handoff. Do not point Exact at legacy Electron/RN artifacts, and do not silently install downloads. No Exact update UI or installer exists yet.
