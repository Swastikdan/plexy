/// Metadata probe worker (PRD 2, 6, 5.6).
///
/// Probing reads container and packet metadata only; it does not need native
/// codec bindings. Keeping those bindings out of the server bundle avoids
/// platform-specific optional dependencies and native crash paths.
///
/// Protocol: one JSON object per line.
///   request  { id, op: "probe", path, timeoutMs? }
///   response { id, ok, result? , error? }
import { ALL_FORMATS, BlobSource, Input, type InputVideoTrack, type InputAudioTrack } from "mediabunny";
import { probeMatroskaSubtitles } from "./mkv-subtitles";

interface ProbeRequest { id: string; op: "probe"; path: string; timeoutMs?: number }

interface ProbeResult {
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

/**
 * Probe one file. Mediabunny reads container metadata without decoding, so a
 * 60 s per-file timeout (PRD 5.6) rarely fires; it protects against stalls on
 * unreadable network drives.
 */
async function probeFile(path: string): Promise<ProbeResult> {
  const file = Bun.file(path);
  if (!(await file.exists())) throw new Error("file not found");
  const input = new Input({ source: new BlobSource(file), formats: ALL_FORMATS });
  try {
    const format = await input.getFormat();
    const duration = await input.getDurationFromMetadata();

    const videoTrack = await input.getPrimaryVideoTrack();
    // One stats pass per file: it is the most expensive probe call (it walks
    // the packets), and both bitrate and frame rate come from it.
    const stats = videoTrack
      ? await videoTrack.computePacketStats().catch(() => null)
      : null;
    const video = videoTrack ? await describeVideo(videoTrack, stats) : null;

    const audio: ProbeResult["audio"] = [];
    for (const track of await input.getAudioTracks()) {
      audio.push(await describeAudio(track));
    }

    // Mediabunny does not expose subtitle *input* tracks (only video/audio),
    // so embedded subtitles are read from the Matroska container directly.
    // Keep the generic loop as a fallback for formats mediabunny may support
    // in the future.
    const subtitles: ProbeResult["subtitles"] = [];
    for (const track of await input.getTracks()) {
      if (track.type !== "subtitle") continue;
      subtitles.push({
        codec: await track.getCodec(),
        language: track.languageCode || "",
        title: await track.getName(),
        isDefault: (await track.getDisposition()).default,
      });
    }
    if (!subtitles.length) {
      const matroska = await probeMatroskaSubtitles(path).catch(() => null);
      if (matroska) {
        for (const track of matroska) {
          subtitles.push({
            codec: track.codec,
            language: track.language || "",
            title: track.title,
            isDefault: track.isDefault,
          });
        }
      }
    }

    return {
      container: format.name,
      duration,
      bitrate: stats ? stats.averageBitrate : null,
      video,
      audio,
      subtitles,
    };
  } finally {
    input.dispose();
  }
}

async function describeVideo(
  track: InputVideoTrack,
  stats: Awaited<ReturnType<InputVideoTrack["computePacketStats"]>> | null,
): Promise<ProbeResult["video"]> {
  const codec = await track.getCodec();
  // Codec parameter strings carry profiles like "h264:6" (High profile) where
  // supported; report them verbatim as a display hint.
  const profile = await track.getCodecParameterString();
  const metadata = await (track as unknown as { getMetadataTags?: () => Promise<{ colorSpace?: string }> }).getMetadataTags?.().catch(() => null);
  return {
    codec,
    profile,
    width: await track.getDisplayWidth(),
    height: await track.getDisplayHeight(),
    fps: stats ? stats.averagePacketRate : null,
    hdr: classifyHdr(metadata?.colorSpace ?? null),
  };
}

async function describeAudio(track: InputAudioTrack): Promise<ProbeResult["audio"][number]> {
  return {
    codec: (await track.getCodec()) ?? "unknown",
    channels: track.numberOfChannels,
    language: track.languageCode || "",
    isDefault: (await track.getDisposition()).default,
  };
}

function classifyHdr(colorSpace: string | null): string | null {
  if (!colorSpace) return null;
  if (colorSpace.includes("pq")) return "HDR10";
  if (colorSpace.includes("hlg")) return "HLG";
  if (colorSpace.includes("bt2020")) return "Wide color";
  return null;
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
