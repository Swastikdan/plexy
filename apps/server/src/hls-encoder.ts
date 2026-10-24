/// H.264 encoder planning for adaptive stream preparation.
///
/// Adaptive HLS preparation is the most expensive media job in Plexy. Software
/// x264 is dependable but saturates every core; modern Macs (and machines with
/// NVIDIA/AMD GPUs) expose a hardware H.264 encoder that does the same work for
/// a fraction of the CPU.
///
/// We deliberately mix encoders: the largest rendition goes to the hardware
/// encoder, while the smaller renditions stay on a fast x264 preset. Hardware
/// encode sessions serialize, so running the cheap lower renditions on the CPU
/// in parallel keeps total wall-clock time down without loading every core.
import { spawn } from "node:child_process";

export type H264Encoder = "h264_videotoolbox" | "h264_nvenc" | "h264_amf" | "libx264";

export interface VideoEncoderOptions {
  /** x264 preset used for software renditions. */
  softwarePreset: string;
  /** Per-encoder x264 thread count; ignored by hardware encoders. */
  softwareThreads: number;
}

/** Encoders worth trying, in preference order, for each platform. */
const PLATFORM_ENCODERS: Partial<Record<NodeJS.Platform, H264Encoder[]>> = {
  darwin: ["h264_videotoolbox"],
  win32: ["h264_nvenc", "h264_amf"],
  // VAAPI/QSV need an explicit hardware device and upload filters; NVENC works
  // with ordinary software frames, so it is the only safe automatic choice.
  linux: ["h264_nvenc"],
};

/**
 * Pick a hardware encoder from the list FFmpeg reports. Pure so the platform
 * rules are testable without touching a GPU.
 */
export function chooseHardwareEncoder(
  available: ReadonlySet<string>,
  platform: NodeJS.Platform = process.platform,
): H264Encoder | null {
  for (const candidate of PLATFORM_ENCODERS[platform] ?? []) {
    if (available.has(candidate)) return candidate;
  }
  return null;
}

/**
 * Build the per-output encoder arguments. FFmpeg's stream specifiers let a
 * single command use hardware for one rendition and x264 for the others.
 */
export function videoEncoderArgs(
  index: number,
  encoder: H264Encoder,
  options: VideoEncoderOptions,
): string[] {
  const stream = `:v:${index}`;
  if (encoder === "h264_videotoolbox") {
    return [
      `-c${stream}`, "h264_videotoolbox",
      `-prio_speed${stream}`, "1",
      `-allow_sw${stream}`, "0",
      `-pix_fmt${stream}`, "yuv420p",
    ];
  }
  if (encoder === "h264_nvenc") {
    return [
      `-c${stream}`, "h264_nvenc",
      `-preset${stream}`, "p4",
      `-pix_fmt${stream}`, "yuv420p",
    ];
  }
  if (encoder === "h264_amf") {
    return [
      `-c${stream}`, "h264_amf",
      `-quality${stream}`, "speed",
      `-pix_fmt${stream}`, "yuv420p",
    ];
  }
  return [
    `-c${stream}`, "libx264",
    `-preset${stream}`, options.softwarePreset,
    `-threads${stream}`, String(options.softwareThreads),
    `-pix_fmt${stream}`, "yuv420p",
  ];
}

interface ProcessResult {
  code: number | null;
  stdout: string;
  stderr: string;
}

function run(ffmpeg: string, args: string[], timeoutMs: number): Promise<ProcessResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(ffmpeg, args, { stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    let settled = false;
    const finish = (result: ProcessResult) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(result);
    };
    const fail = (error: Error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(error);
    };
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      fail(new Error("encoder probe timed out"));
    }, timeoutMs);
    child.stdout?.on("data", (chunk: Buffer) => { stdout += chunk.toString(); });
    child.stderr?.on("data", (chunk: Buffer) => { stderr = (stderr + chunk.toString()).slice(-4_000); });
    child.once("error", fail);
    child.once("close", (code: number | null) => finish({ code, stdout, stderr }));
  });
}

const detected = new Map<string, Promise<H264Encoder | null>>();

/**
 * Find an encoder that FFmpeg advertises *and* can actually initialize. A
 * listed NVENC encoder is useless without a driver, so a one-frame black encode
 * verifies the whole path before a multi-hour title is committed to it.
 */
export function detectHardwareEncoder(ffmpeg: string): Promise<H264Encoder | null> {
  const cached = detected.get(ffmpeg);
  if (cached) return cached;
  const pending = probeHardwareEncoder(ffmpeg).catch(() => null);
  detected.set(ffmpeg, pending);
  return pending;
}

async function probeHardwareEncoder(ffmpeg: string): Promise<H264Encoder | null> {
  const listing = await run(ffmpeg, ["-hide_banner", "-encoders"], 5_000);
  if (listing.code !== 0) return null;

  const available = new Set<string>();
  for (const match of listing.stdout.matchAll(/^\s*V\S*\s+(\S+)/gm)) {
    available.add(match[1]!);
  }
  const candidate = chooseHardwareEncoder(available);
  if (!candidate) return null;

  const args = [
    "-hide_banner", "-loglevel", "error",
    "-f", "lavfi", "-i", "color=c=black:s=256x144:r=1",
    "-frames:v", "1", "-an",
    ...videoEncoderArgs(0, candidate, { softwarePreset: "superfast", softwareThreads: 1 }),
    "-f", "null", "-",
  ];
  const check = await run(ffmpeg, args, 8_000);
  return check.code === 0 ? candidate : null;
}

export function resetHardwareEncoderCache(): void {
  detected.clear();
}
