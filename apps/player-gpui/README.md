# Plexy (GPUI, Apple Silicon macOS)

Standalone local Plexy: GPUI interface, SQLite catalog and libmpv playback in
one Rust app. No server, no listening port, no remux or transcode — originals
open by filesystem path.

## Run

```sh
brew install mpv            # libmpv until the .app bundles its own
cargo run --release -- [FILE]
```

`PLEXY_LIBMPV` overrides the libmpv path. App data (library database, watch
state) lives in `~/Library/Application Support/Plexy Player`, or in
`PLEXY_PLAYER_DATA` when set.

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
| `src/theme.rs` | Plexy HeroUI dark tokens |
| `assets/icons/` | The web app's icons (Video.js neutral for the player, lucide elsewhere); regenerate with `bun apps/player-gpui/tools/extract-icons.ts` from the repo root |

## Verify

```sh
cargo test
cargo run -- "/path/Multi Audio.mkv" --self-test /tmp/plexy/report.json
cargo run -- --add-library tv=/path/TV --add-library movies=/path/Movies --library-test /tmp/plexy
```

The self-tests drive the real window (shortcuts via GPUI key dispatch,
track switching, previews, resize, fullscreen, library flows), write a JSON
report and screenshots, then quit. Wrap them in
`sandbox-exec -p '(version 1)(allow default)(deny network*)'` to prove offline
playback. Screenshots need Screen Recording permission and an unobstructed
window.
