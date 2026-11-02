/// Metadata probe worker (PRD 2, 6, 5.6).
///
/// Probing reads container and packet metadata via ffprobe/ffmpeg in child processes.
///
/// Protocol: one JSON object per line.
///   request  { id, op: "probe", path, timeoutMs? }
///   response { id, ok, result? , error? }
import { spawn } from "node:child_process";
import { resolveFfmpeg, resolveFfprobe } from "./ffmpeg";
import { probeMatroskaSubtitles } from "./mkv-subtitles";

interface ProbeRequest { id: string; op: "probe"; path: string; timeoutMs?: number }

export interface ProbeResult {
  container: string | null;
  duration: number | null; // seconds
  bitrate: number | null;  // bits per second, video track average
  video: {
    codec: string | null;
    profile: string | null;
    width: number;
    height: number;
    fps: number | null;
    hdr: string | null;
  } | null;
  audio: Array<{ codec: string; channels: number; language: string; isDefault: boolean }>;
  subtitles: Array<{ codec: string | null; language: string; title: string | null; isDefault: boolean }>;
}

function classifyHdr(colorDesc: string | null): string | null {
  if (!colorDesc) return null;
  const lower = colorDesc.toLowerCase();
  if (lower.includes("smpte2084") || lower.includes("pq") || lower.includes("hdr10")) return "HDR10";
  if (lower.includes("arib-std-b67") || lower.includes("hlg")) return "HLG";
  if (lower.includes("bt2020")) return "Wide color";
  return null;
}

function parseFfprobeJson(data: any): ProbeResult {
  const format = data.format || {};
  const streams = Array.isArray(data.streams) ? data.streams : [];

  const container = format.format_name ? format.format_name.split(",")[0].trim() : null;
  const duration = format.duration ? parseFloat(format.duration) : null;
  let bitrate = format.bit_rate ? parseInt(format.bit_rate, 10) : null;

  let video: ProbeResult["video"] = null;
  const audio: ProbeResult["audio"] = [];
  const subtitles: ProbeResult["subtitles"] = [];

  for (const s of streams) {
    if (s.codec_type === "video" && !video) {
      let fps: number | null = null;
      if (s.r_frame_rate) {
        const [num, den] = s.r_frame_rate.split("/").map(Number);
        if (den && num) fps = Math.round((num / den) * 100) / 100;
      }
      const cs = `${s.color_space || ""} ${s.color_transfer || ""} ${s.color_primaries || ""}`.trim();
      const hdr = classifyHdr(cs || null);
      if (!bitrate && s.bit_rate) {
        bitrate = parseInt(s.bit_rate, 10);
      }

      video = {
        codec: s.codec_name ? s.codec_name.toLowerCase() : null,
        profile: s.profile || null,
        width: s.width || 0,
        height: s.height || 0,
        fps,
        hdr,
      };
    } else if (s.codec_type === "audio") {
      audio.push({
        codec: (s.codec_name || "unknown").toLowerCase(),
        channels: s.channels || 2,
        language: s.tags?.language || "",
        isDefault: s.disposition?.default === 1,
      });
    } else if (s.codec_type === "subtitle") {
      subtitles.push({
        codec: s.codec_name ? s.codec_name.toLowerCase() : null,
        language: s.tags?.language || "",
        title: s.tags?.title || null,
        isDefault: s.disposition?.default === 1,
      });
    }
  }

  return { container, duration, bitrate, video, audio, subtitles };
}

function parseFfmpegStderr(stderr: string): ProbeResult {
  let container: string | null = null;
  let duration: number | null = null;
  let bitrate: number | null = null;
  let video: ProbeResult["video"] = null;
  const audio: ProbeResult["audio"] = [];
  const subtitles: ProbeResult["subtitles"] = [];

  const inputMatch = stderr.match(/Input #0,\s*([^,]+)/);
  if (inputMatch) container = inputMatch[1].trim();

  const durationMatch = stderr.match(/Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)/);
  if (durationMatch) {
    const h = parseInt(durationMatch[1], 10);
    const m = parseInt(durationMatch[2], 10);
    const s = parseFloat(durationMatch[3]);
    duration = h * 3600 + m * 60 + s;
  }

  const bitrateMatch = stderr.match(/bitrate:\s*(\d+)\s*kb\/s/);
  if (bitrateMatch) {
    bitrate = parseInt(bitrateMatch[1], 10) * 1000;
  }

  const streamRegex = /Stream #0:(\d+)(?:\[0x[0-9a-fA-F]+\])?(?:\(([^)]+)\))?:\s*(Video|Audio|Subtitle):\s*([^\n\r]+)/g;
  let sm: RegExpExecArray | null;
  while ((sm = streamRegex.exec(stderr)) !== null) {
    const lang = sm[2] || "";
    const type = sm[3];
    const rest = sm[4];
    const isDefault = rest.includes("(default)");

    if (type === "Video" && !video) {
      const parts = rest.split(",").map((s) => s.trim());
      const codecPart = parts[0] || "";
      const codecMatch = codecPart.match(/^([^\s(]+)(?:\s*\(([^)]+)\))?/);
      const codec = codecMatch ? codecMatch[1].toLowerCase() : null;
      const profile = codecMatch && codecMatch[2] ? codecMatch[2] : null;

      let width = 0;
      let height = 0;
      for (const p of parts) {
        const dimMatch = p.match(/\b(\d{2,5})x(\d{2,5})\b/);
        if (dimMatch) {
          width = parseInt(dimMatch[1], 10);
          height = parseInt(dimMatch[2], 10);
          break;
        }
      }

      let fps: number | null = null;
      for (const p of parts) {
        const fpsMatch = p.match(/([\d.]+)\s*fps/);
        if (fpsMatch) {
          fps = parseFloat(fpsMatch[1]);
          break;
        }
      }

      video = { codec, profile, width, height, fps, hdr: classifyHdr(rest) };
    } else if (type === "Audio") {
      const parts = rest.split(",").map((s) => s.trim());
      const codecPart = parts[0] || "";
      const codec = codecPart.split(" ")[0].toLowerCase();
      let channels = 2;
      if (rest.includes("stereo")) channels = 2;
      else if (rest.includes("mono")) channels = 1;
      else if (rest.includes("5.1")) channels = 6;
      else if (rest.includes("7.1")) channels = 8;
      else {
        const chMatch = rest.match(/(\d+)\s*channels/);
        if (chMatch) channels = parseInt(chMatch[1], 10);
      }
      audio.push({ codec, channels, language: lang, isDefault });
    } else if (type === "Subtitle") {
      const parts = rest.split(",").map((s) => s.trim());
      const codec = parts[0].split(" ")[0].toLowerCase();
      subtitles.push({ codec, language: lang, title: null, isDefault });
    }
  }

  return { container, duration, bitrate, video, audio, subtitles };
}

async function probeWithFfprobe(ffprobe: string, path: string): Promise<ProbeResult> {
  return new Promise((resolve, reject) => {
    const proc = spawn(ffprobe, [
      "-v", "quiet",
      "-print_format", "json",
      "-show_format",
      "-show_streams",
      path,
    ], { stdio: ["ignore", "pipe", "ignore"] });

    let stdout = "";
    proc.stdout.on("data", (chunk: Buffer) => { stdout += chunk.toString(); });
    proc.on("close", (code: number | null) => {
      if (code === 0 && stdout) {
        try {
          resolve(parseFfprobeJson(JSON.parse(stdout)));
        } catch (err) {
          reject(err);
        }
      } else {
        reject(new Error(`ffprobe failed with exit code ${code}`));
      }
    });
    proc.on("error", reject);
  });
}

async function probeWithFfmpeg(ffmpeg: string, path: string): Promise<ProbeResult> {
  return new Promise((resolve, reject) => {
    const proc = spawn(ffmpeg, [
      "-hide_banner",
      "-i", path,
    ], { stdio: ["ignore", "ignore", "pipe"] });

    let stderr = "";
    proc.stderr.on("data", (chunk: Buffer) => { stderr += chunk.toString(); });
    proc.on("close", () => {
      try {
        const result = parseFfmpegStderr(stderr);
        resolve(result);
      } catch (err) {
        reject(err);
      }
    });
    proc.on("error", reject);
  });
}

/**
 * Probe one file using ffprobe or ffmpeg.
 */
export async function probeFile(path: string): Promise<ProbeResult> {
  const file = Bun.file(path);
  if (!(await file.exists())) throw new Error("file not found");

  const ffprobe = resolveFfprobe();
  if (ffprobe) {
    try {
      const res = await probeWithFfprobe(ffprobe, path);
      if (res.video || res.audio.length > 0) return res;
    } catch {
      // Fall through to ffmpeg probe
    }
  }

  const ffmpeg = resolveFfmpeg();
  if (ffmpeg) {
    const res = await probeWithFfmpeg(ffmpeg, path);
    if (!res.subtitles.length && res.container?.includes("matroska")) {
      const matroska = await probeMatroskaSubtitles(path).catch(() => null);
      if (matroska) {
        for (const track of matroska) {
          res.subtitles.push({
            codec: track.codec,
            language: track.language || "",
            title: track.title,
            isDefault: track.isDefault,
          });
        }
      }
    }
    return res;
  }

  throw new Error("Neither ffprobe nor ffmpeg is available for probing");
}

// --- request loop ------------------------------------------------------------

// The parent bounds how many probes it sends, but the worker also enforces its
// own limit so a runaway caller cannot exhaust file descriptors. Keep in step
// with `probeConcurrency` in config (passed through the environment).
const CONCURRENCY = Math.max(1, Math.min(16, Number(Bun.env.PLEXY_PROBE_CONCURRENCY) || 4));
const queue: ProbeRequest[] = [];
let running = 0;

function respond(id: string, ok: boolean, payload: { result?: unknown; error?: string }) {
  process.stdout.write(JSON.stringify({ id, ok, ...payload }) + "\n");
}

async function handleNext() {
  while (running < CONCURRENCY && queue.length > 0) {
    const req = queue.shift()!;
    running++;
    void (async () => {
      const timer = setTimeout(
        () => respond(req.id, false, { error: `probe timed out after ${req.timeoutMs ?? 60_000} ms` }),
        req.timeoutMs ?? 60_000,
      );
      try {
        const result = await probeFile(req.path);
        clearTimeout(timer);
        respond(req.id, true, { result });
      } catch (err) {
        clearTimeout(timer);
        respond(req.id, false, { error: err instanceof Error ? err.message : String(err) });
      } finally {
        running--;
        handleNext();
      }
    })();
  }
}

const decoder = new TextDecoder();
let buffer = "";
void (async () => {
  for await (const chunk of Bun.stdin.stream()) {
    buffer += decoder.decode(chunk as Uint8Array);
    let idx: number;
    while ((idx = buffer.indexOf("\n")) >= 0) {
      const line = buffer.slice(0, idx).trim();
      buffer = buffer.slice(idx + 1);
      if (!line) continue;
      try {
        const req = JSON.parse(line) as ProbeRequest;
        if (req.op === "probe" && typeof req.path === "string" && /^(\/|\.{1,2}\/|~)/.test(req.path) && !req.path.includes("\0")) {
          queue.push(req);
          handleNext();
        } else {
          respond(req.id, false, { error: "unsupported op or path" });
        }
      } catch {
        respond("malformed", false, { error: "unparseable request line" });
      }
    }
  }
})();
