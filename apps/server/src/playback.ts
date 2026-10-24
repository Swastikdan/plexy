/// Playability classification and streaming (PRD 5.6, 5.8).
///
/// Scanner probe facts give a *likely* path; the browser's reported codec
/// capability refines it right before playback. Four outcomes:
/// - `direct`      — browser can decode, container is streamable, serve bytes.
/// - `remux`       — codecs are decodable but the container is not (MKV with
///                   H.264+AAC); copy packets into fragmented MP4.
/// - `transcode`   — codecs themselves are unsupported; re-encode on demand.
/// - `unsupported` — none of the above is reliable; never claim it will play.

export type PlayPath = "direct" | "remux" | "transcode" | "unsupported";

export interface BrowserCaps {
  videoCodecs: string[];   // e.g. ["avc1", "h264", "hevc", "vp9", "av1"]
  audioCodecs: string[];   // e.g. ["aac", "mp3", "flac", "opus", "ac3", "ec3", "dts"]
}

/** Conservative codec tables when a browser cannot report capabilities. */
const CONSERVATIVE_VIDEO = new Set(["h264", "avc", "avc1", "vp8", "vp9"]);
const CONSERVATIVE_AUDIO = new Set(["aac", "mp3", "opus", "vorbis", "flac"]);

/** MKV/AVI/TS cannot be served as-is; MP4/WebM/mov(mostly) can. */
const STREAMABLE_CONTAINERS = new Set(["mp4", "m4v", "webm", "mov", "mp4f"]);

const CODEC_ALIASES: Record<string, string> = {
  aac: "aac", mp4a: "aac", mp3: "mp3", opus: "opus", vorbis: "vorbis",
  flac: "flac", ac3: "ac3", ac_3: "ac3", eac3: "ec3", e_ac3: "ec3", ec3: "ec3",
  dts: "dts", "dts-hd": "dts", truehd: "truehd", pcm: "pcm", alac: "alac",
  h264: "h264", avc: "h264", avc1: "h264", hevc: "hevc", h265: "hevc",
  vp8: "vp8", vp9: "vp9", av01: "av1", av1: "av1", theora: "theora",
};

function canonical(codec: string | null | undefined): string | null {
  if (!codec) return null;
  const key = codec.toLowerCase().replace(/[^a-z0-9-]/g, "");
  if (key.startsWith("avc1") || key.startsWith("h264")) return "h264";
  if (key.startsWith("hevc") || key.startsWith("h265")) return "hevc";
  if (key.startsWith("av01") || key.startsWith("av1")) return "av1";
  if (key.startsWith("mp4a")) return "aac";
  if (key.startsWith("ec-3") || key.startsWith("ec3") || key.startsWith("eac3")) return "ec3";
  if (key.startsWith("ac-3") || key.startsWith("ac3")) return "ac3";
  return CODEC_ALIASES[key] ?? key;
}

function setOf(caps: BrowserCaps | null, kind: "video" | "audio"): Set<string> {
  if (!caps) return kind === "video" ? CONSERVATIVE_VIDEO : CONSERVATIVE_AUDIO;
  const reported = kind === "video" ? caps.videoCodecs : caps.audioCodecs;
  return new Set(reported.map((c) => canonical(c) ?? c.toLowerCase()));
}

export interface FileFacts {
  container: string | null;
  videoCodec: string | null;
  audioJson: string | null;
  subtitlesJson: string | null;
}

/**
 * Classify before playback, refining probe facts with the browser's report.
 * Reason strings are written for people, shown in the player status chip.
 */
export function classifyPlayability(
  facts: FileFacts,
  caps: BrowserCaps | null,
): { path: PlayPath; reason: string } {
  const container = (facts.container ?? "").toLowerCase().replace(/[^a-z0-9]/g, "");
  const video = canonical(facts.videoCodec);
  const audioTracks: Array<{ codec: string }> = facts.audioJson
    ? JSON.parse(facts.audioJson) : [];
  const audio = audioTracks.map((t) => canonical(t.codec));

  const videoOk = video !== null && setOf(caps, "video").has(video);
  const hasAudio = audio.length > 0;
  const primaryAudio = hasAudio ? audio[0]! : null;
  const audioWouldWork = primaryAudio !== null && setOf(caps, "audio").has(primaryAudio);

  if (!video) return { path: "unsupported", reason: "No video track was found in this file" };
  if (!videoOk) {
    const label = video === "hevc" ? "HEVC/H.265" : video === "av1" ? "AV1" : video.toUpperCase();
    return { path: "transcode", reason: `Your browser doesn't support ${label} video, so Plexy will convert it while playing` };
  }
  if (hasAudio && !audioWouldWork) {
    const label = primaryAudio === "ac3" || primaryAudio === "ec3" ? "Dolby Digital" : primaryAudio?.toUpperCase();
    return { path: "transcode", reason: `Video plays directly, but the ${label} audio track needs conversion` };
  }
  if (STREAMABLE_CONTAINERS.has(container)) {
    return { path: "direct", reason: "Plays directly in your browser" };
  }
  if (container === "mkv" || container === "matroska" || container === "avi" || container === "ts") {
    return { path: "remux", reason: `${container.toUpperCase()} works after repacking to MP4 — no re-encoding, it's nearly instant` };
  }
  return { path: "transcode", reason: `The ${facts.container ?? "source"} container isn't streamable, so Plexy will transcode` };
}

/** Compute a quick HTTP Range response for the watch player, backed by a lazy file slice. */
export function rangeResponse(request: Request, file: Blob, size: number, mime = "video/mp4"): Promise<Response> {
  const range = request.headers.get("range");
  if (!range) {
    return Promise.resolve(new Response(file, {
      headers: { "Content-Length": String(size), "Accept-Ranges": "bytes", "Content-Type": mime },
    }));
  }
  const m = range.match(/bytes=(\d*)-(\d*)/);
  if (!m) return Promise.resolve(new Response("Invalid range", { status: 416 }));
  const start = m[1] ? Number(m[1]) : null;
  const end = m[2] ? Math.min(Number(m[2]), size - 1) : size - 1;
  if (start === null || start > end || start >= size) {
    return Promise.resolve(new Response(null, {
      status: 416,
      headers: { "Content-Range": `bytes */${size}` },
    }));
  }
  return Promise.resolve(new Response(file.slice(start, end + 1), {
    status: 206,
    headers: {
      "Content-Type": mime,
      "Content-Length": String(end - start + 1),
      "Content-Range": `bytes ${start}-${end}/${size}`,
      "Accept-Ranges": "bytes",
      "Cache-Control": "no-store",
    },
  }));
}
