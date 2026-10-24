/// Prepared-playback queue.
///
/// The scanner records probe facts; this module decides whether a file needs
/// work and prepares it *before* anyone presses play. Two operations:
///
/// - `remux`     copy every packet into a fast-start MP4 (lossless, ~1 s per GB)
/// - `transcode` re-encode only the incompatible track(s), keeping the source
///               resolution and bitrate
///
/// The original file is never modified or deleted. Finished copies live in the
/// app-data `optimized/` directory and are served through the normal stream
/// route, which turns every prepared title into a `direct` play with instant
/// byte-range seeking.
import { mkdir, open, readdir, stat, statfs, unlink } from "node:fs/promises";
import { join } from "node:path";
import { q, run, type Row } from "./db";
import { log } from "./logger";
import { getConfig } from "./config";
import { resolveOptimizedDir } from "./paths";
import {
  canonicalCodec, classifyPlayability, preferredAudioBitrate, preferredVideoBitrate,
} from "./playback";
import { runOptimize, shutdownOptimizeWorker } from "./optimize-host";
import { cacheEmbeddedSubtitles } from "./subtitles";

export interface OptimizeFacts {
  container: string | null;
  videoCodec: string | null;
  audioJson: string | null;
  height: number | null;
  bitrate: number | null;
  duration: number | null;
  size: number;
}

export type OptimizeDecision =
  | { action: "skip"; reason: string }
  | {
      action: "optimize";
      mode: "remux" | "transcode";
      videoCopy: boolean;
      audioCopy: boolean;
      videoBitrate?: number;
      audioBitrate?: number;
      reason: string;
    };

const MP4_LIKE = new Set(["mp4", "m4v", "mov", "mp4f"]);

function normalizeContainer(container: string | null): string {
  return (container ?? "").toLowerCase().replace(/[^a-z0-9]/g, "");
}

/**
 * Decide what to do with one probed file. Pure so it can be tested without a
 * database or a media file.
 *
 * `needsFastStart` is only consulted for containers the browser can already
 * play: an MP4 whose `moov` index sits at the end still plays, but the browser
 * has to read the whole file before it can seek, so we repack it.
 */
export function decideOptimization(
  facts: OptimizeFacts,
  options: { needsFastStart?: boolean } = {},
): OptimizeDecision {
  const container = normalizeContainer(facts.container);
  const verdict = classifyPlayability(
    {
      container: facts.container,
      videoCodec: facts.videoCodec,
      audioJson: facts.audioJson ?? "[]",
      subtitlesJson: null,
    },
    null,
  );

  if (verdict.path === "unsupported") {
    return { action: "skip", reason: verdict.reason };
  }

  if (verdict.path === "direct") {
    if (MP4_LIKE.has(container) && options.needsFastStart) {
      return {
        action: "optimize",
        mode: "remux",
        videoCopy: true,
        audioCopy: true,
        reason: "Moving the MP4 index to the front so seeking is instant",
      };
    }
    return { action: "skip", reason: verdict.reason };
  }

  const video = canonicalCodec(facts.videoCodec);
  const audioTracks = safeAudio(facts.audioJson);
  const audio = canonicalCodec(audioTracks[0]?.codec ?? null);
  const videoCopy = video === "h264";
  const audioCopy = audio === "aac" || audio === "mp3";

  // Both tracks are MP4-native: this is only a container problem, so a remux is
  // enough even when the classifier called it a transcode (AVI/TS, for example).
  // Other codecs the browser can decode but MP4 cannot portably hold (VP9/Opus
  // in MKV, for instance) are transcoded instead, otherwise the prepared copy
  // would be marked direct-playable yet fail in some browsers.
  if (videoCopy && audioCopy) {
    return {
      action: "optimize",
      mode: "remux",
      videoCopy: true,
      audioCopy: true,
      reason: "Repacking into a fast-start MP4 without re-encoding",
    };
  }

  const channels = audioTracks[0]?.channels ?? null;
  return {
    action: "optimize",
    mode: "transcode",
    videoCopy,
    audioCopy,
    ...(videoCopy ? {} : { videoBitrate: preferredVideoBitrate(facts.height, facts.bitrate) }),
    ...(audioCopy ? {} : { audioBitrate: preferredAudioBitrate(channels) }),
    reason: verdict.reason,
  };
}

function safeAudio(json: string | null): Array<{ codec: string; channels?: number }> {
  if (!json) return [];
  try {
    const parsed = JSON.parse(json);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

/**
 * True when the first top-level atom is `moov` (index at the front). Returns
 * true for anything unreadable so a broken file is not re-encoded pointlessly.
 */
export async function isFastStart(path: string): Promise<boolean> {
  const handle = await open(path, "r").catch(() => null);
  if (!handle) return true;
  try {
    const { size } = await handle.stat();
    const header = Buffer.alloc(16);
    let offset = 0;
    for (let guard = 0; offset + 8 <= size && guard < 64; guard++) {
      const { bytesRead } = await handle.read(header, 0, 16, offset);
      if (bytesRead < 8) return true;
      let boxSize = header.readUInt32BE(0);
      const type = header.toString("latin1", 4, 8);
      let headerSize = 8;
      if (boxSize === 1) {
        if (bytesRead < 16) return true;
        boxSize = Number(header.readBigUInt64BE(8));
        headerSize = 16;
      } else if (boxSize === 0) {
        boxSize = size - offset;
      }
      if (!Number.isFinite(boxSize) || boxSize < headerSize) return true;
      if (type === "moov") return true;
      if (type === "mdat") return false;
      offset += boxSize;
    }
    return true;
  } catch {
    return true;
  } finally {
    await handle.close().catch(() => {});
  }
}

/** Cache location for one prepared copy; the mtime keeps versions distinct. */
export function optimizedPathFor(row: Row): string {
  return join(resolveOptimizedDir(), `${Number(row.id)}-${Number(row.mtime)}.mp4`);
}

/**
 * The prepared file for this row, if it is still valid for the current source.
 * Checks the recorded mtime *and* the file itself: a cache directory cleared by
 * hand must not leave the player pointing at a missing file.
 */
export async function usableOptimizedPath(row: Row): Promise<string | null> {
  const path = row.optimized_path;
  if (!path) return null;
  if (row.optimized_mtime != null && Number(row.optimized_mtime) !== Number(row.mtime)) return null;
  try {
    const info = await stat(String(path));
    if (!info.isFile() || info.size === 0) return null;
  } catch {
    return null;
  }
  return String(path);
}

export interface OptimizationView {
  status: string;
  mode: string | null;
  progress: number | null;
  size: number | null;
  error: string | null;
}

export function optimizationView(row: Row): OptimizationView {
  return {
    status: String(row.optimized_status ?? "none"),
    mode: row.optimized_mode == null ? null : String(row.optimized_mode),
    progress: row.optimized_progress == null ? null : Number(row.optimized_progress),
    size: row.optimized_size == null ? null : Number(row.optimized_size),
    error: row.optimized_error == null ? null : String(row.optimized_error),
  };
}

// --- queue -------------------------------------------------------------------

const queue: number[] = [];
const queuedIds = new Set<number>();
let running = false;
let paused = false;
let stopping = false;
let current: { fileId: number; progress: number } | null = null;

/** Called by the scanner so probing keeps the machine to itself. */
export function pauseOptimizer(): void {
  paused = true;
}

export function resumeOptimizer(): void {
  paused = false;
  void pump();
}

function markStatus(fileId: number, status: string, patch: Record<string, unknown> = {}) {
  const keys = Object.keys(patch);
  const assignments = ["optimized_status = ?", ...keys.map((key) => `${key} = ?`)];
  run(
    `UPDATE media_files SET ${assignments.join(", ")} WHERE id = ?`,
    status, ...keys.map((key) => patch[key]), fileId,
  );
}

/** Add one file to the queue (no-op when it is already queued/running). */
export function enqueueOptimization(fileId: number): void {
  if (queuedIds.has(fileId) || current?.fileId === fileId) return;
  const row = q<Row, [number]>("SELECT * FROM media_files WHERE id = ?").get(fileId);
  if (!row || Number(row.unavailable ?? 0) !== 0) return;
  if (row.analysis_status !== "probed") return;

  queuedIds.add(fileId);
  queue.push(fileId);
  markStatus(fileId, "queued", {
    optimized_progress: 0,
    optimized_error: null,
  });
  void pump();
}

async function pump(): Promise<void> {
  if (running || paused) return;
  const fileId = queue.shift();
  if (fileId == null) return;
  queuedIds.delete(fileId);
  running = true;
  current = { fileId, progress: 0 };
  try {
    await optimizeOne(fileId);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    log.error("optimizer", "job failed", { fileId, message });
    markStatus(fileId, stopping ? "queued" : "failed", {
      optimized_error: stopping ? null : message,
      optimized_progress: stopping ? 0 : null,
      optimized_at: new Date().toISOString(),
    });
  } finally {
    running = false;
    current = null;
    void pump();
  }
}

async function freeBytes(dir: string): Promise<number | null> {
  try {
    const fs = await statfs(dir);
    return Number(fs.bavail) * Number(fs.bsize);
  } catch {
    return null;
  }
}

async function optimizeOne(fileId: number): Promise<void> {
  const row = q<Row, [number]>("SELECT * FROM media_files WHERE id = ?").get(fileId);
  if (!row) return;
  if (Number(row.unavailable ?? 0) !== 0) {
    markStatus(fileId, "skipped", { optimized_error: "Source file is unavailable" });
    return;
  }

  const sourcePath = String(row.path);
  const source = await stat(sourcePath).catch(() => null);
  if (!source?.isFile()) {
    markStatus(fileId, "failed", {
      optimized_error: "Source file is missing",
      optimized_progress: null,
      optimized_at: new Date().toISOString(),
    });
    return;
  }

  // A file changed after the scan: leave it for the next pass, which re-probes
  // and re-queues with the new mtime.
  if (Number(row.size) !== source.size || Number(row.mtime) !== Math.floor(source.mtimeMs)) {
    markStatus(fileId, "none", {
      optimized_error: null,
      optimized_progress: null,
    });
    log.info("optimizer", "file changed since scan; waiting for the next scan", { fileId });
    return;
  }

  const existing = await usableOptimizedPath(row);
  if (existing) {
    markStatus(fileId, "done", {
      optimized_path: existing,
      optimized_progress: 1,
      optimized_error: null,
    });
    return;
  }

  const container = normalizeContainer(row.container as string | null);
  const needsFastStart = MP4_LIKE.has(container) ? !(await isFastStart(sourcePath)) : false;
  const decision = decideOptimization(
    {
      container: row.container as string | null,
      videoCodec: row.video_codec as string | null,
      audioJson: row.audio_json as string | null,
      height: row.height == null ? null : Number(row.height),
      bitrate: row.bitrate == null ? null : Number(row.bitrate),
      duration: row.duration == null ? null : Number(row.duration),
      size: Number(row.size),
    },
    { needsFastStart },
  );

  if (decision.action === "skip") {
    markStatus(fileId, "skipped", {
      optimized_path: null,
      optimized_size: null,
      optimized_progress: null,
      optimized_mtime: Number(row.mtime),
      optimized_at: new Date().toISOString(),
      optimized_error: decision.reason,
    });
    return;
  }

  await mkdir(resolveOptimizedDir(), { recursive: true });
  const output = optimizedPathFor(row);

  const free = await freeBytes(resolveOptimizedDir());
  const needed = Math.ceil(Number(row.size) * (decision.mode === "remux" ? 1.05 : 1.6))
    + 256 * 1024 * 1024;
  if (free != null && free < needed) {
    markStatus(fileId, "failed", {
      optimized_error: "Not enough free disk space to prepare this file",
      optimized_progress: null,
      optimized_at: new Date().toISOString(),
    });
    log.warn("optimizer", "skipping preparation, low disk space", {
      fileId, free, needed,
    });
    return;
  }

  const previousPath = row.optimized_path == null ? null : String(row.optimized_path);
  log.info("optimizer", "preparing file", {
    fileId, mode: decision.mode, videoCopy: decision.videoCopy, audioCopy: decision.audioCopy,
  });
  markStatus(fileId, "running", {
    optimized_mode: decision.mode,
    optimized_progress: 0,
    optimized_error: null,
  });

  let lastDbWrite = 0;
  const startedAt = Date.now();
  try {
    const size = await runOptimize(
      {
        path: sourcePath,
        output,
        mode: decision.mode,
        videoCopy: decision.videoCopy,
        audioCopy: decision.audioCopy,
        videoBitrate: decision.videoBitrate,
        audioBitrate: decision.audioBitrate,
        duration: row.duration == null ? null : Number(row.duration),
      },
      (progress) => {
        if (current?.fileId === fileId) current.progress = progress;
        const now = Date.now();
        if (now - lastDbWrite < 900 && progress < 1) return;
        lastDbWrite = now;
        run("UPDATE media_files SET optimized_progress = ? WHERE id = ?", progress, fileId);
      },
    );

    const info = await stat(output);
    if (!info.isFile() || info.size === 0) throw new Error("prepared file is empty");

    if (previousPath && previousPath !== output) {
      await unlink(previousPath).catch(() => {});
    }

    markStatus(fileId, "done", {
      optimized_path: output,
      optimized_mode: decision.mode,
      optimized_size: info.size,
      optimized_mtime: Number(row.mtime),
      optimized_progress: 1,
      optimized_at: new Date().toISOString(),
      optimized_error: null,
    });
    log.info("optimizer", "file prepared", {
      fileId,
      mode: decision.mode,
      seconds: Math.round((Date.now() - startedAt) / 100) / 10,
      sizeMb: Math.round(info.size / 1024 / 1024),
    });

    // Subtitles are extracted from the original in the background; the player
    // already has a working file at this point.
    if (row.subtitles_json && String(row.subtitles_json) !== "[]") {
      const fresh = q<Row, [number]>("SELECT * FROM media_files WHERE id = ?").get(fileId);
      if (fresh) {
        void cacheEmbeddedSubtitles(fresh).catch((err) =>
          log.warn("optimizer", "subtitle caching failed", {
            fileId, message: err instanceof Error ? err.message : String(err),
          }));
      }
    }

    void pruneOptimizerCache();
  } catch (err) {
    await unlink(output).catch(() => {});
    await unlink(`${output}.part`).catch(() => {});
    throw err;
  }
}

/** Remove the oldest prepared copies when the configured cache cap is hit. */
export async function pruneOptimizerCache(): Promise<number> {
  const cfg = await getConfig();
  const cap = cfg.optimizeMaxCacheGb * 1024 * 1024 * 1024;
  if (!cap) return 0;

  const rows = q<Row>(
    `SELECT id, optimized_path, optimized_size FROM media_files
     WHERE optimized_status = 'done' AND optimized_path IS NOT NULL
     ORDER BY optimized_at ASC`,
  ).all();
  let total = rows.reduce((sum, row) => sum + Number(row.optimized_size ?? 0), 0);
  let removed = 0;
  for (const row of rows) {
    if (total <= cap) break;
    if (current?.fileId === Number(row.id)) continue;
    await unlink(String(row.optimized_path)).catch(() => {});
    total -= Number(row.optimized_size ?? 0);
    removed++;
    run(
      `UPDATE media_files SET optimized_status = 'skipped', optimized_path = NULL,
         optimized_size = NULL, optimized_progress = NULL,
         optimized_error = 'Removed to keep the playback cache under its size limit'
       WHERE id = ?`,
      Number(row.id),
    );
  }
  if (removed) log.info("optimizer", "pruned prepared copies", { removed });
  return removed;
}

/**
 * Queue every probed file that is not prepared yet. Called after a scan and at
 * boot; safe to call repeatedly.
 */
export async function enqueueMissingOptimizations(
  options: { includeFailed?: boolean } = {},
): Promise<number> {
  const cfg = await getConfig();
  if (!cfg.autoOptimize && !options.includeFailed) return 0;

  const rows = q<Row>(
    `SELECT id FROM media_files
     WHERE unavailable = 0
       AND analysis_status = 'probed'
       AND (
         optimized_status = 'none'
         OR (optimized_status = 'skipped' AND (optimized_mtime IS NULL OR optimized_mtime != mtime))
         OR (optimized_status = 'done' AND (optimized_mtime IS NULL OR optimized_mtime != mtime))
         ${options.includeFailed
           ? "OR optimized_status = 'failed' OR (optimized_status = 'skipped' AND optimized_error LIKE 'Removed to keep%')"
           : "OR (optimized_status = 'failed' AND (optimized_at IS NULL OR optimized_at < datetime('now','-6 hours')))"}
       )
     ORDER BY id`,
  ).all();

  for (const row of rows) enqueueOptimization(Number(row.id));
  return rows.length;
}

/** Reset interrupted jobs and start working through the queue. */
export async function startOptimizer(): Promise<void> {
  try {
    await mkdir(resolveOptimizedDir(), { recursive: true });
  } catch { /* the directory is recreated on demand */ }
  run("UPDATE media_files SET optimized_status = 'none', optimized_progress = NULL WHERE optimized_status IN ('running', 'queued')");
  const cfg = await getConfig();
  if (!cfg.autoOptimize) return;
  await enqueueMissingOptimizations();
}

export async function stopOptimizer(): Promise<void> {
  stopping = true;
  paused = true;
  queue.length = 0;
  queuedIds.clear();
  await shutdownOptimizeWorker();
}

export interface OptimizerStatus {
  enabled: boolean;
  running: boolean;
  paused: boolean;
  queued: number;
  current: { fileId: number; progress: number } | null;
  counts: Record<string, number>;
  cacheBytes: number;
}

export async function optimizerStatus(): Promise<OptimizerStatus> {
  const cfg = await getConfig();
  const counts: Record<string, number> = {
    none: 0, queued: 0, running: 0, done: 0, failed: 0, skipped: 0,
  };
  for (const row of q<Row>(
    "SELECT optimized_status AS status, COUNT(*) AS n FROM media_files GROUP BY optimized_status",
  ).all()) {
    counts[String(row.status ?? "none")] = Number(row.n);
  }
  const cache = q<{ bytes: number | null }>(
    "SELECT SUM(optimized_size) AS bytes FROM media_files WHERE optimized_status = 'done'",
  ).get();
  return {
    enabled: cfg.autoOptimize,
    running,
    paused,
    queued: queue.length,
    current: current ? { ...current } : null,
    counts,
    cacheBytes: Number(cache?.bytes ?? 0),
  };
}

/** Drop every prepared copy (used by an explicit admin reset). */
export async function clearOptimizerCache(): Promise<number> {
  let removed = 0;
  const entries = await readdir(resolveOptimizedDir()).catch(() => [] as string[]);
  for (const name of entries) {
    if (!name.endsWith(".mp4") && !name.endsWith(".part")) continue;
    await unlink(join(resolveOptimizedDir(), name)).catch(() => {});
    removed++;
  }
  run(
    `UPDATE media_files SET optimized_status = 'none', optimized_path = NULL,
       optimized_size = NULL, optimized_progress = NULL, optimized_error = NULL,
       optimized_mtime = NULL`,
  );
  return removed;
}
