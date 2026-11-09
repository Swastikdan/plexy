# Port evidence and runtime corrections

Updated 2026-11-10. The original scaffold-only Phase 0 status has been superseded by native implementation and build work. Hardware acceptance is tracked separately from successful compilation.

## Revisions

- Exact: `94b8671f70fe2e25b307a40e7fce66dc27c9f802`.
- Bun 1.4.2; Rust 1.97.0; Hermes upstream `d412d3bd851278712c20cca25d094e32641a0465`.
- Android Hermes builder: Ibex `a0183568e8229b8243629cdb26cd4a88ac4e2abd`. Built locally from that source and installed with Exact's receipt verifier.
- Media3 1.9.0; maintained FFmpegKit `dev.ffmpegkit-maintained:ffmpeg-kit-full-gpl:8.1.7`; missing POM dependency supplied explicitly as `com.arthenica:smart-exception-java:0.2.1`.
- macOS static FFmpeg/ffprobe 9.0.2. Executable SHA-256 pins and URLs are in `tools/install-ffmpeg.ts`; both downloaded executables matched the distributor's hashes. Notices and GPL text are bundled.

## Corrections established against the pinned runtime

- Exact's generator requires lowercase project names, hence `plexy-exact`.
- Bundle process grants use `bundle:/Resources/ffmpeg/bin/...`: the namespace root is Contents, and Resources must be explicit. The original sketches' `bundle:ffmpeg/...` is refused.
- `modules` must not duplicate native views declared by a package dependency. Package exports must expose the exact manifests.
- `paused` is a reserved element attribute; the native view uses `isPaused`.
- Data sources cannot call ambient Date.now. Contract passes its epoch/clock to mutations.
- Child components cannot own resources/mutations. The root owns these and passes actions/data into Watch.
- `ExactPackageContext.file` on Apple resolves only app data/cache/tmp. Mac media paths are resolved with granted `storage.fs.realpath` immediately before passing them to AVPlayer or FFmpeg; absolute paths are not persisted.
- Android private media uses `app:/data/media`, because native path resolution supports data/cache/tmp rather than an arbitrary `app:/media` root.
- The SQLite authorizer denies app-side connection PRAGMAs. Host-owned foreign keys remain enabled; the reviewed patch enables native WAL before authorizer installation. Web verification uses Exact's serialized WASM database.
- Android hosted native views do not receive child touch events. Contract owns seek, audio/subtitle and window controls; Media3 owns the rendering surface.
- READ_MEDIA_VIDEO / legacy storage and conversion/install permissions derive from the package's named operations. No MANAGE_EXTERNAL_STORAGE is used.
- Native Android libraries were inspected from the APK. The FFmpeg arm64 libraries met 16 KB alignment; Exact's library initially did not. The patch adds a target-only 16 KB linker argument.
- Exact's CLI accepts `test macos`; `verify macos` is not implemented at this revision. `verify` checks web; `verify android` checks the reader.

`patches/runtime.patch` contains only native WAL initialization, Android version/signing configuration, the permitted media-processing service type, PiP manifest support, and Android ELF alignment. Setup compares the entire runtime diff with this patch and refuses additional changes.

## Checks observed so far

- Contract compilation and the full TypeScript data-module build pass.
- macOS standalone app bundle builds, including the Swift package player.
- Native macOS navigation tests: 3 pass.
- Android APK builds and installs on Android 16 arm64 emulator `Plexy_Phone_API_36`.
- Web verification passes navigation tests, narrow/wide light/dark checks, relaunch, and the largest supported text size with no findings (rerun after final edits).
- 69 tests pass across port and existing local-library/build-target suites. This includes 40 filename cases, catalog/scan failures, update checksum rejection, and conversion failure ordering.
- A real generated multi-audio MKV remuxes to MP4, verifies through ffprobe and preserves both audio tracks.

## Media acceptance

Use disposable fixtures for native import, track selection, seek/resume, cancellation, verified deletion, full output decoding, and relaunch recovery. No user media is needed for these checks. Automatic conversion defaults off so verification cannot convert an unrelated library.

Real physical Android phone/SD-card and TV D-pad acceptance have not been performed. Emulator success must not be described as physical-device verification. Metadata matching acceptance needs a user-supplied TMDB token; core offline checks do not depend on that secret.

## Update delivery

The original v1 auto-update exclusion is superseded by the user's implementation request. The new app checks GitHub releases on demand, selects only Exact-native asset names, verifies SHA256SUMS, rechecks local bytes before install handoff, and uses a stable dedicated Android signing identity with increasing version codes. Legacy GitHub workflows and client updaters are preserved. Release publication is gated on main and successful native build jobs.
