# Playback preparation and original file replacement

Plexy prepares files that browsers cannot play directly. Preparation is one of:

- **Remux** — copy the packets into a fast-start MP4. Lossless and usually seconds.
- **Audio-only transcode** — copy the video and re-encode the first audio track.
- **Full transcode** — re-encode incompatible video to H.264 and audio to AAC.

By default prepared copies are cache files. They are never the library source.

## When preparation starts

Nothing has to be played first. The scanner queues every file that cannot stream
as-is, and the optimizer works through that queue in a child process while the
server keeps serving requests:

- On boot, `startOptimizer()` re-queues interrupted jobs and sweeps the library
  for unprepared files.
- A scan pauses the queue while it probes (so probing stays fast) and starts it
  again as soon as each library's walk finishes.
- Opening a title never *starts* the work: if a browser asks for a copy that is
  still queued it moves that file to the front (and playback begins as soon as
  it is ready), but libraries that finished scanning are already prepared.

The optimizer runs one job at a time to keep CPU and disk contention
predictable; its progress is visible in Settings → Preparation cache and in
`GET /api/server/status`.

## Where prepared copies live

| Setting | Location |
| --- | --- |
| `optimizeStorage: "data"` (default) | `~/Library/Application Support/Plexy/optimized/` |
| `optimizeStorage: "media"` | `<media folder>/.plexy/optimized/` |

The scanner skips every `.plexy` folder, so copies stored beside media never
appear as duplicate titles. A read-only media folder falls back to the data
folder for that file.

## Replacing the original

`replaceOriginal: true` makes the prepared MP4 the library file after a
successful preparation:

1. The MP4 is staged beside the original and verified.
2. The catalog row switches to the MP4 path, container, codecs, size, and mtime.
3. The previous source is removed according to the deletion policy below.
4. Embedded subtitles are extracted to Plexy's subtitle cache first when
   possible, so they remain selectable after the MP4 replaces the source.

The MP4 contains the first video track and the first audio track only. Extra
audio tracks and embedded subtitle tracks are not carried into the MP4. Enable
replacement only when that trade-off is acceptable.

Replacement is opt-in and applies to future successful preparations. Already
prepared cache files stay cache files until you clear the cache and prepare
again.

## Deletion policy

`moveOriginalsToTrash: true` (default) sends the previous original to the
operating system Trash/Recycle Bin:

- macOS: `NSFileManager` trash integration.
- Linux: `gio trash`, falling back to `trash-put`.
- Headless or unavailable trash service: a hidden `.plexy/trash` folder beside
  the media is used instead so the file is never silently destroyed.

`moveOriginalsToTrash: false` deletes the original permanently and is the only
mode that reclaims its disk space immediately.

> The system Trash still occupies disk space until it is emptied. If a 100 GB
> library is replaced, the new MP4s replace the originals in the media folders,
> but the originals remain in the Trash until it is emptied. Turn the Trash
> option off when immediate space reclamation matters more than recovery.

The same policy applies when a title is removed from Plexy.

During preparation the new MP4 and the original exist at the same time. In the
data-folder mode that extra copy is outside the media folder; in the
beside-original mode (or when replacement copies into the media folder) the
media volume needs temporary headroom roughly equal to the prepared file.
After replacement, only one copy remains in the media folder.

## Restoring a file

- System Trash: use Finder/Explorer or the Linux desktop trash UI, then rescan
  the library.
- Local fallback: move the file out of `<media folder>/.plexy/trash/` and
  rescan.

Files in the local fallback keep their original filename after a timestamp
prefix, for example `2026-11-14T15-59-33-566Z-Movie.mkv`.

## Clearing prepared copies

**Clear Cache** removes prepared copies from both the data folder and
`.plexy/optimized` beside media. It never removes a file that is now the
library source after replacement.
