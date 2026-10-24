/// Scan service (PRD 5.2, 5.3, 5.4).
///
/// Walks each library's roots, classifies paths, parses names, probes media in
/// the isolated worker, matches against TMDB and persists items. Files that are
/// unchanged (size + mtime) are skipped for incremental rescans; locked manual
/// matches are never overwritten. Complete scans prune records for missing
/// files; unavailable roots and incomplete walks preserve existing records.
import { lstat, readdir, readFile, stat, unlink, rm } from "node:fs/promises";
import { basename, dirname, join, relative, resolve, sep } from "node:path";
import { db, q, run, type Row } from "./db";
import { log } from "./logger";
import { setActiveScanJobId } from "./crash";
import { getConfig } from "./config";
import { VIDEO_EXTENSIONS, EXTRA_FOLDER, SEASON_FOLDER, parsePath, movieFolderKey, tvSeriesFolderKey, normalizeTitle, type LibraryType } from "./parse";
import { match } from "./matcher";
import * as tmdb from "./tmdb";
import { probe, createProbePool, setOnWorkerCrash, shutdownWorker } from "./worker-host";
import { enqueueMissingOptimizations, pauseOptimizer, resumeOptimizer } from "./optimize";
import { cacheEmbeddedSubtitles } from "./subtitles";
import { resolveOptimizedDir, resolveTrickplayDir } from "./paths";
import { hydrateItemMetadata, hydrateEpisodeItem, hydrateMissingEpisodes } from "./hydrate";

export interface ScanProgress {
  scanId: number;
  status: "running" | "done" | "failed";
  libraryId: number | null;   // null during the discovery phase
  libraryName: string | null;
  filesSeen: number;
  filesUpdated: number;
  issues: number;
  currentFile: string | null;
  startedAt: string;
  finishedAt?: string | null;
  error?: string | null;
}

/** Live progress snapshots for the SSE endpoint. */
export let currentScan: ScanProgress | null = null;
export type ScanListener = (p: ScanProgress) => void;
const listeners = new Set<ScanListener>();
export function onScanProgress(fn: ScanListener): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

// --- sidecars (PRD 5.3) ------------------------------------------------------

/** Memoized NFO reader so sibling episodes don't re-read the same file. */
const nfoIdCache = new Map<string, number | null>();

/**
 * Read an explicit TMDB id from the first `*.nfo` in a folder (e.g.
 * `tvshow.nfo`, `movie.nfo`). Accepts the `<tmdbid>` tag and Kodi's
 * `<uniqueid type="tmdb">` form. Cached per folder for the process lifetime.
 */
async function readNfoId(dir: string): Promise<number | null> {
  const cached = nfoIdCache.get(dir);
  if (cached !== undefined) return cached;
  let id: number | null = null;
  try {
    const entries = await readdir(dir, { withFileTypes: true });
    const nfo = entries.find((e) => e.isFile() && e.name.toLowerCase().endsWith(".nfo"));
    if (nfo) {
      const text = await readFile(join(dir, nfo.name), "utf8");
      const m = text.match(/<tmdbid>\s*(\d+)\s*<\/tmdbid>/i)
        ?? text.match(/<uniqueid[^>]*type=["']tmdb["'][^>]*>\s*(\d+)\s*<\/uniqueid>/i);
      id = m ? Number(m[1]) : null;
    }
  } catch { /* unreadable folder simply yields no explicit id */ }
  nfoIdCache.set(dir, id);
  return id;
}

/** Sidecar image name conventions map to artwork kinds (PRD 5.3). */
const LOCAL_ART_SPECS: ReadonlyArray<{ kind: "poster" | "backdrop" | "logo"; files: string[] }> = [
  { kind: "poster", files: ["poster.jpg", "folder.jpg", "poster.png", "folder.png"] },
  { kind: "backdrop", files: ["fanart.jpg", "backdrop.jpg", "fanart.png", "backdrop.png"] },
  { kind: "logo", files: ["logo.png", "logo.jpg"] },
];

async function fileExists(p: string): Promise<boolean> {
  try { return (await stat(p)).isFile(); } catch { return false; }
}

/**
 * Attach local sidecar artwork (poster.jpg, fanart.jpg, logo.png,
 * seasonNN-poster.jpg) to an item. Only fills kinds with no artwork yet, so
 * hydrated TMDB art keeps priority when it exists; local sidecars cover
 * season posters, logos and never-matched items. The absolute path is stored
 * server-side only — clients receive `/api/images/:artworkId` links (PRD 11).
 */
export async function attachLocalArtwork(
  itemId: number, dir: string, seasonNumber?: number,
): Promise<void> {
  const have = new Set(
    q<Row>("SELECT kind FROM artwork WHERE item_id=?").all(itemId).map((r) => String(r.kind)),
  );
  const seasonTag = seasonNumber === undefined
    ? null : `season${String(seasonNumber).padStart(2, "0")}`;
  for (const spec of LOCAL_ART_SPECS) {
    if (have.has(spec.kind)) continue;
    const candidates = seasonTag && spec.kind === "poster"
      ? [`${seasonTag}-poster.jpg`, `${seasonTag}-poster.png`]
      : spec.files;
    for (const file of candidates) {
      const path = join(dir, file.toLowerCase());
      if (await fileExists(path)) {
        q("INSERT INTO artwork (item_id, kind, source, url) VALUES (?,?,'local',?)")
          .run(itemId, spec.kind, path);
        break;
      }
    }
  }
}

/**
 * The folder holding a series' sidecar art: the file's directory, or one
 * above it when the file lives in a season folder.
 */
function seriesDirFor(path: string): string {
  const parent = dirname(path);
  return SEASON_FOLDER.test(basename(parent).trim()) ? dirname(parent) : parent;
}

let scanning = false;
/** Library ids whose scan waits for the current run to finish (PRD 5.2). */
const queuedLibraries = new Set<number>();

/** Start scanning the given libraries (or all). Idempotent while running. */
export function startScan(libraryIds: number[] = allLibraryIds()): number | null {
  if (scanning) {
    for (const id of libraryIds) queuedLibraries.add(id);
    return currentScan?.scanId ?? null;
  }
  scanning = true;
  void runScan(libraryIds).catch((err) => {
    log.error("scanner", "scan loop failed", { message: String(err) });
  });
  return currentScan?.scanId ?? null;
}

function allLibraryIds(): number[] {
  return q<{ id: number }, []>("SELECT id FROM libraries").all().map((r) => r.id);
}

async function runScan(libraryIds: number[]): Promise<void> {
  const startedAt = new Date().toISOString();
  nfoIdCache.clear(); // re-read NFO sidecars every scan
  await shutdownWorker(); // one clean worker per scan run
  setOnWorkerCrash((code) => log.error("media", "worker crashed during scan", { exitCode: code }));

  const libraryRows = libraryIds
    .map((id) => q<{ id: number; name: string }, [number]>(
      "SELECT id, name FROM libraries WHERE id = ?").get(id))
    .filter((row): row is { id: number; name: string } => !!row);

  run(
    "INSERT INTO scans (library_ids, status, started_at) VALUES (?, 'running', ?)",
    JSON.stringify(libraryIds), startedAt,
  );
  const scanRowId = (q<{ id: number }>(
    "SELECT id FROM scans ORDER BY id DESC LIMIT 1").get() as Row).id as number;
  setActiveScanJobId(scanRowId);

  const progress: ScanProgress = {
    scanId: scanRowId,
    status: "running",
    libraryId: null,
    libraryName: null,
    filesSeen: 0,
    filesUpdated: 0,
    issues: 0,
    currentFile: null,
    startedAt,
  };
  let lastEmitAt = 0;
  let trailingEmit: ReturnType<typeof setTimeout> | null = null;
  const publish = () => {
    currentScan = { ...progress };
    for (const fn of listeners) { try { fn(currentScan); } catch {} }
  };
  // SSE listeners do not need one frame per file; a trailing emit guarantees
  // the final position and status are delivered.
  const emit = (force = false) => {
    currentScan = { ...progress };
    const now = Date.now();
    if (!force && now - lastEmitAt < 120) {
      if (!trailingEmit) {
        trailingEmit = setTimeout(() => { trailingEmit = null; emit(true); }, 120);
      }
      return;
    }
    clearTimeout(trailingEmit ?? undefined);
    trailingEmit = null;
    lastEmitAt = now;
    publish();
  };
  emit(true);

  // Preparation jobs would compete with scanning for CPU and disk; keep the
  // queue for after the walk (it resumes in `finally`).
  pauseOptimizer("scan");

  const seen = { count: 0 };
  const cfg = await getConfig();
  // The probe worker enforces the same ceiling internally.
  Bun.env.PLEXY_PROBE_CONCURRENCY = String(cfg.probeConcurrency);
  const pool = createProbePool(cfg.probeConcurrency);

  try {
    for (const library of libraryRows) {
      const roots = q<{ path: string }, [number]>("SELECT path FROM library_paths WHERE library_id = ?")
        .all(library.id).map((r) => r.path);
      const type = (q<{ type: string }, [number]>("SELECT type FROM libraries WHERE id = ?")
        .get(library.id) as Row).type as LibraryType;

      progress.libraryId = library.id;
      progress.libraryName = library.name;
      const issuesBeforeLibrary = progress.issues;
      let rootsComplete = true;
      const seenPaths = new Set<string>();

      for (const root of roots) {
        // An unreachable root must not be read as "everything deleted" (PRD 5.2).
        let readable = true;
        try { await lstat(root); } catch {
          readable = false;
          rootsComplete = false;
          log.error("scanner", "root unavailable, keeping records", { root });
          emit();
        }
        if (readable) {
          await scanFolder(root, root, type, roots, progress, emit, pool, seen, seenPaths, library.id);
        }
      }

      // Only a complete, issue-free walk treats absent files as deletions.
      // Inaccessible folders and failed file probes keep existing records.
      if (roots.length > 0 && rootsComplete && progress.issues === issuesBeforeLibrary) {
        const removed = await removeMissingLibraryFiles(library.id, seenPaths);
        if (removed) log.info("scanner", "removed missing media records", {
          libraryId: library.id, count: removed,
        });
      }

      // Ensure all episodes discovered for this library have TMDB metadata and stills
      await hydrateMissingEpisodes().catch((err) =>
        log.warn("tmdb", "could not hydrate missing episodes after library scan", {
          message: err instanceof Error ? err.message : String(err),
        }));
    }
    progress.status = "done";
    progress.finishedAt = new Date().toISOString();
    run(
      `UPDATE scans SET status='done', files_seen=?, files_updated=?, issues=?, finished_at=? WHERE id=?`,
      progress.filesSeen, progress.filesUpdated, progress.issues, progress.finishedAt, scanRowId,
    );
    log.info("scanner", "scan complete", {
      files: progress.filesSeen, updated: progress.filesUpdated, issues: progress.issues,
    });
    void pruneTmdbCacheSoon();
  } catch (err) {
    progress.status = "failed";
    progress.error = err instanceof Error ? err.message : String(err);
    progress.finishedAt = new Date().toISOString();
    run(`UPDATE scans SET status='failed', error=?, finished_at=? WHERE id=?`,
      progress.error, progress.finishedAt, scanRowId);
    log.error("scanner", "scan failed", { error: progress.error });
  } finally {
    setActiveScanJobId(null);
    if (trailingEmit) { clearTimeout(trailingEmit); trailingEmit = null; }
    emit(true);
    await shutdownWorker();
    scanning = false;
    // Start preparing everything the walk just discovered. Optimizer jobs run
    // one at a time in a child process, so this never blocks the event loop.
    resumeOptimizer("scan");
    void enqueueMissingOptimizations().catch((err) =>
      log.warn("optimizer", "could not queue preparation after scan", {
        message: err instanceof Error ? err.message : String(err),
      }));
    // Libraries created (or manual scans requested) while this run was
    // underway get their own pass instead of being silently dropped.
    if (queuedLibraries.size) {
      const next = [...queuedLibraries];
      queuedLibraries.clear();
      void startScan(next);
    }
  }
}

/** Depth-first walk skipping extras and non-video files (PRD 5.2). */
async function scanFolder(
  root: string, dir: string, type: LibraryType, roots: string[],
  progress: ScanProgress, emit: () => void,
  pool: ReturnType<typeof createProbePool>,
  seen: { count: number },
  seenPaths: Set<string>,
  libraryId: number,
): Promise<void> {
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch (err) {
    log.warn("scanner", "unreadable folder skipped", { dir, message: String(err) });
    progress.issues++;
    emit();
    return;
  }
  const tasks: Promise<void>[] = [];
  for (const entry of entries) {
    const path = join(dir, entry.name);
    if (entry.isDirectory() && EXTRA_FOLDER.test(entry.name)) continue;
    if (entry.isDirectory()) {
      await scanFolder(root, path, type, roots, progress, emit, pool, seen, seenPaths, libraryId);
      continue;
    }
    if (!VIDEO_EXTENSIONS.has(basename(path).toLowerCase().match(/\.[^.]+$/)?.[0] ?? "")) continue;
    seenPaths.add(path);
    seen.count++;
    progress.filesSeen = seen.count;
    progress.currentFile = relative(root, path);
    emit();
    // Files are probed/matched concurrently; the pool bounds how many probes
    // the worker receives at once (configurable, default 4).
    tasks.push(pool(async () => {
      try {
        const changed = await processFile(path, root, type, roots, libraryId);
        if (changed) progress.filesUpdated++;
        emit();
      } catch (err) {
        progress.issues++;
        log.error("scanner", "file failed", { path, message: err instanceof Error ? err.message : String(err) });
        emit();
      }
    }));
  }
  await Promise.all(tasks);
}

/** Remove records and generated caches for files absent from a complete walk. */
async function removeMissingLibraryFiles(libraryId: number, seenPaths: Set<string>): Promise<number> {
  const rows = q<Row>(
    "SELECT id, path, mtime, optimized_path FROM media_files WHERE library_id = ?",
  ).all(libraryId);
  const missing = rows.filter((row) => !seenPaths.has(String(row.path)));
  if (!missing.length) return 0;

  const optimizedRoot = resolve(resolveOptimizedDir());
  const trickplayRoot = resolveTrickplayDir();
  const trickplayEntries = await readdir(trickplayRoot).catch(() => [] as string[]);
  for (const row of missing) {
    const fileId = Number(row.id);
    const optimizedPath = row.optimized_path == null ? null : resolve(String(row.optimized_path));
    if (optimizedPath?.startsWith(`${optimizedRoot}${sep}`)) {
      await unlink(optimizedPath).catch(() => {});
    }
    const subtitles = q<{ path: string }, [number]>(
      "SELECT path FROM subtitle_cache WHERE file_id = ?",
    ).all(fileId);
    for (const subtitle of subtitles) {
      const subtitlePath = resolve(subtitle.path);
      if (subtitlePath.startsWith(`${optimizedRoot}${sep}`)) await unlink(subtitlePath).catch(() => {});
    }
    for (const name of trickplayEntries) {
      if (name.startsWith(`${fileId}-`)) {
        await rm(join(trickplayRoot, name), { recursive: true, force: true }).catch(() => {});
      }
    }
  }

  db.exec("BEGIN IMMEDIATE");
  try {
    for (const row of missing) run("DELETE FROM media_files WHERE id = ?", Number(row.id));
    // Removing the final source file also removes its title and cascaded
    // watch state, metadata, match candidates, artwork references and trailers.
    run(
      `DELETE FROM items WHERE library_id = ? AND kind IN ('movie', 'episode')
       AND NOT EXISTS (SELECT 1 FROM media_files WHERE item_id = items.id)`,
      libraryId,
    );
    run(
      `DELETE FROM items WHERE library_id = ? AND kind = 'season'
       AND NOT EXISTS (SELECT 1 FROM items child WHERE child.parent_id = items.id)`,
      libraryId,
    );
    run(
      `DELETE FROM items WHERE library_id = ? AND kind = 'series'
       AND NOT EXISTS (SELECT 1 FROM items child WHERE child.parent_id = items.id)
       AND NOT EXISTS (SELECT 1 FROM media_files WHERE item_id = items.id)`,
      libraryId,
    );
    run("DELETE FROM people WHERE NOT EXISTS (SELECT 1 FROM item_people WHERE person_id = people.id)");
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
  return missing.length;
}

/**
 * Process one file. Returns true if the DB row was touched. Incremental scan:
 * unchanged files (size + mtime) with a complete probe are skipped, but items
 * are still created if missing.
 */
async function processFile(
  path: string, root: string, type: LibraryType, roots: string[],
  libraryId: number,
): Promise<boolean> {
  const info = await stat(path);
  const existing = q<Row>("SELECT * FROM media_files WHERE path = ?").get(path);

  const sameStamp = !!existing
    && Number(existing.size) === info.size
    && Number(existing.mtime) === Math.floor(info.mtimeMs);
  const alreadyProbed = sameStamp && existing?.analysis_status === "probed";

  const parsed = parsePath(path, type, roots);
  const folderKey = type === "movies" ? movieFolderKey(path, roots)
    : tvSeriesFolderKey(path, roots);
  const itemId = existing?.item_id == null ? null : Number(existing.item_id);
  const previousItem = itemId
    ? q<{ match_status: string; folder_key: string | null; tmdb_id: number | null; kind: string }, [number]>(
      "SELECT match_status, folder_key, tmdb_id, kind FROM items WHERE id=?",
    ).get(itemId)
    : undefined;
  const previousMatch = previousItem?.match_status ?? "unmatched";

  // Fast path: the file is unchanged and fully matched. Nothing to re-probe,
  // re-match, or write — this is what keeps rescans quick.
  // Note: an episode whose tmdb_id is null is not fully matched and needs hydration.
  if (alreadyProbed && previousMatch === "matched"
    && existing?.folder_key === folderKey
    && previousItem?.folder_key === folderKey
    && (previousItem?.kind !== "episode" || previousItem?.tmdb_id != null)) return false;

  // NFO sidecars provide explicit ids that outrank parsed titles (PRD 5.3).
  // Checked in the file's folder and its parent (season layouts).
  const nfoId = await readNfoId(dirname(path)) ?? await readNfoId(dirname(dirname(path)));

  if (alreadyProbed && existing) {
    // Unchanged but not matched yet: retry matching without touching the media
    // file again. A transient TMDB outage should not require a manual reset.
    const fileId = ensureFileRow(path, libraryId, folderKey, info.size, Math.floor(info.mtimeMs), parsed, existing);
    await ensureItemAndMatch(fileId, path, type, roots, libraryId, parsed, folderKey, existing, nfoId);
    const current = q<{ match_status: string }, [number]>("SELECT match_status FROM items WHERE id=?")
      .get(itemId ?? 0);
    return (current?.match_status ?? previousMatch) !== previousMatch;
  }

  // 1) upsert the file row, 2) probe, 3) ensure the item, 4) match
  const fileId = ensureFileRow(path, libraryId, folderKey, info.size, Math.floor(info.mtimeMs), parsed, existing);

  let subtitles: unknown[] = [];
  try {
    const facts = await probe(path, { timeoutMs: 60_000 });
    subtitles = facts.subtitles;
    run(
      `UPDATE media_files SET
        container=$container, duration=$duration, bitrate=$bitrate,
        video_codec=$vc, video_profile=$vp, width=$w, height=$h, fps=$fps, hdr=$hdr,
        audio_json=$audio, subtitles_json=$subs, analysis_status='probed',
        analysis_error=NULL, probed_at=$at
       WHERE id=$id`,
      {
        $id: fileId,
        $container: facts.container,
        $duration: facts.duration,
        $bitrate: facts.bitrate,
        $vc: facts.video?.codec ?? null,
        $vp: facts.video?.profile ?? null,
        $w: facts.video?.width ?? null,
        $h: facts.video?.height ?? null,
        $fps: facts.video?.fps ?? null,
        $hdr: facts.video?.hdr ?? null,
        $audio: JSON.stringify(facts.audio),
        $subs: JSON.stringify(facts.subtitles),
        $at: new Date().toISOString(),
      },
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    // analysis_failed is terminal for this scan; manual rescan retries (PRD 6).
    run("UPDATE media_files SET analysis_status='analysis_failed', analysis_error=? WHERE id=?", message, fileId);
    log.warn("media", "probe failed", { path, message });
  }

  await ensureItemAndMatch(fileId, path, type, roots, libraryId, parsed, folderKey, existing, nfoId);

  // Extract embedded tracks while the file is already open in the scanner's
  // mind: the player then never has to demux the video to show subtitles.
  if (subtitles.length) {
    const fresh = q<Row, [number]>("SELECT * FROM media_files WHERE id = ?").get(fileId);
    if (fresh) {
      void cacheEmbeddedSubtitles(fresh).catch((err) =>
        log.warn("player", "subtitle caching failed", {
          fileId, message: err instanceof Error ? err.message : String(err),
        }));
    }
  }

  return true;
}

type FileRow = {
  id: number; library_id: number; path: string; folder_key: string;
  size: number; mtime: number; unavailable: number;
  container: string | null; duration: number | null; bitrate: number | null;
  video_codec: string | null; video_profile: string | null; video_bit_depth: number | null;
  width: number | null; height: number | null; fps: number | null; hdr: string | null;
  audio_json: string | null; subtitles_json: string | null; chapters_json: string | null;
  analysis_status: string; analysis_error: string | null; probed_at: string | null;
  item_id: number | null; episode_range: string | null;
};

function ensureFileRow(
  path: string, libraryId: number, folderKey: string,
  size: number, mtime: number, parsed: ReturnType<typeof parsePath>,
  existing: Row | undefined,
): number {
  if (existing) {
    run(
      "UPDATE media_files SET size=?, mtime=?, unavailable=0, folder_key=?, episode_range=? WHERE id=?",
      size, mtime, folderKey,
      rangeTag(parsed),
      existing.id as number,
    );
    return existing.id as number;
  }
  const row = q<{ id: number }>(
    "INSERT INTO media_files (library_id, path, folder_key, size, mtime, episode_range) VALUES (?,?,?,?,?,?) RETURNING id",
  ).get(libraryId, path, folderKey, size, mtime, rangeTag(parsed));
  return Number(row!.id);
}

/** `S01E01-E02` marker when one file spans two episodes. */
function rangeTag(parsed: ReturnType<typeof parsePath>): string | null {
  if (!parsed.episode) return null;
  const e = String(parsed.episode).padStart(2, "0");
  return parsed.episodeEnd
    ? `S${String(parsed.season ?? 0).padStart(2, "0")}E${e}-E${String(parsed.episodeEnd).padStart(2, "0")}`
    : `S${String(parsed.season ?? 0).padStart(2, "0")}E${e}`;
}

/**
 * Make sure the item for this file exists (movie / series / season / episode)
 * and run matching when the item is not locked (PRD 5.4 step 8).
 */
async function ensureItemAndMatch(
  fileId: number, path: string, type: LibraryType, roots: string[],
  libraryId: number, parsed: ReturnType<typeof parsePath>,
  folderKey: string, existing: Row | undefined, nfoId: number | null,
): Promise<void> {
  const cfg = await getConfig();
  const lang = cfg.metadataLanguage;

  if (type === "movies") {
    const itemId = await ensureMovie(folderKey, libraryId, parsed, path, nfoId);
    if (itemId) {
      run("UPDATE media_files SET item_id=? WHERE id=?", itemId, fileId);
      const oldItemId = existing?.item_id == null ? null : Number(existing.item_id);
      if (oldItemId != null && oldItemId !== itemId) {
        // Remove the stale shared root item after its last file has been
        // reassigned by a repair scan. Other old files keep it alive until
        // their own incremental repair pass completes.
        run(
          `DELETE FROM items WHERE id=? AND kind='movie' AND folder_key='.'
           AND NOT EXISTS (SELECT 1 FROM media_files WHERE item_id=?)`,
          oldItemId, oldItemId,
        );
      }
      void attachLocalArtwork(itemId, dirname(path));
    }
    return;
  }

  // TV: series item, then season, then episode item (PRD 5.4 step 7).
  const seriesItem = await ensureSeries(folderKey, libraryId, parsed, path, nfoId);
  if (!seriesItem) return;
  run("UPDATE media_files SET item_id=? WHERE id=?", seriesItem, fileId);

  const sDir = seriesDirFor(path);
  void attachLocalArtwork(seriesItem, sDir);

  const seasonNumber = parsed.season ?? 0;
  const seasonItem = await ensureSeason(seriesItem, seasonNumber, parsed.year);
  void attachLocalArtwork(seasonItem, sDir, seasonNumber);

  const episodeNumber = parsed.episode;
  if (episodeNumber) {
    const episodeItem = await ensureEpisode(seriesItem, seasonItem, seasonNumber, episodeNumber, parsed.title);
    if (episodeItem) run("UPDATE media_files SET item_id=? WHERE id=?", episodeItem, fileId);
  }
}

/** Look up or create a movie item keyed by folder (PRD 8: items.folder_key). */
async function ensureMovie(folderKey: string, libraryId: number, parsed: ReturnType<typeof parsePath>, path: string, nfoId: number | null): Promise<number | null> {
  const existing = q<{ id: number; locked: number; match_status: string }, [number, string]>
    ("SELECT id, locked, match_status FROM items WHERE library_id=? AND kind='movie' AND folder_key=?")
    .get(libraryId, folderKey);
  if (existing) {
    if (!existing.locked && existing.match_status !== "matched") {
      await runMatchForItem(existing.id, "movie", parsed, path, nfoId);
    }
    return existing.id;
  }
  const row = q<{ id: number }>(
    "INSERT INTO items (library_id, kind, folder_key, name, sort_title, year) VALUES (?,?,?,?,?,?) RETURNING id",
  ).get(libraryId, "movie", folderKey, parsed.title, normalizeTitle(parsed.title), parsed.year);
  const id = Number(row!.id);
  await runMatchForItem(id, "movie", parsed, path, nfoId);
  return id;
}

/** Ensure the series item for a TV folder, matching it if unlocked. */
async function ensureSeries(folderKey: string, libraryId: number, parsed: ReturnType<typeof parsePath>, path: string, nfoId: number | null): Promise<number | null> {
  const existing = q<{ id: number; locked: number; match_status: string }>(
    "SELECT id, locked, match_status FROM items WHERE library_id=? AND kind='series' AND folder_key=?").get(libraryId, folderKey);
  if (existing) {
    if (!existing.locked && existing.match_status !== "matched") {
      await runMatchForItem(existing.id, "series", parsed, path, nfoId, seriesDirFor(path));
    }
    return existing.id;
  }
  const row = q<{ id: number }>(
    "INSERT INTO items (library_id, kind, folder_key, name, sort_title, year) VALUES (?,?,?,?,?,?) RETURNING id",
  ).get(libraryId, "series", folderKey, parsed.title, normalizeTitle(parsed.title), parsed.year);
  const id = Number(row!.id);
  await runMatchForItem(id, "series", parsed, path, nfoId, seriesDirFor(path));
  return id;
}

async function ensureSeason(seriesId: number, seasonNumber: number, year: number | null): Promise<number> {
  const existing = q<{ id: number }, [number, number]>(
    "SELECT id FROM items WHERE parent_id=? AND kind='season' AND season_number=?").get(seriesId, seasonNumber);
  if (existing) return existing.id;
  q("INSERT INTO items (library_id, parent_id, kind, name, sort_title, season_number, year) SELECT library_id, id, 'season', ?, ?, ?, ? FROM items WHERE id=?")
    .run(`Season ${seasonNumber}`, normalizeTitle(`Season ${seasonNumber}`), seasonNumber, year, seriesId);
  return Number(q<{ id: number }>("SELECT id FROM items WHERE parent_id=? AND kind='season' AND season_number=?").get(seriesId, seasonNumber)!.id);
}

async function ensureEpisode(
  seriesId: number, seasonId: number, seasonNumber: number, episodeNumber: number, seriesTitle: string,
): Promise<number | null> {
  const existing = q<{ id: number; tmdb_id: number | null }, [number, number, number]>(
    "SELECT id, tmdb_id FROM items WHERE parent_id=? AND kind='episode' AND season_number=? AND episode_number=?")
    .get(seriesId, seasonNumber, episodeNumber);
  if (existing) {
    if (!existing.tmdb_id) {
      void hydrateEpisodeItem(existing.id, seriesId, seasonNumber, episodeNumber, seriesTitle).catch(() => {});
    }
    return existing.id;
  }
  const name = `S${String(seasonNumber).padStart(2, "0")}E${String(episodeNumber).padStart(2, "0")}`;
  q("INSERT INTO items (library_id, parent_id, kind, name, sort_title, season_number, episode_number, match_status, matched_by) VALUES (?,?,?,?,?,?,?,?,?)")
    .run(libraryIdOfSeries(seriesId), seriesId, "episode", name, normalizeTitle(`${seriesTitle} ${name}`), seasonNumber, episodeNumber, "matched", "series");
  const row = q<{ id: number }>(
    "SELECT id FROM items WHERE parent_id=? AND kind='episode' AND season_number=? AND episode_number=?")
    .get(seriesId, seasonNumber, episodeNumber);
  if (row) {
    void hydrateEpisodeItem(row.id, seriesId, seasonNumber, episodeNumber, seriesTitle).catch(() => {});
  }
  return row ? Number(row.id) : null;
}

function libraryIdOfSeries(seriesId: number): number {
  const row = q<{ library_id: number }, [number]>("SELECT library_id FROM items WHERE id=?").get(seriesId);
  return row?.library_id ?? 0;
}

/** Insert match candidates into the review rows (PRD 5.4 step 6). */
function storeCandidates(itemId: number, candidates: Array<{ tmdbId: number; tmdbType: string; title: string; year: number | null; posterPath: string | null; score: number; reason: string }>) {
  run("DELETE FROM match_candidates WHERE item_id=?", itemId);
  candidates.forEach((c, i) => {
    q("INSERT INTO match_candidates (item_id, tmdb_id, tmdb_type, title, year, poster_path, score, reason, position) VALUES (?,?,?,?,?,?,?,?,?)")
      .run(itemId, c.tmdbId, c.tmdbType, c.title, c.year, c.posterPath, c.score, c.reason, i);
  });
}

/** Items currently being matched; prevents duplicate TMDB calls during a parallel scan. */
const matchingItems = new Set<number>();

/** Run the matching pipeline for one item and persist the decision. */
async function runMatchForItem(
  itemId: number, kind: "movie" | "series", parsed: ReturnType<typeof parsePath>,
  path: string, nfoId: number | null, artDir: string = dirname(path),
): Promise<void> {
  if (matchingItems.has(itemId)) return;
  matchingItems.add(itemId);
  try {
    await matchItemOnce(itemId, kind, parsed, path, nfoId, artDir);
  } finally {
    matchingItems.delete(itemId);
  }
}

async function matchItemOnce(
  itemId: number, kind: "movie" | "series", parsed: ReturnType<typeof parsePath>,
  path: string, nfoId: number | null, artDir: string,
): Promise<void> {
  const item = q<{ locked: number; match_status: string }, [number]>("SELECT locked, match_status FROM items WHERE id=?").get(itemId);
  if (!item || item.locked) return; // locked manual matches never rerun (PRD 5.4.8)

  const id = path.match(/[\[{]tmdb(?:id)?\s*[=:\-]\s*(\d+)[\]}]/i)?.[1];
  // Movie runtime from the probe lets the top candidates earn the 0.15
  // runtime component (PRD 5.4 step 5).
  const runtimeRow = kind === "movie"
    ? q<{ duration: number | null }>("SELECT duration FROM media_files WHERE item_id=? AND duration IS NOT NULL ORDER BY id LIMIT 1").get(itemId)
    : null;
  let result;
  try {
    result = await match({
      parsedTitle: parsed.title,
      parsedYear: parsed.year,
      kind: kind === "series" ? "tv" : "movie",
      fileRuntimeMinutes: runtimeRow?.duration ? Math.round(runtimeRow.duration / 60) : null,
      explicitId: parsed.explicitId ?? nfoId ?? (id ? Number(id) : null),
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    run("UPDATE items SET match_status='unmatched', reason=? WHERE id=?", `TMDB unavailable: ${message}`, itemId);
    log.warn("matcher", "match failed", { itemId, message });
    return;
  }

  if (result.status === "matched" && result.best) {
    run(
      `UPDATE items SET match_status='matched', tmdb_type=?, tmdb_id=?, score=?, matched_by=?, reason=?, refreshed_at=? WHERE id=?`,
      result.best.tmdbType, result.best.tmdbId, result.best.score, result.matchedBy, result.best.reason, new Date().toISOString(), itemId,
    );
    storeCandidates(itemId, []); // clear stale review candidates
    log.info("matcher", "matched", { itemId, title: result.best.title, score: result.best.score, reason: result.best.reason });
    void hydrateMetadata(itemId, result.best.tmdbType, result.best.tmdbId, kind === "series" ? seriesDirFor(path) : dirname(path)).catch((e) =>
      log.warn("tmdb", "hydrating metadata failed", { itemId, message: String(e) }));
  } else if (result.status === "review") {
    run(
      `UPDATE items SET match_status='review', score=?, matched_by=?, reason=?, tmdb_type=NULL, tmdb_id=NULL WHERE id=?`,
      result.best?.score ?? null, result.matchedBy, result.best ? `candidate: ${result.best.reason}` : "ambiguous candidates", itemId,
    );
    storeCandidates(itemId, result.candidates);
    log.info("matcher", "review queue", { itemId, count: result.candidates.length });
  } else {
    run(
      `UPDATE items SET match_status='unmatched', score=NULL, tmdb_type=NULL, tmdb_id=NULL, reason=? WHERE id=?`,
      result.best
        ? `below review threshold (${result.best.score.toFixed(2)})`
        : result.candidates.length
          ? "below review threshold (no clear candidate)"
          : "no search results",
      itemId,
    );
    log.info("matcher", "unmatched", { itemId, reason: "below threshold" });
  }
}

/**
 * Pull essentials (PRD 5.5) into item_metadata, artwork, videos, people.
 * Series-level fetches happen on the series item; episode names resolve via
 * the season endpoint in hydrateEpisodes.
 */
async function hydrateMetadata(itemId: number, tmdbType: "movie" | "tv", tmdbId: number, artDir: string | null): Promise<void> {
  // Shared implementation: hydrate.ts
  await hydrateItemMetadata(itemId, tmdbType, tmdbId);
  // Hydration rewrites the artwork rows; re-attach sidecar art the TMDB pass
  // doesn't provide (logos, season posters) so they survive the wipe.
  if (artDir) {
    try { await attachLocalArtwork(itemId, artDir); } catch { /* non-fatal */ }
  }
}

/** Free expired cache rows shortly after a scan; keeps the table bounded. */
async function pruneTmdbCacheSoon() {
  setTimeout(() => {
    try { tmdb.pruneCache(); } catch { /* non-fatal */ }
  }, 5_000);
}
