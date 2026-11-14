/// Prepared-playback queue.
///
/// The scanner records probe facts; this module decides whether a file needs
/// work and prepares it *before* anyone presses play. Three operations, in
/// increasing cost:
///
/// - `remux`     copy every packet into a fast-start MP4 (lossless, I/O-bound:
///               roughly a second per GB on an SSD). H.264 + AAC in MKV is a
///               container problem only, so it must never be re-encoded.
/// - `transcode` with `videoCopy: true` — re-encode audio only (say H.264 with
///               Dolby Digital), which still runs much faster than realtime.
/// - `transcode` re-encode the incompatible video track, keeping the source
///               resolution and bitrate.
///
/// Playback requests are *priority* jobs: they jump the queue and preempt a
/// long-running encode, so opening a freshly added title never waits behind
/// the rest of the library.
///
/// Finished copies default to the app-data `optimized/` directory. The owner
/// can instead store them beside each original in `.plexy/optimized`, and can
/// opt into replacing the source after a successful preparation. Replacement
/// removes the original with the owner's policy: the system Trash by default,
/// permanent deletion only when explicitly selected.
import { constants } from "node:fs";
import { access, copyFile, lstat, mkdir, open, readdir, rename, stat, statfs, unlink } from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";
import { q, run, type Row } from "./db";
import { log } from "./logger";
import { getConfig } from "./config";
import { resolveOptimizedDir } from "./paths";
import {
  canonicalCodec, classifyPlayability, preferredAudioBitrate, preferredVideoBitrate,
  rowPlayabilityFacts,
} from "./playback";
import { cancelOptimize, OptimizerCancelledError, runOptimize, shutdownOptimizeWorker } from "./optimize-host";
import { cacheEmbeddedSubtitles } from "./subtitles";
import {
  preparedDirBeside,
  removeOriginal,
  removePreparedFile,
  replacementTargetFor,
} from "./trash";

export interface OptimizeFacts {
  container: string | null;
  videoCodec: string | null;
  /** FFprobe profile, e.g. "High" or "High 10"; controls copy-ability. */
  videoProfile?: string | null;
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

/** Video codecs an MP4 can hold *and* a browser can decode without re-encoding. */
const MP4_VIDEO_COPY = new Set(["h264"]);
/**
 * H.264 profiles no browser decodes (10-bit, 4:2:2, 4:4:4). Copying these into
 * MP4 would produce a file Plexy claims is direct playable and then fails.
 */
const UNSUPPORTED_H264_PROFILE = /(high 10|high 4:2:2|high 4:4:4)/i;
/** Audio codecs MP4 can hold that every browser decodes. */
const MP4_AUDIO_COPY = new Set(["aac", "mp3"]);

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
  // Copy whatever MP4 can carry as-is. The container itself is never a reason
  // to re-encode: an MKV holding H.264 + AAC is repacked packet-for-packet,
  // which takes seconds instead of an hour-long encode.
  const videoCopy = video !== null
    && MP4_VIDEO_COPY.has(video)
    && !(video === "h264" && UNSUPPORTED_H264_PROFILE.test(facts.videoProfile ?? ""));
  const hasAudio = audioTracks.length > 0;
  const audioCopy = hasAudio && audio !== null && MP4_AUDIO_COPY.has(audio);
  const sourceLabel = (facts.container ?? "this file").toString().toUpperCase();

  if (videoCopy && (audioCopy || !hasAudio)) {
    return {
      action: "optimize",
      mode: "remux",
      videoCopy: true,
      audioCopy: true,
      reason: `Repacking ${sourceLabel} into MP4 — no re-encoding, this finishes in seconds`,
    };
  }

  if (videoCopy) {
    return {
      action: "optimize",
      mode: "transcode",
      videoCopy: true,
      audioCopy: false,
      audioBitrate: preferredAudioBitrate(audioTracks[0]?.channels ?? null),
      reason: "Keeping the original video and converting just the audio track",
    };
  }

  const channels = audioTracks[0]?.channels ?? null;
  return {
    action: "optimize",
    mode: "transcode",
    videoCopy: false,
    audioCopy,
    videoBitrate: preferredVideoBitrate(facts.height, facts.bitrate),
    ...(audioCopy ? {} : { audioBitrate: preferredAudioBitrate(channels) }),
    reason: video === "hevc"
      ? "Converting HEVC/H.265 video into H.264, because browsers cannot play HEVC in MP4"
      : verdict.reason,
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
export function optimizedPathFor(row: Row): Promise<string> {
  return preparedOutputPath(row);
}

async function preparedOutputPath(row: Row, suffix = ""): Promise<string> {
  const cfg = await getConfig();
  const name = `${Number(row.id)}-${Number(row.mtime)}${suffix}.mp4`;
  return cfg.optimizeStorage === "media" && row.path
    ? join(preparedDirBeside(String(row.path)), name)
    : join(resolveOptimizedDir(), name);
}

/**
 * Create the chosen output directory. A read-only or missing media folder
 * falls back to the app-data cache instead of failing the whole preparation.
 */
async function ensurePreparedOutput(output: string): Promise<string> {
  try {
    const dir = dirname(output);
    await mkdir(dir, { recursive: true });
    await access(dir, constants.W_OK);
    return output;
  } catch (err) {
    const fallback = join(resolveOptimizedDir(), basename(output));
    log.warn("optimizer", "could not write beside the original; using the Plexy cache", {
      message: err instanceof Error ? err.message : String(err),
    });
    await mkdir(resolveOptimizedDir(), { recursive: true });
    return fallback;
  }
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
  /** FFmpeg's clock ratio (e.g. 1.4 means 1.4 s of media per second). */
  speed: number | null;
  /** Seconds left, derived from progress and speed. Null while queued/unknown. */
  etaSeconds: number | null;
  /** 1-based position while queued; null otherwise. */
  queuePosition: number | null;
}

export function optimizationView(row: Row): OptimizationView {
  const fileId = Number(row.id);
  const status = String(row.optimized_status ?? "none");
  return {
    status,
    mode: row.optimized_mode == null ? null : String(row.optimized_mode),
    progress: row.optimized_progress == null ? null : Number(row.optimized_progress),
    size: row.optimized_size == null ? null : Number(row.optimized_size),
    error: row.optimized_error == null ? null : String(row.optimized_error),
    speed: row.optimized_speed == null ? null : Number(row.optimized_speed),
    etaSeconds: row.optimized_eta_seconds == null ? null : Number(row.optimized_eta_seconds),
    queuePosition: status === "queued" ? queuePosition(fileId) : null,
  };
}

// --- audio-track variants ----------------------------------------------------

/**
 * A second prepared copy that keeps the same video packets but a different
 * audio track. Browsers cannot switch audio inside one MP4, so the player swaps
 * sources for the selected language; these copies are built on demand and are
 * usually a sub-second remux.
 */
export interface AudioVariantView extends OptimizationView {
  audioIndex: number;
}

const variantQueue: Array<{ fileId: number; audioIndex: number }> = [];
const variantQueued = new Set<string>();
let variantRunning = false;
let variantStopping = false;
let variantCurrentKey: string | null = null;
let variantCancelRequested = false;

function variantKey(fileId: number, audioIndex: number): string {
  return `${fileId}:${audioIndex}`;
}

function variantPathFor(row: Row, audioIndex: number): Promise<string> {
  return preparedOutputPath(row, `-a${audioIndex}`);
}

function variantRow(fileId: number, audioIndex: number): Row | undefined {
  return q<Row, [number, number]>(
    "SELECT * FROM media_audio_variants WHERE file_id = ? AND audio_index = ?",
  ).get(fileId, audioIndex);
}

/** The prepared copy for one audio track, if it still matches the source. */
export async function usableAudioVariant(row: Row, audioIndex: number): Promise<string | null> {
  if (audioIndex <= 0) return null;
  const record = variantRow(Number(row.id), audioIndex);
  if (!record || record.status !== "done" || !record.path) return null;
  if (Number(record.source_mtime) !== Number(row.mtime)) return null;
  try {
    const info = await stat(String(record.path));
    if (!info.isFile() || info.size === 0) return null;
  } catch {
    return null;
  }
  return String(record.path);
}

function variantDecision(row: Row, audioIndex: number): {
  mode: "remux" | "transcode";
  videoCopy: boolean;
  audioCopy: boolean;
  audioBitrate?: number;
  videoBitrate?: number;
} {
  const video = canonicalCodec(row.video_codec as string | null);
  const profile = row.video_profile == null ? "" : String(row.video_profile);
  const videoCopy = video === "h264" && !UNSUPPORTED_H264_PROFILE.test(profile);
  const track = safeAudio(row.audio_json as string | null)[audioIndex];
  const audioCodec = canonicalCodec(track?.codec ?? null);
  const audioCopy = audioCodec === "aac" || audioCodec === "mp3";
  return {
    mode: videoCopy && audioCopy ? "remux" : "transcode",
    videoCopy,
    audioCopy,
    ...(audioCopy ? {} : { audioBitrate: preferredAudioBitrate(track?.channels ?? null) }),
    ...(videoCopy
      ? {}
      : {
          videoBitrate: preferredVideoBitrate(
            row.height == null ? null : Number(row.height),
            row.bitrate == null ? null : Number(row.bitrate),
          ),
        }),
  };
}

export function audioVariantView(row: Row, audioIndex: number): AudioVariantView {
  const record = variantRow(Number(row.id), audioIndex);
  const decision = variantDecision(row, audioIndex);
  return {
    audioIndex,
    status: record ? String(record.status ?? "none") : "none",
    mode: decision.mode,
    progress: record?.progress == null ? null : Number(record.progress),
    size: record?.size == null ? null : Number(record.size),
    error: record?.error == null ? null : String(record.error),
    speed: null,
    etaSeconds: record?.eta_seconds == null ? null : Number(record.eta_seconds),
    queuePosition: null,
  };
}

function upsertVariant(
  row: Row,
  audioIndex: number,
  status: string,
  patch: Record<string, unknown> = {},
): void {
  const fileId = Number(row.id);
  const mtime = Number(row.mtime);
  if (!variantRow(fileId, audioIndex)) {
    run(
      `INSERT INTO media_audio_variants (file_id, audio_index, source_mtime, status)
       VALUES (?, ?, ?, ?)`,
      fileId, audioIndex, mtime, status,
    );
  }
  const values: Record<string, unknown> = { source_mtime: mtime, status, ...patch };
  const keys = Object.keys(values);
  run(
    `UPDATE media_audio_variants SET ${keys.map((key) => `${key} = ?`).join(", ")},
       updated_at = datetime('now')
     WHERE file_id = ? AND audio_index = ?`,
    ...keys.map((key) => values[key]), fileId, audioIndex,
  );
}

/** Queue a copy for one audio track because a viewer selected it. */
export function enqueueAudioVariant(fileId: number, audioIndex: number): void {
  const row = q<Row, [number]>("SELECT * FROM media_files WHERE id = ?").get(fileId);
  if (!row || Number(row.unavailable ?? 0) !== 0) return;
  if (row.analysis_status !== "probed") return;
  const tracks = safeAudio(row.audio_json as string | null);
  if (!Number.isInteger(audioIndex) || audioIndex < 1 || audioIndex >= tracks.length) return;

  const key = variantKey(fileId, audioIndex);
  if (variantQueued.has(key)) return;
  if (variantRunning && variantCurrentKey === key) return;

  // Do not spin on a track that just failed: the player polls this manifest
  // once a second, and every poll would otherwise restart a doomed job.
  const existing = variantRow(fileId, audioIndex);
  if (existing?.status === "failed") {
    const recent = q<Row, [number, number]>(
      `SELECT 1 AS recent FROM media_audio_variants
       WHERE file_id = ? AND audio_index = ? AND updated_at > datetime('now', '-30 seconds')`,
    ).get(fileId, audioIndex);
    if (recent) return;
  }

  variantQueued.add(key);
  variantQueue.unshift({ fileId, audioIndex });
  upsertVariant(row, audioIndex, "queued", {
    progress: 0,
    eta_seconds: null,
    error: null,
    path: null,
    size: null,
  });

  // The viewer is waiting: stop whatever preparation is running. The variant
  // job is queued first, so the worker picks it up immediately after the kill.
  if (variantRunning && variantCurrentKey !== key && !variantCancelRequested) {
    variantCancelRequested = true;
    void cancelOptimize().catch(() => {});
  } else if (!variantRunning && current) {
    requestPreemption(fileId);
  }
  void pumpVariants();
}

async function pumpVariants(): Promise<void> {
  if (variantRunning || variantStopping || paused) return;
  const job = variantQueue.shift();
  if (!job) return;
  const key = variantKey(job.fileId, job.audioIndex);
  variantQueued.delete(key);
  variantRunning = true;
  variantCurrentKey = key;
  try {
    await prepareAudioVariant(job.fileId, job.audioIndex);
  } catch (err) {
    const cancelled = err instanceof OptimizerCancelledError || variantCancelRequested || cancelRequested;
    if (cancelled && !variantStopping) {
      variantQueued.add(key);
      // Resume behind the newly requested track rather than ahead of it.
      variantQueue.push(job);
      const row = q<Row, [number]>("SELECT * FROM media_files WHERE id = ?").get(job.fileId);
      if (row) upsertVariant(row, job.audioIndex, "queued", { progress: 0, eta_seconds: null });
    } else if (!variantStopping) {
      const message = err instanceof Error ? err.message : String(err);
      log.error("optimizer", "audio track preparation failed", {
        fileId: job.fileId, audioIndex: job.audioIndex, message,
      });
      const row = q<Row, [number]>("SELECT * FROM media_files WHERE id = ?").get(job.fileId);
      if (row) {
        upsertVariant(row, job.audioIndex, "failed", {
          error: message, progress: null, eta_seconds: null,
        });
      }
    }
  } finally {
    variantRunning = false;
    variantCurrentKey = null;
    variantCancelRequested = false;
    if (!variantStopping) void pumpVariants();
  }
}

async function prepareAudioVariant(fileId: number, audioIndex: number): Promise<void> {
  const row = q<Row, [number]>("SELECT * FROM media_files WHERE id = ?").get(fileId);
  if (!row) return;
  const sourcePath = String(row.path);
  const source = await stat(sourcePath).catch(() => null);
  if (!source?.isFile()) throw new Error("Source file is missing");
  const track = safeAudio(row.audio_json as string | null)[audioIndex];
  if (!track) throw new Error("That audio track no longer exists");

  const decision = variantDecision(row, audioIndex);
  const output = await ensurePreparedOutput(await variantPathFor(row, audioIndex));
  const previousPath = variantRow(fileId, audioIndex)?.path;
  upsertVariant(row, audioIndex, "running", {
    progress: 0,
    eta_seconds: null,
    error: null,
    path: null,
    size: null,
  });

  let lastDbWrite = 0;
  try {
    if (cancelRequested || variantCancelRequested || pauseReasons.has("manual")) {
      throw new OptimizerCancelledError();
    }
    await runOptimize(
      {
        path: sourcePath,
        output,
        mode: decision.mode,
        videoCopy: decision.videoCopy,
        audioCopy: decision.audioCopy,
        audioIndex,
        videoBitrate: decision.videoBitrate,
        audioBitrate: decision.audioBitrate,
        duration: row.duration == null ? null : Number(row.duration),
        sourceSize: Number(row.size),
      },
      (update) => {
        const now = Date.now();
        if (now - lastDbWrite < 900 && update.progress < 1) return;
        lastDbWrite = now;
        run(
          `UPDATE media_audio_variants SET progress = ?, eta_seconds = ?,
             updated_at = datetime('now') WHERE file_id = ? AND audio_index = ?`,
          update.progress,
          update.etaSeconds == null ? null : Math.round(Number(update.etaSeconds)),
          fileId,
          audioIndex,
        );
      },
    );

    const info = await stat(output);
    if (!info.isFile() || info.size === 0) throw new Error("prepared audio track is empty");
    if (previousPath && String(previousPath) !== output) {
      await removePreparedFile(String(previousPath));
    }
    upsertVariant(row, audioIndex, "done", {
      progress: 1,
      eta_seconds: null,
      path: output,
      size: info.size,
      error: null,
    });
    log.debug("optimizer", "audio track prepared", {
      fileId, audioIndex, mode: decision.mode,
    });
  } catch (err) {
    await unlink(output).catch(() => {});
    await unlink(`${output}.part`).catch(() => {});
    throw err;
  }
}

// --- queue -------------------------------------------------------------------

const queue: number[] = [];
const queuedIds = new Set<number>();
/** Files a viewer is actively waiting on; they stay ahead of requeued work. */
const urgentIds = new Set<number>();
let running = false;
let paused = false;
const pauseReasons = new Set<string>();
let stopping = false;
let cancelRequested = false;
let current: {
  fileId: number;
  progress: number;
  speed: number | null;
  etaSeconds: number | null;
} | null = null;

function queuePosition(fileId: number): number | null {
  if (current?.fileId === fileId) return 0;
  const index = queue.indexOf(fileId);
  return index < 0 ? null : index + 1;
}

/** Pause queue advancement while higher-priority work uses the machine. */
export function pauseOptimizer(reason = "manual"): void {
  pauseReasons.add(reason);
  paused = true;
}

export function resumeOptimizer(reason = "manual"): void {
  pauseReasons.delete(reason);
  paused = pauseReasons.size > 0;
  if (!paused) {
    void pump();
    void pumpVariants();
  }
}

/** Stop active encodes and hold all queued work until the owner resumes. */
export async function cancelOptimization(): Promise<void> {
  pauseOptimizer("manual");
  if (running) cancelRequested = true;
  if (variantRunning) variantCancelRequested = true;
  await cancelOptimize();
}

function markStatus(fileId: number, status: string, patch: Record<string, unknown> = {}) {
  const keys = Object.keys(patch);
  const assignments = ["optimized_status = ?", ...keys.map((key) => `${key} = ?`)];
  run(
    `UPDATE media_files SET ${assignments.join(", ")} WHERE id = ?`,
    status, ...keys.map((key) => patch[key]), fileId,
  );
}

/**
 * Add one file to the queue (no-op when it is already queued/running).
 *
 * `urgent` is set when a viewer is waiting on this exact file: it jumps to the
 * front and preempts whatever encode is running. Preempted work is put back in
 * the queue and simply resumes later, so nothing is lost.
 */
export function enqueueOptimization(fileId: number, options: { urgent?: boolean } = {}): void {
  if (queuedIds.has(fileId)) {
    if (options.urgent) {
      urgentIds.add(fileId);
      if (queue[0] !== fileId) {
        queue.splice(queue.indexOf(fileId), 1);
        queue.unshift(fileId);
      }
      requestPreemption(fileId);
    }
    return;
  }
  if (current?.fileId === fileId) return;
  const row = q<Row, [number]>("SELECT * FROM media_files WHERE id = ?").get(fileId);
  if (!row || Number(row.unavailable ?? 0) !== 0) return;
  if (row.analysis_status !== "probed") return;
  // Direct files are streamed as-is; never copy or re-encode them.
  if (!needsPreparation(row)) return;

  queuedIds.add(fileId);
  if (options.urgent) {
    urgentIds.add(fileId);
    queue.unshift(fileId);
  } else {
    queue.push(fileId);
  }
  markStatus(fileId, "queued", {
    optimized_progress: 0,
    optimized_error: null,
    optimized_speed: null,
    optimized_eta_seconds: null,
  });
  if (options.urgent) requestPreemption(fileId);
  void pump();
}

/**
 * Someone is waiting on `fileId`: stop whatever encode is running so the queue
 * can start the requested file next. The preempted job returns to the front of
 * the queue and simply resumes later, so no work is lost.
 */
function requestPreemption(fileId: number): void {
  if (!current || current.fileId === fileId || cancelRequested) return;
  cancelRequested = true;
  log.info("optimizer", "preempting preparation for a playback request", {
    cancelled: current.fileId, requested: fileId,
  });
  void cancelOptimize().catch((err) =>
    log.warn("optimizer", "could not preempt the running job", {
      message: err instanceof Error ? err.message : String(err),
    }));
}

/**
 * Place preempted work behind every file a viewer is currently waiting on.
 * Without this, a cancelled encode would jump the queue it was preempted for
 * and start again immediately.
 */
export function requeueAfterUrgent(
  queue: number[],
  urgentIds: ReadonlySet<number>,
  fileId: number,
): void {
  let index = 0;
  while (index < queue.length && urgentIds.has(queue[index]!)) index++;
  queue.splice(index, 0, fileId);
}

async function pump(): Promise<void> {
  if (running || paused) return;
  const fileId = queue.shift();
  if (fileId == null) return;
  queuedIds.delete(fileId);
  urgentIds.delete(fileId);
  running = true;
  current = { fileId, progress: 0, speed: null, etaSeconds: null };
  try {
    await optimizeOne(fileId);
  } catch (err) {
    if (err instanceof OptimizerCancelledError || cancelRequested) {
      // Preempted by a playback request: return to the front of the queue so
      // it restarts as soon as the urgent file is ready. Not a failure.
      log.debug("optimizer", "preparation preempted", { fileId });
      if (!stopping) {
        if (!queuedIds.has(fileId)) {
          queuedIds.add(fileId);
          // Requeue behind any viewer-requested work, never ahead of it.
          requeueAfterUrgent(queue, urgentIds, fileId);
        }
        markStatus(fileId, "queued", {
          optimized_progress: 0,
          optimized_speed: null,
          optimized_eta_seconds: null,
        });
      }
    } else {
      const message = err instanceof Error ? err.message : String(err);
      log.error("optimizer", "job failed", { fileId, message });
      markStatus(fileId, stopping ? "queued" : "failed", {
        optimized_error: stopping ? null : message,
        optimized_progress: stopping ? 0 : null,
        optimized_speed: null,
        optimized_eta_seconds: null,
        optimized_at: new Date().toISOString(),
      });
    }
  } finally {
    cancelRequested = false;
    current = null;
    // Cache pruning scans all prepared rows. Do it once after the queue drains,
    // rather than once for each file in a long preparation batch.
    if (queue.length === 0 && !paused && !stopping) {
      await pruneOptimizerCache().catch((err) =>
        log.warn("optimizer", "cache pruning failed", {
          message: err instanceof Error ? err.message : String(err),
        }));
    }
    running = false;
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

type OptimizeAction = Extract<OptimizeDecision, { action: "optimize" }>;

interface ReplacementResult {
  path: string;
  size: number;
  mtime: number;
  trashPath: string | null;
  method: "system" | "local-trash" | "permanent";
}

async function pathIsFile(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isFile();
  } catch {
    return false;
  }
}

/**
 * Publish the prepared MP4 at the source's path and remove the original using
 * the owner's deletion policy. The new file is staged and verified first; a
 * failure before the swap leaves the original untouched.
 */
export async function replaceOriginalWithPrepared(
  row: Row,
  output: string,
  policy: "system" | "permanent",
): Promise<ReplacementResult | null> {
  const sourcePath = String(row.path);
  const before = await lstat(sourcePath).catch(() => null);
  if (!before) throw new Error("Source file is missing");
  if (before.isSymbolicLink()) {
    log.warn("optimizer", "keeping the original because it is a symbolic link", {
      fileId: Number(row.id), path: sourcePath,
    });
    return null;
  }
  if (before.size !== Number(row.size) || Math.floor(before.mtimeMs) !== Number(row.mtime)) {
    log.warn("optimizer", "keeping the original because it changed during preparation", {
      fileId: Number(row.id), path: sourcePath,
    });
    return null;
  }

  const target = await replacementTargetFor(sourcePath);
  const part = `${target}.part`;
  await unlink(part).catch(() => {});
  let stagedByRename = false;
  try {
    const prepared = await stat(output);
    try {
      await rename(output, part);
      stagedByRename = true;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EXDEV") throw error;
      const free = await freeBytes(dirname(target));
      if (free != null && free < prepared.size + 64 * 1024 * 1024) {
        throw new Error("Not enough free disk space beside the original for the replacement");
      }
      await copyFile(output, part);
    }
    const staged = await stat(part);
    if (!staged.isFile() || staged.size === 0) throw new Error("staged replacement is empty");

    let removed: { trashPath: string | null; method: ReplacementResult["method"] };
    if (resolve(target) === resolve(sourcePath)) {
      // In-place MP4 replacement: park the original beside the new file while
      // the final rename happens, then send it to the chosen trash policy.
      const backup = `${sourcePath}.plexy-original`;
      await unlink(backup).catch(() => {});
      await rename(sourcePath, backup);
      try {
        await rename(part, target);
      } catch (error) {
        await rename(backup, sourcePath).catch(() => {});
        throw error;
      }
      try {
        removed = await removeOriginal(backup, policy);
      } catch (error) {
        log.warn("optimizer", "replacement succeeded but the original could not be trashed", {
          fileId: Number(row.id), path: backup,
          message: error instanceof Error ? error.message : String(error),
        });
        removed = { trashPath: backup, method: "local-trash" };
      }
    } else {
      await rename(part, target);
      try {
        removed = await removeOriginal(sourcePath, policy);
      } catch (error) {
        // Put the folder back the way it was; the prepared cache copy still
        // exists when it was copied rather than renamed.
        await unlink(target).catch(() => {});
        throw error;
      }
    }

    if (!stagedByRename && resolve(output) !== resolve(target)) {
      await removePreparedFile(output);
    }
    const final = await stat(target);
    return {
      path: target,
      size: final.size,
      mtime: Math.floor(final.mtimeMs),
      ...removed,
    };
  } catch (error) {
    await unlink(part).catch(() => {});
    if (resolve(target) !== resolve(sourcePath)
      && await pathIsFile(target)
      && await pathIsFile(sourcePath)) {
      await unlink(target).catch(() => {});
    }
    throw error;
  }
}

/** Point the catalog at the replacement file and retire its old cache state. */
async function markReplaced(
  fileId: number,
  row: Row,
  replacement: ReplacementResult,
  decision: OptimizeAction,
  subtitlesJson: string,
): Promise<void> {
  const duration = row.duration == null ? null : Number(row.duration);
  const bitrate = duration && duration > 0
    ? Math.round((replacement.size * 8) / duration)
    : row.bitrate;
  const tracks = safeAudio(row.audio_json as string | null) as Array<Record<string, unknown>>;
  const first = tracks[0];
  const audioJson = first
    ? JSON.stringify([{
        ...first,
        codec: decision.audioCopy ? String(first.codec ?? "aac") : "aac",
      }])
    : "[]";

  const variants = q<Row, [number]>(
    "SELECT path FROM media_audio_variants WHERE file_id = ?",
  ).all(fileId);
  for (const variant of variants) {
    if (variant.path) await removePreparedFile(String(variant.path));
  }
  run("DELETE FROM media_audio_variants WHERE file_id = ?", fileId);

  run(
    `UPDATE media_files SET
       path = $path, size = $size, mtime = $mtime,
       container = 'mp4', video_codec = 'h264', video_profile = NULL,
       video_bit_depth = 8, hdr = $hdr, chapters_json = '[]',
       bitrate = $bitrate, audio_json = $audio, subtitles_json = $subtitles,
       optimized_status = 'skipped', optimized_path = NULL, optimized_size = 0,
       optimized_mtime = $mtime, optimized_progress = 1, optimized_mode = $mode,
       optimized_error = $error, optimized_speed = NULL,
       optimized_eta_seconds = NULL, optimized_started_at = NULL,
       optimized_at = $at
     WHERE id = $id`,
    {
      $path: replacement.path,
      $size: replacement.size,
      $mtime: replacement.mtime,
      $hdr: decision.videoCopy ? row.hdr : null,
      $bitrate: bitrate,
      $audio: audioJson,
      $subtitles: subtitlesJson,
      $mode: decision.mode,
      $error: replacement.method === "permanent"
        ? "Original replaced with the prepared MP4"
        : "Original replaced with the prepared MP4; the previous file is in the recycle bin",
      $at: new Date().toISOString(),
      $id: fileId,
    },
  );
  run(
    "UPDATE subtitle_cache SET source_mtime = ? WHERE file_id = ?",
    replacement.mtime,
    fileId,
  );
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
    log.debug("optimizer", "file changed since scan; waiting for the next scan", { fileId });
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
      videoProfile: row.video_profile == null ? null : String(row.video_profile),
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

  const output = await ensurePreparedOutput(await optimizedPathFor(row));

  const free = await freeBytes(dirname(output));
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
    optimized_speed: null,
    optimized_eta_seconds: null,
    optimized_started_at: new Date().toISOString(),
  });

  let lastDbWrite = 0;
  const startedAt = Date.now();
  try {
    if (cancelRequested || variantCancelRequested || pauseReasons.has("manual")) {
      throw new OptimizerCancelledError();
    }
    await runOptimize(
      {
        path: sourcePath,
        output,
        mode: decision.mode,
        videoCopy: decision.videoCopy,
        audioCopy: decision.audioCopy,
        videoBitrate: decision.videoBitrate,
        audioBitrate: decision.audioBitrate,
        duration: row.duration == null ? null : Number(row.duration),
        sourceSize: Number(row.size),
      },
      (update) => {
        const progress = Number(update.progress ?? 0);
        if (current?.fileId === fileId) {
          current.progress = progress;
          current.speed = update.speed ?? null;
          current.etaSeconds = update.etaSeconds ?? null;
        }
        const now = Date.now();
        if (now - lastDbWrite < 900 && progress < 1) return;
        lastDbWrite = now;
        run(
          `UPDATE media_files SET optimized_progress = ?, optimized_speed = ?,
             optimized_eta_seconds = ? WHERE id = ?`,
          progress,
          update.speed == null ? null : Number(update.speed),
          update.etaSeconds == null ? null : Math.round(Number(update.etaSeconds)),
          fileId,
        );
      },
    );

    const info = await stat(output);
    if (!info.isFile() || info.size === 0) throw new Error("prepared file is empty");

    if (previousPath && previousPath !== output) {
      await removePreparedFile(previousPath);
    }

    const cfg = await getConfig();
    if (cfg.replaceOriginal) {
      let subtitlesJson = String(row.subtitles_json ?? "[]");
      if (subtitlesJson !== "[]") {
        // The prepared MP4 drops embedded tracks. Cache the source subtitles
        // before the original moves so the player can keep offering them.
        const cached = await cacheEmbeddedSubtitles(row).catch(() => 0);
        if (!cached) subtitlesJson = "[]";
      }
      const replacement = await replaceOriginalWithPrepared(
        row,
        output,
        cfg.moveOriginalsToTrash ? "system" : "permanent",
      );
      if (replacement) {
        await markReplaced(fileId, row, replacement, decision, subtitlesJson);
        log.info("optimizer", "original replaced with prepared MP4", {
          fileId,
          path: replacement.path,
          removedBy: replacement.method,
          trash: replacement.trashPath,
        });
        return;
      }
    }

    markStatus(fileId, "done", {
      optimized_path: output,
      optimized_mode: decision.mode,
      optimized_size: info.size,
      optimized_mtime: Number(row.mtime),
      optimized_progress: 1,
      optimized_speed: null,
      optimized_eta_seconds: null,
      optimized_started_at: null,
      optimized_at: new Date().toISOString(),
      optimized_error: null,
    });
    log.debug("optimizer", "file prepared", {
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
    await removePreparedFile(String(row.optimized_path));
    total -= Number(row.optimized_size ?? 0);
    removed++;
    run(
      `UPDATE media_files SET optimized_status = 'skipped', optimized_path = NULL,
         optimized_size = NULL, optimized_progress = NULL,
         optimized_speed = NULL, optimized_eta_seconds = NULL,
         optimized_error = 'Removed to keep the playback cache under its size limit'
       WHERE id = ?`,
      Number(row.id),
    );
  }
  if (removed) log.info("optimizer", "pruned prepared copies", { removed });
  return removed;
}

/**
 * A file is worth preparing only when it cannot play as-is. Direct files are
 * never copied, remuxed, or re-encoded — the original bytes are the stream.
 */
export function needsPreparation(row: {
  container?: unknown;
  video_codec?: unknown;
  audio_json?: unknown;
  subtitles_json?: unknown;
}): boolean {
  const verdict = classifyPlayability(rowPlayabilityFacts(row), null);
  return verdict.path === "remux" || verdict.path === "transcode";
}

/**
 * Queue probed files that cannot play directly and are not prepared yet.
 * Called after a scan, at boot, and when a play identifies a fallback; safe to
 * call repeatedly.
 */
export async function enqueueMissingOptimizations(
  options: { includeFailed?: boolean } = {},
): Promise<number> {
  const rows = q<Row>(
    `SELECT id, container, video_codec, audio_json, subtitles_json FROM media_files
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

  const candidates = rows.filter((row) => needsPreparation(row));
  for (const row of candidates) enqueueOptimization(Number(row.id));
  return candidates.length;
}

/** Reset interrupted jobs and start working through the queue. */
export async function startOptimizer(): Promise<void> {
  // Scanning can enqueue work before this delayed startup hook runs. Only
  // reset jobs left by a previous process, preserving this process's queue.
  const activeIds = [...queuedIds, ...(current ? [current.fileId] : [])];
  run(`UPDATE media_files SET optimized_status = 'none', optimized_progress = NULL,
      optimized_speed = NULL, optimized_eta_seconds = NULL, optimized_started_at = NULL
    WHERE optimized_status IN ('running', 'queued')
    ${activeIds.length ? `AND id NOT IN (${activeIds.map(() => "?").join(",")})` : ""}`, ...activeIds);
  try {
    await mkdir(resolveOptimizedDir(), { recursive: true });
  } catch { /* the directory is recreated on demand */ }
  // A previous process may have been killed mid-preparation. Those `.part`
  // files can be gigabytes; no job is running in this process yet, so every
  // one of them is stale.
  const leftovers = await readdir(resolveOptimizedDir()).catch(() => [] as string[]);
  for (const name of leftovers) {
    if (!name.endsWith(".part")) continue;
    await unlink(join(resolveOptimizedDir(), name)).catch(() => {});
    log.debug("optimizer", "removed an interrupted preparation", { name });
  }
  run(`UPDATE media_audio_variants SET status = 'none', progress = NULL,
    eta_seconds = NULL, error = NULL WHERE status IN ('running', 'queued')`);
  await enqueueMissingOptimizations();
}

export async function stopOptimizer(): Promise<void> {
  stopping = true;
  variantStopping = true;
  paused = true;
  queue.length = 0;
  queuedIds.clear();
  urgentIds.clear();
  variantQueue.length = 0;
  variantQueued.clear();
  await shutdownOptimizeWorker();
}

export interface OptimizerStatus {
  enabled: boolean;
  running: boolean;
  paused: boolean;
  manuallyPaused: boolean;
  queued: number;
  current: {
    fileId: number;
    progress: number;
    speed: number | null;
    etaSeconds: number | null;
  } | null;
  counts: Record<string, number>;
  cacheBytes: number;
  cacheDir: string;
  storage: "data" | "media";
  files?: Array<{
    id: number;
    path: string;
    optimizedPath: string | null;
    size: number;
    optimizedSize: number;
    mtime: number | null;
    title?: string;
  }>;
}

export async function optimizerStatus(
  options: { includeFiles?: boolean } = {},
): Promise<OptimizerStatus> {
  const cfg = await getConfig();
  const counts: Record<string, number> = {
    none: 0, queued: 0, running: 0, done: 0, failed: 0, skipped: 0,
  };
  for (const row of q<Row>(
    "SELECT optimized_status AS status, COUNT(*) AS n FROM media_files GROUP BY optimized_status",
  ).all()) {
    counts[String(row.status ?? "none")] = Number(row.n);
  }
  // Replaced originals are retired as "skipped", but they are successful
  // preparations. Report them separately so the UI does not look stalled.
  const replaced = Number(q<{ n: number }>(
    `SELECT COUNT(*) AS n FROM media_files
     WHERE optimized_status = 'skipped'
       AND optimized_error LIKE 'Original replaced with the prepared MP4%'`,
  ).get()?.n ?? 0);
  counts.replaced = replaced;
  counts.skipped = Math.max(0, (counts.skipped ?? 0) - replaced);
  const cache = q<{ bytes: number | null }>(
    "SELECT SUM(optimized_size) AS bytes FROM media_files WHERE optimized_status = 'done'",
  ).get();
  const preparedRows = options.includeFiles === false ? [] : q<{
    id: number;
    path: string;
    size: number;
    optimized_path: string | null;
    optimized_size: number | null;
    optimized_mtime: number | null;
    title: string | null;
  }>(
    `SELECT f.id, f.path, f.size, f.optimized_path, f.optimized_size, f.optimized_mtime,
            COALESCE(i.name, f.path) AS title
     FROM media_files f
     LEFT JOIN items i ON i.id = f.item_id
     WHERE f.optimized_status = 'done'
     ORDER BY f.id ASC`,
  ).all();
  return {
    enabled: true,
    running: running || variantRunning,
    paused,
    manuallyPaused: pauseReasons.has("manual"),
    queued: queue.length + variantQueue.length,
    current: current ? { ...current } : null,
    counts,
    cacheBytes: Number(cache?.bytes ?? 0),
    cacheDir: resolveOptimizedDir(),
    storage: cfg.optimizeStorage,
    ...(options.includeFiles === false ? {} : { files: preparedRows.map((r) => ({
      id: Number(r.id),
      path: String(r.path),
      optimizedPath: r.optimized_path ? String(r.optimized_path) : null,
      size: Number(r.size),
      optimizedSize: Number(r.optimized_size ?? 0),
      mtime: r.optimized_mtime ? Number(r.optimized_mtime) : null,
      title: r.title ? String(r.title) : undefined,
    })) }),
  };
}

/** Drop every prepared copy (used by an explicit admin reset). */
export async function clearOptimizerCache(): Promise<number> {
  let removed = 0;
  // Media-folder copies are not in the app-data directory, so use the paths
  // recorded in the database as well as the default cache folder.
  for (const row of q<Row>(
    "SELECT optimized_path FROM media_files WHERE optimized_path IS NOT NULL",
  ).all()) {
    if (row.optimized_path && await removePreparedFile(String(row.optimized_path))) removed++;
  }
  for (const row of q<Row>(
    "SELECT path FROM media_audio_variants WHERE path IS NOT NULL",
  ).all()) {
    if (row.path && await removePreparedFile(String(row.path))) removed++;
  }
  const entries = await readdir(resolveOptimizedDir()).catch(() => [] as string[]);
  for (const name of entries) {
    if (!name.endsWith(".mp4") && !name.endsWith(".part")) continue;
    await unlink(join(resolveOptimizedDir(), name)).catch(() => {});
    removed++;
  }
  run(
    `UPDATE media_files SET optimized_status = 'none', optimized_path = NULL,
       optimized_size = NULL, optimized_progress = NULL, optimized_error = NULL,
       optimized_speed = NULL, optimized_eta_seconds = NULL, optimized_started_at = NULL,
       optimized_mtime = NULL`,
  );
  run("DELETE FROM media_audio_variants");
  return removed;
}
