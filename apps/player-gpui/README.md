# Plexy Beta

Plexy Beta is the Rust desktop preview for Apple Silicon macOS. It uses GPUI,
SQLite, and libmpv to browse local libraries and play original files directly.
Install it alongside Plexy, the stable Electron app, while the Rust app reaches
feature parity.

## Run

From the repository root, with Rust and Xcode including the Metal toolchain installed:

```sh
brew install mpv
cargo run --locked --release --manifest-path apps/player-gpui/Cargo.toml
```

Append `-- /path/to/video.mkv` to open a file at launch. `PLEXY_LIBMPV` overrides
the libmpv path. Beta uses the existing Rust player's
data directory at `~/Library/Application Support/Plexy Player`. Set
`PLEXY_PLAYER_DATA` to use a separate local test catalog.

## Package for macOS

On Apple Silicon, install native Bun and Rust, Xcode with the Metal toolchain,
and Homebrew mpv. From the repository root:

```sh
bun run build:player:mac
```

This writes `Plexy Beta.app` and `Plexy-Beta-<version>-mac-arm64.dmg` to
`dist/player-mac/`, using the version in `Cargo.toml`. The app's bundle ID is
`com.plexy.beta`. Open the DMG and drag the app to Applications. The app carries
libmpv and its dependent dylibs, so Homebrew is only needed on the build machine.
The executable lives inside the app at `Contents/MacOS/plexy-player`.

Set `PLEXY_LIBMPV_SOURCE` to an alternate arm64 `libmpv.2.dylib` to package a
different runtime. The build reports the highest macOS deployment target of
the executable and bundled dylibs and writes it to the app's `Info.plist`.
Choose a libmpv build and dependencies that support the oldest macOS version
you want to run. The package is ad-hoc signed for local testing. Downloaded
copies may require Gatekeeper approval.

## CI and beta releases

The [Plexy Beta workflow](../../.github/workflows/plexy-beta.yml) runs locked
Rust tests and packages a DMG on an Apple Silicon runner. Pull requests that
touch beta build inputs and manual build-only runs produce a
`plexy-beta-mac-arm64` Actions artifact containing the DMG and `SHA256SUMS`.

1. Choose the beta version in [Cargo.toml](Cargo.toml). For subsequent releases,
   bump it and run `cargo check --manifest-path apps/player-gpui/Cargo.toml`
   to refresh [Cargo.lock](Cargo.lock). Merge the version and lockfile into `main`.
2. In GitHub Actions, open **Plexy Beta**, choose `main`, and turn on
   **Create a GitHub prerelease draft**. Add notes describing the preview
   features and known limitations for this build. The existing `RELEASE_ACTORS`
   repository variable controls who can create the draft. It defaults to the
   repository owner when unset.
3. Download the draft's DMG and `SHA256SUMS` together and run
   `shasum -a 256 -c SHA256SUMS`. Check the minimum macOS version in
   `Plexy Beta.app/Contents/Info.plist` and include it in the notes. On a clean
   Apple Silicon Mac without Homebrew, install the beta alongside stable Plexy,
   scan a local library, play a file, seek, switch tracks, and verify resume
   after relaunch. Review the redistribution notices and corresponding source
   for the exact bundled libmpv build and its dependencies before publishing.
4. Publish the draft from GitHub Releases as a pre-release. Its tag is
   `plexy-beta-v<version>` and points to the tested commit. Give a corrected build
   a new version once the prior version is public. Users install beta updates by
   downloading the new DMG.

Stable Plexy continues through [Build & Release](../../.github/workflows/build.yml)
and its Electron updater. Use the [Plexy feature audit](../../docs/APP_FEATURE_AUDIT.md)
as the baseline for preview scope and parity. After feature parity, validate
how existing Plexy installations and libraries move to the Rust app and how
they receive stable updates. Retire Electron packaging once that transition is ready.

## Layout

| File | Role |
| --- | --- |
| `native/plexy_mpv.mm` | libmpv loader, `NSOpenGLView` surface under GPUI's view, event thread, headless preview core (from the Electron `mpv-embed` module) |
| `src/mpv.rs` | Rust-callable player interface replacing the Electron bridge |
| `src/preview.rs` | Seek previews off the playback core, latest-request-wins, cached |
| `src/catalog.rs` | SQLite libraries, roots, items, watch progress; incremental background scan |
| `src/media.rs` | Filename identification (`S01E02`, `1x02`, `Movie (2019)`), next episode |
| `src/app.rs` | Player chrome, shortcuts, menus |
| `src/library_ui.rs` | Home, Movies, TV, show page, Libraries |
| `src/personal_ui.rs` | Search, sort/filters, title pages, watchlist, favorites, ratings, hidden, collections, history |
| `src/shell_ui.rs` | Top navigation, Home hero carousel, Library page, title hero pages, Settings |
| `src/theme.rs` | Plexy HeroUI dark/light tokens |
| `assets/icons/` | The web app's icons (Video.js neutral for the player, lucide elsewhere); regenerate with `bun apps/player-gpui/tools/extract-icons.ts` from the repo root |
| [`docs/README.md`](docs/README.md) | Parent orchestration log for the Rust UI work: status board, order of work, handoff protocol, verification matrices |
| [`docs/UI_KIT.md`](docs/UI_KIT.md) | Proposed reusable components, typed icon library, tokens, scene workflow, canonical menu/artwork specs and migration phases (design only) |
| [`docs/MOTION.md`](docs/MOTION.md) | Animation audit, motion engine design and frame-performance plan (design only) |

## Verify

From `apps/player-gpui`:

```sh
cargo test --locked --release -- --test-threads=1
cargo run -- "/path/Multi Audio.mkv" --self-test /tmp/plexy/report.json
cargo run -- --add-library tv=/path/TV --add-library movies=/path/Movies --library-test /tmp/plexy
```

The self-tests drive the real window (shortcuts via GPUI key dispatch,
track switching, previews, resize, fullscreen, library flows), write a JSON
report and screenshots, then quit. Wrap them in
`sandbox-exec -p '(version 1)(allow default)(deny network*)'` to prove offline
playback. Screenshots need Screen Recording permission and an unobstructed
window.
