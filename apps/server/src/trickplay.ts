/// Trickplay: the thumbnail strip shown while scrubbing the timeline.
///
/// One FFmpeg pass extracts a frame every 10 seconds (15 for very long titles)
/// at 160×90 into the app-data cache. The player loads a WebVTT `metadata`
/// track labelled "thumbnails"; Media Chrome turns each cue's
/// `image.jpg#xywh=0,0,160,90` text into the hover preview, so no custom player
/// image plumbing is needed.
///
/// FFmpeg is a child process, never a binding in the server: a bad file can
/// kill the extractor without touching playback. Generation is lazy (first time
/// a file is opened), serialized, and delayed briefly so it never competes with
/// the first seconds of playback.
import { existsSync } from "node:fs";
import { mkdir, readdir, rm, stat } from "node:fs/promises";
import { join } from "node:path";
import { spawn, type ChildProcess } from "node:child_process";
import { q, run, type Row } from "./db";
import { log } from "./logger";
import { resolveTrickplayDir } from "./paths";
import { resolveFfmpeg } from "./ffmpeg";
import { fmtVttTimestamp } from "./subtitles";
import { pauseOptimizer, resumeOptimizer } from "./optimize";

export const TRICKPLAY_WIDTH = 160;
export const TRICKPLAY_HEIGHT = 90;
export const SPRITE_COLS = 10;
export const SPRITE_ROWS = 10;
export const SPRITE_SIZE = SPRITE_COLS * SPRITE_ROWS; // 100 frames per sprite sheet
const DEFAULT_INTERVAL = 10;
const LONG_INTERVAL = 15;
const START_DELAY_MS = 4_000;
const RETRY_AFTER_MS = 10 * 60_000;

export interface TrickplayView {
  ready: boolean;
  status: string;
  trackUrl: string | null;
  sprites: string[];
  interval: number;
  width: number;
  height: number;
  frameCount: number | null;
  error: string | null;
}

interface TrickplayRow {
  file_id: number;
  source_mtime: number;
  status: string;
  interval: number;
  frame_count: number | null;
  width: number;
  height: number;
  duration: number | null;
  error: string | null;
  updated_at: string;
}

let active: { fileId: number; child: ChildProcess | null } | null = null;
let running = false;
let stopping = false;
const queue: number[] = [];
const queued = new Set<number>();
let startTimer: ReturnType<typeof setTimeout> | null = null;

/** Directory holding one file's frames for the current source mtime. */
export function trickplayDirFor(row: Row): string {
  return join(resolveTrickplayDir(), `${Number(row.id)}-${Number(row.mtime)}`);
}

function rowFor(fileId: number): TrickplayRow | null {
  return (q<TrickplayRow, [number]>("SELECT * FROM trickplay WHERE file_id = ?").get(fileId) ?? null);
}

/** A row is usable only when it matches the current source mtime. */
function currentRow(row: Row, entry: TrickplayRow | null): TrickplayRow | null {
  if (!entry) return null;
  if (Number(entry.source_mtime) !== Number(row.mtime)) return null;
  return entry;
}

function intervalFor(duration: number | null): number {
  return duration != null && duration > 2 * 60 * 60 ? LONG_INTERVAL : DEFAULT_INTERVAL;
}

/** Public manifest view; never exposes filesystem paths. */
export function trickplayView(row: Row): TrickplayView {
  const entry = currentRow(row, rowFor(Number(row.id)));
  const dir = trickplayDirFor(row);
  const hasSprites = existsSync(join(dir, "sprite_000.jpg"));
  const ready = Boolean(entry && entry.status === "done" && Number(entry.frame_count ?? 0) > 0 && hasSprites);
  const count = Number(entry?.frame_count ?? 0);
  const sprites: string[] = [];
  if (ready && count > 0) {
    const numSheets = Math.ceil(count / SPRITE_SIZE);
    for (let s = 0; s < numSheets; s++) {
      const name = `sprite_${String(s).padStart(3, "0")}.jpg`;
      sprites.push(`/api/trickplay/${Number(row.id)}/${name}?v=${Number(row.mtime)}`);
    }
  }
  return {
    ready,
    status: ready ? "done" : (entry?.status ?? "none"),
    trackUrl: ready ? trickplayTrackUrl(row) : null,
    sprites,
    interval: entry?.interval != null ? Number(entry.interval) : intervalFor(row.duration as number | null),
    width: entry?.width != null ? Number(entry.width) : TRICKPLAY_WIDTH,
    height: entry?.height != null ? Number(entry.height) : TRICKPLAY_HEIGHT,
    frameCount: entry?.frame_count == null ? null : Number(entry.frame_count),
    error: entry?.error == null ? null : String(entry.error),
  };
}

export function trickplayTrackUrl(row: Row): string {
  return `/api/trickplay/${Number(row.id)}/track.vtt?mtime=${Number(row.mtime)}`;
}

function mark(fileId: number, status: string, patch: Record<string, unknown> = {}): void {
  run(
    `INSERT OR IGNORE INTO trickplay (file_id, source_mtime, status)
     VALUES (?, 0, 'none')`,
    fileId,
  );
  const keys = Object.keys(patch);
  const assignments = ["status = ?", "updated_at = datetime('now')", ...keys.map((key) => `${key} = ?`)];
  run(
    `UPDATE trickplay SET ${assignments.join(", ")} WHERE file_id = ?`,
    status, ...keys.map((key) => patch[key]), fileId,
  );
}

/**
 * Start (or resume) extraction for a file. Cheap and idempotent: the play
 * manifest calls it on every request, but only the first one does any work.
 */
export function enqueueTrickplay(rowOrId: Row | number): void {
  const fileId = typeof rowOrId === "number" ? rowOrId : Number(rowOrId.id);
  const row = q<Row, [number]>("SELECT * FROM media_files WHERE id = ?").get(fileId);
  if (!row || Number(row.unavailable ?? 0) !== 0) return;
  if (Number(row.mtime) <= 0 || String(row.analysis_status ?? "") !== "probed") return;

  const entry = currentRow(row, rowFor(fileId));
  const dir = trickplayDirFor(row);
  const hasSprites = existsSync(join(dir, "sprite_000.jpg"));
  if (entry?.status === "done" && Number(entry.frame_count ?? 0) > 0 && hasSprites) return;
  if (entry?.status === "running" || entry?.status === "queued") return;
  if (queued.has(fileId) || active?.fileId === fileId) return;

  // A recent failure (corrupt stream, codec missing) is not retried on every
  // player open; an admin can clear the cache to force it.
  if (entry?.status === "failed") {
    const updated = Date.parse(String(entry.updated_at).replace(" ", "T") + "Z");
    if (Number.isFinite(updated) && Date.now() - updated < RETRY_AFTER_MS) return;
  }

  queued.add(fileId);
  queue.push(fileId);
  mark(fileId, "queued", {
    source_mtime: Number(row.mtime),
    interval: intervalFor(row.duration == null ? null : Number(row.duration)),
    duration: row.duration == null ? null : Number(row.duration),
    error: null,
  });

  if (!running && !startTimer && !stopping) {
    // Let the first frames of video arrive before spending CPU on extraction.
    startTimer = setTimeout(() => {
      startTimer = null;
      void pump();
    }, START_DELAY_MS);
  }
}

async function pump(): Promise<void> {
  if (running || stopping) return;
  const fileId = queue.shift();
  if (fileId == null) return;
  queued.delete(fileId);
  running = true;
  try {
    await extractOne(fileId);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    log.warn("media", "trickplay extraction failed", { fileId, message });
    if (!stopping) mark(fileId, "failed", { error: message.slice(0, 400) });
  } finally {
    running = false;
    active = null;
    if (queue.length > 0 && !stopping) void pump();
  }
}

async function extractOne(fileId: number): Promise<void> {
  const row = q<Row, [number]>("SELECT * FROM media_files WHERE id = ?").get(fileId);
  if (!row) return;
  const entry = currentRow(row, rowFor(fileId));
  if (!entry) return;

  const ffmpeg = resolveFfmpeg();
  if (!ffmpeg) {
    mark(fileId, "failed", { error: "FFmpeg is not available on this machine" });
    log.warn("media", "trickplay skipped: ffmpeg not found", { fileId });
    return;
  }

  const source = String(row.path);
  const info = await stat(source).catch(() => null);
  if (!info?.isFile()) {
    mark(fileId, "failed", { error: "Source file is missing" });
    return;
  }

  const dir = trickplayDirFor(row);
  await rm(dir, { recursive: true, force: true });
  await mkdir(dir, { recursive: true });

  const interval = Number(entry.interval) > 0 ? Number(entry.interval) : DEFAULT_INTERVAL;
  const pattern = join(dir, "sprite_%03d.jpg");
  const filter = [
    `fps=1/${interval}`,
    `scale=${TRICKPLAY_WIDTH}:${TRICKPLAY_HEIGHT}:force_original_aspect_ratio=decrease`,
    `pad=${TRICKPLAY_WIDTH}:${TRICKPLAY_HEIGHT}:(ow-iw)/2:(oh-ih)/2`,
    `tile=${SPRITE_COLS}x${SPRITE_ROWS}`,
  ].join(",");

  mark(fileId, "running", { error: null });

  const args = [
    "-hide_banner", "-loglevel", "error", "-nostdin", "-y",
    "-threads", "0",
    "-skip_frame", "nokey",
    "-i", source,
    "-map", "0:v:0", "-an", "-sn", "-dn",
    "-vf", filter,
    "-q:v", "5",
    "-start_number", "0",
    pattern,
  ];

  log.info("media", "extracting trickplay sprite sheets", { fileId, interval });
  const startedAt = Date.now();
  pauseOptimizer("trickplay");
  try {
    await runFfmpeg(ffmpeg, args, fileId);
  } finally {
    resumeOptimizer("trickplay");
  }
  if (stopping) {
    // Shutdown killed the extractor; the row stays `running` and is reset on
    // the next boot, which regenerates the folder from scratch.
    await rm(dir, { recursive: true, force: true }).catch(() => {});
    return;
  }

  const dirFiles = await readdir(dir).catch(() => [] as string[]);
  const spriteFiles = dirFiles.filter((name) => /^sprite_\d+\.jpg$/.test(name));
  const legacyFiles = dirFiles.filter((name) => /^\d+\.jpg$/.test(name));

  let frames = 0;
  if (spriteFiles.length > 0) {
    const dur = row.duration == null ? null : Number(row.duration);
    frames = dur && dur > 0 ? Math.ceil(dur / interval) : spriteFiles.length * SPRITE_SIZE;
  } else if (legacyFiles.length > 0) {
    frames = legacyFiles.length;
  } else {
    throw new Error("FFmpeg produced no frames");
  }

  // Remove folders for older source versions of this file.
  const prefix = `${fileId}-`;
  for (const name of await readdir(resolveTrickplayDir()).catch(() => [] as string[])) {
    if (name.startsWith(prefix) && name !== `${fileId}-${Number(row.mtime)}`) {
      await rm(join(resolveTrickplayDir(), name), { recursive: true, force: true }).catch(() => {});
    }
  }

  mark(fileId, "done", {
    source_mtime: Number(row.mtime),
    interval,
    frame_count: frames,
    width: TRICKPLAY_WIDTH,
    height: TRICKPLAY_HEIGHT,
    duration: row.duration == null ? null : Number(row.duration),
    error: null,
  });
  log.info("media", "trickplay ready", {
    fileId,
    frames,
    seconds: Math.round((Date.now() - startedAt) / 100) / 10,
  });
}

function runFfmpeg(ffmpeg: string, args: string[], fileId: number): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    const child = spawn(ffmpeg, args, { stdio: ["ignore", "ignore", "pipe"] });
    active = { fileId, child };
    let stderr = "";
    child.stderr!.on("data", (chunk: Buffer) => {
      if (stderr.length < 4_000) stderr += chunk.toString();
    });
    child.on("error", (err: Error) => {
      if (active?.child === child) active = null;
      reject(err);
    });
    child.on("exit", (code: number | null, signal: string | null) => {
      if (active?.child === child) active = null;
      if (stopping) {
        resolve();
        return;
      }
      if (code === 0) resolve();
      else reject(new Error(`ffmpeg exited ${code ?? signal}: ${stderr.trim().slice(0, 300)}`));
    });
  });
}

/** All cached frame paths for one file, or empty when not ready. */
export async function trickplayFilePath(row: Row, filename: string): Promise<string | null> {
  const entry = currentRow(row, rowFor(Number(row.id)));
  if (!entry || entry.status !== "done") return null;
  const dir = trickplayDirFor(row);
  let path = join(dir, filename);
  // Also support legacy numeric index, e.g. "0.jpg" -> "00000.jpg"
  if (!existsSync(path) && /^\d+\.jpg$/.test(filename)) {
    const num = Number(filename.replace(".jpg", ""));
    path = join(dir, `${String(num).padStart(5, "0")}.jpg`);
  }
  try {
    const info = await stat(path);
    return info.isFile() && info.size > 0 ? path : null;
  } catch {
    return null;
  }
}

export async function trickplayFrame(row: Row, index: number): Promise<string | null> {
  return trickplayFilePath(row, `${String(index).padStart(5, "0")}.jpg`);
}

/** Build the WebVTT thumbnails track on demand (tiny; no disk file needed). */
export function trickplayVtt(row: Row): string {
  const entry = currentRow(row, rowFor(Number(row.id)));
  if (!entry || entry.status !== "done") return "WEBVTT\n\n";
  const count = Number(entry.frame_count ?? 0);
  const interval = Number(entry.interval) > 0 ? Number(entry.interval) : DEFAULT_INTERVAL;
  const duration = entry.duration != null ? Number(entry.duration) : null;
  const lines: string[] = ["WEBVTT", ""];

  const dir = trickplayDirFor(row);
  const hasSprites = existsSync(join(dir, "sprite_000.jpg")) || existsSync(join(dir, "sprite_001.jpg"));
  if (!hasSprites) {
    enqueueTrickplay(row);
    return "WEBVTT\n\n";
  }

  for (let index = 0; index < count; index++) {
    const start = index * interval;
    const end = Math.min(start + interval, duration && duration > start ? duration : start + interval);
    if (end <= start) break;

    const sheetIndex = Math.floor(index / SPRITE_SIZE);
    const posInSheet = index % SPRITE_SIZE;
    const col = posInSheet % SPRITE_COLS;
    const rowIdx = Math.floor(posInSheet / SPRITE_COLS);
    const x = col * TRICKPLAY_WIDTH;
    const y = rowIdx * TRICKPLAY_HEIGHT;
    const sheetName = `sprite_${String(sheetIndex).padStart(3, "0")}.jpg`;
    lines.push(
      `${fmtVttTimestamp(start)} --> ${fmtVttTimestamp(end)}`,
      `/api/trickplay/${Number(row.id)}/${sheetName}?v=${Number(row.mtime)}#xywh=${x},${y},${TRICKPLAY_WIDTH},${TRICKPLAY_HEIGHT}`,
      "",
    );
  }
  return lines.join("\n");
}

/** Remove every cached frame for a file (admin cache reset / source change). */
export async function clearTrickplay(fileId?: number): Promise<number> {
  let removed = 0;
  const base = resolveTrickplayDir();
  const entries = await readdir(base).catch(() => [] as string[]);
  for (const name of entries) {
    if (fileId != null && !name.startsWith(`${fileId}-`)) continue;
    await rm(join(base, name), { recursive: true, force: true }).catch(() => {});
    removed++;
  }
  if (fileId == null) run("DELETE FROM trickplay");
  else run("DELETE FROM trickplay WHERE file_id = ?", fileId);
  return removed;
}

/** Stop the extractor during shutdown. A partial folder is removed next run. */
export async function shutdownTrickplay(): Promise<void> {
  stopping = true;
  queue.length = 0;
  queued.clear();
  if (startTimer) {
    clearTimeout(startTimer);
    startTimer = null;
  }
  const child = active?.child;
  if (child && child.exitCode === null) {
    await new Promise<void>((resolve) => {
      child.once("exit", () => resolve());
      child.kill("SIGTERM");
      setTimeout(resolve, 2000);
    });
  }
}

/** Boot-time cleanup: queued/running rows from an unclean exit are retryable. */
export function resetInterruptedTrickplay(): void {
  run("UPDATE trickplay SET status = 'none', error = NULL WHERE status IN ('queued', 'running')");
}
