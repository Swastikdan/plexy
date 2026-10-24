/// Background playback-preparation worker.
///
/// Runs in its own child process because the native codec bindings used for
/// full transcodes can crash the process (segfault). A crash only loses the
/// current job; the server records a failure and respawns on the next one.
///
/// Protocol: one JSON object per line on stdin/stdout.
///   request  { id, op: "optimize", path, output, mode, videoCopy, audioCopy,
///              videoBitrate?, audioBitrate?, duration? }
///   progress { id, type: "progress", progress }
///   done     { id, type: "done", size }
///   error    { id, type: "error", error }
import { rename, unlink } from "node:fs/promises";
import {
  ALL_FORMATS, BlobSource, Conversion, FilePathTarget, Input, Mp4OutputFormat, Output,
  type InputAudioTrack, type InputVideoTrack,
} from "mediabunny";
import { registerMediabunnyServer } from "@mediabunny/server";

try {
  registerMediabunnyServer();
} catch {
  // Pure-TS remux still works; only transcode jobs will fail honestly.
}

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

function estimatePacketCount(
  type: "video" | "audio",
  copy: boolean,
  duration: number,
  inputTrack: InputVideoTrack | InputAudioTrack | null,
  stats: Awaited<ReturnType<InputVideoTrack["computePacketStats"]>> | null,
): number {
  if (copy && stats) return Math.ceil(stats.packetCount * 1.01) + 32;

  if (type === "video") {
    const rate = stats?.averagePacketRate && stats.averagePacketRate > 0
      ? stats.averagePacketRate
      : 30;
    return Math.ceil(duration * Math.max(rate, 24)) + 300;
  }
  // AAC frames are 1024 samples at 48 kHz; reserve a little extra for priming.
  return Math.ceil((duration * 48_000) / 1024) + 300;
}

async function convert(job: OptimizeJob): Promise<number> {
  const part = `${job.output}.part`;
  const input = new Input({ source: new BlobSource(Bun.file(job.path)), formats: ALL_FORMATS });

  try {
    const output = new Output({
      // 'reserve' writes the moov index at the front of a normal MP4 without
      // keeping the media in memory (unlike 'in-memory'). That is what makes
      // instant first-frame playback and byte-range seeking possible.
      format: new Mp4OutputFormat({ fastStart: "reserve" }),
      target: new FilePathTarget(part),
    });

    const conversion = await Conversion.init({
      input,
      output,
      tracks: "primary",
      showWarnings: false,
      ...(job.mode === "transcode"
        ? {
            ...(job.videoCopy ? {} : {
              video: { codec: "avc" as const, bitrate: job.videoBitrate ?? 8_000_000 },
            }),
            ...(job.audioCopy ? {} : {
              audio: { codec: "aac" as const, bitrate: job.audioBitrate ?? 256_000 },
            }),
          }
        : {}),
    });

    if (!conversion.isValid) {
      throw new Error(`no usable tracks (${conversion.discardedTracks.map((t) => t.reason).join(", ")})`);
    }

    const duration = job.duration
      ?? await input.getDurationFromMetadata()
      ?? 0;

    // 'reserve' needs a maximum packet count for every track before writing.
    const used = new Map<string, number>();
    for (const outTrack of conversion.output.tracks) {
      const seen = used.get(outTrack.type) ?? 0;
      used.set(outTrack.type, seen + 1);
      const inputs = conversion.utilizedTracks.filter((track) => track.type === outTrack.type);
      const inputTrack = inputs[seen] ?? inputs[0] ?? null;
      if (!inputTrack) continue;

      const copy = job.mode === "remux"
        || (outTrack.type === "video" ? job.videoCopy : job.audioCopy);

      let stats = null;
      try {
        stats = await inputTrack.computePacketStats();
      } catch { /* estimate below */ }

      const count = estimatePacketCount(
        outTrack.type === "video" ? "video" : "audio",
        copy,
        duration,
        inputTrack as InputVideoTrack | InputAudioTrack,
        stats,
      );
      outTrack.metadata.maximumPacketCount = Math.max(1, count);
    }

    let lastProgressAt = 0;
    conversion.onProgress = (progress) => {
      const now = Date.now();
      if (now - lastProgressAt < 400 && progress < 1) return;
      lastProgressAt = now;
      emit({ id: job.id, type: "progress", progress });
    };

    await conversion.execute();
    await rename(part, job.output);
    return Bun.file(job.output).size;
  } catch (err) {
    await unlink(part).catch(() => {});
    throw err;
  } finally {
    input.dispose();
  }
}

let queue: Promise<void> = Promise.resolve();

function enqueue(job: OptimizeJob) {
  queue = queue.then(async () => {
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
  });
}

const decoder = new TextDecoder();
let buffer = "";

void (async () => {
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
})();
