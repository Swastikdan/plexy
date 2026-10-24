/// Adaptive HLS preparation. Variants are encoded before playback.
import { mkdir, readFile, rm, stat } from "node:fs/promises";
import { availableParallelism } from "node:os";
import { join } from "node:path";
import { spawn } from "node:child_process";
import { q, run, type Row } from "./db";
import { log } from "./logger";
import { resolveFfmpeg } from "./ffmpeg";
import { detectHardwareEncoder, videoEncoderArgs } from "./hls-encoder";
import { pauseOptimizer, resumeOptimizer } from "./optimize";
import { resolveOptimizedDir } from "./paths";
import { preferredAudioBitrate } from "./playback";
import { getConfig } from "./config";

export const QUALITY_HEIGHTS = [360, 480, 720, 1080, 2160] as const;

/**
 * Prepared HLS files are named by FFmpeg's `var_stream_map`: numeric indexes
 * (`variant_0.m3u8`) or friendly labels (`variant_1080p.m3u8`, `variant_4k.m3u8`).
 * Keep this in one place so the route and the playlist rewriter cannot drift.
 */
const HLS_ASSET = /^(?:variant_\d+(?:p|k)?\.m3u8|segment_\d+(?:p|k)?_\d+\.ts)$/;
const HLS_ASSET_LINE = /^(?:variant_\d+(?:p|k)?\.m3u8|segment_\d+(?:p|k)?_\d+\.ts)$/gm;

export function isPreparedHlsAsset(asset: string): boolean {
  return asset === "master.m3u8" || HLS_ASSET.test(asset);
}

/** Point a cached playlist's relative entries back at the authenticated route. */
export function rewritePreparedPlaylist(
  playlist: string,
  fileId: number,
  origin: string,
  audioIndex: number,
): string {
  return playlist.replace(
    HLS_ASSET_LINE,
    `${origin}/api/stream/${fileId}/hls/$&?audio=${audioIndex}`,
  );
}

export function streamPreparationStatus() {
  const rows = q<{ status: string; progress: number }>(
    "SELECT status, progress FROM hls_preparations",
  ).all();
  const ready = rows.filter((row) => row.status === "ready").length;
  const queuedCount = rows.filter((row) => row.status === "queued").length;
  const runningRow = rows.find((row) => row.status === "running");
  const failed = rows.filter((row) => row.status === "failed").length;
  const cancelled = rows.filter((row) => row.status === "cancelled").length;
  const total = rows.length;
  const current = runningRow ? q<{ title: string }, []>(
    `SELECT i.name AS title FROM hls_preparations h
     JOIN media_files f ON f.id=h.file_id LEFT JOIN items i ON i.id=f.item_id
     WHERE h.status='running' LIMIT 1`,
  ).get()?.title ?? "Current title" : null;
  const error = q<{ error: string | null }, []>(
    "SELECT error FROM hls_preparations WHERE status='failed' ORDER BY updated_at DESC LIMIT 1",
  ).get()?.error ?? null;
  const completed = ready + (runningRow ? Number(runningRow.progress ?? 0) : 0);
  return {
    total,
    ready,
    queued: queuedCount,
    running: runningRow ? 1 : 0,
    failed,
    cancelled,
    error,
    progress: total ? completed / total : 0,
    current: runningRow ? { title: current, progress: Number(runningRow.progress ?? 0) } : null,
  };
}

const queue: number[] = [];
const queued = new Set<number>();
const active = new Set<number>();
const activeProcesses = new Map<number, ReturnType<typeof spawn>>();
const cancelledJobs = new Set<number>();
let bulkPreparationVersion = 0;
let running = false;
let optimizerPaused = false;

/**
 * Adaptive HLS generation already keeps every core busy. Letting the background
 * optimizer encode another title at the same time makes both jobs slower and
 * turns the machine into a space heater.
 */
function pauseBackgroundPreparation(): void {
  if (optimizerPaused) return;
  optimizerPaused = true;
  pauseOptimizer("adaptive-streams");
}

function resumeBackgroundPreparation(): void {
  if (!optimizerPaused) return;
  optimizerPaused = false;
  resumeOptimizer("adaptive-streams");
}

export function streamCacheDir(row: Row, audioIndex: number, qualities: number[]): string {
  const suffix = [...qualities].sort((a, b) => a - b).join("-");
  return join(resolveOptimizedDir(), "hls", `${row.id}-${Number(row.mtime ?? 0)}-a${audioIndex}-q${suffix}`);
}

function cacheDirFor(row: Row): string | null {
  const prep = q<Row, [number]>("SELECT * FROM hls_preparations WHERE file_id = ?").get(Number(row.id));
  if (!prep || prep.status !== "ready" || Number(prep.source_mtime) !== Number(row.mtime)) return null;
  let qualities: number[];
  try { qualities = JSON.parse(String(prep.qualities)); } catch { return null; }
  if (!qualities.length) return null;
  return streamCacheDir(row, Number(prep.audio_index), qualities);
}

export async function preparedStreamAvailable(row: Row, audioIndex?: number): Promise<boolean> {
  if (audioIndex !== undefined) {
    const prep = q<Row, [number]>("SELECT audio_index FROM hls_preparations WHERE file_id = ? AND status = 'ready'").get(Number(row.id));
    if (!prep || Number(prep.audio_index) !== audioIndex) return false;
  }
  const dir = cacheDirFor(row);
  if (!dir) return false;
  try { return (await stat(join(dir, "master.m3u8"))).isFile(); } catch { return false; }
}

export async function readPreparedPlaylist(row: Row, asset: string, origin: string, requestedAudioIndex?: number): Promise<Response | null> {
  const dir = cacheDirFor(row);
  if (!dir || !isPreparedHlsAsset(asset)) return null;
  const prep = q<Row, [number]>("SELECT audio_index FROM hls_preparations WHERE file_id = ?").get(Number(row.id));
  if (!prep) return null;
  if (requestedAudioIndex !== undefined && Number(prep.audio_index) !== requestedAudioIndex) return null;
  const assetPath = join(dir, asset);
  const info = await stat(assetPath).catch(() => null);
  if (!info?.isFile()) return null;
  if (asset.endsWith(".m3u8")) {
    const audioIndex = Number(prep.audio_index);
    const playlist = rewritePreparedPlaylist(
      await readFile(assetPath, "utf8"),
      Number(row.id),
      origin,
      audioIndex,
    );
    return new Response(playlist, { headers: {
      "Content-Type": "application/vnd.apple.mpegurl",
      "Cache-Control": "private, max-age=3600",
    } });
  }
  return new Response(Bun.file(assetPath), { headers: {
    "Content-Type": "video/mp2t",
    "Cache-Control": "private, max-age=86400",
  } });
}

export async function setTitleStreamQualities(itemId: number, qualities: number[], force = false, bulkVersion?: number): Promise<number> {
  const normalized = [...new Set(qualities)].filter((height) => QUALITY_HEIGHTS.includes(height as typeof QUALITY_HEIGHTS[number])).sort((a, b) => a - b);
  if (!normalized.length) {
    run("DELETE FROM item_stream_settings WHERE item_id = ?", itemId);
  } else {
    run(
      `INSERT INTO item_stream_settings (item_id, qualities, updated_at) VALUES (?, ?, datetime('now'))
       ON CONFLICT(item_id) DO UPDATE SET qualities=excluded.qualities, updated_at=datetime('now')`,
      itemId, JSON.stringify(normalized),
    );
  }
  const item = q<Row, [number]>("SELECT kind FROM items WHERE id = ?").get(itemId);
  const itemIds = item?.kind === "series"
    ? [itemId, ...q<{ id: number }, [number]>("SELECT id FROM items WHERE parent_id = ? AND kind = 'episode'").all(itemId).map((row) => Number(row.id))]
    : [itemId];
  const placeholders = itemIds.map(() => "?").join(",");
  const rows = q<Row>(
    `SELECT id, item_id, mtime, height, audio_json, analysis_status FROM media_files
     WHERE item_id IN (${placeholders}) AND unavailable = 0`,
  ).all(...itemIds);
  if (!normalized.length) {
    for (const row of rows) {
      const id = Number(row.id);
      run("DELETE FROM hls_preparations WHERE file_id = ?", id);
      if (!active.has(id)) queued.delete(id);
    }
    for (let i = queue.length - 1; i >= 0; i--) {
      if (rows.some((row) => Number(row.id) === queue[i])) queue.splice(i, 1);
    }
    return 0;
  }
  let added = 0;
  const config = await getConfig();
  if (bulkVersion !== undefined && bulkVersion !== bulkPreparationVersion) return 0;
  for (const row of rows) {
    if (row.analysis_status !== "probed") continue;
    const id = Number(row.id);
    const tracks = safeAudio(String(row.audio_json ?? "[]")) as Array<{ channels?: number; language?: string; isDefault?: boolean }>;
    const wanted = normalizeLanguage(config.preferredAudioLanguage || "en");
    const languageIndex = tracks.findIndex((track) => normalizeLanguage(track.language) === wanted);
    const defaultIndex = tracks.findIndex((track) => track.isDefault);
    const audioIndex = languageIndex >= 0 ? languageIndex : Math.max(0, defaultIndex);
    const sourceHeight = Math.floor((Number(row.height) || normalized[normalized.length - 1] || 360) / 2) * 2;
    const fileQualities = [...new Set(normalized.map((height) => Math.min(height, sourceHeight)))].sort((a, b) => a - b);
    const nextQualities = JSON.stringify(fileQualities);
    const previous = q<Row, [number]>("SELECT * FROM hls_preparations WHERE file_id=?").get(id);
    const sameProfile = previous && Number(previous.source_mtime) === Number(row.mtime)
      && Number(previous.audio_index) === audioIndex && String(previous.qualities) === nextQualities;
    if (sameProfile && (previous.status === "queued" || previous.status === "running")) continue;
    if (sameProfile && previous.status === "cancelled" && !force) continue;
    if (sameProfile && previous.status === "ready" && await preparedStreamAvailable(row, audioIndex)) continue;
    if (bulkVersion !== undefined && bulkVersion !== bulkPreparationVersion) return added;
    run(
      `INSERT INTO hls_preparations (file_id, source_mtime, audio_index, qualities, status, error, progress, updated_at)
       VALUES (?, ?, ?, ?, 'queued', NULL, 0, datetime('now'))
       ON CONFLICT(file_id) DO UPDATE SET source_mtime=excluded.source_mtime,
         audio_index=excluded.audio_index, qualities=excluded.qualities, status='queued', error=NULL, progress=0, updated_at=datetime('now')`,
      id, Number(row.mtime), audioIndex, nextQualities,
    );
    if (active.has(id) || queued.has(id)) continue;
    queue.push(id);
    queued.add(id);
    added++;
  }
  void pump();
  return added;
}

function normalizeLanguage(language: unknown): string {
  const value = String(language ?? "").trim().toLowerCase().split(/[-_]/, 1)[0];
  const aliases: Record<string, string> = { eng: "en", english: "en", spa: "es", spanish: "es", fra: "fr", fre: "fr", french: "fr", deu: "de", german: "de", hin: "hi", hindi: "hi", jpn: "ja", japanese: "ja" };
  return aliases[value] ?? value;
}

async function buildPreparedStreams(fileId: number, onProgress: (value: number) => void): Promise<void> {
  const row = q<Row, [number]>("SELECT * FROM media_files WHERE id = ?").get(fileId);
  const prep = q<Row, [number]>("SELECT * FROM hls_preparations WHERE file_id = ?").get(fileId);
  if (!row || !prep) throw new Error("Title or preparation settings no longer exist");
  const source = String(row.path ?? "");
  const sourceInfo = await stat(source).catch(() => null);
  if (!sourceInfo?.isFile()) throw new Error("Source video is unavailable");
  if (Number(row.mtime) !== Math.floor(sourceInfo.mtimeMs)) throw new Error("Video changed; rescan the library before preparing streams");
  const ffmpeg = resolveFfmpeg();
  if (!ffmpeg) throw new Error("FFmpeg was not found on the server");
  const qualities: number[] = JSON.parse(String(prep.qualities));
  const audioIndex = Number(prep.audio_index ?? 0);
  if (!qualities.length) throw new Error("Choose at least one quality level");

  const output = streamCacheDir(row, audioIndex, qualities);
  await rm(output, { recursive: true, force: true });
  await mkdir(output, { recursive: true });

  // Give the largest rendition to the hardware encoder when one is available.
  // The smaller variants stay on x264 and run in parallel with it. Threads are
  // split across the software encoders so four outputs do not each try to use
  // every core (which caused heavy context switching and ~1 GB of x264 state).
  const hardwareEncoder = await detectHardwareEncoder(ffmpeg);
  const hardwareIndex = hardwareEncoder ? qualities.length - 1 : -1;
  const softwareCount = Math.max(1, qualities.length - (hardwareEncoder ? 1 : 0));
  const softwareThreads = Math.max(1, Math.min(16, Math.floor(availableParallelism() / softwareCount)));
  const encoderOptions = { softwarePreset: "superfast", softwareThreads };

  const filters: string[] = [];
  const splitLabels = qualities.map((_, i) => `[src${i}]`).join("");
  filters.push(`[0:v:0]split=${qualities.length}${splitLabels}`);
  qualities.forEach((height, i) => filters.push(
    `[src${i}]scale=-2:${height}:force_original_aspect_ratio=decrease:force_divisible_by=2,setsar=1[v${i}]`,
  ));
  const args = ["-hide_banner", "-loglevel", "error", "-nostdin", "-y", "-i", source,
    "-filter_complex", filters.join(";")];
  qualities.forEach((_, i) => args.push("-map", `[v${i}]`));
  const audio = safeAudio(String(row.audio_json ?? "[]"));
  const hasAudio = audioIndex < audio.length;
  if (hasAudio) qualities.forEach(() => args.push("-map", `0:a:${audioIndex}?`));
  qualities.forEach((height, i) => {
    const rate = height >= 2160 ? 12_000_000 : height >= 1080 ? 5_000_000 : height >= 720 ? 3_000_000 : height >= 480 ? 1_500_000 : 800_000;
    args.push(...videoEncoderArgs(i, i === hardwareIndex ? hardwareEncoder! : "libx264", encoderOptions),
      `-b:v:${i}`, String(rate), `-maxrate:v:${i}`, String(Math.round(rate * 1.15)),
      `-bufsize:v:${i}`, String(rate * 2));
    if (hasAudio) args.push(`-c:a:${i}`, "aac", `-b:a:${i}`, String(preferredAudioBitrate(audio[audioIndex]?.channels ?? null)));
  });
  const streamMap = qualities.map((height, i) => hasAudio
    ? `v:${i},a:${i},name:${height === 2160 ? "4k" : `${height}p`}`
    : `v:${i},name:${height === 2160 ? "4k" : `${height}p`}`).join(" ");
  args.push("-sn", "-dn", "-map_metadata", "-1", "-sc_threshold", "0",
    // Force the same keyframe cadence for hardware and software encoders, so
    // every variant has matching segment boundaries for clean quality switches.
    "-force_key_frames", "expr:gte(t,n_forced*6)",
    "-progress", "pipe:1", "-nostats", "-f", "hls", "-hls_time", "6",
    "-hls_playlist_type", "vod", "-hls_flags", "independent_segments", "-master_pl_name", "master.m3u8",
    "-var_stream_map", streamMap, "-hls_segment_filename", join(output, "segment_%v_%05d.ts"),
    join(output, "variant_%v.m3u8"));
  log.info("media", "adaptive stream encoding plan", {
    fileId,
    encoder: hardwareEncoder ?? "libx264",
    hardware: Boolean(hardwareEncoder),
    softwarePreset: encoderOptions.softwarePreset,
    softwareThreads,
    qualities,
  });
  try {
    await new Promise<void>((resolve, reject) => {
      const child = spawn(ffmpeg, args, { stdio: ["ignore", "pipe", "pipe"] });
      activeProcesses.set(fileId, child);
      if (cancelledJobs.has(fileId)) child.kill("SIGTERM");
      let stderr = "";
      let stdout = "";
      let lastWrite = 0;
      const duration = Number(row.duration ?? 0);
      child.stdout?.on("data", (chunk: Buffer) => {
        stdout += chunk.toString();
        const lines = stdout.split(/\r?\n/);
        stdout = lines.pop() ?? "";
        const marker = [...lines].reverse().find((line) => line.startsWith("out_time_ms="));
        if (!marker || duration <= 0) return;
        const seconds = Number(marker.slice("out_time_ms=".length)) / 1_000_000;
        if (!Number.isFinite(seconds)) return;
        const progress = Math.min(0.99, Math.max(0, seconds / duration));
        const now = Date.now();
        if (now - lastWrite > 1000) {
          lastWrite = now;
          onProgress(progress);
        }
      });
      child.stderr?.on("data", (chunk: Buffer) => { stderr = (stderr + chunk.toString()).slice(-4000); });
      child.once("error", reject);
      child.once("close", (code: number | null) => {
        if (activeProcesses.get(fileId) === child) activeProcesses.delete(fileId);
        code === 0 ? resolve() : reject(new Error(stderr || `FFmpeg exited with code ${code}`));
      });
    });
    const master = await stat(join(output, "master.m3u8"));
    if (!master.isFile()) throw new Error("FFmpeg did not write an HLS master playlist");
  } catch (error) {
    await rm(output, { recursive: true, force: true });
    throw error;
  }
}

function safeAudio(raw: string): Array<{ channels?: number; language?: string; isDefault?: boolean }> {
  try { const parsed = JSON.parse(raw); return Array.isArray(parsed) ? parsed : []; }
  catch { return []; }
}

async function pump(): Promise<void> {
  if (running) return;
  const fileId = queue.shift();
  if (fileId == null) return;
  queued.delete(fileId);
  active.add(fileId);
  running = true;
  pauseBackgroundPreparation();
  const expected = q<Row, [number]>("SELECT source_mtime, qualities FROM hls_preparations WHERE file_id=?").get(fileId);
  run("UPDATE hls_preparations SET status='running', error=NULL, progress=0, updated_at=datetime('now') WHERE file_id=?", fileId);
  try {
    await buildPreparedStreams(fileId, (progress) => {
      run("UPDATE hls_preparations SET progress=? WHERE file_id=? AND status='running'", progress, fileId);
    });
    if (cancelledJobs.delete(fileId)) {
      log.info("media", "adaptive stream preparation cancelled", { fileId });
    } else {
      run("UPDATE hls_preparations SET progress=1 WHERE file_id=? AND status='running'", fileId);
      run("UPDATE hls_preparations SET status='ready', error=NULL, updated_at=datetime('now') WHERE file_id=? AND status='running' AND source_mtime=? AND qualities=?", fileId, expected?.source_mtime, expected?.qualities);
      log.info("media", "prepared adaptive quality streams", { fileId });
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (cancelledJobs.delete(fileId)) {
      log.info("media", "adaptive stream preparation cancelled", { fileId });
    } else {
      run("UPDATE hls_preparations SET status='failed', error=?, updated_at=datetime('now') WHERE file_id=? AND status='running' AND source_mtime=? AND qualities=?", message, fileId, expected?.source_mtime, expected?.qualities);
      log.error("media", "adaptive stream preparation failed", { fileId, message });
    }
  } finally {
    active.delete(fileId);
    running = false;
    const pending = q<{ status: string }, [number]>("SELECT status FROM hls_preparations WHERE file_id=?").get(fileId);
    if (pending?.status === "queued" && !queued.has(fileId)) {
      queued.add(fileId);
      queue.push(fileId);
    }
    if (queue.length === 0) resumeBackgroundPreparation();
    void pump();
  }
}

export async function startStreamPreparation(): Promise<void> {
  run("UPDATE hls_preparations SET status='queued', progress=0 WHERE status='running'");
  const rows = q<{ file_id: number }>("SELECT file_id FROM hls_preparations WHERE status='queued' ORDER BY updated_at").all();
  for (const row of rows) {
    const id = Number(row.file_id);
    if (queued.has(id)) continue;
    queue.push(id);
    queued.add(id);
  }
  await enqueueConfiguredStreamPreparations();
  void pump();
}

export async function enqueueConfiguredStreamPreparations(): Promise<void> {
  const settings = q<{ item_id: number; qualities: string }>("SELECT item_id, qualities FROM item_stream_settings").all();
  for (const setting of settings) {
    let qualities: number[];
    try { qualities = JSON.parse(setting.qualities); } catch { continue; }
    await setTitleStreamQualities(Number(setting.item_id), qualities);
  }
}

export async function enqueueStreamPreparationsForTitles(itemIds: number[]): Promise<number> {
  const version = ++bulkPreparationVersion;
  const ids = [...new Set(itemIds.map((id) => Math.trunc(id)).filter((id) => id > 0))];
  if (!ids.length) return 0;
  let queuedCount = 0;
  for (const itemId of ids) {
    if (version !== bulkPreparationVersion) break;
    queuedCount += await setTitleStreamQualities(itemId, [...QUALITY_HEIGHTS], true, version);
  }
  return queuedCount;
}

export function cancelStreamPreparation(): void {
  bulkPreparationVersion++;
  run("UPDATE hls_preparations SET status='cancelled', progress=0, error=NULL, updated_at=datetime('now') WHERE status IN ('queued','running')");
  queue.length = 0;
  queued.clear();
  for (const id of active) {
    cancelledJobs.add(id);
    activeProcesses.get(id)?.kill("SIGTERM");
  }
}

export async function cancelStreamPreparationsForFiles(fileIds: number[]): Promise<void> {
  const targets = new Set(fileIds);
  for (let index = queue.length - 1; index >= 0; index--) {
    if (targets.has(queue[index])) queue.splice(index, 1);
  }
  for (const fileId of targets) {
    queued.delete(fileId);
    if (!active.has(fileId)) continue;
    cancelledJobs.add(fileId);
    activeProcesses.get(fileId)?.kill("SIGTERM");
  }
  while ([...targets].some((fileId) => active.has(fileId))) {
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  for (const fileId of targets) {
    cancelledJobs.delete(fileId);
    run("DELETE FROM hls_preparations WHERE file_id=?", fileId);
  }
}
