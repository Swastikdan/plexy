/// Background playback-preparation worker.
///
/// FFmpeg runs as a child process so a codec or input failure only rejects
/// the current job. The worker and HTTP server remain available.
///
/// Protocol: one JSON object per line on stdin/stdout.
///   request  { id, op: "optimize", path, output, mode, videoCopy, audioCopy,
///              videoBitrate?, audioBitrate?, duration?, sourceSize? }
///   cancel   { id, op: "cancel" }              — preempt the running job
///   progress { id, type: "progress", progress, speed, etaSeconds, stage }
///   done     { id, type: "done", size }
///   cancelled{ id, type: "cancelled" }
///   error    { id, type: "error", error }
///
/// A `remux` copies packets with no encoder involved and is I/O-bound; only a
/// real re-encode gets CPU threads. Output is validated from its header
/// (duration + streams) instead of decoding the whole file again, which used
/// to double the wall-clock time of every preparation.
import { rename, stat, unlink } from "node:fs/promises";
import { statSync } from "node:fs";
import { spawn, type ChildProcess } from "node:child_process";
import { availableParallelism } from "node:os";
import { resolveFfmpeg, resolveFfprobe } from "./ffmpeg";

process.on("uncaughtException", (err) => {
  process.stderr.write(`optimizer-worker uncaughtException: ${err?.stack || err}\n`);
});

process.on("unhandledRejection", (err) => {
  process.stderr.write(`optimizer-worker unhandledRejection: ${(err as any)?.stack || err}\n`);
});

// Never leave an FFmpeg child encoding after the worker goes away.
for (const signal of ["SIGTERM", "SIGINT"] as const) {
  process.on(signal, () => {
    activeChild?.kill("SIGKILL");
    process.exit(0);
  });
}
process.on("exit", () => {
  try {
    activeChild?.kill("SIGKILL");
  } catch {
    /* already gone */
  }
});

interface OptimizeJob {
  id: string;
  op: "optimize";
  path: string;
  output: string;
  mode: "remux" | "transcode";
  videoCopy: boolean;
  audioCopy: boolean;
  /** 0-based index among the source's audio streams; omitted means the first. */
  audioIndex?: number;
  videoBitrate?: number;
  audioBitrate?: number;
  duration?: number | null;
  /** Source bytes; used to estimate progress when the probe had no duration. */
  sourceSize?: number | null;
}

interface ProgressUpdate {
  progress: number;
  speed: number | null;
  etaSeconds: number | null;
  stage: "prepare" | "verify";
}

/** Thrown when a playback request preempts this job. */
class CancelledError extends Error {
  constructor() {
    super("Preparation was preempted");
    this.name = "CancelledError";
  }
}

let cancelRequested = false;
let activeChild: ChildProcess | null = null;

function emit(message: object) {
  process.stdout.write(JSON.stringify(message) + "\n");
}

/**
 * Encode threads for a real re-encode. Remuxes ignore this (packet copies are
 * I/O-bound); a transcode should use the machine instead of one core, keeping
 * one core free so the UI and the HTTP server stay responsive.
 */
function encoderThreads(): number {
  const override = Number(Bun.env.PLEXY_ENCODE_THREADS);
  if (Number.isFinite(override) && override >= 1) return Math.min(16, Math.floor(override));
  const cores = availableParallelism?.() ?? 4;
  return Math.max(2, Math.min(8, cores - 1));
}

function parseClock(value: string): number {
  const match = value.match(/^(\d+):(\d+):(\d+(?:\.\d+)?)$/);
  if (!match) return 0;
  return Number(match[1]) * 3600 + Number(match[2]) * 60 + Number(match[3]);
}

/**
 * Duration straight from the container header. Uses ffprobe when the install
 * has it and falls back to parsing ffmpeg's banner, which the packaged build
 * always provides. Instant compared with decoding the whole file.
 */
function readDuration(ffmpeg: string, path: string): Promise<number | null> {
  const ffprobe = resolveFfprobe();
  const command = ffprobe
    ? {
        bin: ffprobe,
        args: ["-v", "error", "-show_entries", "format=duration", "-of", "default=nw=1:nk=1", path],
      }
    : { bin: ffmpeg, args: ["-hide_banner", "-nostdin", "-i", path] };

  return new Promise((resolve) => {
    const child = spawn(command.bin, command.args, { stdio: ["ignore", "pipe", "pipe"] });
    let text = "";
    const collect = (chunk: Buffer) => {
      if (text.length < 8_000) text += chunk.toString();
    };
    child.stdout!.on("data", collect);
    child.stderr!.on("data", collect);
    child.on("error", () => resolve(null));
    child.on("close", () => {
      const duration = text.match(/Duration:\s*(\d+:\d+:\d+(?:\.\d+)?)/);
      if (duration) return resolve(parseClock(duration[1]!));
      if (!ffprobe) return resolve(null);
      const number = text.match(/^\s*(\d+(?:\.\d+)?)\s*$/m);
      resolve(number ? Number(number[1]) : null);
    });
  });
}

/** Full decode check, only used when the container header has no duration. */
async function decodeVerify(ffmpeg: string, part: string, job: OptimizeJob): Promise<void> {
  await runFfmpeg(
    ffmpeg,
    [
      "-hide_banner", "-loglevel", "error", "-nostdin", "-xerror",
      "-i", part,
      "-map", "0:v:0", "-map", "0:a:0?",
      "-threads", String(encoderThreads()),
      "-progress", "pipe:1", "-nostats", "-f", "null", "-",
    ],
    job,
    "verify",
  );
}

async function convert(job: OptimizeJob): Promise<number> {
  const part = `${job.output}.part`;
  const ffmpeg = resolveFfmpeg();
  if (!ffmpeg) throw new Error("FFmpeg is not available on this machine");

  const remux = job.mode === "remux";
  const videoCopy = remux || job.videoCopy;
  const audioCopy = remux || job.audioCopy;
  const hardwareVideo = process.platform === "darwin" && !videoCopy;
  const threads = encoderThreads();

  const args = [
    "-hide_banner", "-loglevel", "error", "-nostdin", "-y",
    "-i", job.path,
    "-map", "0:v:0?",
    "-map", Number.isInteger(job.audioIndex) && Number(job.audioIndex) >= 0
      ? `0:a:${Number(job.audioIndex)}`
      : "0:a:0?",
  ];
  if (videoCopy) {
    args.push("-c:v", "copy");
  } else if (hardwareVideo) {
    args.push("-c:v", "h264_videotoolbox", "-q:v", "85", "-allow_sw", "0", "-pix_fmt", "yuv420p");
  } else {
    args.push("-c:v", "libx264", "-threads", String(threads), "-preset", "fast", "-pix_fmt", "yuv420p", "-crf", "16");
  }
  if (audioCopy) {
    args.push("-c:a", "copy");
  } else {
    args.push("-c:a", "aac", "-b:a", String(job.audioBitrate ?? 256_000));
  }
  args.push(
    "-sn", "-dn", "-map_metadata", "-1",
    "-movflags", "+faststart",
    "-progress", "pipe:1", "-nostats",
    "-f", "mp4", part,
  );

  try {
    try {
      await runFfmpeg(ffmpeg, args, job, "prepare");
    } catch (error) {
      if (error instanceof CancelledError || !hardwareVideo) throw error;
      // VideoToolbox may be unavailable on a headless Mac or for this input.
      // Fall back to bounded software encoding; validation failures never retry.
      process.stderr.write(`Hardware preparation unavailable; using software: ${error}\n`);
      const fallback = [...args];
      const codec = fallback.indexOf("-c:v");
      const audio = fallback.indexOf("-c:a");
      fallback.splice(codec, audio - codec, "-c:v", "libx264", "-threads", String(threads), "-preset", "fast", "-pix_fmt", "yuv420p", "-crf", "16");
      await runFfmpeg(ffmpeg, fallback, job, "prepare");
    }

    // Validate the output before publishing it as playable. Reading the header
    // catches a truncated mux in milliseconds; a full decode is only needed
    // when the source duration is unknown.
    const expected = Number(job.duration ?? 0);
    if (expected > 0) {
      const actual = await readDuration(ffmpeg, part);
      const tolerance = Math.max(1, expected * 0.01);
      if (actual != null) {
        if (actual < expected - tolerance) {
          throw new Error("Prepared file is shorter than the source; verification failed");
        }
      } else {
        await decodeVerify(ffmpeg, part, job);
      }
    }

    const info = await stat(part);
    if (!info.isFile() || info.size === 0) throw new Error("prepared file is empty");
    await rename(part, job.output);
    return info.size;
  } catch (err) {
    await unlink(part).catch(() => {});
    throw err;
  }
}

function runFfmpeg(
  ffmpeg: string,
  args: string[],
  job: OptimizeJob,
  stage: "prepare" | "verify" = "prepare",
  onUpdate?: (update: ProgressUpdate) => void,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(ffmpeg, args, { stdio: ["ignore", "pipe", "pipe"] });
    activeChild = child;
    let stderr = "";
    let stdout = "";
    let lastProgressAt = 0;
    let decodedSeconds = 0;
    let speed: number | null = null;
    let estimatedFraction = 0;
    let lastSizeCheck = 0;
    let settled = false;

    const fail = (error: Error) => {
      if (settled) return;
      settled = true;
      if (activeChild === child) activeChild = null;
      reject(error);
    };

    const report = (fraction: number) => {
      const clamped = Math.max(0, Math.min(0.99, fraction));
      const duration = Number(job.duration ?? 0);
      const etaSeconds = duration > 0 && speed && speed > 0
        ? Math.max(0, (duration - decodedSeconds) / speed)
        : null;
      emit({
        id: job.id,
        type: "progress",
        progress: clamped,
        speed: speed == null ? null : Math.round(speed * 100) / 100,
        etaSeconds: etaSeconds == null ? null : Math.round(etaSeconds),
        stage,
      });
      onUpdate?.({ progress: clamped, speed, etaSeconds, stage });
    };

    child.stdout!.on("data", (chunk: Buffer) => {
      stdout += chunk.toString();
      let index: number;
      while ((index = stdout.indexOf("\n")) >= 0) {
        const line = stdout.slice(0, index).trim();
        stdout = stdout.slice(index + 1);
        const [key, raw] = line.split("=", 2) as [string, string | undefined];
        if (key === "out_time_ms" || key === "out_time_us") {
          const micros = Number(raw);
          if (Number.isFinite(micros)) decodedSeconds = Math.max(decodedSeconds, micros / 1_000_000);
        } else if (key === "out_time") {
          const seconds = parseClock(raw ?? "");
          if (seconds > 0) decodedSeconds = Math.max(decodedSeconds, seconds);
        } else if (key === "speed") {
          const value = Number((raw ?? "").replace(/x$/, ""));
          if (Number.isFinite(value) && value > 0) speed = value;
        } else {
          continue;
        }

        const now = Date.now();
        if (now - lastProgressAt < 400) continue;
        lastProgressAt = now;

        const duration = Number(job.duration ?? 0);
        let fraction: number | null = duration > 0 ? decodedSeconds / duration : null;
        if (fraction == null) {
          // No probe duration: estimate from how much output has been written.
          if (now - lastSizeCheck > 500) {
            lastSizeCheck = now;
            try {
              const written = statSync(`${job.output}.part`).size;
              const total = Number(job.sourceSize ?? 0);
              if (total > 0) estimatedFraction = written / total;
            } catch { /* file not created yet */ }
          }
          fraction = estimatedFraction;
        }
        if (fraction != null) report(fraction);
      }
    });
    child.stderr!.on("data", (chunk: Buffer) => {
      if (stderr.length < 4_000) stderr += chunk.toString();
    });
    child.on("error", (err: Error) => fail(err));
    child.on("close", (code: number | null, signal: string | null) => {
      if (settled) return;
      if (cancelRequested) {
        fail(new CancelledError());
        return;
      }
      if (code === 0) {
        const expected = Number(job.duration ?? 0);
        if (stage === "verify" && expected > 0 && decodedSeconds > 0
          && decodedSeconds < expected - Math.max(1, expected * 0.01)) {
          fail(new Error("Prepared file is shorter than the source; verification failed"));
          return;
        }
        settled = true;
        if (activeChild === child) activeChild = null;
        resolve();
      } else {
        fail(new Error(stderr.trim() || `FFmpeg exited ${code ?? signal}`));
      }
    });
  });
}

let queue: Promise<void> = Promise.resolve();

function enqueue(job: OptimizeJob) {
  queue = queue
    .then(async () => {
      cancelRequested = false;
      try {
        const size = await convert(job);
        emit({ id: job.id, type: "done", size });
      } catch (err) {
        if (err instanceof CancelledError || cancelRequested) {
          emit({ id: job.id, type: "cancelled" });
          return;
        }
        emit({
          id: job.id,
          type: "error",
          error: err instanceof Error ? err.message : String(err),
        });
      }
    })
    .catch((err) => {
      emit({
        id: job.id,
        type: "error",
        error: err instanceof Error ? err.message : String(err),
      });
    });
}

const decoder = new TextDecoder();
let buffer = "";

void (async () => {
  try {
    for await (const chunk of Bun.stdin.stream()) {
      buffer += decoder.decode(chunk as Uint8Array);
      let index: number;
      while ((index = buffer.indexOf("\n")) >= 0) {
        const line = buffer.slice(0, index).trim();
        buffer = buffer.slice(index + 1);
        if (!line) continue;
        try {
          const message = JSON.parse(line) as Record<string, unknown> & { id?: string; op?: string };
          if (message.op === "optimize" && typeof message.path === "string" && typeof message.output === "string") {
            enqueue(message as unknown as OptimizeJob);
          } else if (message.op === "cancel") {
            cancelRequested = true;
            const running = activeChild as ChildProcess | null;
            running?.kill("SIGKILL");
          } else {
            emit({ id: message.id ?? "unknown", type: "error", error: "unsupported job" });
          }
        } catch {
          emit({ id: "malformed", type: "error", error: "unparseable job" });
        }
      }
    }
  } catch (err) {
    process.stderr.write(`optimizer-worker stdin stream error: ${err}\n`);
  }
})();
