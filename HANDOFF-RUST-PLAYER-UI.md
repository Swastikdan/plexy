# Handoff: Rust player (GPUI) UI parity + feature gaps

Status as of Nov 27, ~9:20 AM. Everything below is verified against the code.

## Mission (from the user)

1. The Rust implementation (`apps/player-gpui`) works, but its UI must match the
   current Plexy app. The user provided 6 target screenshots (dark theme):
   home hero (Lupin), home rows (Watchlist / Recently added shows), Library
   page ×2, Collections empty state, Search page. They are saved at
   `/Users/swastik/.t3/userdata/attachments/bd3b7aec-*.png`.
2. Specific complaints: home cards "not spaced right", carousel images wrong,
   "title cards not downloading" (= TMDB artwork), fix every page.
3. Also implement `docs/RUST_PLAYER_FEATURE_GAPS.md` (5 gaps).
4. "The animation doesn't really work" — port the web app's animations
   faithfully (specs below).

## Reference implementations (copy behavior from these)

| Thing | File |
| --- | --- |
| TMDB client (throttle, cache, fallback chain, logo pick) | `apps/server/src/tmdb.ts` |
| Metadata fetch (exact-title match rule, cast, stills) | `packages/local-library/src/metadata.ts` |
| IntroDB skip markers (clamp/plausibility, caching) | `apps/server/src/skip-segments.ts` |
| Subtitle search/download (OpenSubtitles via Stremio addon) | `apps/mobile/src/features/player/lib/subtitle-search.ts` |
| Web animations | `apps/web/src/styles.css` + `apps/web/src/components/home-hero.tsx` |
| Design tokens/components | `plans/013-visual-parity-loop.md` (§4) |

## Animation specs (from the web app — port these)

- `--ease-out: cubic-bezier(0.23, 1, 0.32, 1)` — GPUI's `ease_out_quint` is the
  closest built-in.
- **Page enter**: `page-enter 140ms` — opacity 0.94 → 1, NO translate. The web
  explicitly removed a fade-up ("made the home banner read as a flash").
  GPUI currently does 260ms opacity + 10px slide — replace it.
- **Hero copy**: `hero-copy-in 700ms` per child, staggered 60ms (children at
  0/60/120/180/240ms), rise `translateY(12px) → 0` + fade in.
- **Hero crossfade**: slides are absolutely stacked; inactive slide
  `opacity 0`, active `opacity 1`, `transition-opacity 700ms ease-out`.
- **Card hover**: art `scale(1.035)` 500ms + card `translateY(-3px)` +
  border lighten 240ms. GPUI 0.2.2 has **no transforms in Style** — keep hover
  to border/bg/opacity changes (acceptable platform adaptation).
- **Dots**: active dot width transition 300ms (wide pill).
- **Progress ring** (continue cards): 20×20, r=8, track `white/28`, fill white
  2px round caps, rotated −90° (`poster.tsx` ProgressRing). GPUI Path has no
  strokes — either paint a donut with `canvas()` + bezier arcs or fall back to
  the thin bar. Ring preferred for parity.

GPUI animation mechanics: `with_animation(id, Animation, |el, t| ...)`. No
native delay — use `with_animations(id, vec![Animation::new(delay).with_easing(|_| 0.), Animation::new(dur).with_easing(ease_out_quint())], |el, index, t| ...)`
and ignore index 0. Keying the id by content (e.g. `hero-crossfade-{index}`)
restarts the animation on change.

## DONE

### Environment / tooling
- Web reference app running: repo root `bun run dev` (background shell
  `sh_21afc0796001Mc8GGPWvHQIddu`), Vite on :5173, server on :8765.
  Setup complete: owner `owner` / `plexy-dev-2026-pass`, TMDB connected (token
  from `.env`), TV library `Tv` → `/Users/swastik/Documents/Media/Tv`
  (Legion, Mindhunter, Lupin, Dhindora; only Mindhunter has sidecar art).
- GPUI app data: `~/Library/Application Support/Plexy Player/library.sqlite`.
- Playwright-core + capture scripts: `/private/var/folders/3_/lc_cl13x56x5dwwyzf44cvqr0000gn/T/opencode/shots/`
  (`capture-dark.mjs` made `dark-home.png`, `dark-library-full.png`,
  `dark-title.png`, etc. — the web reference screenshots).
- GPUI window capture: `screencapture -x -l<windowID>`; get windowID with a
  Swift `CGWindowListCopyWindowInfo` script (was `/tmp/winid.swift`; window was
  1280×760 at (95,98), scale 2.0, fiducial for the mapping = header divider
  row). Clicks: `swift /tmp/click.swift X Y` posts CGEvents (System Events
  clicks do NOT reach the app reliably).
- Shell/paths: this session runs in T3 Code; the in-app browser is NOT
  attached (use playwright above, not `tools.browser`).

### Code (compiles; `cargo test` = 13 passed)
- `Cargo.toml`: added `serde_json = "1"`, `ureq = { version = "2", default-features = false, features = ["tls", "gzip"] }`.
- `src/main.rs`: added `mod metadata;`.
- `src/metadata.rs` (NEW, complete):
  - `Tmdb`: bearer token, ~1 req/s throttle, 3 retries (429/5xx backoff),
    `tmdb_cache` table (24h search / 7d detail), stale-cache offline fallback,
    `search` (with-year → no-year → simplified title chain), `detail`
    (append credits/release_dates/content_ratings), `season`, `logo_path`
    (neutral → en → votes), `external_imdb_id`, `prune`.
  - `fetch_image` — downloads TMDB art into `data_dir/artwork/<name>` (never
    re-downloads when the file exists).
  - `enrich_title` / `enrich_missing` — manual match first → single
    exact-`normalized_title` match else `Review` (parked for manual flow);
    stores `TitleMeta` (overview, year, vote_average, runtime, certification
    US-first, genres, cast 12 with photos, poster/backdrop/logo, imdb_id);
    for shows also `/tv/{id}/season/{n}` → per-episode still + name + overview.
    Token: `settings.tmdb_token` or env `PLEXY_TMDB_TOKEN`. Everything is
    opt-in and silent offline.
  - IntroDB markers: `fetch_markers` (404 = empty), `normalize_segment`,
    `clamp_window` (ported plausibility rules verbatim).
  - Tests for normalize/clamp/matching/cache keys/round-trips.
- `src/catalog.rs`:
  - `Catalog` gained `metadata_epoch: Arc<AtomicU64>` (+`bump`/`get`) — bump
    after metadata/marker writes so the UI tick can reload.
  - New tables: `tmdb_cache`, `title_metadata`, `episode_metadata`,
    `manual_matches`, `match_status`, `skip_segments`, `skip_lookups`.
  - New types: `CastMember`, `TitleMeta`, `EpisodeMeta`, `EnrichTarget`,
    `SegmentKind`, `SegmentWindow`, `SkipSegments` (+`active(position)`).
  - New methods: `artwork_cache_path`, `tmdb_token`, `set_tmdb_token`,
    `db_handle` (crate-private for Tmdb), `store_title_meta`, `title_meta`,
    `episode_meta`, `store_episode_meta`, `title_show_files`,
    `manual_match`, `set_manual_match`, `clear_manual_match`,
    `match_status`, `record_match_status`, `recently_attempted`,
    `titles_missing_metadata`, `genre_counts`, `titles_with_genre`,
    `titles_with_person`, `store_segments`, `stored_segments`,
    `skip_lookup`, `record_skip_lookup`, `paths_missing_markers`.
  - `test_support::lock()` — serializes tests that touch the global
    `PLEXY_PLAYER_DATA` env var.
- `src/library_ui.rs`:
  - **THE spacing bug**: `poster_card` was `w(134)` with a `168×252` poster
    inside — cards overlapped. Now card `w(168)`, caption title 13px semibold
    + meta 11px muted, gap 7, watched badge 20px, `flex_none`.
  - `poster()`: radius 10, no border, placeholder shows the title at
    `white(0.55)` when there is no artwork; local `white()` helper added.

## TODO (in order)

### 1. Finish shell_ui.rs layout (in progress, mid-edit)
- [ ] `render_show_page` / `render_movie_page`: pt 19 → 86 (nav now floats).
- [ ] Hero rewrite (`render_hero`): full-bleed (`w_full`, no mx/rounded/
      border), h≈520, sits at the top of Home (under the transparent nav).
      Crossfade: stack previous slide image below, animate current's opacity
      0→1, 700ms `ease_out_quint`, id `hero-crossfade-{index}`. Copy block:
      left 36–48, bottom 28–32, max-w ~680; staggered rise (700ms, 60ms
      stagger). Genre chips (from `TitleMeta.genres`, first 3) ABOVE the
      title; title = `TitleMeta.logo` image if present else uppercase text;
      meta `S01E01 · 2021 · ★ 7.7 · Series` (raw vote_average after the star;
      personal rating only if set); actions `Continue watching`/`Play` (blue
      pill) + `Details` + bookmark circle; arrows 42px circles at the hero's
      vertical center, 13px from the edges; pause + dots bottom-left, active
      dot width animated 300ms.
- [ ] Home rows: add **Next Up** row (wide cards, gap 14) right after
      Continue watching; poster-row captions should read `2017 · ★ 7.5`
      (year + `TitleMeta.rating`) when metadata exists; section gap ~44–48.
- [ ] Library page: default sort = `Sort::Added` (web shows "Recently
      added"); replace the colorful Categories with web-style **Genres**
      tiles when `catalog.genre_counts()` is non-empty (dark subtle-tint
      cards, small icon top-left, name + `N titles →` bottom-left,
      ~256×128, flex-1 min 176; keep Categories as fallback); Top 10: numeral
      ~180px dark gray BEHIND/overlapping the card's left edge, card
      ~270×152 16:9 + title below; add a "Recently added" poster row above
      "All titles".
- [ ] Title pages: genre chips; logo image fallback text; meta
      `2017 · 61 min · TV-MA · Series`; average-rating row (stars =
      round(rating/2), "Average rating 4.1/5") above "Your rating"; overview
      (~280 chars + ellipsis); episode rows use `catalog.episode_meta()` for
      still + episode name; right panel = **Top cast** (36px photos, name,
      role) when `TitleMeta.cast` is non-empty, else the current Details
      panel; add a "Match" action for `match_status == "review"` titles
      (manual-match flow: search field + candidate list → `set_manual_match`
      → re-enrich that title on a thread).
- [ ] Collections screen: h1 + subtitle ("Franchise collections from TMDB
      appear automatically. Create your own to group titles for a mood or a
      movie night.") + centered empty state (rounded-2xl icon tile,
      "No collections yet", 2-line desc, WHITE button "+ New collection").
- [ ] Search screen: full-width 48px rounded-full field directly under the
      nav (magnifier left, placeholder "Search your films and shows...");
      empty state = "Jump back in" (continue-watching wide cards) +
      "Recently added" poster row with See all.
- [ ] Settings: add a **Metadata** section (TMDB token field — add
      `Field::Token` to the text-field machinery — "Verify and save" button,
      status line; saving calls `catalog.set_tmdb_token()` then spawns
      `metadata::enrich_missing` on a background thread). Playback section:
      autoplay toggle + skip-markers toggle (settings keys `autoplay`,
      `skip_markers`, values "on"/"off", default off).
- [ ] Genre/person search (gap 5): in the search screen, match the query
      against `catalog.titles_with_genre(q)` and `catalog.titles_with_person(q)`
      in addition to title text; render a genre-chip row (from
      `genre_counts()`) that filters results.
- [ ] `Screen` enum: add `Genre(String)` (or a filter field) so genre tiles
      link to a filtered grid.

### 2. app.rs player features
- [ ] tick(): watch `catalog.metadata_epoch()` → `reload_catalog()`; on
      scan-finished also spawn `metadata::enrich_missing(&catalog)` on a
      background thread (plus once at startup).
- [ ] Skip markers (gap 3): on `open()`, if setting `skip_markers` == "on"
      and `catalog.skip_lookup(path)` is stale/missing, spawn a background
      IntroDB lookup (needs `TitleMeta.imdb_id` + season/episode; movies
      `is_movie=true`), then `store_segments` + `bump_metadata_epoch`.
      In tick, compute `catalog.stored_segments(path, Some(duration)).active(position)`
      and render a "Skip intro/recap/credits" action that seeks to
      `window.end`; keep the existing chapter-based `intro_end()` as
      fallback when no marker rows exist. Invalidate on seek (re-read
      `active` each tick — it's cheap, one SQLite query per tick is NOT
      fine; cache the segments at open() and after background lookups).
- [ ] Autoplay + next-episode preview (gap 2): setting `autoplay` == "on"
      (default off). When `state.ended` && `next_episode` && autoplay &&
      `!autoplay_fired`: show a countdown card ("Playing next in Ns", 8s,
      Cancel + Play now); on expiry `play_next()` exactly once. Reset
      `autoplay_fired` in `open()`. Preview card (thumb + "Next: Episode N ·
      title") in the last ~60s and on end. The player already has
      `next_episode` + `play_next()`.
- [ ] Subtitle search/download (gap 4): Subtitles menu gains "Search
      subtitles…" → panel with spinner → results. Needs `TitleMeta.imdb_id`
      (else message "Identify this title first" — same as mobile). Endpoint
      `https://opensubtitles-v3.strem.io/subtitles/{series|movie}/{imdb or imdb:s:e}.json`;
      validate result urls `^https://subs\d*\.strem\.io/`; download ≤2MB to
      `{video_stem}.{lang}.srt` next to the video; `add_subtitle(path)` loads
      it live; offline reuse comes free via sidecar import. Filter row by
      language.

### 3. Verify loop
- [ ] `cargo test` (13 passing; add tests for any new pure logic).
- [ ] `cargo run --release` from `apps/player-gpui` → screenshot each page
      (Home/scroll/Library/Show/Movie/Collections/History/Search/Settings)
      with the screencapture recipe above; compare against the user's 6
      screenshots + `shots/dark-*.png`; iterate.
- [ ] With the `.env` token set (`PLEXY_TMDB_TOKEN`) launch once online so
      artwork downloads for Legion/Lupin (Legion was already enriched during
      dev in the WEB app; the GPUI app needs its own run). Then verify the
      offline story: relaunch with network denied — art persists in
      `data_dir/artwork/`.
- [ ] `bun run typecheck` is NOT affected (Rust-only change), but if you
      touch shared packages run it.

## Gotchas
- `set_manual_match` currently `DELETE FROM episode_metadata` globally —
  should scope to the show's files when you touch it (minor).
- `stored_segments` queries SQLite; don't call it every tick (cache at open).
- Two plexy-player processes confused window captures earlier; kill leftover
  processes (`ps aux | grep plexy-player`) before capturing. The old release
  binary (PID 43321) is still running the pre-change UI.
- The nav pill click coordinates move with the window; recompute from a fresh
  capture (fiducial: header divider row, scale 2.0).
- Web routes: home `/`, library `/library/tv`, title `/title/{publicId}`,
  `/collections`, `/history`, `/search`, `/settings`. `/library/movies` shows
  the empty state (only a TV library exists).
- The web app signs out between headless runs (cookie per context) — the
  capture scripts sign in first.
- `enrich_missing` walks `titles_missing_metadata` — after a successful
  enrichment a title is skipped by the `title_meta` check; failed attempts
  cool down 30 min via `match_status`.
- Do not reorder `apps/mobile` or shared packages — untouched per plan 014.
