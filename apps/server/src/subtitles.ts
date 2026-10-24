/// Embedded and sidecar subtitle handling, shared by the scanner, the playback
/// preparation queue and the HTTP routes.
///
/// Mediabunny gives us each subtitle packet's timestamp and duration. We turn
/// those packets into well-formed WebVTT cues (`start --> end`) instead of
/// treating the packet payload as a complete cue, which is what made embedded
/// subtitles invisible before. Extracted tracks are cached on disk so opening
/// the subtitle menu never re-reads the video container.
import { mkdir, readdir, stat } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import {
  ALL_FORMATS, BlobSource, EncodedPacketSink, Input,
} from "mediabunny";
import { q, run, type Row } from "./db";
import { log } from "./logger";
import { resolveSubtitleCacheDir } from "./paths";
import { readMatroskaSubtitles, type MatroskaSubtitlePacket, type MatroskaSubtitleTrack } from "./mkv-subtitles";

export interface EmbeddedSubtitle {
  codec: string | null;
  language: string | null;
  title: string | null;
  isDefault?: boolean;
}

export interface SubtitleTrackInfo {
  track: string;
  kind: "embedded" | "sidecar";
  language: string | null;
  title: string;
  isDefault: boolean;
}

const TEXT_SUBTITLE_CODECS = new Set([
  "webvtt", "vtt", "srt", "subrip", "ass", "ssa", "mov_text", "text", "ttml", "usf",
]);

/** True for subtitle codecs we can turn into WebVTT text (not PGS/VobSub). */
export function isTextSubtitle(codec: string | null | undefined): boolean {
  return !codec || TEXT_SUBTITLE_CODECS.has(codec);
}

const decoder = new TextDecoder();

/** `HH:MM:SS.mmm` — WebVTT requires a dot and milliseconds. */
export function fmtVttTimestamp(seconds: number): string {
  const totalMs = Math.round(Math.max(0, Number.isFinite(seconds) ? seconds : 0) * 1000);
  const h = Math.floor(totalMs / 3_600_000);
  const m = Math.floor((totalMs % 3_600_000) / 60_000);
  const s = Math.floor((totalMs % 60_000) / 1000);
  const ms = totalMs % 1000;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}.${String(ms).padStart(3, "0")}`;
}

/** Replace commas in SRT timestamps with dots, leaving other text alone. */
function normalizeTimestamps(text: string): string {
  return text.replace(/(\d{1,2}:\d{2}:\d{2}),(\d{3})/g, "$1.$2");
}

function decodeMovText(data: Uint8Array): string {
  // QuickTime tx3g samples are a big-endian 16-bit length followed by UTF-8.
  if (data.byteLength < 2) return "";
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const length = view.getUint16(0);
  if (length > 0 && 2 + length <= data.byteLength) {
    return decoder.decode(data.subarray(2, 2 + length));
  }
  return decoder.decode(data.subarray(2));
}

/** Turn one subtitle packet into readable text (no timing). */
export function normalizeSubtitleText(raw: string, codec: string | null): string {
  let text = raw
    .replace(/\uFEFF/g, "")
    .replace(/\0/g, "")
    .replace(/\r\n?/g, "\n");

  if (codec === "webvtt" || codec === "vtt" || /^WEBVTT\b/.test(text)) {
    text = text.replace(/^WEBVTT[^\n]*\n?/i, "");
  }

  // Matroska can hand us a complete ASS dialogue line.
  if (/^\s*Dialogue\s*:/i.test(text)) {
    text = text
      .split("\n")
      .map((line) => {
        const m = line.match(/^\s*Dialogue\s*:\s*([^,]*),([^,]*),([^,]*),([^,]*),([^,]*),([^,]*),([^,]*),([^,]*),([^,]*),(.*)$/i);
        return m ? m[10]! : line.replace(/^\s*Dialogue\s*:/i, "");
      })
      .join("\n");
  } else if (codec === "ass" || codec === "ssa") {
    // Matroska stores the ASS fields *after* "Dialogue:":
    // ReadOrder, Layer, Style, Name, MarginL, MarginR, MarginV, Effect, Text.
    const m = /^\d+,(?:[^,]*,){7}(.*)$/s.exec(text);
    if (m) text = m[1]!;
  }

  // Drop SRT cue numbers and timestamp lines; the packet timing is authoritative.
  text = text
    .replace(/^\s*\d+\s*$/gm, "")
    .replace(/^\s*\d{1,2}:\d{2}:\d{2}[.,]\d{3}\s*-->.*$/gm, "");

  // ASS/SSA override blocks and HTML-ish tags.
  text = text
    .replace(/\{[^}]*\}/g, "")
    .replace(/<\/?(?:i|b|u|s|font|ruby|rt|span|p|br)[^>]*>/gi, "")
    .replace(/\\[Nnh]/g, "\n")
    .replace(/\\h/g, " ");

  return text
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .join("\n")
    .trim();
}

/**
 * One packet → one or more cues.
 *
 * Embedded text tracks usually carry one cue per packet, but some muxers put a
 * whole SRT/VTT block (or several) into a single packet. When the payload
 * carries `-->` timing we parse real cue blocks and use their start/end; the
 * timing lines must never end up in the cue payload or players show garbage.
 * Otherwise the packet timestamp/duration is authoritative.
 */
export function packetToCues(
  data: Uint8Array,
  codec: string | null,
  timestamp: number,
  duration: number,
): Array<{ start: number; end: number; text: string }> {
  const raw = codec === "mov_text" ? decodeMovText(data) : decoder.decode(data);
  if (!raw.trim()) return [];

  if (/-->/.test(raw)) {
    const parsed = parseTimedBlocks(raw);
    if (parsed.length) return parsed;
  }

  const text = normalizeSubtitleText(raw, codec);
  if (!text) return [];
  const start = Math.max(0, timestamp);
  const end = start + Math.max(0.5, Number.isFinite(duration) && duration > 0 ? duration : 2);
  return [{ start, end, text }];
}

function timingFromText(line: string): { start: number; end: number } | null {
  const m = /(\d{1,2}):(\d{2}):(\d{2})[.,](\d{3})\s*-->\s*(\d{1,2}):(\d{2}):(\d{2})[.,](\d{3})/.exec(line);
  if (!m) return null;
  const seconds = (h: string, min: string, s: string, ms: string) =>
    Number(h) * 3600 + Number(min) * 60 + Number(s) + Number(ms) / 1000;
  return {
    start: seconds(m[1]!, m[2]!, m[3]!, m[4]!),
    end: seconds(m[5]!, m[6]!, m[7]!, m[8]!),
  };
}

/** Parse a complete SRT/VTT document into cues with explicit timing. */
function parseTimedBlocks(raw: string): Array<{ start: number; end: number; text: string }> {
  const normalized = normalizeTimestamps(raw)
    .replace(/\uFEFF/g, "")
    .replace(/\r\n?/g, "\n")
    .replace(/^WEBVTT[^\n]*\n?/i, "");
  const cues: Array<{ start: number; end: number; text: string }> = [];

  for (const block of normalized.split(/\n{2,}/)) {
    const lines = block.split("\n");
    if (lines.length && /^\s*\d+\s*$/.test(lines[0]!)) lines.shift();
    const timingIndex = lines.findIndex((line) => line.includes("-->"));
    if (timingIndex < 0) continue;
    const timing = timingFromText(lines[timingIndex]!);
    if (!timing) continue;
    const text = normalizeSubtitleText(lines.slice(timingIndex + 1).join("\n"), null);
    if (text) cues.push({ start: timing.start, end: timing.end, text });
  }
  return cues;
}

/** Convert an SRT sidecar (or an already-valid VTT file) into WebVTT text. */
export function srtToVtt(text: string): string {
  const body = text
    .replace(/\uFEFF/g, "")
    .replace(/\r\n?/g, "\n")
    .replace(/(\d{1,2}:\d{2}:\d{2}),(\d{3})/g, "$1.$2")
    .trim();
  if (/^WEBVTT\b/i.test(body)) return body.endsWith("\n") ? body : `${body}\n`;
  return body ? `WEBVTT\n\n${body}\n` : "WEBVTT\n\n";
}

/** Serialize cues as a valid WebVTT document. */
export function cuesToVtt(cues: Array<{ start: number; end: number; text: string }>): string {
  const body = cues
    .filter((cue) => cue.text.trim().length > 0)
    .map((cue) => {
      const end = Math.max(cue.end, cue.start + 0.05);
      return `${fmtVttTimestamp(cue.start)} --> ${fmtVttTimestamp(end)}\n${cue.text.trim()}\n`;
    })
    .join("\n");
  return body ? `WEBVTT\n\n${body}` : "WEBVTT\n\n";
}

function matroskaVtt(
  track: MatroskaSubtitleTrack,
  packets: MatroskaSubtitlePacket[],
): string | null {
  if (!isTextSubtitle(track.codec)) {
    log.debug("player", "skipping image-based subtitle track", {
      track: track.number, codec: track.codec,
    });
    return null;
  }
  const cues: Array<{ start: number; end: number; text: string }> = [];
  for (const packet of packets) {
    cues.push(...packetToCues(packet.data, track.codec, packet.timestamp, packet.duration));
  }
  return cues.length ? cuesToVtt(cues) : null;
}

/**
 * Extract every subtitle track in one pass. Returns `null` for image-based or
 * empty tracks, aligned with the track order stored in `subtitles_json`.
 * Matroska is read directly because mediabunny cannot demux subtitle tracks.
 */
export async function extractAllEmbeddedVtt(path: string): Promise<Array<string | null> | null> {
  const matroska = await readMatroskaSubtitles(path).catch((err) => {
    log.warn("player", "matroska subtitle read failed", {
      path, message: err instanceof Error ? err.message : String(err),
    });
    return null;
  });
  if (!matroska) return null;
  return matroska.tracks.map((track) =>
    matroskaVtt(track, matroska.packets.get(track.number) ?? []));
}

/** Extract one embedded subtitle track from a video file as WebVTT. */
export async function extractEmbeddedVtt(path: string, trackIndex: number): Promise<string | null> {
  const all = await extractAllEmbeddedVtt(path);
  if (all) return all[trackIndex] ?? null;

  // Fallback for containers mediabunny can demux subtitles from (none in the
  // current version, but harmless if support is added).
  const input = new Input({ source: new BlobSource(Bun.file(path)), formats: ALL_FORMATS });
  try {
    const tracks = await input.getTracks();
    const subs = tracks.filter((track) => track.type === "subtitle");
    const track = subs[trackIndex];
    if (!track) return null;

    const codec = await track.getCodec();
    if (codec && !TEXT_SUBTITLE_CODECS.has(codec)) {
      log.debug("player", "skipping image-based subtitle track", { path, trackIndex, codec });
      return null;
    }

    const sink = new EncodedPacketSink(track);
    const cues: Array<{ start: number; end: number; text: string }> = [];
    for await (const packet of sink.packets()) {
      cues.push(...packetToCues(packet.data, codec, packet.timestamp, packet.duration));
    }
    if (!cues.length) return null;
    return cuesToVtt(cues);
  } finally {
    input.dispose();
  }
}

function parseEmbedded(row: Row): EmbeddedSubtitle[] {
  if (!row.subtitles_json) return [];
  try {
    const parsed = JSON.parse(String(row.subtitles_json));
    return Array.isArray(parsed) ? parsed as EmbeddedSubtitle[] : [];
  } catch {
    return [];
  }
}

/** Current source mtime (seconds) used to invalidate cached subtitle files. */
function sourceStamp(row: Row): number {
  return Number(row.mtime ?? 0);
}

function cachedSubtitlePath(row: Row, trackIndex: number): string {
  const id = Number(row.id);
  const stamp = sourceStamp(row);
  return join(resolveSubtitleCacheDir(), `${id}-${stamp}-${trackIndex}.vtt`);
}

async function pathIsFile(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isFile();
  } catch {
    return false;
  }
}

/**
 * Extract and cache every text subtitle track for a file. Returns the number of
 * tracks written. Safe to call repeatedly; unchanged tracks are reused.
 */
export async function cacheEmbeddedSubtitles(row: Row): Promise<number> {
  const embedded = parseEmbedded(row);
  if (!embedded.length || !row.path) return 0;

  await mkdir(resolveSubtitleCacheDir(), { recursive: true });
  let written = 0;
  // One pass over the container, not one per track.
  const extracted = await extractAllEmbeddedVtt(String(row.path)).catch(() => null);

  for (let index = 0; index < embedded.length; index++) {
    const info = embedded[index]!;
    if (info.codec && !TEXT_SUBTITLE_CODECS.has(info.codec)) continue;
    const output = cachedSubtitlePath(row, index);

    const existing = q<Row, [number, number]>(
      "SELECT path, source_mtime FROM subtitle_cache WHERE file_id = ? AND track_index = ?",
    ).get(Number(row.id), index);

    if (existing && Number(existing.source_mtime) === sourceStamp(row) && await pathIsFile(String(existing.path))) {
      continue;
    }

    try {
      const vtt = extracted
        ? extracted[index] ?? null
        : await extractEmbeddedVtt(String(row.path), index);
      if (!vtt || vtt === "WEBVTT\n\n") continue;
      await Bun.write(output, vtt);
      run(
        `INSERT INTO subtitle_cache (file_id, track_index, path, source_mtime, bytes)
         VALUES (?,?,?,?,?)
         ON CONFLICT(file_id, track_index) DO UPDATE SET
           path = excluded.path, source_mtime = excluded.source_mtime, bytes = excluded.bytes,
           created_at = datetime('now')`,
        Number(row.id), index, output, sourceStamp(row), vtt.length,
      );
      written++;
    } catch (err) {
      log.warn("player", "subtitle extraction failed", {
        fileId: Number(row.id), trackIndex: index,
        message: err instanceof Error ? err.message : String(err),
      });
    }
  }

  return written;
}

/** Cached path for one embedded track, extracting it first when necessary. */
export async function cachedEmbeddedSubtitle(row: Row, trackIndex: number): Promise<string | null> {
  const cached = q<Row, [number, number]>(
    "SELECT path, source_mtime FROM subtitle_cache WHERE file_id = ? AND track_index = ?",
  ).get(Number(row.id), trackIndex);
  if (cached && Number(cached.source_mtime) === sourceStamp(row) && await pathIsFile(String(cached.path))) {
    return String(cached.path);
  }

  const embedded = parseEmbedded(row);
  if (!embedded[trackIndex]) return null;
  await mkdir(resolveSubtitleCacheDir(), { recursive: true });
  const vtt = await extractEmbeddedVtt(String(row.path), trackIndex);
  if (!vtt || vtt === "WEBVTT\n\n") return null;
  const output = cachedSubtitlePath(row, trackIndex);
  await Bun.write(output, vtt);
  run(
    `INSERT INTO subtitle_cache (file_id, track_index, path, source_mtime, bytes)
     VALUES (?,?,?,?,?)
     ON CONFLICT(file_id, track_index) DO UPDATE SET
       path = excluded.path, source_mtime = excluded.source_mtime, bytes = excluded.bytes,
       created_at = datetime('now')`,
    Number(row.id), trackIndex, output, sourceStamp(row), vtt.length,
  );
  return output;
}

export interface SidecarFile {
  label: string;
  language: string | null;
  path: string;
  ext: "vtt" | "srt";
}

/** Find subtitle files next to the video that belong to it, not its neighbours. */
export async function findSidecarSubtitles(row: Row): Promise<SidecarFile[]> {
  const videoPath = String(row.path ?? "");
  if (!videoPath) return [];
  const dir = dirname(videoPath);
  const base = basename(videoPath).replace(/\.[^.]+$/, "").toLowerCase();
  const entries = await readdir(dir).catch(() => [] as string[]);

  const all: Array<SidecarFile & { preferred: boolean }> = [];
  for (const name of entries) {
    const match = name.toLowerCase().match(/^(.+)\.(vtt|srt)$/);
    if (!match) continue;
    const label = match[1]!;
    const ext = match[2] as "vtt" | "srt";
    if (label === base) continue;

    const suffix = /(?:^|[.\s_-])([a-z]{2,3})$/.exec(label)?.[1] ?? null;
    const lower = label.toLowerCase();
    const belongs = lower === base
      || lower.startsWith(`${base}.`)
      || lower.startsWith(`${base} `)
      || lower.startsWith(`${base}-`)
      || base.startsWith(`${lower}.`);
    // Folder-level subtitles ("English", "Subtitle") are common; keep them
    // unless they clearly name a different episode.
    const namesOtherEpisode = /\bs\d{1,2}e\d{1,2}\b/i.test(label) && !belongs;

    if (namesOtherEpisode) continue;
    all.push({
      label,
      language: suffix,
      path: join(dir, name),
      ext,
      preferred: belongs,
    });
  }

  const preferred = all.filter((entry) => entry.preferred);
  const chosen = preferred.length ? preferred : all;

  // Prefer WebVTT when both .vtt and .srt exist for the same label.
  const byLabel = new Map<string, SidecarFile & { preferred: boolean }>();
  for (const entry of chosen) {
    const key = entry.label.toLowerCase();
    const existing = byLabel.get(key);
    if (!existing || (entry.ext === "vtt" && existing.ext === "srt")) byLabel.set(key, entry);
  }

  return [...byLabel.values()].map(({ preferred: _preferred, ...entry }) => entry);
}

/** Embedded + sidecar tracks, in a stable order for the player menu. */
export async function listSubtitleTracks(row: Row): Promise<SubtitleTrackInfo[]> {
  const embedded = parseEmbedded(row)
    .map((info, index): SubtitleTrackInfo & { codec: string | null } => ({
      track: `embedded-${index}`,
      kind: "embedded",
      language: info.language || null,
      title: info.title || info.language || `Embedded ${index + 1}`,
      isDefault: Boolean(info.isDefault),
      codec: info.codec,
    }))
    // Keep the original index in the track id; filtering here must not shift
    // the packet-based extraction index.
    .filter((info) => isTextSubtitle(info.codec))
    .map(({ codec: _codec, ...info }) => info);

  const sidecars = (await findSidecarSubtitles(row)).map(({ label, language, ext }): SubtitleTrackInfo => ({
    track: `sidecar-${label}`,
    kind: "sidecar",
    language,
    title: label,
    isDefault: false,
  }));

  return [...embedded, ...sidecars];
}
