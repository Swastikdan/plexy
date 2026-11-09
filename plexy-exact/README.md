# Plexy Exact

Standalone macOS 14+ and Android 12+ local-media apps. Contract owns the UI, TypeScript owns the local SQLite catalog, and native AVPlayer/Media3 modules play files directly. No Plexy server is started or required. Existing Electron and React Native apps remain in the repository as references and continue using their original build workflow.

## Run

Use Bun **1.4.2** and Rust **1.97.0**:

```sh
bun plexy-exact/tools/setup.ts
bun install --cwd plexy-exact --frozen-lockfile
cd plexy-exact
bun ../.build/exact-runtime/scripts/exact.mjs setup
bun tools/install-ffmpeg.ts
bun exact.mjs mac --bundle --run
```

Exact is pinned in `runtime.lock.json`. Setup installs its frozen dependency graph, applies the reviewed `patches/runtime.patch`, and generates the local launcher. It refuses unrelated runtime modifications. Generated code, downloaded tools, fixtures, native build products and signing material stay out of git.

On macOS, put videos in `~/Plexy` or choose **Settings → Import Folder**. On Android, choose **Settings → Import videos** to copy MediaStore videos into app-private storage. Automatic conversion is opt-in on macOS; Android plays MKV directly and converts only on request. Back up the Android library before uninstalling.

Add a TMDB read-access token in Settings for cached metadata, posters, backdrops, cast, and search suggestions. Offline playback and filename-based browsing work without a token. Audio/subtitle choices and watch position remain local. Settings include language preferences, subtitle defaults, conversion quality, original retention, and Mac battery policy.

## Android runtime

Exact's reviewed release does not distribute Android Hermes. Build it from pinned Ibex source once:

```sh
cd ..
git clone https://github.com/expo/ibex.git .build/ibex-android
git -C .build/ibex-android checkout a0183568e8229b8243629cdb26cd4a88ac4e2abd
IBEX_DIR="$PWD/.build/ibex-android" bun .build/exact-runtime/scripts/hermes-android.mjs build
cd plexy-exact
bun exact.mjs android --install --run
```

The SDK needs platform 37.2, NDK 27.1+, Java 17+, CMake and Ninja. Maven coordinates, Gradle dependencies and checksums are committed. Android conversion uses the pinned maintained FFmpegKit GPL artifact, a foreground service, notifications and a wake lock. Thermal/battery limits stop work safely; retry after conditions improve. Interrupted work is reconciled from its file hashes and journal on launch.

## Validation and packaging

```sh
bun test tests
bun tools/schema.ts --check
bun exact.mjs contract build app.contract --json --errors-only
bun exact.mjs verify
bun exact.mjs test macos
bun exact.mjs verify android
bun tools/build.ts macos
bun tools/build.ts android
```

`tools/make-fixtures.sh` creates disposable multi-audio/subtitle media. Integration tests use it when available; CI's core tests do not require downloaded binaries. [Spike evidence](docs/spikes.md) distinguishes compiled code, automated checks and unverified hardware behavior.

## Builds and updates

`.github/workflows/exact.yml` builds the native apps on pushes to this branch and main. Main publishes prereleases with `plexy-exact-macos.zip`, `plexy-exact-android.apk`, and `SHA256SUMS`. Settings checks only releases containing Exact assets, verifies downloaded bytes, and opens the platform installation flow. Existing clients' artifacts never become Exact updates.

Android update signing uses dedicated GitHub secrets `PLEXY_EXACT_KEYSTORE` and `PLEXY_EXACT_KEYSTORE_PASSWORD`; the generated local backup is outside the repo at `~/.local/share/plexy/exact-signing`. Version codes follow the Exact workflow's run number. Native local development defaults to Android's debug identity; use the dedicated signing environment variables for release-compatible local builds. macOS previews are ad-hoc signed.

GPL/codec notices are under `tools/ffmpeg` and `packages/plexy-native/android/NOTICE.md`. Android TV remains a stretch target; no D-pad acceptance is claimed.
