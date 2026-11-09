# Plexy → Exact Porting Specification

**Status:** implementation plan; code sketches are illustrative and have not been compiled or device-tested  
**Targets:** macOS 14+ and Android 12+ (arm64). Android TV is a stretch goal.  
**Runtime:** [Expo Exact](https://github.com/expo/exact), pinned to one commit. Exact is pre-1.0 and changes daily; do not track `main` during the port.  
**Goal:** two self-contained apps, one source tree, no Plexy server, no HTTP client/server split. Each app owns its local media, local SQLite database, and local watch progress.

---

## 0. Read this first

### 0.1 The five decisions that shape the port

| Decision | Why |
|---|---|
| **One Exact project, two languages, plus native modules** | UI is Contract (`.contract`). Data logic is TypeScript (`app.ts`). Swift/Kotlin native modules fill the gaps Exact does not cover: the video player, Android media import, and Android conversion. This is still one project and one build per platform, not a server/client split. |
| **No server process anywhere** | `app.ts` is the "backend": it reads files, queries SQLite, calls TMDB, and starts FFmpeg on macOS. On Android the same work runs in-process through a Kotlin module. There is no Bun/Elysia server, no localhost HTTP, no WebSocket. |
| **Audio-track switching requires custom native players on both platforms** | Exact's `video` element exposes no audio-track or subtitle-track selection API. Since you need track switching, the built-in player is not enough. macOS gets an `AVPlayerView` native view; Android gets a Media3/ExoPlayer native view. |
| **Android does not need MKV→MP4 just to play** | Media3/ExoPlayer reads Matroska (`.mkv`) and most codecs found in it. Android converts only when the device cannot decode a stream (for example DTS/TrueHD audio, PGS subtitles, or an unsupported video profile) or when you explicitly ask for an MP4. macOS always converts MKV, because AVPlayer cannot demux Matroska. |
| **Media lives in a user-visible library on macOS, and in app storage on Android** | macOS: `~/Plexy` (`home:/Plexy`), so files are visible and backup-friendly. Android: `app:/media`, because Android shared-storage paths are content URIs, not stable file paths, and Exact's Android host refuses file pickers. |

### 0.2 The two hard truths

1. **This is not "one language."** It is one project with Contract for UI, TypeScript for data, and a small amount of Swift/Kotlin for platform capabilities. The alternative — writing a custom player and file/conversion layer in Contract — is not possible.
2. **The Android host is the immature part.** Exact's Android host is newer than the stable macOS/iOS/web hosts, is arm64-only, is described as a development shell, refuses file pickers, and cannot load remote images. The plan below avoids the picker refusal with MediaStore and avoids remote images by caching artwork locally. Budget a Phase 0 spike to prove Media3, FFmpeg, and MediaStore on a real phone before building the whole app.

### 0.3 Confirmed requirements and proposed defaults

- macOS + Android mobile first. Android TV only if it falls out cheaply.
- No server; in-process data layer only.
- Local/personal use; no App Store publishing.
- Most media is `.mkv`.
- Ahead-of-time conversion and deletion of successfully replaced originals are requested. Prefer lossless stream copy when possible; re-encoding can lose quality.

The remaining items below are **proposed implementation defaults, not recorded user decisions**. The porting agent must keep them configurable where practical:
- Android: copy/import media into app storage.
- Delete originals after a successful, verified conversion.
- Subtitles: text only (SRT/ASS/VTT), toggleable. PGS/VOBSUB not required.
- Audio: **track switching is required**.
- Output: up to 4K SDR.
- Mac is the main conversion machine; Android converts only what it cannot play.
- No cross-device sync. Fresh library, no migration of the old Plexy database.
- Android TV: stretch goal, not a blocker.

---

### 0.4 Evidence and implementation boundaries

Source review baseline: Exact commit `94b8671f70fe2e25b307a40e7fce66dc27c9f802` (reviewed 2026-11-09). Start Phase 0 from this commit or explicitly document a replacement. All Exact-specific paths, grants, schemas, APIs and commands below must be checked against that revision before use. A source review establishes feasibility; it does not establish that the sketches compile.

- [Exact source at the reviewed revision](https://github.com/expo/exact/tree/94b8671f70fe2e25b307a40e7fce66dc27c9f802): README, `host/android/README.md`, native module recipes and runtime source. Android is early; require a real-device spike.
- [Media3 supported formats](https://developer.android.com/media/media3/exoplayer/supported-formats): Matroska extraction is supported; sample decoding depends on platform decoders and any bundled extensions. A container extension alone never proves playback support.
- [FFmpeg stream copy and transcoding](https://ffmpeg.org/ffmpeg.html): stream copy avoids re-encoding; transcoding can change quality. Renaming an extension does not convert a container.
- [Apple media compatibility guidance](https://support.apple.com/en-gb/102644): compatibility depends on the app, format and device. The selected AVPlayer design must demonstrate its supported MP4 profiles in Phase 0. A custom libmpv/libVLC macOS player is an alternative route to MKV direct play, with extra integration and packaging work; macOS hardware itself does not require MKV conversion.

This document changes no application implementation. Preserve the current working tree. “Drop” below means omit from the new Exact application, not delete the existing apps or server. Current local-mode work in `packages/local-library/src/library.ts`, `apps/mobile/local.tsx`, and `docs/local-apps.md` is another reference: reuse its pure parsing, grouping, progress and incomplete-scan handling through Exact storage adapters where useful. Do not assume Node, Bun or React Native imports run inside Exact.

## 1. Scope

### In scope

- macOS app: library scan, metadata, artwork, playback, MKV→MP4 conversion, track/subtitle selection, watch progress.
- Android app: MediaStore import, direct playback of MKV/MP4, track/subtitle selection, optional on-device conversion, watch progress.
- TMDB metadata matching and artwork caching.
- A local SQLite catalog and a conversion job queue.
- Offline playback after import/metadata fetch.

### Out of scope for v1

- Any server, remote access, multi-user auth, or cross-device sync.
- HLS, DASH, adaptive streaming, or a transcoding server.
- Cast/AirPlay/DLNA.
- PGS/VOBSUB burn-in or image-subtitle rendering.
- iOS (the code should stay portable, but iOS is not a target).
- App Store/Play Store distribution, notarization, or auto-update.
- 4K HDR output. HDR is tone-mapped to SDR.
- Trickplay thumbnails, skip-intro detection, trailers (nice-to-have later).
- Android TV as a release blocker.

---

## 2. Architecture

### 2.1 Shape

```
┌──────────────────────────────────────────────────────────────┐
│ Plexy.app (macOS)                  Plexy.apk (Android)       │
│                                                              │
│ app.contract  ── UI, routes, state, actions                   │
│ app.ts        ── scan, match, SQLite, TMDB, job queue        │
│                                                              │
│ macOS native:                     Android native:            │
│  AVPlayerView (Swift)              Media3 PlayerView (Kotlin)│
│  FFmpeg child process              MediaStore import (Kotlin)│
│  (no server)                       FFmpeg in-process (Kotlin)│
│                                                              │
│ app:/data/library.db              app:/data/library.db       │
│ ~/Plexy/... (media)               app:/media/... (media)     │
│ app:/cache/artwork/...            app:/cache/artwork/...     │
└──────────────────────────────────────────────────────────────┘
```

There is no process listening on a port. There is no client/server protocol. The "backend" is a set of `Sources` functions in `app.ts` plus platform code behind `native.call` / `native.later`.

### 2.2 Platform capability matrix

| Capability | macOS | Android |
|---|---|---|
| Contract UI | Yes | Yes (Canvas host) |
| TypeScript data module | Yes (Hermes) | Yes (Hermes via the Linux/Android host) |
| SQLite + app files | Yes | Yes |
| Spawn FFmpeg | Yes (`@exact/child-process`) | No; use an in-process native library |
| Direct-play MKV | No (AVPlayer) | Yes (Media3), codec-dependent |
| Direct-play MP4 | Yes | Yes |
| Audio-track switching | Custom `AVPlayerView` module | Custom Media3 module |
| Subtitle-track switching | Custom `AVPlayerView` module | Custom Media3 module |
| File/folder picker | Exact picker + `doc.keep` | Exact picker refused; use MediaStore |
| Remote images | Exact `image` can fetch | Refused; cache artwork to `app:/cache` |
| Background work | App must stay running; resume on launch | Foreground service for conversion |
| Android TV | N/A | Possible, D-pad focus unproven |

### 2.3 Why the player is a native view, not the `video` element

Exact's `video` element supports `source`, `poster`, `controls`, `paused`, `currentTime`, `timeupdate`, `durationchange`, `fullscreenchange`, `fastSeek`, Media Session, and PiP. It has **no API** for:

- listing audio tracks,
- selecting an audio track,
- listing subtitle tracks,
- selecting a subtitle track,
- changing subtitle styling or delay.

Because track switching is a hard requirement, both platforms use a native view (`plexy-player`) that owns the player surface, controls, and track menus. Contract passes the source and receives progress/track events.

On Android this is also necessary because the host's `VideoPlayer` interface (`attach`, `source`, `set`, `release`) has no track-selection surface, and the app would otherwise have to patch the host. A native module view is the supported seam.

---

## 3. Project layout

Create a new Exact app rather than converting the current monorepo in place. Keep the current Plexy repo as the reference implementation.

```
PlexyExact/
  app.json
  app.contract
  app.ts
  app.test.contract
  exact.mjs
  assets/
    icon-1024.png
    splash.png
  packages/
    plexy-native/
      package.json
      exact.json                  # interface: names + views + shapes
      apple/
        exact.json
        PlexyPlayer.swift
      android/
        exact.json                # implementation: maven + kotlin
        PlexyPlayer.kt
        PlexyMediaStore.kt
        PlexyConvert.kt
      web/
        exact.json
        index.js                  # fallback for the web preview
  tools/
    ffmpeg/                       # macOS only: ffmpeg + ffprobe + licenses
      bin/ffmpeg
      bin/ffprobe
    fixtures/                     # generated test media
    make-fixtures.sh
  docs/
    spikes.md
    exact-port-spec.md
  patches/
    exact-android.patch           # only if a host patch is unavoidable
```

Rules:

- Pin Exact to a commit and record it in `docs/spikes.md` and the lockfile.
- Put any host patch in `patches/` and apply it after `exact update`. Keep patches small.
- Keep generated media and downloaded FFmpeg binaries out of git (`.gitignore`); record their SHA-256 and a download script.
- Do not commit `node_modules`, `target/`, or build outputs.

### 3.1 `app.json`

```json
{
  "$schema": "../exact2/scripts/app.schema.json",
  "app": { "id": "com.plexy.local", "name": "Plexy" },
  "name": "Plexy",
  "modules": ["plexy-player"],
  "audio_session": "playback",
  "icons": [
    { "src": "assets/icon-1024.png", "sizes": "1024x1024", "type": "image/png" }
  ],
  "host": {
    "macos": {
      "minimumOS": "14.0",
      "resources": [
        { "from": "tools/ffmpeg", "to": "Resources/ffmpeg" }
      ]
    },
    "android": {
      "minimumOS": "12"
    }
  }
}
```

Notes:

- `modules` lists the hyphenated tag served by the native package. A tag not listed is a build error.
- `host.macos.resources` copies the FFmpeg tree into `Contents/Resources/ffmpeg`; Mach-O helpers are signed with the bundle.
- `host.android.minimumOS` accepts `"10"` through `"16"`. Use `"12"` (API 31) unless a test device requires `"10"`/`"11"`.
- Do not put secrets in `app.json`.

### 3.2 Grants

```ts
// app.ts
export const appId = 'com.plexy.local';

export const grants = `
fs.read app:/data
fs.write app:/data
fs.read app:/cache
fs.write app:/cache
fs.read app:/tmp
fs.write app:/tmp
sqlite.open app:/data/library.db

fs.read home:/Plexy
fs.write home:/Plexy

fs.read doc:/
fs.write doc:/
doc.keep

net.fetch https://api.themoviedb.org
net.fetch https://image.tmdb.org

secret.keep tmdb

process.spawn bundle:ffmpeg/bin/ffmpeg
process.spawn bundle:ffmpeg/bin/ffprobe
`.trim();
```

Notes:

- `home:/Plexy` is the macOS library root. It is a **fixed path** because grants are compile-time. If you want a different root, change it here and rebuild. Do not grant all of `home:/`.
- `doc:/` + `doc.keep` let the macOS app scan a folder the person picks and reopen it after a relaunch.
- `process.spawn` lines are ignored on Android/iOS/web; `processStatus().available` is `false` there.
- `secret.keep tmdb` is for the TMDB bearer token via `store.set`/`store.get`.
- Android runtime permissions are derived from the app's grant lines (`reach.android` in `runner/src/device.rs`), and there is **no built-in grant that maps to `READ_MEDIA_VIDEO`**. Plan to add it through the app's `modules/android` build (`android_entry` writes `permissions.txt` beside the bake output) or a small host patch; verify it in Phase 0. The module still asks at runtime with `ExtensionContext.requestPermissions`. Do not add `MANAGE_EXTERNAL_STORAGE`.

---

## 4. Storage and library model

### 4.1 macOS: `~/Plexy`

```
~/Plexy/
  Movies/
    The Matrix (1999)/
      The Matrix (1999).mp4
  TV/
    Severance (2022)/
      Season 01/
        Severance - S01E01 - Good News About Hell.mp4
  Unsorted/
    ...
```

- The app creates `~/Plexy/Movies`, `~/Plexy/TV`, `~/Plexy/Unsorted` on first launch with `storage.fs.mkdir('home:/Plexy/Movies')`, etc.
- The person can also drop files into `~/Plexy` manually; the app scans it.
- Source folders outside `~/Plexy` are picked with `showDirectoryPicker`, scanned via `doc:/`, and **moved** into `~/Plexy` during conversion (FFmpeg reads the source real path, writes the MP4 into `~/Plexy`, then the source is deleted).
- This avoids copying a second full library into the app container and keeps media visible in Finder.

### 4.2 Android: `app:/media`

```
app:/media/
  Movies/...
  TV/...
  Unsorted/...
  inbox/            # temporary imports, cleaned after probe
```

- MediaStore import copies files from shared storage into `app:/media/inbox`, then the probe moves them into `Movies/TV/Unsorted`.
- App-private storage is stable, doesn't need SAF permissions at playback time, and is readable by Media3 and FFmpeg.
- The trade-off: the library is inside the app's data directory. Back it up with Android's backup tools or export it before uninstalling. Add an "Export library" action later if needed.

### 4.3 Why the asymmetry is intentional

| | macOS | Android |
|---|---|---|
| Media path | `home:/Plexy` (user-visible) | `app:/media` (app-private) |
| Why | Finder-visible, backup-friendly, FFmpeg child can read/write it | Stable file paths; Media3 and FFmpeg read it directly; no SAF URI lifetime problems |
| Original deletion | `storage.fs.rm` on `doc:/` or `home:/` | Delete the app-storage MKV; optionally ask the system to delete the shared-storage source via MediaStore |

Do **not** try to keep a macOS library inside `app:/`; it hides a large library inside the container and complicates backup. Do **not** try to play Android media directly from SAF content URIs in v1; it adds URI-permission and FFmpeg-fd complexity for little gain.

### 4.4 Free-space rules

- Before import: require `file.size * 1.10` free in the destination.
- Before conversion: require `max(input.size * 1.20, 2 GiB)` free (transcode), or `input.size * 1.05` (remux).
- Check free space with `StatFs` on Android and `FileManager`/`statfs` in the native macOS module, or estimate with a conservative rule in `app.ts` (Exact has no free-space API).
- If space is insufficient, fail the job before starting and keep the original.

### 4.5 Path rules

- Store **virtual paths** in SQLite: `home:/Plexy/...`, `app:/media/...`, `doc:/1/...`.
- On macOS, compute the real path with `storage.fs.realpath(...)` at the moment you hand it to FFmpeg or AVPlayer. Do not persist `realpath` results; they can change if the folder moves.
- On Android, compute the real path with `ExtensionContext.file(path)` in the Kotlin module (`context.file("app:/media/…")`); it wraps the host's `Native.appFile`. Do not persist absolute paths.
- Never store a `content://` URI in the catalog; copy it into app storage first.

---

## 5. Data model

Open one database: `app:/data/library.db`. Use `PRAGMA journal_mode=WAL`, `PRAGMA foreign_keys=ON`, and a schema version in `settings`.

```sql
CREATE TABLE IF NOT EXISTS schema_meta (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS titles (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL CHECK (kind IN ('movie','show')),
  name TEXT NOT NULL,
  sort_name TEXT,
  year INTEGER,
  overview TEXT,
  runtime INTEGER,                 -- seconds
  rating REAL,
  tmdb_id INTEGER,
  imdb_id TEXT,
  poster_path TEXT,                -- app:/cache/artwork/...
  backdrop_path TEXT,
  logo_path TEXT,
  metadata_json TEXT,              -- raw TMDB payload for fields not modeled
  added_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS media (
  id TEXT PRIMARY KEY,
  title_id TEXT NOT NULL REFERENCES titles(id) ON DELETE CASCADE,
  season INTEGER,
  episode INTEGER,
  path TEXT NOT NULL UNIQUE,       -- virtual path
  container TEXT,                  -- mkv, mp4, ...
  video_codec TEXT,
  width INTEGER,
  height INTEGER,
  hdr TEXT,                        -- sdr | hdr10 | hlg | dv
  duration REAL,
  size INTEGER,
  mtime INTEGER,
  status TEXT NOT NULL DEFAULT 'ready'
    CHECK (status IN ('ready','needs_conversion','converting','failed','missing')),
  original_path TEXT,              -- where it came from, for audit
  added_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS streams (
  id TEXT PRIMARY KEY,
  media_id TEXT NOT NULL REFERENCES media(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind IN ('video','audio','subtitle')),
  stream_index INTEGER NOT NULL,
  codec TEXT,
  language TEXT,
  title TEXT,
  channels INTEGER,
  width INTEGER,
  height INTEGER,
  is_default INTEGER NOT NULL DEFAULT 0,
  is_forced INTEGER NOT NULL DEFAULT 0,
  is_text_subtitle INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS progress (
  media_id TEXT PRIMARY KEY REFERENCES media(id) ON DELETE CASCADE,
  position REAL NOT NULL DEFAULT 0,
  duration REAL,
  watched INTEGER NOT NULL DEFAULT 0,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS jobs (
  id TEXT PRIMARY KEY,
  media_id TEXT,
  kind TEXT NOT NULL CHECK (kind IN ('scan','probe','import','convert')),
  state TEXT NOT NULL CHECK (state IN ('queued','running','verifying','done','failed','canceled','interrupted')),
  progress REAL NOT NULL DEFAULT 0,
  input_path TEXT,
  output_path TEXT,
  error TEXT,
  started_at INTEGER,
  updated_at INTEGER
);

CREATE TABLE IF NOT EXISTS artwork (
  key TEXT PRIMARY KEY,            -- tmdb:movie:123:poster
  path TEXT NOT NULL,
  url TEXT,
  fetched_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_titles_name ON titles(name);
CREATE INDEX IF NOT EXISTS idx_media_title ON media(title_id);
CREATE INDEX IF NOT EXISTS idx_streams_media ON streams(media_id);
CREATE INDEX IF NOT EXISTS idx_progress_updated ON progress(updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_jobs_state ON jobs(state);
```

Rules:

- SQLite integers arrive as `bigint` in TypeScript. Convert with `Number(n)` or `String(n)` before returning a shape.
- One open database at a time. Use a single promise queue around `storage.sqlite.open`/`close`; overlapping opens are refused as busy.
- Every mutation that changes multiple tables (commit a conversion) runs in `db.transaction([...])`.
- Keep `metadata_json` so a later UI change does not require a schema migration for every TMDB field.
- `status='needs_conversion'` is set when the probe finds an MKV on macOS, or an Android file whose codecs the device cannot play.
- `status='missing'` is set by a reconciliation scan when the file is gone; do not delete the row immediately, so progress is not lost.

### 5.1 Startup reconciliation

On launch, before showing the library:

1. Mark every active `running` or `verifying` job as `interrupted`; persist its input identity, plan and output path before restarting work.
2. Reconcile partial files belonging to recorded jobs only. Never glob-delete user files. Verify a completed partial before removing or restarting it.
3. For each `interrupted` convert job, re-queue if the source still exists and the output is missing or incomplete.
4. For each `media` row, `stat` the path. Missing → `status='missing'`. Present but not in DB → add it (an interrupted commit).
5. If both source and output exist, re-verify the output, confirm it belongs to that job and commit the catalog replacement before deleting the source. Confirm source identity has not changed. Never infer permission to delete from matching filenames.
6. If only the source exists, mark the job interrupted/queued.

---

## 6. Import and scanning

### 6.1 macOS: pick a folder, scan, move into `~/Plexy`

Contract:

```contract
component ImportScreen
  state folder = ""
  state scanning = false
  state foundCount = 0
  state importedCount = 0
  mutation scanned as shape ScanReply
  action picked(path: string)
    folder = path
    scanning = true
    send scanned = scanFolder(path)
  action progress(found: number, imported: number)
    foundCount = found
    importedCount = imported
  view
    column padding=20 gap=16
      text "Add media" role="heading" aria-level=1
      text "Choose a folder of movies or TV shows. Plexy will copy and convert what it can."
      button press=chooseFolder testId="choose-folder"
        text "Choose folder"
      if folder != ""
        text `Scanning ${folder}` testId="scan-status"
      if scanning
        text `Found ${foundCount}, imported ${importedCount}`
```

`app.ts` flow:

```ts
// A source function that asks the host picker. The picker's `change` event
// arrives through the Contract action, which passes the `doc:/...` path.
scanFolder: async ([folder], _store, storage) => {
  const files: string[] = [];
  async function walk(dir: string) {
    for (const name of await storage.fs.readdir(dir)) {
      const path = `${dir}/${name}`;
      const st = await storage.fs.stat(path);
      if (st.isDirectory) await walk(path);
      else if (isMediaName(name)) files.push(path);
    }
  }
  await walk(folder);
  return { files };
}
```

Then for each file:

1. Probe it with `ffprobe` (macOS) or a lightweight parser (Android).
2. Parse the filename (`parse.ts`) to get title/year/season/episode.
3. Match TMDB (or fall back to `Unsorted`).
4. Convert/remux it into `~/Plexy/Movies/...` or `~/Plexy/TV/...`.
5. Verify, then delete the source file with `storage.fs.rm(sourcePath)` if the person chose "Move into Plexy" (default). If the source is read-only or deletion fails, keep it and record `source_kept`.

Why use FFmpeg to move rather than `storage.fs.copyFile`:

- `copyFile` supports `doc:` → `app:` only, not `doc:` → `home:`.
- FFmpeg can read the source real path and write the destination real path in one pass, doing the remux/transcode at the same time.
- If the source is already an MP4 that needs no conversion, run FFmpeg with `-c copy` (fast) or a native copy; do not read the file into JavaScript.

### 6.2 macOS: already in `~/Plexy`

- Scan `home:/Plexy` recursively on launch.
- `storage.fs.watch(path)` only accepts a `doc:` path the app may read; it does **not** work on `home:/`. So scan `home:/Plexy` on launch and after each job, and use `watch` only on a picked `doc:/` folder (macOS listens with FSEvents).
- Do not re-probe every file on every launch; compare `size` + `mtime` and skip unchanged rows.

### 6.3 Android: MediaStore import (no SAF picker)

Exact's Android host refuses `showPicker`, `saveFile`, and the document pickers. Do not fight that. Use MediaStore, which also matches the "copy into app storage" decision.

Native module responsibilities (`PlexyMediaStore.kt`):

- Request `READ_MEDIA_VIDEO` on Android 13+; `READ_EXTERNAL_STORAGE` with `maxSdkVersion=32` on Android 12.
- Query `MediaStore.Video.Media.getContentUri(MediaStore.VOLUME_EXTERNAL)` for all volumes.
- Return rows: `id`, `displayName`, `relativePath`, `size`, `durationMs`, `mimeType`, `dateAdded`, `contentUri`.
- Group by `relativePath` so Contract can show a folder browser.
- Copy selected rows to `app:/media/inbox/<uuid>.<ext>` with a 1 MiB buffer; report progress to a file or via `changed(topic)`.
- Verify the copied size; compute a cheap fingerprint (size + first/last 1 MiB SHA-256) for dedupe.
- Optionally delete the shared-storage source after a successful conversion:
  - Android 11+ (`API 30`): `MediaStore.createDeleteRequest` and launch the system consent dialog.
  - Android 10 (`API 29`): `ContentResolver.delete` and handle `RecoverableSecurityException`.
  - If the person declines or the provider refuses, keep the source and record `source_kept`.

Contract import screen:

```contract
component DeviceImport
  resource videos = listDeviceVideos() as shape DeviceVideo[]
  state selected: string[] = []
  state importing = false
  mutation imported as shape ImportResult
  action toggle(id: string)
    selected = selected.includes(id) ? selected.filter(x => x != id) : selected.concat([id])
  action start
    importing = true
    send imported = importVideos(selected)
  view
    column padding=20 gap=12
      text "Videos on this device" role="heading" aria-level=1
      for v in videos key=v.id
        button press=toggle(v.id) testId=`video-${v.id}`
          text `${v.name} — ${v.folder}`
      button press=start disabled=(selected.length == 0) testId="import"
        text `Import ${selected.length}`
```

Notes:

- MediaStore covers internal storage and SD cards. It does not cover arbitrary document providers (Google Drive, USB OTG through Documents). Add SAF later only if needed; it requires a host patch or a headless-Fragment result bridge because the Exact Android host exposes no activity-result API to packages.
- Do not request `MANAGE_EXTERNAL_STORAGE`; it is unnecessary and hostile.
- Do not scan the whole device on every launch. Import is explicit.

### 6.4 Dedupe

- macOS: `path` uniqueness + `size` + `mtime`.
- Android: `size` + cheap fingerprint; also compare `displayName` and `relativePath`.
- If a duplicate is found, skip it and show "Already in library".

### 6.5 Filename parsing

Port `apps/server/src/parse.ts` to `app.ts`/`lib/parse.ts` with tests. It should extract:

- title and year: `The Matrix (1999)`, `The.Matrix.1999.1080p...`
- season/episode: `S01E02`, `1x02`, `Season 1 Episode 2`
- quality/codec tags to strip: `1080p`, `2160p`, `4K`, `x264`, `x265`, `HEVC`, `HDR`, `DV`, `DDP5.1`, `Atmos`, `WEB-DL`, `BluRay`, `REMUX`
- edition/cut: `Director's Cut`, `Extended`
- release group: trailing `-GROUP`

Return a stable shape:

```ts
type ParsedName = {
  title: string;
  year: number | null;
  season: number | null;
  episode: number | null;
  edition: string | null;
};
```

Add unit tests with a table of at least 40 real-world filenames.

### 6.6 TMDB matching

Port `apps/server/src/matcher.ts` and `tmdb.ts`, but call TMDB directly with `fetch`:

- `GET https://api.themoviedb.org/3/search/movie?query=...&year=...`
- `GET https://api.themoviedb.org/3/search/tv?query=...&first_air_date_year=...`
- `GET https://api.themoviedb.org/3/movie/{id}?append_to_response=credits,images,videos,external_ids`
- `GET https://api.themoviedb.org/3/tv/{id}?append_to_response=credits,images,videos,external_ids`
- For episodes: `GET /tv/{id}/season/{n}/episode/{m}` or the season payload.

Scoring:

1. Exact normalized title match: +50.
2. Year within ±1: +20; exact: +25.
3. Runtime within ±10%: +10.
4. Popularity/vote count tie-breaker.
5. If the score is below a threshold, leave it unmatched and show "Fix match" in the UI.

Rate limiting:

- One request at a time, 60 ms apart.
- On HTTP 429, wait `Retry-After` or exponential backoff (1s, 2s, 4s), max 3 tries.
- Cache search responses for 7 days; details for 30 days.
- Store the API token with `store.set('tmdb', token)`; read with `store.get('tmdb')`.

### 6.7 Artwork

- Download to `app:/cache/artwork/<tmdb_id>-<kind>.jpg` with:
  ```ts
  await fetch(url, { exactBodyTo: `app:/cache/artwork/${key}.jpg` });
  ```
  This streams the body to disk; it does not enter JavaScript or the 64 MiB heap.
- Kinds: `poster`, `backdrop`, `logo`, `still`, `profile`.
- Sizes: `w342`/`w500` for posters, `w780`/`original` for backdrops, `w185` for profiles.
- On Android, always use the local path. Remote images are refused by the Android host.
- On macOS, local paths are also preferred so the library works offline.
- Evict artwork older than 90 days if the cache exceeds a size budget (for example 2 GiB). Keep posters for titles in the library; evict only `still`/`profile` first.

---

## 7. Conversion pipeline

### 7.0 Rules that override the illustrative command templates

- Probe first and build explicit stream-index mappings. The `-map 0:s?` shorthand below must be replaced by mappings for supported text streams; never pass image subtitles to `mov_text`. Apply audio bitrate/channel options per output track.
- Ten-bit SDR is not HDR. Determine transfer characteristics and HDR metadata before tone mapping. Supported ten-bit HEVC SDR can be copied. Dolby Vision-only sources without a validated SDR conversion path must remain unchanged and report unsupported conversion. Set output SDR color tags consistently after tone mapping.
- The proposed SDR conversion policy applies when conversion is selected. Already playable HDR files can direct-play; converting every HDR file is an optional normalization setting.
- Reject plans that silently discard tracks or metadata outside the chosen policy. Until the proposed text-only/HDR defaults are accepted as product settings, retain the original when conversion drops image subtitles or changes HDR presentation. Show those changes in the conversion plan.
- Reserve space from estimated bitrate × duration plus muxing margin and current usage, then monitor during conversion. Input-size multipliers are fallback estimates, not upper bounds: HEVC→H.264 can expand substantially. Out-of-space, cancellation and failed verification always retain the source.
- Android MediaStore may omit documents, downloads or files in `.nomedia` folders. Treat SAF through a native module as a supported import alternative to spike, even though Exact’s built-in picker refuses it. Handle partial photo/video access and permission revocation; never interpret a partial listing as deletion of existing media.

### 7.1 Job state machine

```
queued
  → probing
  → converting (remux or transcode)
  → verifying
  → committing
  → deleting_source
  → done
       ↘ failed (keep source, delete partial)
       ↘ canceled (keep source, delete partial)
       ↘ interrupted (resume on next launch)
```

Rules:

- Only one job runs at a time on Android; one (optionally two) on macOS.
- A job never deletes the source before `verifying` passes.
- A job writes to `<name>.partial.mp4`, never directly to the final name.
- A failed job leaves the source untouched and removes the partial file.
- A canceled job kills FFmpeg, waits for exit, removes the partial file, and marks `canceled`.

### 7.2 Probe

macOS:

```sh
bundle:ffmpeg/bin/ffprobe -v error -print_format json \
  -show_format -show_streams -show_chapters input.mkv
```

Android:

- Use the FFmpeg build's `ffprobe` via JNI, or `MediaExtractor`/`MediaMetadataRetriever` for a quick probe. Prefer FFprobe so the stream indices and metadata match the conversion command.

Extract:

- `format.duration`, `format.size`, `format.format_name`
- for each stream: `index`, `codec_type`, `codec_name`, `profile`, `pix_fmt`, `width`, `height`, `channels`, `channel_layout`, `tags.language`, `tags.title`, `disposition.default`, `disposition.forced`, `color_transfer`, `color_primaries`, `color_space`, `field_order`
- chapters count

Store the streams in `streams` and the file facts in `media`.

### 7.3 Decision matrix

| Source | Video | Audio | Subtitles | Action |
|---|---|---|---|---|
| MKV, H.264 8-bit SDR, AAC | copy | copy or AAC | text | Remux to MP4. No quality loss when all retained streams are copied; audio/subtitle conversion can change them. |
| MKV, H.264 8-bit SDR, AC3/DTS/TrueHD | copy | AAC | text | Remux video, transcode audio. |
| MKV, HEVC 8-bit SDR | copy if target supports HEVC; else H.264 | AAC | text | Prefer copy on macOS/HEVC-capable Android; H.264 for maximum compatibility. |
| MKV, H.264/HEVC 10-bit or HDR | H.264 8-bit SDR | AAC | text | Transcode + tone-map. |
| MKV, VC-1/MPEG-2/AV1 unsupported | H.264 8-bit SDR | AAC | text | Transcode. |
| MP4, H.264 8-bit SDR, AAC | copy | copy | text | Leave as is; play directly. |
| MP4, HEVC 10-bit HDR | H.264 8-bit SDR | AAC | text | Transcode + tone-map (macOS AVPlayer may play HEVC HDR, but SDR output is the chosen target). |
| Any, PGS/VOBSUB subtitles only | keep video | AAC | drop image subs | Text-only policy. |
| Any, >5.1 audio | keep | AAC 5.1 | text | Downmix to 5.1, not stereo. |

The command builder should be **data-driven**, not a pile of `if` statements. Build a `Plan`:

```ts
type Plan = {
  container: 'mp4';
  video: { mode: 'copy' } | { mode: 'encode'; codec: 'h264'; crf: number; maxWidth: number; toneMap: boolean; deinterlace: boolean };
  audio: Array<{ sourceIndex: number; mode: 'copy' | 'aac'; bitrate: number; channels: number }>;
  subtitles: Array<{ sourceIndex: number; mode: 'mov_text' }>;
  chapters: boolean;
  faststart: boolean;
};
```

Then a pure function `buildFfmpegArgs(plan, input, output): string[]` that is unit-tested without running FFmpeg.

### 7.4 FFmpeg command templates

#### Remux (video copy, audio AAC, text subtitles)

```sh
ffmpeg -y -hide_banner -nostdin -i INPUT \
  -map 0:v:0 \
  -map 0:a? \
  -map 0:s? \
  -map_chapters 0 \
  -map_metadata 0 \
  -c:v copy \
  -c:a aac -b:a 256k \
  -c:s mov_text \
  -movflags +faststart \
  -max_muxing_queue_size 4096 \
  OUTPUT.partial.mp4
```

- Map only text subtitle streams. If you map PGS into `mov_text`, FFmpeg fails. Filter by `codec_name in {subrip, ass, ssa, mov_text, webvtt, text}`.
- If all audio is already AAC and channels ≤ 6, use `-c:a copy` instead of `aac`.
- Set per-stream metadata and dispositions:
  ```
  -metadata:s:a:0 language=eng -metadata:s:a:0 title="English 5.1"
  -disposition:a:0 default
  -metadata:s:s:0 language=eng -metadata:s:s:0 title="English"
  -disposition:s:0 0
  ```
- Preserve the source's default audio track; if none, make the first audio track default.
- Subtitles default off.

#### Transcode to H.264 SDR

```sh
ffmpeg -y -hide_banner -nostdin -i INPUT \
  -map 0:v:0 \
  -map 0:a? \
  -map 0:s? \
  -map_chapters 0 \
  -map_metadata 0 \
  -vf "scale='min(3840,iw)':-2:flags=lanczos,format=yuv420p" \
  -c:v libx264 -preset medium -crf 20 \
  -c:a aac -b:a 256k \
  -c:s mov_text \
  -movflags +faststart \
  -max_muxing_queue_size 4096 \
  OUTPUT.partial.mp4
```

HDR/10-bit tone-map (insert before `format=yuv420p`):

```
zscale=t=linear:npl=100,format=gbrpf32le,zscale=p=bt709,tonemap=tonemap=hable:desat=0,zscale=t=bt709:m=bt709:r=tv,format=yuv420p
```

Interlaced source: prepend `yadif,` to the filter chain.

Notes:

- `scale='min(3840,iw)':-2` caps at 4K and keeps the aspect ratio with an even height.
- For 1080p sources, the scale is a no-op but still normalizes the pixel format.
- `-crf 20` for 1080p; use `-crf 22` for 4K to keep files reasonable. Make it a setting.
- `-preset medium` on macOS; `-preset veryfast` on Android to reduce heat/time.
- Do not use `-c:v h264_videotoolbox` by default; quality is less predictable. Offer it as a "fast" setting later.
- If the source is HEVC 8-bit SDR and the target supports HEVC, a `-c:v copy` remux is better. For Android, check `MediaCodecList` for an HEVC decoder before choosing copy; for macOS, AVPlayer supports HEVC in MP4 on modern Macs, but H.264 is the safest default.

#### Audio rules

- AAC-LC.
- Stereo: 192–256 kbps.
- 5.1: 384 kbps.
- >5.1: downmix to 5.1 (`-ac 6`).
- Mono: 96–128 kbps.
- Keep all audio tracks; do not drop commentaries unless the person asks.
- Preserve language/title metadata; if missing, label by index ("Audio 1").

#### Subtitle rules

- Text only: `subrip`, `ass`, `ssa`, `mov_text`, `webvtt`.
- Convert to `mov_text` in MP4.
- Drop PGS/VOBSUB/DVB image subtitles. Record that they were dropped in the job log.
- ASS styling is lost; text and timing are preserved.
- Keep forced subtitles as a separate track; do not burn them in.
- Default subtitle track: off, unless the person sets a preferred language.

### 7.5 Verification

Run after FFmpeg exits with code 0:

1. `ffprobe` the output.
2. `format.duration` is within `max(2s, 0.5%)` of the source duration.
3. Exactly one video stream.
4. Audio stream count equals the number of audio streams in the plan.
5. Text subtitle count equals the number of mapped text subtitles.
6. `format.size > 0`.
7. Decode the first 2 seconds and the last 2 seconds as a quick check (these checks alone do not justify source deletion):
   ```sh
   ffmpeg -v error -i OUTPUT -t 2 -f null -
   ffmpeg -v error -sseof -2 -i OUTPUT -f null -
   ```
   A non-zero exit or any stderr line means the file is not trustworthy.
8. Before deleting the source, fully decode all planned video/audio streams using `ffmpeg -v error -xerror -i OUTPUT -map 0:v -map 0:a? -f null -`, inspect subtitle/track metadata, and open/seek the output in the target player. Record the verification result. Full decoding detects corruption but does not prove perceptual quality.
9. Persist source identity (size, mtime and a strong hash before deletion), the selected stream mapping, verification result and final output path in the job journal. If the source changed during conversion, keep it and fail replacement. Do not overwrite an unrelated output: use unique paths and a no-clobber final commit.

If any check fails:

- Delete `OUTPUT.partial.mp4`.
- Keep the source.
- Mark the job `failed` with the failing check and FFmpeg's last 40 stderr lines.
- Do not update the media row to point at the partial file.

### 7.6 Commit and delete

Only after verification passes:

1. Rename `OUTPUT.partial.mp4` to the final path (within `home:/Plexy` or `app:/media`; `storage.fs.rename` is allowed there, unlike `doc:/`).
2. In one SQLite transaction:
   - insert/update the `media` row with the new path, size, duration, codecs;
   - insert the `streams` rows;
   - set `status='ready'`;
   - set `original_path` to the source;
   - mark the job `done`.
3. Delete the source:
   - macOS: `storage.fs.rm(sourcePath)` for `doc:/` or `home:/`.
   - Android: delete the app-storage MKV; optionally ask MediaStore to delete the shared-storage original.
4. If deletion fails, keep the source, log `source_kept`, and do not fail the job. The library is still correct.
5. If the app crashes between rename and DB update, use the persisted job journal to verify and commit the matching MP4 first, then delete the unchanged source. A crash after DB commit but before deletion retries cleanup; mark deletion pending separately from conversion success.

### 7.7 macOS implementation

- Bundle `ffmpeg` and `ffprobe` under `tools/ffmpeg/bin/`.
- Grant `process.spawn bundle:ffmpeg/bin/ffmpeg` and `.../ffprobe`. The reference names "a `bundle:` helper" without a worked example, so confirm the exact grant spelling against the pinned commit during the Phase 0 spike; the helper path is relative to `Contents/Resources`.
- Use `spawn('bundle:ffmpeg/bin/ffmpeg', args, { encoding: 'utf8', exactStream })`.
- Add `-progress pipe:1 -nostats`; parse `out_time_ms`, `total_size`, `speed`, `progress=end`.
- Write progress to `jobs.progress` at most 4 times per second.
- On `exit`, run verification.
- On app quit: `willQuit` gives 5 seconds. Kill the child, mark the job `interrupted`, and resume on next launch. Do not try to keep converting after the app quits.
- Keep the Mac app running while converting; show a menu-bar/Dock badge or a window title. If the person closes the window, Exact may quit; `host.macos.window.keepRunning` can keep it alive (check the pinned version's behavior).
- Run at most one FFmpeg at a time by default; two is acceptable on Apple silicon if memory allows.

Sandbox/spike note:

- The child-process fixture uses `home:/` with `realpath` and a spawned child, so the intended pattern is supported. Still, test a **bundled** app (`bun exact.mjs mac --bundle`) reading and writing `home:/Plexy` and reading a `doc:/` picked folder. If the sandbox blocks the child's access to a `doc:/` path, do one of:
  1. Ask the person to put media in `~/Plexy` (the library root), or
  2. Use a small Swift module to copy the source into `home:/Plexy/inbox` before conversion (same process, security-scoped access), or
  3. Fall back to a managed `app:/media` library for that source.
- Record the result in `docs/spikes.md`.

### 7.8 Android implementation

- Link FFmpeg as a native library (arm64-v8a) with a JNI wrapper around `ffmpeg_main`, or use a maintained FFmpegKit fork pinned to a commit.
- Do **not** try to execute a bundled `ffmpeg` binary from the APK; Android 10+ restricts `exec` from app data.
- Requirements:
  - 16 KB page-size alignment (Android 15+ devices; targetSdk 36). Build with NDK r27+ and the 16 KB flags, or use a fork that already does.
  - Include `libavformat`, `libavcodec`, `libavfilter`, `libswscale`, `libswresample`, `libavutil`.
  - GPL is acceptable for local personal use if you include `libx264`; keep the license notices in the APK/assets. If you want LGPL, use `h264_mediacodec`/`hevc_mediacodec` and skip `libx264`, but quality/format control is worse.
- Run conversion in a foreground service:
  - Type `dataSync` (or `mediaProcessing` on Android 15+) with a progress notification.
  - Start it from a visible activity after the person taps Convert.
  - Request `POST_NOTIFICATIONS` on Android 13+ before the first conversion.
  - Keep a wake lock while converting; release it on completion.
- Use `-preset veryfast -crf 23` and cap at 1080p by default. 4K on-device is slow and hot; allow it only with a warning.
- If the device can direct-play the MKV, do not convert automatically. Show "Plays natively" and offer "Convert to MP4" as an action.
- If the device cannot play it, show a "Convert to play" action with an estimate (duration × speed factor).

### 7.9 Concurrency, thermal, and battery

- Android: one job at a time. Pause if `PowerManager.isPowerSaveMode` or the thermal status is `MODERATE`/`SEVERE` (API 29+ `PowerManager.getCurrentThermalStatus`). Resume when conditions improve or the person taps Resume.
- macOS: one or two jobs. Do not run FFmpeg on battery by default; offer "Convert on battery" as a setting.
- Show ETA as a range, not a precise number. FFmpeg speed varies by source.

---

## 8. Playback

### 8.1 Why two native players

The built-in `video` element cannot list or select audio/subtitle tracks. The native players also give us:

- direct MKV playback on Android,
- reliable track menus,
- fullscreen and PiP,
- playback state/progress events,
- platform-standard controls.

### 8.2 The `plexy-player` native view

Contract usage:

```contract
shape WatchItem
  path: string
  backdrop: string

shape Resume
  position: number

shape PlayerEvent
  position: number
  duration: number
  playing: bool
  tracks: string

shape Saved
  ok: bool

component Watch
  props
    mediaId: string
  resource item = mediaForWatch(mediaId) as shape WatchItem
  resource resume = resumeFor(mediaId) as shape Resume
  state position = 0
  state duration = 0
  state playing = false
  state audio = ""
  state subtitle = ""
  state tracks = ""
  // A mutation's answer is read in the action that follows it. Resources and
  // mutations belong to the root component, so this is the root screen (or the
  // data lives in the root and is passed down as props).
  mutation player as shape PlayerEvent then afterPlayer
  mutation saved as shape Saved
  action playerEvent(text: string)
    send player = parsePlayerEvent(text)
  action afterPlayer
    match player
      case some(p)
        position = p.position
        duration = p.duration
        playing = p.playing
        tracks = p.tracks
      case none
        playing = false
  action save
    send saved = saveProgress(mediaId, position)
  view
    column width="100%" height="100%" background-color="#000000"
      plexy-player src=item.path poster=item.backdrop startAt=resume.position autoplay=true audioTrack=audio subtitleTrack=subtitle message=playerEvent width="100%" flex=1
      row padding=12 gap=12
        text `${position} / ${duration}` testId="time"
        button press=save testId="save"
          text "Save"
```

Props (all strings, replaced on every change):

| Prop | Meaning |
|---|---|
| `src` | Virtual path (`home:/Plexy/...`, `app:/media/...`) or an absolute macOS path. |
| `poster` | Local artwork path for the poster/placeholder. |
| `startAt` | Seconds to start at (resume). |
| `autoplay` | `"true"` / `"false"`. |
| `audioTrack` | Selected audio track index, or `""` for default. |
| `subtitleTrack` | Selected subtitle track index, or `""` for off. |
| `muted` | `"true"` / `"false"`. |
| `rate` | Playback rate, default `"1"`. |

Events (compact strings, parsed in `app.ts`; do not require JSON in Contract):

| Event | Payload |
|---|---|
| `message` | `"time|123.4|7200|playing"` |
| `message` | `"state|paused"` / `"state|playing"` / `"state|ended"` |
| `message` | `"tracks|a:0:English 5.1:aac:6|a:1:Commentary:aac:2|s:2:English:subrip"` |
| `message` | `"error|codec_unsupported"` |
| `press` | The person tapped the surface (toggle controls). |
| `change` | A single value, if the native view uses a simple control. |

Use a TS source `parsePlayerEvent(text)` that returns a shape:

```ts
type PlayerEvent = {
  kind: 'time' | 'state' | 'tracks' | 'error';
  position: number;
  duration: number;
  playing: boolean;
  tracks: string;   // "a:0:English 5.1|s:2:English" for the menus
  error: string;
};
```

`parsePlayerEvent` is a source that returns this shape; `p.tracks` is split in Contract only if the menus need individual rows (Contract has `split`, `first`, `slice`). Keep the raw string in state and parse it in a derive.

The player writes progress to SQLite every 5 seconds and on pause/exit; the Contract can also call `saveProgress`.

### 8.3 macOS player (`PlexyPlayer.swift`)

Implementation outline:

```swift
#if os(macOS)
import AVKit
import AppKit

final class PlexyModule: ExactModule {
    override class var views: [String: ExactNativeFactory] {
        ["plexy-player": ExactNativeFactory(for: PlexyModule.self) { module, props, events in
            PlexyPlayer(module.context, props, events)
        }]
    }
}
let exactModule: ExactModule.Type = PlexyModule.self

final class PlexyPlayer: ExactNativeInstance {
    private let context: ExactModuleContext
    private let player = AVPlayer()
    private let playerView = AVPlayerView()
    private var timeObserver: Any?
    private var item: AVPlayerItem?

    init(_ context: ExactModuleContext, _ props: [String: String], _ events: ExactNativeEvents) {
        self.context = context
        super.init(events: events)
        playerView.player = player
        playerView.controlsStyle = .floating
        playerView.showsFullScreenToggleButton = true
        playerView.allowsPictureInPicturePlayback = true
        playerView.videoGravity = .resizeAspect
        try? setProps(props)
        timeObserver = player.addPeriodicTimeObserver(
            forInterval: CMTime(seconds: 0.5, preferredTimescale: 600),
            queue: .main
        ) { [weak self] time in
            guard let self else { return }
            let t = time.seconds
            let d = self.player.currentItem?.duration.seconds ?? 0
            let playing = self.player.rate != 0
            self.events.message("time|\(t)|\(d)|\(playing ? "playing" : "paused")")
        }
    }

    override var view: NSView { playerView }

    override func setProps(_ props: [String: String]) throws {
        if let src = props["src"], !src.isEmpty {
            let url = resolve(src)
            if let current = item?.asset as? AVURLAsset, current.url == url {
                // Same source: do not restart playback for a track change.
            } else {
                let newItem = AVPlayerItem(url: url)
                item = newItem
                player.replaceCurrentItem(with: newItem)
                observeReady(newItem)
                if let start = Double(props["startAt"] ?? ""), start > 0 {
                    player.seek(to: CMTime(seconds: start, preferredTimescale: 600))
                }
                if props["autoplay"] == "true" { player.play() }
            }
        }
        if let audio = props["audioTrack"], !audio.isEmpty { selectAudio(audio) }
        if let sub = props["subtitleTrack"] { selectSubtitle(sub) }
        if let muted = props["muted"] { player.isMuted = muted == "true" }
        if let rate = Double(props["rate"] ?? "") { player.rate = Float(rate) }
    }

    override func destroy() {
        if let timeObserver { player.removeTimeObserver(timeObserver) }
        player.pause()
        player.replaceCurrentItem(with: nil)
    }

    /// `app:/data|cache|tmp/…` map to the module's own directories.
    /// `home:/` and `doc:/` arrive absolute: `app.ts` calls
    /// `storage.fs.realpath` before setting the prop, because only it holds
    /// the grant and the document handle.
    private func resolve(_ src: String) -> URL {
        if src.hasPrefix("/") { return URL(fileURLWithPath: src) }
        if src.hasPrefix("app:/data/") {
            return context.data.appendingPathComponent(String(src.dropFirst("app:/data/".count)))
        }
        if src.hasPrefix("app:/cache/") {
            return context.cache.appendingPathComponent(String(src.dropFirst("app:/cache/".count)))
        }
        if src.hasPrefix("app:/tmp/") {
            return context.temporary.appendingPathComponent(String(src.dropFirst("app:/tmp/".count)))
        }
        return URL(fileURLWithPath: src)
    }

    private func observeReady(_ newItem: AVPlayerItem) {
        // AVPlayerItem.status is KVO; tracks exist only once ready.
        readyObservation = newItem.observe(\.status, options: [.new]) { [weak self] item, _ in
            guard item.status == .readyToPlay else { return }
            DispatchQueue.main.async { self?.publishTracks() }
        }
    }
    private var readyObservation: NSKeyValueObservation?

    private func publishTracks() {
        guard let asset = item?.asset else { return }
        var parts: [String] = []
        if let group = asset.mediaSelectionGroup(forMediaCharacteristic: .audible) {
            for (i, option) in group.options.enumerated() {
                parts.append("a:\(i):\(option.displayName):\(option.extendedLanguageTag ?? ""):0")
            }
        }
        if let group = asset.mediaSelectionGroup(forMediaCharacteristic: .legible) {
            for (i, option) in group.options.enumerated() {
                parts.append("s:\(i):\(option.displayName):\(option.extendedLanguageTag ?? ""):1")
            }
        }
        events.message("tracks|" + parts.joined(separator: "|"))
    }

    private func selectAudio(_ index: String) {
        guard let n = Int(index),
              let group = item?.asset.mediaSelectionGroup(forMediaCharacteristic: .audible),
              n >= 0, n < group.options.count else { return }
        item?.select(group.options[n], in: group)
    }

    private func selectSubtitle(_ index: String) {
        guard let group = item?.asset.mediaSelectionGroup(forMediaCharacteristic: .legible) else { return }
        if index.isEmpty || index == "off" {
            item?.select(nil, in: group)
            return
        }
        guard let n = Int(index), n >= 0, n < group.options.count else { return }
        item?.select(group.options[n], in: group)
    }
}
#endif
```

Notes:

- `AVPlayerView` gives native controls, fullscreen, and PiP.
- `AVMediaSelectionGroup` gives audio and subtitle selection for MP4 tracks.
- Subtitles must be embedded as `mov_text` during conversion. Sidecar subtitles are not supported by AVPlayer without extra composition work.
- `app.ts` must pass an absolute path for `home:/` and `doc:/` sources: call `storage.fs.realpath(path)` before setting the prop. For `app:/cache` paths, the module can map them via its `ExactModuleContext`.
- Do not use `CADisplayLink`/`Timer` for time updates; use `AVPlayer`'s periodic time observer.
- Publish tracks after the item is ready (`AVPlayerItem.status == .readyToPlay`); use KVO or `asset.loadValuesAsynchronously`. The outline above is a sketch; implement readiness correctly.
- For HDR sources, AVPlayer may tone-map automatically on an SDR display; the conversion pipeline still produces SDR files for consistency.

### 8.4 Android player (`PlexyPlayer.kt`)

Implementation outline:

```kotlin
class PlexyPlayerView(context: Context) : PlayerView(context) {
    // `player` is PlayerView's own property; keep the ExoPlayer apart and set it once.
    private val exo = ExoPlayer.Builder(context).build()
    private var ticker: Runnable? = null

    init {
        useController = true
        setUseTextureView(true) // the Exact host composites into a RenderNode
        player = exo
    }

    fun setSource(file: File, startAt: Double, autoplay: Boolean) {
        exo.setMediaItem(MediaItem.fromUri(Uri.fromFile(file)))
        exo.prepare()
        if (startAt > 0) exo.seekTo((startAt * 1000).toLong())
        exo.playWhenReady = autoplay
    }

    fun setAudioTrack(index: Int) {
        val tracks = exo.currentTracks
        val group = tracks.groups.firstOrNull { it.type == C.TRACK_TYPE_AUDIO } ?: return
        if (index in 0 until group.length) {
            exo.trackSelectionParameters = exo.trackSelectionParameters.buildUpon()
                .setOverrideForType(
                    TrackSelectionOverride(group.mediaTrackGroup, index)
                ).build()
        }
    }

    fun setSubtitleTrack(index: Int) {
        val tracks = exo.currentTracks
        val group = tracks.groups.firstOrNull { it.type == C.TRACK_TYPE_TEXT } ?: return
        if (index < 0) {
            exo.trackSelectionParameters = exo.trackSelectionParameters.buildUpon()
                .setTrackTypeDisabled(C.TRACK_TYPE_TEXT, true).build()
        } else if (index in 0 until group.length) {
            exo.trackSelectionParameters = exo.trackSelectionParameters.buildUpon()
                .setTrackTypeDisabled(C.TRACK_TYPE_TEXT, false)
                .setOverrideForType(TrackSelectionOverride(group.mediaTrackGroup, index))
                .build()
        }
    }

    fun startTicker(emit: (String, String) -> Unit) {
        stopTicker()
        val handler = Handler(Looper.getMainLooper())
        ticker = object : Runnable {
            override fun run() {
                val pos = exo.currentPosition / 1000.0
                val dur = exo.duration.coerceAtLeast(0) / 1000.0
                emit("message", "time|$pos|$dur|${if (exo.isPlaying) "playing" else "paused"}")
                handler.postDelayed(this, 500)
            }
        }
        handler.post(ticker!!)
    }

    fun stopTicker() {
        ticker?.let { Handler(Looper.getMainLooper()).removeCallbacks(it) }
        ticker = null
    }

    fun release() {
        stopTicker()
        exo.release()
    }
}
```

The package extension (the `class` named in `android/exact.json`):

```kotlin
class PlexyNative(context: ExtensionContext) : ExactExtension(context) {
    private val views = HashMap<String, PlexyPlayerView>()
    private var emit: (String, String) -> Unit = { _, _ -> }

    override fun view(
        tag: String, session: String, id: String, context: Context,
        props: JSONObject, emit: (String, String) -> Unit
    ): View {
        require(tag == "plexy-player") { "no view $tag" }
        this.emit = emit
        val v = PlexyPlayerView(context)
        views[id] = v
        v.startTicker(emit)
        apply(v, props)
        return v
    }

    override fun update(view: View, props: JSONObject) {
        apply(view as PlexyPlayerView, props)
    }

    override fun destroyView(view: View) {
        (view as PlexyPlayerView).release()
        views.entries.removeAll { it.value === view }
    }

    override fun later(name: String, args: JSONObject, reply: (JSONObject) -> Unit) {
        when (name) {
            "listDeviceVideos" -> reply(JSONObject().put("exact:answer", listVideos()))
            "importVideos" -> importVideos(args, reply)
            "convertMedia" -> convert(args, reply)
            "cancelConvert" -> cancel(args, reply)
            else -> reply(JSONObject().put("error", "NotSupportedError"))
        }
    }

    private fun apply(v: PlexyPlayerView, props: JSONObject) {
        if (props.has("src")) {
            // Resolve app:/ paths through the extension's context, not from the view.
            val file = this.context.file(props.optString("src"))
            if (file != null) {
                v.setSource(
                    file,
                    props.optString("startAt").toDoubleOrNull() ?: 0.0,
                    props.optBoolean("autoplay", true)
                )
            }
        }
        props.optString("audioTrack").toIntOrNull()?.let(v::setAudioTrack)
        props.optString("subtitleTrack").toIntOrNull()?.let(v::setSubtitleTrack)
    }
}
```

Check the pinned host's `ExactExtension` signatures (`packages/camera/android/Camera.kt` is the working example). A list answer is `{"exact:answer": [...]}` because a reply is one JSON object.

Notes:

- Use `PlayerView` with `setUseTextureView(true)`. A `SurfaceView` may not composite into Exact's `RenderNode`; `TextureView` does.
- Media3 includes `MatroskaExtractor`, so `.mkv` plays directly when the device has decoders.
- `DefaultTrackSelector` exposes audio/text groups; use `TrackSelectionOverride` for explicit choices.
- For sidecar subtitles, add `MediaItem.SubtitleConfiguration`; for embedded `mov_text`, Media3's `Tx3gDecoder` handles it.
- PGS/DVD image subtitles are not supported; the conversion pipeline drops them.
- On `PlaybackException`, emit `error|codec_unsupported` and show a Convert action.
- Add a track menu button to the controller (`TrackSelectionDialogBuilder`) for a user-facing selector. The outline uses props; the dialog can call back into the same selection methods.
- Fullscreen: use a full-screen `Dialog` or a dedicated `PlayerActivity` with immersive mode. Keep the player instance alive across the transition, or seek to the same position on recreate.

### 8.5 Direct-play policy

| File | macOS | Android |
|---|---|---|
| MP4 H.264 8-bit SDR + AAC | Play directly | Play directly |
| MP4 HEVC 8-bit SDR + AAC | Play directly (AVPlayer supports HEVC) | Play directly if the device has an HEVC decoder |
| MP4 HEVC 10-bit HDR | Play directly if AVPlayer supports it; otherwise convert | Play directly if the device supports HDR HEVC; otherwise convert |
| MKV H.264/HEVC + AAC/AC3 | **Convert to MP4 first** | Play directly if codecs are supported |
| MKV + DTS/TrueHD | Convert (audio) | Play directly only if the device has a DTS/TrueHD decoder; otherwise convert |
| MKV + PGS only | Convert and drop image subs | Play directly (video/audio); PGS not rendered |
| AV1 | Convert if AVPlayer can't decode; modern Macs may play AV1 | Play if the device has an AV1 decoder; otherwise convert |

When the file is not directly playable, the title screen shows:

- "Convert to play" with an estimate.
- "Why?" explaining the unsupported stream.
- A "Convert all unsupported" bulk action.

### 8.6 Subtitles and audio tracks

- Audio menu: language, title, channels, codec; "Default" and "Commentary" labels.
- Subtitle menu: Off, then each text track by language/title; forced tracks marked.
- Remember the last audio/subtitle choice per title, not globally.
- Do not auto-select a subtitle track unless the person set a preferred language.
- ASS styling is lost; do not promise typesetting.

### 8.7 Progress and resume

- Save `position` every 5 seconds while playing, on pause, on screen exit, and on app background.
- If `position / duration > 0.95`, mark `watched=1` and reset `position` to 0 for the next play.
- Continue Watching shows items with `0 < position < 95%` sorted by `updated_at`.
- If the media is converted, keep the progress row keyed by the new media id; migrate it in the commit transaction.

### 8.8 Fullscreen and PiP

- macOS: `AVPlayerView` fullscreen button; optionally PiP via `AVPlayerView.allowsPictureInPicturePlayback = true`.
- Android: fullscreen dialog/activity; PiP is optional. Skip PiP in v1 unless it falls out of Media3.
- Do not implement a custom fullscreen overlay in Contract; the native view owns it.

---

## 9. Native package: `@plexy/native`

Use a local Exact package rather than app-local `modules/android`, because Android needs Maven dependencies (Media3) and the package system is the supported way to add them. Model it on `packages/camera` in the Exact repo.

### 9.1 Interface (`packages/plexy-native/exact.json`)

```json
{
  "kind": "interface",
  "name": "@plexy/native",
  "version": "1.0.0",
  "grants": [],
  "shapes": {
    "DeviceVideo": {
      "id": "string",
      "name": "string",
      "folder": "string",
      "size": "number",
      "durationMs": "number",
      "mimeType": "string",
      "contentUri": "string"
    },
    "ImportResult": {
      "ok": "bool",
      "imported": "number",
      "skipped": "number",
      "error": "string"
    },
    "ConvertResult": {
      "ok": "bool",
      "output": "string",
      "error": "string"
    }
  },
  "names": [
    { "source": "listDeviceVideos", "live": true, "answers": "DeviceVideo[]" },
    { "send": "importVideos", "request": true, "answers": "ImportResult", "options": { "ids": "string[]" } },
    { "send": "convertMedia", "request": true, "answers": "ConvertResult", "options": { "path": "string", "maxWidth": "number", "crf": "number" } },
    { "send": "cancelConvert", "answers": "ConvertResult", "options": { "jobId": "string" } }
  ],
  "views": {
    "plexy-player": {
      "props": {
        "src": "string",
        "poster": "option<string>",
        "startAt": "option<string>",
        "autoplay": "option<string>",
        "audioTrack": "option<string>",
        "subtitleTrack": "option<string>",
        "muted": "option<string>",
        "rate": "option<string>"
      },
      "events": ["message", "press"],
      "displayed": true
    }
  }
}
```

The exact shape/name syntax must match the pinned Exact version; use `packages/camera/exact.json` and `packages/geolocation/exact.json` as the source of truth. In particular, an interface's `views` is an object keyed by tag, while an implementation's `views` is an array of tags. This is a sketch, not a compile-checked file.

The app must depend on the package. In the app's `package.json` (the one `exact new` writes, or the nearest one above the app):

```json
{
  "dependencies": {
    "@plexy/native": "file:./packages/plexy-native"
  }
}
```

Then `use Player... from "@plexy/native"` in `app.contract`, or `import` it in `app.ts`, resolves it. A package is found through the app's `node_modules`, so run the app's package install after adding the dependency.

### 9.2 Android implementation (`packages/plexy-native/android/exact.json`)

```json
{
  "kind": "implementation",
  "implements": "@plexy/native@^1.0",
  "platform": "android",
  "targets": ["android"],
  "shapes": {},
  "names": [],
  "views": ["plexy-player"],
  "hatches": [],
  "sources": { "kotlin": ["."] },
  "maven": [
    "androidx.media3:media3-exoplayer:<pin>",
    "androidx.media3:media3-ui:<pin>",
    "androidx.media3:media3-extractor:<pin>",
    "androidx.media3:media3-datasource:<pin>"
  ],
  "class": "com.plexy.native.PlexyNative"
}
```

- Pin Media3 to a specific version; do not use `+` or `latest.release`.
- The package's Kotlin sources compile into the APK through `-PextensionDirs`; Maven coordinates go through `-Pmaven` and are lock-verified.
- The `PlexyNative` class implements `ExactExtension` for `listDeviceVideos`/`importVideos`/`convertMedia` and serves the `plexy-player` view through the package view roster.
- If the package view roster on the pinned Android host does not support this, fall back to an app-local `modules/android/PlexyPlayer.kt` and patch `host/android/app/build.gradle.kts` to add Media3. Keep the patch in `patches/`.

### 9.3 Apple implementation (`packages/plexy-native/apple/exact.json`)

- `PlexyPlayer.swift` serves the `plexy-player` view.
- No extension calls are needed on macOS; the TS side handles files and FFmpeg.
- Guard all code with `#if os(macOS)` so the package can still compile for iOS later.

### 9.4 Web fallback (`packages/plexy-native/web/`)

- Serve `plexy-player` as an HTML `<video>` with controls for the web preview. Track selection can be a no-op or use the browser's default track menu.
- Do not spend time on web conversion or MediaStore.

### 9.5 FFmpeg packaging on Android

Media3 is a Maven dependency; FFmpeg is not. Choose one:

1. **Maintained FFmpegKit fork AAR** (preferred if one exists with 16 KB page support). Add it to `maven`, use its `FFmpegKit.executeAsync` API, and keep the license notices.
2. **Custom FFmpeg build + JNI wrapper**: build FFmpeg 7.x for `arm64-v8a` with NDK r27+, 16 KB alignment, and the codecs you need. Add the `.so` files under the app's `jniLibs/arm64-v8a` and patch the pinned host Gradle to include that directory, or publish a local AAR.
3. **No on-device conversion in v1**: direct-play only, and convert unsupported titles on the Mac. This is a legitimate fallback if FFmpeg integration blocks; document it and ship.

Record the choice and the exact build flags in `docs/spikes.md`.

---

## 10. UI port

### 10.1 Screens

| Screen | Source reference | Notes |
|---|---|---|
| Home | `apps/web/src/routes/index.tsx` | Hero + rows: Continue Watching, Recently Added, Movies, Shows, Genres. |
| Library | `apps/web/src/routes/library/$kind.tsx` | Grid/list, sort, filter, search. |
| Search | `apps/web/src/routes/search.tsx` | Local DB search + TMDB suggestions; debounce 250 ms. |
| Title detail | `apps/web/src/routes/title/$itemId.tsx` | Backdrop, poster, metadata, cast, seasons/episodes, play/resume, convert status, fix match. |
| Watch | `apps/web/src/routes/watch/$fileId.tsx` | Native `plexy-player`, resume, audio/subtitle menus, next episode. |
| Import | new | macOS folder picker; Android MediaStore browser. |
| Activity | new | Conversion queue, progress, cancel/retry, errors. |
| Settings | new | Library root, TMDB token, preferred audio/subtitle language, conversion quality, storage usage, about. |

### 10.2 Contract structure

- Use `routes` for tabs/stacks, not `if page == ...` state switches.
- Use `list` for rows and grids; key every `for`.
- Use `image` with local `app:/cache/...` paths.
- Use `resource` for reads; `mutation` + `refreshes` for writes.
- Use `task` for progress polling (500 ms while a job runs) and resume saves.
- Use `persist` for settings that should survive relaunch.
- Keep the dark, cinematic look, but use platform roles (`-exact-background`, `-exact-label`, `-exact-secondary-label`, `-exact-secondary-background`) instead of hard-coded colors.
- Do not draw list separators or press states; let the platform draw them.

### 10.3 Design notes

- Poster grid: 2 columns on phones, 4–6 on macOS, 6+ on TV.
- Hero: backdrop + title + Play/Resume + overview; avoid autoplaying trailers.
- Title detail: poster + metadata on wide, stacked on phones; seasons as a horizontal selector, episodes as a list.
- Player: native controls; Contract shows title, episode label, and a "Next episode" button below the player.
- Empty states: "Add media" on Home/Library; "No results" on Search; "Nothing converting" on Activity.
- Loading: skeletons for artwork; do not block the first frame on TMDB.
- Accessibility: `aria-label` on icon buttons, `role="heading"` on titles, focusable rows on TV.

### 10.4 Android TV stretch

Only after phone parity:

- Add `LEANBACK_LAUNCHER` to the manifest fragment and `android.hardware.touchscreen` as not required.
- Add a TV layout: larger type, 10-foot spacing, focus rings, D-pad navigation.
- Media3 `PlayerView` supports D-pad; test on a TV emulator or device.
- The Exact Android host's D-pad focus is unproven; if it fights you, keep TV as a separate Kotlin/Compose app later. Do not block the phone app.

---

## 11. Platform specifics

### 11.1 macOS

- **FFmpeg**: bundle static `ffmpeg`/`ffprobe` (arm64; universal if you want Intel). Verify SHA-256. Exact signs Mach-O helpers in `Resources/`.
- **Grants**: `process.spawn bundle:ffmpeg/bin/ffmpeg`, `.../ffprobe`; `fs.read/write home:/Plexy`; `fs.read/write doc:/`; `doc.keep`; `net.fetch` TMDB; `secret.keep tmdb`.
- **Picker**: `showDirectoryPicker` for source folders; `doc.keep` reopens them after relaunch.
- **Real paths**: `storage.fs.realpath(path)` for `home:/` and `doc:/` before FFmpeg/AVPlayer. Do not persist them.
- **Sandbox**: test a bundled app. If the child cannot read a `doc:/` path, use the library root or a Swift copy module (see 7.7).
- **Quit**: `willQuit` has a 5-second budget. Kill FFmpeg, mark jobs interrupted, resume on launch. Optionally keep the app running with `host.macos.window.keepRunning` while a job is active.
- **Menu**: add "Import Folder…", "Open Library", "Activity", "Settings" commands if they fit the app.
- **Notifications**: optional; use a native module or `@exact/notifications` if available. A Dock badge or window title is enough for v1.
- **Backup**: `~/Plexy` is user-visible; document it in Settings ("Your library is at ~/Plexy").

### 11.2 Android

- **Build**: `bun exact.mjs android` produces an arm64-v8a APK; install with `adb install -r`. Minimum SDK 31 (Android 12) unless a device needs 29/30.
- **Storage**: app-private `app:/media`. No `MANAGE_EXTERNAL_STORAGE`.
- **MediaStore**: request `READ_MEDIA_VIDEO` (13+) / `READ_EXTERNAL_STORAGE` (≤12, maxSdkVersion 32) via `ExtensionContext.requestPermissions`. The permission must first be in the APK manifest; because no grant line maps to it, supply it via the app's `modules/android` `android_entry` (`permissions.txt`) or a host patch, and check it in Phase 0.
- **Import**: query all external volumes; copy to `app:/media/inbox`; verify size; dedupe.
- **Delete source**: `MediaStore.createDeleteRequest` on API 30+; `RecoverableSecurityException` on API 29. If refused, keep the source.
- **Player**: Media3 `PlayerView` with `TextureView`; `MatroskaExtractor`; `TrackSelectionOverride` for audio/text; `TrackSelectionDialogBuilder` for the menu.
- **Conversion**: FFmpeg native library + foreground service (`dataSync`/`mediaProcessing`), `POST_NOTIFICATIONS`, wake lock, thermal/battery checks.
- **Remote images**: refused; always use `app:/cache/artwork/...`.
- **Pickers**: Exact's are refused; use MediaStore. SAF only with a host patch/headless Fragment.
- **16 KB pages**: FFmpeg native libs must be 16 KB aligned for Android 15+ devices.
- **TV**: optional leanback manifest + focus layout; test D-pad.
- **Backup**: app-private storage is removed on uninstall; add an "Export library" action later if needed.

### 11.3 iOS (future, not now)

If you add iOS later:

- No child processes; no `realpath`; `doc.keep` is not available; `fs.watch` never fires.
- Copy media into `app:/media` and use an AVPlayer native view.
- No background conversion while the app is closed.
- Keep the Swift player portable with `#if os(iOS)` guards.

---

## 12. What to port from the current code

| Current file | Action |
|---|---|
| `packages/local-library/src/library.ts` | Reuse pure local-library behavior and regression cases; replace persistence and file adapters with Exact APIs. Preserve records on incomplete scans. |
| `apps/server/src/parse.ts` | Port to `lib/parse.ts`; add tests. |
| `apps/server/src/matcher.ts` | Port scoring logic; adapt to direct TMDB `fetch`. |
| `apps/server/src/tmdb.ts` | Port request shapes and caching; use `store` for the token. |
| `apps/server/src/scan.ts` | Rewrite with `storage.fs`; macOS scan `home:/Plexy` + `doc:/`; Android scan `app:/media`. |
| `apps/server/src/ffmpeg.ts` | Port probe parsing, command construction, and progress parsing; split into pure functions. |
| `apps/server/src/optimize.ts` | Port job state machine and decision matrix; drop server-specific code. |
| `apps/server/src/hls-encoder.ts` | Drop. No HLS. |
| `apps/server/src/routes-media.ts` | Drop. Replace with local file playback. |
| `apps/server/src/app.ts` / `main.ts` | Drop. Replace with `app.ts` sources. |
| `apps/web/src/routes/*` | Use as UI/behavior reference; rewrite in Contract. |
| `apps/web/src/components/*` | Use as design reference; rewrite. |
| `packages/native-client` | Reference for mobile behavior; do not port the RN code. |
| `apps/mobile`, `apps/tv` | Drop. Android is the Exact app; TV is a stretch. |
| Server auth, users, sessions, WebSockets | Drop. No server. |
| Server HLS/transcode endpoints | Drop. Ahead-of-time MP4 only. |

Keep the old repo for comparison and for extracting parser/matcher test cases.

---

## 13. Implementation phases

### Phase 0 — Spike (go/no-go)

Build the smallest proof on real devices:

1. Create the Exact app, pin the commit, build macOS and Android.
2. macOS: a native `AVPlayerView` module plays a local MP4 from `~/Plexy`; audio/subtitle track menus appear.
3. macOS: `@exact/child-process` runs bundled FFmpeg on a disposable sample MKV, writes an MP4 into `~/Plexy`, verifies it, and deletes only that fixture source.
4. macOS: a bundled (`--bundle`) app can read/write `home:/Plexy` and read a `doc:/` folder in the child process.
5. Android: a Media3 `PlayerView` native view plays a local MKV with multiple audio tracks and text subtitles.
6. Android: a MediaStore query lists videos and copies one into `app:/media`; Media3 plays the copy. Confirm `READ_MEDIA_VIDEO` actually reaches the APK manifest (grant-line mapping, `permissions.txt`, or a patch).
7. Android: FFmpeg native conversion of a small MKV works, or the fallback is explicitly accepted.

**Go/no-go:** if Android Media3 + MediaStore work but FFmpeg is too costly, ship direct-play + Mac conversion. If Media3 itself cannot be integrated, stop and reassess the Android host before building UI.

Record commands, versions, device models, and failures in `docs/spikes.md`.

### Phase 1 — Core library (macOS)

- SQLite schema + migrations.
- Scan `~/Plexy`; pick a source folder with `doc.keep`; parse filenames.
- TMDB matching + artwork cache.
- Home, Library, Search, Title detail.
- Play existing MP4s with the native player.

**Acceptance:** import/scan 20 files, match at least 18, browse, search, play an MP4, resume progress after relaunch.

### Phase 2 — macOS conversion

- Bundle FFmpeg/ffprobe.
- Probe + plan + command builder.
- Remux/transcode, progress, cancel.
- Verify + commit + delete source.
- Activity screen.
- Startup reconciliation.

**Acceptance:** convert 10 MKVs (H.264, HEVC, 10-bit, multi-audio, text subs), all verify and play; originals deleted; failed job keeps the original; cancel keeps the original.

### Phase 3 — macOS player polish

- Audio/subtitle menus, track memory.
- Fullscreen/PiP.
- Resume/next episode.
- Error handling for unsupported files.

**Acceptance:** switch audio tracks and subtitles during playback; resume at 50%; progress survives relaunch.

### Phase 4 — Android foundation

- MediaStore import.
- Media3 player with track menus.
- Local artwork.
- Home/Library/Search/Title/Watch parity.
- Direct-play MKV.

**Acceptance:** import 10 videos from internal storage and SD card; play MKV with audio/subtitle switching; resume after app restart.

### Phase 5 — Android conversion

- FFmpeg native library or accepted fallback.
- Foreground service + notification.
- Convert unsupported titles; verify + delete.
- Thermal/battery handling.

**Acceptance:** convert an unsupported MKV; notification progress; app backgrounded/foregrounded; output plays; original deleted; cancel keeps original.

### Phase 6 — Polish and TV

- Settings, storage usage, export/backup notes.
- Trickplay thumbnails (optional).
- Skip intro (optional).
- Android TV leanback + focus layout (stretch).
- Docs and runbook.

---

## 14. Testing

### 14.1 Fixtures

Generate small files with FFmpeg (`tools/make-fixtures.sh`):

```sh
# H.264 + AAC, 30s
ffmpeg -f lavfi -i testsrc2=size=1280x720:rate=30 -f lavfi -i sine=frequency=440 \
  -t 30 -c:v libx264 -preset ultrafast -c:a aac -shortest h264-aac.mkv

# Two audio tracks
ffmpeg -f lavfi -i testsrc2=size=1280x720:rate=30 \
  -f lavfi -i sine=frequency=440 -f lavfi -i sine=frequency=880 \
  -t 30 -map 0:v -map 1:a -map 2:a -c:v libx264 -preset ultrafast \
  -c:a aac -metadata:s:a:0 language=eng -metadata:s:a:1 language=spa multi-audio.mkv

# Text subtitles
printf '1\n00:00:01,000 --> 00:00:04,000\nHello\n' > sample.srt
ffmpeg -i h264-aac.mkv -i sample.srt -c copy -c:s srt -metadata:s:s:0 language=eng subs.mkv

# HEVC 10-bit (short)
ffmpeg -f lavfi -i testsrc2=size=1280x720:rate=30 -t 10 \
  -c:v libx265 -pix_fmt yuv420p10le -preset ultrafast hevc10.mkv

# 4K HDR sample (short; tone-map test)
ffmpeg -f lavfi -i testsrc2=size=3840x2160:rate=24 -t 5 \
  -c:v libx265 -pix_fmt yuv420p10le -preset ultrafast \
  -color_primaries bt2020 -color_trc smpte2084 -colorspace bt2020nc hdr4k.mkv
```

Also keep one real-world PGS sample for the "drop image subs" test.

### 14.2 Unit tests (Bun)

- `parse.ts`: 40 filename cases.
- `matcher.ts`: scoring and tie-breakers.
- `plan.ts`: copy vs transcode decisions.
- `buildFfmpegArgs(plan, input, output)`: exact argument arrays.
- `verifyProbe(input, output, plan)`: pass/fail cases.
- `path.ts`: virtual path handling, sanitization, collision avoidance.

### 14.3 Contract tests (`app.test.contract`)

- Home renders rows from a seeded DB.
- Search filters the library.
- Title detail shows metadata and Play/Resume.
- Import screen shows the picker/MediaStore list.
- Activity shows queued/running/done.
- Empty states.
- Run on macOS and web with `bun exact.mjs verify` / `bun scripts/agent.mjs macos ...`.

### 14.4 Device tests

macOS:

```sh
bun exact.mjs mac
bun scripts/agent.mjs macos tree "tap play" screenshot .exact/watch.png logs
```

Android:

```sh
ANDROID_SERIAL=<serial> bun exact.mjs android --install --run
bun scripts/agent.mjs android --reader tree "tap import" screenshot .exact/android.png logs
```

Manual checklist:

- Import from internal storage and SD card.
- Play MKV with two audio tracks; switch tracks mid-playback.
- Toggle subtitles; confirm text and timing.
- Convert a title; watch progress; verify output; confirm original deletion.
- Cancel a conversion; confirm original remains and partial is gone.
- Kill the app during conversion; relaunch; confirm resume/interrupted state.
- Fill the disk (or simulate); confirm a clean failure and no data loss.
- Rotate/fullscreen; confirm position and tracks survive.
- Background/foreground on Android; confirm the foreground service continues.

### 14.5 Acceptance criteria (definition of done)

macOS:

- Scans `~/Plexy` and a picked `doc:/` folder.
- Converts MKV→MP4 (H.264/HEVC, up to 4K SDR), keeps all audio tracks, embeds text subtitles.
- Verifies before deleting the original.
- Plays MP4 with audio/subtitle switching and resume.
- Survives relaunch; interrupted jobs resume.
- No server process; no network needed for playback.

Android:

- Imports from MediaStore into `app:/media`.
- Direct-plays MKV when codecs are supported.
- Converts unsupported titles on-device (or the documented fallback).
- Plays with audio/subtitle switching and resume.
- Survives relaunch; foreground conversion continues when backgrounded.
- No remote images; artwork is local.

Both:

- No Plexy server, no HTTP client/server split.
- Fresh library; no sync.
- TMDB metadata and artwork cached locally.
- App works offline after import/metadata.

---

## 15. Risks and mitigations

| Risk | Impact | Mitigation |
|---|---|---|
| Exact is pre-1.0 and changes daily | Build breaks on update | Pin a commit; keep a fork; apply patches in `patches/`; never track `main` mid-port. |
| Android host is immature | Media3/FFmpeg/MediaStore integration fails | Phase 0 spike; fall back to app-local module + Gradle patch; last resort: separate Kotlin app. |
| AVPlayer cannot play MKV | macOS can't direct-play most media | Convert MKV→MP4; this is the main macOS job. |
| Audio track switching needs custom players | More native code on both platforms | Budget it; use AVPlayerView/Media3, not the `video` element. |
| Android FFmpeg build is heavy | Time, APK size, 16 KB pages | Use a maintained fork/AAR; cap at 1080p; fallback to Mac conversion. |
| Android pickers refused | No SAF folder import | Use MediaStore; SAF only with a host patch/headless Fragment. |
| No grant line maps to `READ_MEDIA_VIDEO` | MediaStore query denied | Add it through `modules/android`'s `android_entry` `permissions.txt` or a small host patch; verify the merged manifest in Phase 0. |
| Android remote images refused | Blank artwork | Cache all artwork to `app:/cache`; never use remote URLs in `image`. |
| Sandbox blocks FFmpeg on `doc:/` | In-place source conversion fails | Spike; use `~/Plexy` library or a Swift copy module; fall back to managed storage. |
| 4K HDR tone-mapping is slow | Long conversions | Short test clips; offer 1080p default; document time; run on power. |
| PGS/ASS subtitles | Lost styling/image subs | Text-only policy; drop image subs; document it. |
| Disk space | Failed conversions / data loss | Preflight checks; partial files; keep source until verify; startup cleanup. |
| App killed mid-conversion | Corrupt output / lost job | Partial files; DB state; foreground service on Android; resume on launch. |
| MediaStore delete refused | Originals remain | Keep the source; report `source_kept`; never force deletion. |
| TMDB API changes/rate limits | Metadata failures | Cache; retry/backoff; manual match; filename fallback. |
| Exact storage limits | Can't copy app→doc large files | Use FFmpeg for doc→home; `copyFile` only doc→app; never `readFile` large media. |
| Android TV focus unproven | TV app unusable | Stretch only; test D-pad; keep phone app independent. |

---

## 16. Open decisions

The defaults in section 0.3 and below are engineering proposals. Record the chosen behavior in `docs/spikes.md`; do not present it as a user-confirmed requirement. Source deletion is requested, but subtitle loss, HDR tone mapping, app-private imports and a fresh database remain proposed tradeoffs.

1. **macOS library root**: default `~/Plexy`. If you want `~/Movies/Plexy`, change the `home:/...` grants and the path constants before the first build. Grants are compile-time.
2. **macOS source handling**: default "move into `~/Plexy`" (convert + delete source). Alternative: "copy, keep source" for a safer first run.
3. **macOS 4K policy**: default 4K SDR H.264, CRF 22. Alternative: 1080p default with a per-title "Keep 4K" toggle.
4. **Android conversion**: default direct-play first, convert only unsupported titles. Alternative: convert everything to MP4 for uniformity (slower, hotter).
5. **Android 4K**: default cap at 1080p for on-device conversion. Alternative: allow 4K with a warning.
6. **Subtitle default**: off unless the person sets a preferred language.
7. **TMDB token**: store in Keychain via `store.set`; enter it in Settings on first launch.
8. **Android TV**: attempt only after phone parity; do not block v1.

---

## 17. Runbook for the implementing agent

1. Read this spec and the Exact docs: `docs/start-here.md`, `docs/reference.md`, `docs/recipes/native-module.md`, `docs/recipes/native-views.md`, `docs/recipes/files-and-grants.md`, `docs/recipes/porting-and-release.md`, `host/android/README.md`.
2. Pin Exact. Create the app. Run `bun exact.mjs setup` once.
3. Do Phase 0 before writing UI. Record results in `docs/spikes.md`.
4. Build the pure TypeScript core first (parse, match, plan, verify) with tests; it is the part that survives platform changes.
5. Build the macOS player and conversion before the Android player; macOS is the stable host.
6. Build the Android MediaStore import and Media3 player next; conversion last.
7. Keep `app.ts` free of platform branches where possible. Use `processStatus().available` and a `capabilities()` source for macOS vs Android differences.
8. Run `bun exact.mjs contract build app.contract --json --errors-only` after every Contract change.
9. Run `bun exact.mjs verify` on macOS and `bun exact.mjs verify android` on a device before calling a phase done.
10. Update this spec when a spike changes a decision; do not leave stale assumptions.

---

## 18. Appendix: capability source

```ts
// app.ts
import { processStatus } from '@exact/child-process';

export const sources: Sources = {
  capabilities: () => {
    const p = processStatus();
    return {
      platform: p.available ? 'macos' : 'android',
      canSpawn: p.available,
      canConvertOnDevice: !p.available, // Android native module
      canPickFolder: p.available,       // macOS Exact picker
      canUseMediaStore: !p.available,   // Android native module
    };
  },
};
```

Contract:

```contract
shape Capabilities
  platform: string
  canSpawn: bool
  canConvertOnDevice: bool
  canPickFolder: bool
  canUseMediaStore: bool

component App
  resource caps = capabilities() as shape Capabilities
  view
    if caps.canPickFolder
      ImportFolder()
    else
      DeviceImport()
```

This is how one Contract tree serves both platforms without a server and without pretending the platforms are identical.

Notes:

- `processStatus().available` is a stand-in for "has child processes", which here means macOS. It is false on Windows/Linux too, but those are not targets. When the native package is in place, prefer a `capabilities` name implemented on both sides: Android answers `canUseMediaStore: true` and codec support from `MediaCodecList`; macOS answers `canSpawn: true`. That avoids inferring the platform from an unrelated capability.
- The source's real signature is `(args, store, storage)` and its declared answer is a `Result<'capabilities'>`; the zero-argument form above is fine, and the generated `Sources` type checks it.
- Do not branch on the platform inside Contract when a capability answers the same question. `caps.canPickFolder` and `caps.canUseMediaStore` are the two real forks.

## Implementation status (2026-11-09)

The initial foundation is in `plexy-exact/` (lowercase required by Exact's generator).
See `plexy-exact/docs/spikes.md` for Phase 0 evidence and unresolved gates.
The port is not complete and no native release is available. Per the implementation
request, GitHub build update support is now a required release feature, superseding
its exclusion from v1 above. Existing GitHub build/update behavior is preserved.
