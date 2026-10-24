/// Background playback-preparation worker.
///
/// FFmpeg runs as a child process so a codec or input failure only rejects
/// the current job. The worker and HTTP server remain available.
///
/// Protocol: one JSON object per line on stdin/stdout.
///   request  { id, op: "optimize", path, output, mode, videoCopy, audioCopy,
///              videoBitrate?, audioBitrate?, duration? }
///   progress { id, type: "progress", progress }
///   done     { id, type: "done", size }
///   error    { id, type: "error", error }
import { rename, unlink } from "node:fs/promises";
import { spawn } from "node:child_process";
import { resolveFfmpeg } from "./ffmpeg";

process.on("uncaughtException", (err) => {
  process.stderr.write(`optimizer-worker uncaughtException: ${err?.stack || err}\n`);
});

process.on("unhandledRejection", (err) => {
  process.stderr.write(`optimizer-worker unhandledRejection: ${(err as any)?.stack || err}\n`);
});

interface OptimizeJob {
  id: string;
  op: "optimize";
  path: string;
  output: string;
  mode: "remux" | "transcode";
  videoCopy: boolean;
  audioCopy: boolean;
  videoBitrate?: number;
  audioBitrate?: number;
  duration?: number | null;
}

function emit(message: object) {
  process.stdout.write(JSON.stringify(message) + "\n");
}

async function convert(job: OptimizeJob): Promise<number> {
  const part = `${job.output}.part`;
  const ffmpeg = resolveFfmpeg();
  if (!ffmpeg) throw new Error("FFmpeg is not available on this machine");

  const args = [
    "-hide_banner", "-loglevel", "error", "-nostdin", "-y",
    "-i", job.path,
    "-map", "0:v:0?", "-map", "0:a:0?",
  ];
  if (job.mode === "remux" || job.videoCopy) {
    args.push("-c:v", "copy");
  } else {
    args.push(
      "-c:v", "libx264",
      "-preset", "veryfast",
      "-pix_fmt", "yuv420p",
      "-b:v", String(job.videoBitrate ?? 8_000_000),
    );
  }
  if (job.mode === "remux" || job.audioCopy) {
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
    await runFfmpeg(ffmpeg, args, job);
    await rename(part, job.output);
    return Bun.file(job.output).size;
  } catch (err) {
    await unlink(part).catch(() => {});
    throw err;
  }
}

function runFfmpeg(ffmpeg: string, args: string[], job: OptimizeJob): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(ffmpeg, args, { stdio: ["ignore", "pipe", "pipe"] });
    let stderr = "";
    let stdout = "";
    let lastProgressAt = 0;
    let settled = false;

    const fail = (error: Error) => {
      if (settled) return;
      settled = true;
      reject(error);
    };

    child.stdout!.on("data", (chunk: Buffer) => {
      stdout += chunk.toString();
      let index: number;
      while ((index = stdout.indexOf("\n")) >= 0) {
        const line = stdout.slice(0, index).trim();
        stdout = stdout.slice(index + 1);
        if (!line.startsWith("out_time_ms=")) continue;
        const duration = Number(job.duration ?? 0);
        if (duration <= 0) continue;
        const fraction = Math.max(0, Math.min(0.99, Number(line.slice(12)) / 1_000_000 / duration));
        const now = Date.now();
        if (now - lastProgressAt >= 400) {
          lastProgressAt = now;
          emit({ id: job.id, type: "progress", progress: fraction });
        }
      }
    });
    child.stderr!.on("data", (chunk: Buffer) => {
      if (stderr.length < 4_000) stderr += chunk.toString();
    });
    child.on("error", (err: Error) => fail(err));
    child.on("close", (code: number | null, signal: string | null) => {
      if (settled) return;
      if (code === 0) {
        settled = true;
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
      try {
        const size = await convert(job);
        emit({ id: job.id, type: "done", size });
      } catch (err) {
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
          const job = JSON.parse(line) as OptimizeJob;
          if (job.op === "optimize" && typeof job.path === "string" && typeof job.output === "string") {
            enqueue(job);
          } else {
            emit({ id: job.id ?? "unknown", type: "error", error: "unsupported job" });
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
