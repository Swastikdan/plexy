/// Media routes (PRD 5.8, 9).
///
/// - `GET /api/play/:fileId`             one-shot manifest: play path, title,
///                                       resume point, next episode, subtitles,
///                                       optimization state.
/// - `GET /api/stream/:fileId`           direct HTTP Range streaming. Serves
///                                       the prepared fast-start copy when one
///                                       exists, otherwise the original.
/// - `GET /api/stream/:fileId/remux`     default-audio container fallback;
///                                       alternate-track remux is disabled.
/// - `GET /api/stream/:fileId/transcode` fallback re-encode for the same case.
/// - `GET /api/subtitles/:fileId`        discovered tracks (embedded + sidecar).
/// - `GET /api/subtitles/:fileId/:track` WebVTT, from the extracted cache.
///
/// Files resolve only through database ids and paths constrained to a
/// configured library (PRD 11). Prepared copies live in app data; the original
/// media file is never modified.
import { Elysia, t } from "elysia";
import { stat } from "node:fs/promises";
import { spawn } from "node:child_process";
import { q, run, type Row } from "./db";
import { log } from "./logger";
import {
  canonicalCodec, classifyPlayability, preferredAudioBitrate, preferredVideoBitrate,
  rangeResponse, type BrowserCaps,
} from "./playback";
import {
  optimizationView, usableOptimizedPath, pauseOptimizer, resumeOptimizer,
} from "./optimize";
import { cachedEmbeddedSubtitle, findSidecarSubtitles, listSubtitleTracks, srtToVtt } from "./subtitles";
import { resolveFfmpeg } from "./ffmpeg";
import { getConfig } from "./config";
import { externalImdbId } from "./tmdb";
import { isPreparedHlsAsset, preparedStreamAvailable, readPreparedPlaylist } from "./hls-preparation";
import {
  enqueueTrickplay, trickplayFilePath, trickplayFrame, trickplayVtt, trickplayView,
} from "./trickplay";

type SegmentWindow = { start: number; end: number } | null;
type EpisodeSegments = { intro: SegmentWindow; recap: SegmentWindow; outro: SegmentWindow };
const segmentCache = new Map<string, { expires: number; value: EpisodeSegments }>();
const MAX_LIVE_CONVERSIONS = 2;
let activeLiveConversions = 0;

function parseSegment(value: unknown, duration: number | null): SegmentWindow {
  if (!value || typeof value !== "object") return null;
  const segment = value as Record<string, unknown>;
  const start = typeof segment.start_sec === "number" ? segment.start_sec
    : typeof segment.start_ms === "number" ? segment.start_ms / 1000
      : 0;
  const end = typeof segment.end_sec === "number" ? segment.end_sec
    : typeof segment.end_ms === "number" ? segment.end_ms / 1000
      : null;
  if (end == null || !Number.isFinite(start) || !Number.isFinite(end) || end <= start || start < 0) return null;
  if (duration && (start > duration || end > duration + 15)) return null;
  return { start, end: duration ? Math.min(end, duration) : end };
}

async function episodeSegments(fileId: number): Promise<EpisodeSegments> {
  const empty: EpisodeSegments = { intro: null, recap: null, outro: null };
  const cached = segmentCache.get(String(fileId));
  if (cached && cached.expires > Date.now()) return cached.value;
  const file = getFile(fileId);
  if (!file?.item_id) return empty;
  const episode = q<Row, [number]>("SELECT kind, parent_id, season_number, episode_number FROM items WHERE id = ?")
    .get(Number(file.item_id));
  if (!episode || episode.kind !== "episode" || episode.parent_id == null
    || episode.season_number == null || episode.episode_number == null) return empty;
  const series = q<{ tmdb_id: number | null }, [number]>("SELECT tmdb_id FROM items WHERE id = ?")
    .get(Number(episode.parent_id));
  if (!series?.tmdb_id) return empty;
  const key = `${series.tmdb_id}/${episode.season_number}/${episode.episode_number}`;
  const seriesCache = segmentCache.get(key);
  if (seriesCache && seriesCache.expires > Date.now()) return seriesCache.value;

  try {
    const imdbId = await externalImdbId("tv", Number(series.tmdb_id));
    if (!imdbId) return empty;
    const params = new URLSearchParams({
      imdb_id: imdbId,
      season: String(episode.season_number),
      episode: String(episode.episode_number),
    });
    const response = await fetch(`https://api.introdb.app/segments?${params}`, {
      signal: AbortSignal.timeout(1800),
      headers: { accept: "application/json" },
    });
    if (!response.ok) return empty;
    const data = await response.json() as Record<string, unknown>;
    const value: EpisodeSegments = {
      intro: parseSegment(data.intro, file.duration == null ? null : Number(file.duration)),
      recap: parseSegment(data.recap, file.duration == null ? null : Number(file.duration)),
      outro: parseSegment(data.outro, file.duration == null ? null : Number(file.duration)),
    };
    const cacheKey = `${series.tmdb_id}/${episode.season_number}/${episode.episode_number}`;
    segmentCache.set(cacheKey, { value, expires: Date.now() + (value.intro || value.recap || value.outro ? 24 : 4) * 3600_000 });
    segmentCache.set(String(fileId), { value, expires: Date.now() + 24 * 3600_000 });
    return value;
  } catch (error) {
    log.debug("player", "skip segment lookup unavailable", { fileId, message: String(error) });
    return empty;
  }
}

// --- helpers -----------------------------------------------------------------

function getFile(fileOrItemId: number): Row | null {
  return (
    q<Row, [number]>("SELECT * FROM media_files WHERE id = ?").get(fileOrItemId) ??
    q<Row, [number]>("SELECT * FROM media_files WHERE item_id = ? AND unavailable = 0 ORDER BY id DESC LIMIT 1").get(fileOrItemId) ??
    null
  );
}

/** Just-in-time probe helper: if a file has not been analyzed or previously failed, probe it on-demand before playback. */
async function ensureFileProbed(row: Row): Promise<Row> {
  if (row.video_codec || !row.path) return row;
  try {
    const { existsSync } = await import("node:fs");
    if (!existsSync(row.path as string)) return row;
    const { probe } = await import("./worker-host");
    const facts = await probe(row.path as string, { timeoutMs: 20_000 });
    if (facts) {
      run(
        `UPDATE media_files SET
          container=$container, duration=$duration, bitrate=$bitrate,
          video_codec=$vc, video_profile=$vp, width=$w, height=$h, fps=$fps, hdr=$hdr,
          audio_json=$audio, subtitles_json=$subs, analysis_status='probed',
          analysis_error=NULL, probed_at=$at
         WHERE id=$id`,
        {
          $id: row.id,
          $container: facts.container,
          $duration: facts.duration,
          $bitrate: facts.bitrate,
          $vc: facts.video?.codec ?? null,
          $vp: facts.video?.profile ?? null,
          $w: facts.video?.width ?? null,
          $h: facts.video?.height ?? null,
          $fps: facts.video?.fps ?? null,
          $hdr: facts.video?.hdr ?? null,
          $audio: JSON.stringify(facts.audio),
          $subs: JSON.stringify(facts.subtitles),
          $at: new Date().toISOString(),
        },
      );
      const fresh = getFile(Number(row.id));
      if (fresh) return fresh;
    }
  } catch (err) {
    log.warn("media", "just-in-time probe failed", { fileId: row.id, message: String(err) });
  }
  return row;
}

/** Null exactly when the file cannot be opened (missing disk = unavailable). */
async function openablePath(fileId: number): Promise<string | null> {
  const row = getFile(fileId);
  if (!row) return null;
  const path = String(row.path);
  try {
    const st = await stat(path);
    if (st.isFile()) return path;
  } catch { /* fall through */ }
  q("UPDATE media_files SET unavailable = 1 WHERE id = ?").run(fileId);
  return null;
}

interface ConversionOptions {
  trimStart?: number;
  audioIndex?: number;
  mode: "remux" | "transcode";
  height: number | null;
  sourceBitrate: number | null;
  channels: number | null;
  /** Remux can copy video but still needs AAC audio for browser compatibility. */
  audioCodec?: string | null;
}

function conversionArgs(path: string, options: ConversionOptions): string[] {
  const args = ["-hide_banner", "-loglevel", "error", "-nostdin"];
  if (options.trimStart && options.trimStart > 0.5) {
    // Input-side seek: FFmpeg resets timestamps so the player's display
    // timeline (source offset + currentTime) stays correct.
    args.push("-ss", options.trimStart.toFixed(3));
  }
  args.push("-i", path, "-map", "0:v:0", "-map", `0:a:${options.audioIndex ?? 0}?`);

  if (options.mode === "remux") {
    args.push("-c:v", "copy");
    const audio = canonicalCodec(options.audioCodec);
    if (audio === "aac" || audio === "mp3") {
      args.push("-c:a", "copy");
    } else {
      args.push("-c:a", "aac", "-b:a", String(preferredAudioBitrate(options.channels)));
    }
  } else {
    const videoBitrate = preferredVideoBitrate(options.height, options.sourceBitrate);
    args.push(
      "-c:v", "libx264",
      "-preset", "veryfast",
      "-pix_fmt", "yuv420p",
      "-b:v", String(videoBitrate),
      "-maxrate", String(Math.round(videoBitrate * 1.4)),
      "-bufsize", String(Math.round(videoBitrate * 3)),
      "-c:a", "aac",
      "-b:a", String(preferredAudioBitrate(options.channels)),
    );
  }

  args.push(
    "-sn", "-dn", "-map_metadata", "-1",
    "-avoid_negative_ts", "make_zero",
    // Fragmented MP4 lets the browser start before FFmpeg has finished and
    // survives a non-seekable pipe.
    "-movflags", "+frag_keyframe+empty_moov+default_base_moof",
    "-f", "mp4", "pipe:1",
  );
  return args;
}

/**
 * Stream a live remux/transcode from an FFmpeg **child process**.
 *
 * This used to run the native decoder inside the HTTP process, where one bad
 * file could segfault the whole server. FFmpeg now owns the codec state; a
 * crash only ends this response and the player's recovery logic rejoins at the
 * current timestamp. Client disconnects terminate the child immediately.
 */
async function conversionResponse(path: string, options: ConversionOptions): Promise<Response> {
  const ffmpeg = resolveFfmpeg();
  if (!ffmpeg) {
    log.error("media", "ffmpeg unavailable for live conversion", { mode: options.mode });
    return Response.json(
      { error: "Server conversion is unavailable: FFmpeg was not found." },
      { status: 503 },
    );
  }

  if (activeLiveConversions >= MAX_LIVE_CONVERSIONS) {
    return Response.json(
      { error: "The server is handling its maximum number of live conversions. Try again shortly." },
      { status: 503, headers: { "Retry-After": "5" } },
    );
  }

  const args = conversionArgs(path, options);
  // Keep prepared-file work from starting while any live conversion is active.
  // The shared pause reason is released only when the last conversion exits.
  if (activeLiveConversions === 0) pauseOptimizer("live-conversion");
  activeLiveConversions++;
  let conversionReleased = false;
  const releaseConversion = () => {
    if (conversionReleased) return;
    conversionReleased = true;
    activeLiveConversions = Math.max(0, activeLiveConversions - 1);
    if (activeLiveConversions === 0) resumeOptimizer("live-conversion");
  };
  let child: ReturnType<typeof spawn>;
  try {
    child = spawn(ffmpeg, args, { stdio: ["ignore", "pipe", "pipe"] });
  } catch (err) {
    releaseConversion();
    throw err;
  }

  let closed = false;
  let received = 0;
  let stderr = "";
  const stop = () => {
    if (closed) return;
    closed = true;
    if (child.exitCode === null) {
      child.kill("SIGTERM");
      setTimeout(() => {
        if (child.exitCode === null) child.kill("SIGKILL");
      }, 1500).unref?.();
    } else {
      releaseConversion();
    }
  };

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      child.stdout!.on("data", (chunk: Buffer) => {
        if (closed) return;
        received += chunk.length;
        try { controller.enqueue(new Uint8Array(chunk)); } catch { stop(); }
      });
      child.stderr!.on("data", (chunk: Buffer) => {
        if (stderr.length < 4_000) stderr += chunk.toString();
      });
      child.on("error", (err) => {
        if (closed) return;
        closed = true;
        releaseConversion();
        log.error("media", `${options.mode} process failed`, { message: err.message });
        try { controller.error(new Error("conversion failed")); } catch { /* done */ }
      });
      child.on("exit", (code, signal) => {
        releaseConversion();
        if (closed) return;
        closed = true;
        if (code === 0) {
          try { controller.close(); } catch { /* done */ }
          return;
        }
        const message = stderr.trim().slice(0, 600) || `ffmpeg exited ${code ?? signal}`;
        log.error("media", `${options.mode} failed`, {
          code, signal, bytes: received, message,
        });
        try { controller.error(new Error("conversion failed")); } catch { /* done */ }
      });
    },
    cancel() { stop(); },
  });

  // Give FFmpeg a moment to reject an unreadable file *before* committing to a
  // 200 response, so the player sees a real error instead of a dead stream.
  const early = await new Promise<"started" | "failed">((resolve) => {
    let settled = false;
    const finish = (result: "started" | "failed") => {
      if (settled) return;
      settled = true;
      resolve(result);
    };
    child.stdout!.once("data", () => finish("started"));
    child.once("spawn", () => setTimeout(() => finish("started"), 350));
    child.once("error", () => finish("failed"));
    child.once("exit", (code) => {
      if (code !== 0 && received === 0) finish("failed");
    });
    setTimeout(() => finish("started"), 1200);
  });
  if (early === "failed") {
    stop();
    releaseConversion();
    return Response.json(
      { error: `${options.mode === "remux" ? "Remux" : "Conversion"} could not start for this file.` },
      { status: options.mode === "remux" ? 500 : 503 },
    );
  }

  return new Response(stream, {
    headers: {
      "Content-Type": "video/mp4",
      "Cache-Control": "no-store",
      "X-Plexy-Path": options.mode,
      "Accept-Ranges": "none",
    },
  });
}

function parseCaps(raw: string | undefined): BrowserCaps | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === "object") {
      if (Array.isArray(parsed.videoCodecs) && Array.isArray(parsed.audioCodecs)) {
        return parsed as BrowserCaps;
      }
      const videoCodecs: string[] = ["h264", "avc", "avc1"];
      const audioCodecs: string[] = ["aac", "mp3", "opus", "flac"];
      if (parsed.hevc) videoCodecs.push("hevc", "h265");
      if (parsed.vp9) videoCodecs.push("vp9", "vp8");
      if (parsed.av1) videoCodecs.push("av1", "av01");
      return { videoCodecs, audioCodecs };
    }
    return null;
  } catch {
    return null;
  }
}

function audioTracksFor(row: Row): Array<{ codec: string; channels: number; language: string; isDefault: boolean }> {
  try {
    const tracks = JSON.parse(String(row.audio_json ?? "[]"));
    return Array.isArray(tracks) ? tracks : [];
  } catch {
    return [];
  }
}

function firstChannelCount(row: Row, index = 0): number | null {
  try {
    const audio = audioTracksFor(row);
    return audio[index] ? Number(audio[index].channels ?? 0) || null : null;
  } catch {
    return null;
  }
}

function firstAudioCodec(row: Row, index = 0): string | null {
  try {
    const audio = audioTracksFor(row);
    return audio[index] ? String(audio[index].codec ?? "") || null : null;
  } catch {
    return null;
  }
}

function normalizedLanguage(language: unknown): string {
  const value = String(language ?? "").trim().toLowerCase().split(/[-_]/, 1)[0];
  const aliases: Record<string, string> = {
    eng: "en", spa: "es", fre: "fr", fra: "fr", deu: "de", ger: "de", hin: "hi",
    jpn: "ja", kor: "ko", chi: "zh", zho: "zh", por: "pt", ita: "it", rus: "ru",
    english: "en", spanish: "es", french: "fr", german: "de", hindi: "hi", japanese: "ja",
    korean: "ko", chinese: "zh", portuguese: "pt", italian: "it", russian: "ru",
  };
  return aliases[value] ?? value;
}

export interface NextEpisode {
  fileId: number;
  itemId: number;
  title: string;
  subtitle: string;
  poster: string | null;
  seasonNumber: number | null;
  episodeNumber: number | null;
}

interface ItemContext {
  title: string;
  subtitle: string | null;
  seasonNumber: number | null;
  episodeNumber: number | null;
  duration: number | null;
  nextFileId: number | null;
  next: NextEpisode | null;
}

function episodeSubtitle(name: string, season: number, episode: number): string {
  const label = `S${String(season).padStart(2, "0")}E${String(episode).padStart(2, "0")}`;
  return name.toUpperCase().startsWith(label) ? name : `${label} · ${name}`;
}

/** Poster/thumb for one item, sized for the player's up-next card. */
function itemPoster(itemId: number): string | null {
  const art = q<{ id: number }, [number]>(
    `SELECT id FROM artwork
     WHERE item_id = ? AND kind IN ('thumb','poster')
     ORDER BY CASE kind WHEN 'thumb' THEN 0 ELSE 1 END, id
     LIMIT 1`,
  ).get(itemId);
  return art ? `/api/images/${Number(art.id)}?w=300` : null;
}

/** Title, episode label and "next episode" for the player header. */
function itemContext(row: Row): ItemContext {
  const duration = row.duration == null ? null : Number(row.duration);
  const itemId = row.item_id == null ? null : Number(row.item_id);
  const empty = {
    title: "", subtitle: null, seasonNumber: null, episodeNumber: null,
    duration, nextFileId: null, next: null,
  };
  if (!itemId) return empty;

  const item = q<Row, [number]>(
    "SELECT id, name, kind, parent_id, season_number, episode_number FROM items WHERE id = ?",
  ).get(itemId);
  if (!item) return empty;

  if (String(item.kind) !== "episode" || item.parent_id == null) {
    return { ...empty, title: String(item.name) };
  }

  const parent = q<{ name: string }, [number]>("SELECT name FROM items WHERE id = ?")
    .get(Number(item.parent_id));
  const season = item.season_number == null ? 0 : Number(item.season_number);
  const episode = item.episode_number == null ? 0 : Number(item.episode_number);
  const name = String(item.name);
  const subtitle = episodeSubtitle(name, season, episode);

  const siblings = q<Row, [number]>(
    `SELECT e.id AS item_id, e.name, e.season_number, e.episode_number,
            (SELECT f.id FROM media_files f
              WHERE f.item_id = e.id AND f.unavailable = 0 ORDER BY f.id DESC LIMIT 1) AS file_id
     FROM items e
     WHERE e.parent_id = ? AND e.kind = 'episode'
     ORDER BY e.season_number, e.episode_number`,
  ).all(Number(item.parent_id));
  const index = siblings.findIndex((sibling) => Number(sibling.item_id) === itemId);
  const nextRow = index >= 0
    ? siblings.slice(index + 1).find((sibling) => sibling.file_id != null)
    : undefined;

  const next: NextEpisode | null = nextRow
    ? {
        fileId: Number(nextRow.file_id),
        itemId: Number(nextRow.item_id),
        title: parent ? String(parent.name) : name,
        subtitle: episodeSubtitle(
          String(nextRow.name ?? "Next episode"),
          Number(nextRow.season_number ?? 0),
          Number(nextRow.episode_number ?? 0),
        ),
        poster: itemPoster(Number(nextRow.item_id)),
        seasonNumber: nextRow.season_number == null ? null : Number(nextRow.season_number),
        episodeNumber: nextRow.episode_number == null ? null : Number(nextRow.episode_number),
      }
    : null;

  return {
    title: parent ? String(parent.name) : name,
    subtitle,
    seasonNumber: season,
    episodeNumber: episode,
    duration,
    nextFileId: next?.fileId ?? null,
    next,
  };
}

// --- routes ------------------------------------------------------------------

export const mediaRoutes = new Elysia({ prefix: "/api", normalize: "typebox" })
  /**
   * One request for everything the player needs. Previously the player fetched
   * playability, title detail and subtitle tracks separately before it could
   * even start loading media; this removes two round-trips from the critical
   * path and lets the browser begin fetching bytes immediately.
   */
  .get("/play/:fileId", async (ctx) => {
    let row = getFile(Number(ctx.params.fileId));
    if (!row) return Response.json({ error: "Not found" }, { status: 404 });
    row = await ensureFileProbed(row);

    const audioTracks = audioTracksFor(row).map((track, index) => ({ ...track, index }));
    const config = await getConfig();
    const requestedLanguage = normalizedLanguage(config.preferredAudioLanguage || "en");
    const languageIndex = audioTracks.findIndex((track) => normalizedLanguage(track.language) === requestedLanguage);
    const defaultAudioIndex = languageIndex >= 0
      ? languageIndex
      : Math.max(0, audioTracks.findIndex((track) => track.isDefault));
    const requestedAudioIndex = ctx.query.audio;
    const selectedAudioIndex = requestedAudioIndex != null
      && Number.isInteger(requestedAudioIndex)
      && requestedAudioIndex >= 0
      && requestedAudioIndex < audioTracks.length
      ? requestedAudioIndex
      : defaultAudioIndex;
    const selectedAudioNeedsConversion = selectedAudioIndex !== defaultAudioIndex;

    let verdict = classifyPlayability({
      container: (row.container as string | null) ?? "",
      videoCodec: row.video_codec as string | null,
      audioJson: (row.audio_json as string | null) ?? "[]",
      subtitlesJson: (row.subtitles_json as string | null) ?? "[]",
    }, parseCaps(ctx.query.caps));

    // A prepared copy is a plain fast-start MP4: the browser can play and seek
    // it natively, so the "likely" path from probe facts no longer applies.
    const prepared = !selectedAudioNeedsConversion ? await usableOptimizedPath(row) : null;
    if (prepared) {
      verdict = { path: "direct", reason: "Prepared for instant playback and seeking" };
    }
    if (selectedAudioNeedsConversion && verdict.path === "direct") {
      verdict = { path: "remux", reason: "Remuxing with selected audio track" };
    }
    if (await preparedStreamAvailable(row, selectedAudioIndex)) {
      verdict = { path: "hls", reason: "Prepared adaptive quality streams are ready" };
    }

    const watch = row.item_id
      ? q<Row>(
          `SELECT position_seconds, duration_seconds, played
           FROM watch_state WHERE item_id = ? LIMIT 1`,
        ).get(row.item_id as number) ?? null
      : null;

    const context = itemContext(row);
    const versions = row.item_id == null ? [] : q<Row>(
      `SELECT id, width, height, video_codec, hdr, size FROM media_files
       WHERE item_id = ? AND unavailable = 0 ORDER BY height DESC, size DESC, id DESC`,
    ).all(row.item_id as number).map((version) => {
      const height = version.height == null ? null : Number(version.height);
      const codec = version.video_codec == null ? null : String(version.video_codec);
      const hdr = version.hdr == null ? null : String(version.hdr);
      const size = Number(version.size ?? 0);
      const resolution = height == null ? "Unknown resolution" : height >= 2160 ? "4K" : `${height}p`;
      return {
        fileId: Number(version.id),
        height,
        codec,
        hdr,
        size,
        label: [resolution, hdr, codec?.toUpperCase()].filter(Boolean).join(" · "),
      };
    });
    const tracks = await listSubtitleTracks(row).catch((err) => {
      log.warn("player", "subtitle discovery failed", {
        fileId: row.id, message: err instanceof Error ? err.message : String(err),
      });
      return [];
    });

    // Lazy, idempotent: the first play starts one background FFmpeg pass.
    if (verdict.path !== "unsupported") enqueueTrickplay(row);
    const trickplay = trickplayView(row);

    log.debug("player", "play manifest", {
      fileId: row.id, path: verdict.path, prepared: Boolean(prepared),
      trickplay: trickplay.status,
    });

    return {
      ...verdict,
      fileId: Number(row.id),
      itemId: row.item_id as number | null,
      audioTracks,
      selectedAudioIndex,
      versions,
      title: context.title,
      subtitle: context.subtitle,
      seasonNumber: context.seasonNumber,
      episodeNumber: context.episodeNumber,
      duration: context.duration,
      nextFileId: context.nextFileId,
      next: context.next,
      watch: watch ? {
        position: Number(watch.position_seconds),
        duration: watch.duration_seconds != null ? Number(watch.duration_seconds) : null,
        played: !!Number(watch.played),
      } : null,
      tracks,
      trickplay,
      optimization: optimizationView(row),
    };
  }, {
    params: t.Object({ fileId: t.Numeric() }),
    query: t.Object({ caps: t.Optional(t.String()), audio: t.Optional(t.Numeric()) }),
  })

  /** Community segment lookup is separately opt-in and never blocks stream startup. */
  .get("/skip-segments/:fileId", async ({ params }) => {
    const config = await getConfig();
    if (!config.skipSegmentsEnabled) {
      return { enabled: false, intro: null, recap: null, outro: null };
    }
    return { enabled: true, ...await episodeSegments(Number(params.fileId)) };
  }, { params: t.Object({ fileId: t.Numeric() }) })

  /** Playpath judgment for the current browser (kept for older clients). */
  .get("/playability/:fileId", async (ctx) => {
    let row = getFile(Number(ctx.params.fileId));
    if (!row) return Response.json({ error: "Not found" }, { status: 404 });
    row = await ensureFileProbed(row);
    const verdict = classifyPlayability({
      container: (row.container as string | null) ?? "",
      videoCodec: row.video_codec as string | null,
      audioJson: (row.audio_json as string | null) ?? "[]",
      subtitlesJson: (row.subtitles_json as string | null) ?? "[]",
    }, parseCaps(ctx.query.caps));

    const watch = row.item_id
      ? q<Row>(
          `SELECT position_seconds, duration_seconds, played
           FROM watch_state WHERE item_id = ? LIMIT 1`,
        ).get(row.item_id as number) ?? null
      : null;
    return {
      ...verdict,
      fileId: Number(row.id),
      itemId: row.item_id as number | null,
      watch: watch ? {
        position: Number(watch.position_seconds),
        duration: watch.duration_seconds != null ? Number(watch.duration_seconds) : null,
        played: !!Number(watch.played),
      } : null,
    };
  }, {
    params: t.Object({ fileId: t.Numeric() }),
    query: t.Object({ caps: t.Optional(t.String()) }),
  })

  /** Direct HTTP Range streaming; prefers the prepared fast-start copy. */
  .get("/stream/:fileId", async (ctx) => {
    let fileId = Number(ctx.params.fileId);
    let path = await openablePath(fileId);
    if (!path) {
      const fRow = q<Row>("SELECT id FROM media_files WHERE item_id = ? AND unavailable = 0 ORDER BY id DESC LIMIT 1").get(fileId);
      if (fRow) {
        fileId = Number(fRow.id);
        path = await openablePath(fileId);
      }
    }
    if (!path) return Response.json({ error: "File unavailable" }, { status: 404 });

    const row = getFile(fileId)!;
    const prepared = await usableOptimizedPath(row);
    const servePath = prepared ?? path;
    const st = await stat(servePath);
    const container = String(row.container ?? "").toLowerCase();
    const mime = prepared
      ? "video/mp4"
      : container === "webm" ? "video/webm" : "video/mp4";

    const response = await rangeResponse(ctx.request, Bun.file(servePath), st.size, mime);
    response.headers.set("X-Plexy-Source", prepared ? "optimized" : "original");
    return response;
  }, { params: t.Object({ fileId: t.Numeric() }) })

  /** Remux = container-only problem (PRD 5.8). Copy packets, near instant. */
  .get("/stream/:fileId/remux", async (ctx) => {
    const fileId = Number(ctx.params.fileId);
    const path = await openablePath(fileId);
    if (!path) return Response.json({ error: "File unavailable" }, { status: 404 });
    const row = getFile(fileId)!;
    const requestedAudio = Number.isInteger(Number(ctx.query.audio)) && Number(ctx.query.audio) >= 0
      ? Number(ctx.query.audio)
      : 0;
    try {
      return await conversionResponse(path, {
        mode: "remux",
        height: (row.height as number | null) ?? null,
        sourceBitrate: (row.bitrate as number | null) ?? null,
        channels: firstChannelCount(row, requestedAudio),
        audioCodec: firstAudioCodec(row, requestedAudio),
        audioIndex: requestedAudio,
        trimStart: Number.isFinite(Number(ctx.query.start)) && Number(ctx.query.start) > 0
          ? Number(ctx.query.start)
          : undefined,
      });
    } catch (err) {
      log.error("media", "remux failed to start", {
        fileId, message: err instanceof Error ? err.message : String(err),
      });
      return Response.json(
        { error: "Remux failed for this file. It may need a full conversion instead." },
        { status: 500 },
      );
    }
  }, {
    params: t.Object({ fileId: t.Numeric() }),
    query: t.Object({ start: t.Optional(t.Numeric()), audio: t.Optional(t.Numeric()) }),
  })

  /**
   * On-demand transcode fallback for a file that is still being prepared.
   * `start=` seconds resumes from a position; the player restarts the stream
   * on long seeks. Failures return honest errors, never a fake stream.
   */
  .get("/stream/:fileId/transcode", async (ctx) => {
    const fileId = Number(ctx.params.fileId);
    const path = await openablePath(fileId);
    if (!path) return Response.json({ error: "File unavailable" }, { status: 404 });
    const row = getFile(fileId)!;
    const start = ctx.query.start ? Number(ctx.query.start) : 0;
    try {
      return await conversionResponse(path, {
        mode: "transcode",
        height: (row.height as number | null) ?? null,
        sourceBitrate: (row.bitrate as number | null) ?? null,
        channels: firstChannelCount(row, Number(ctx.query.audio) || 0),
        audioIndex: Number.isInteger(Number(ctx.query.audio)) && Number(ctx.query.audio) >= 0
          ? Number(ctx.query.audio)
          : 0,
        trimStart: Number.isFinite(start) && start > 0 ? start : undefined,
      });
    } catch (err) {
      log.error("media", "transcode failed to start", {
        fileId, message: err instanceof Error ? err.message : String(err),
      });
      return Response.json(
        { error: "Server conversion could not start for this file on this machine." },
        { status: 503 },
      );
    }
  }, {
    params: t.Object({ fileId: t.Numeric() }),
    query: t.Object({ start: t.Optional(t.Numeric()), audio: t.Optional(t.Numeric()) }),
  })

  /** Cached adaptive HLS stream with several server-generated resolutions. */
  .get("/stream/:fileId/hls/:asset", async (ctx) => {
    const fileId = Number(ctx.params.fileId);
    const path = await openablePath(fileId);
    if (!path) return Response.json({ error: "File unavailable" }, { status: 404 });
    const row = getFile(fileId)!;
    const asset = String(ctx.params.asset);
    if (!isPreparedHlsAsset(asset)) {
      return Response.json({ error: "Invalid HLS asset" }, { status: 404 });
    }
    const audioIndex = Number.isInteger(Number(ctx.query.audio)) && Number(ctx.query.audio) >= 0
      ? Number(ctx.query.audio)
      : 0;
    const response = await readPreparedPlaylist(row, asset, new URL(ctx.request.url).origin, audioIndex);
    return response ?? Response.json({ error: "Prepared quality streams are not available for this title." }, { status: 404 });
  }, {
    params: t.Object({ fileId: t.Numeric(), asset: t.String() }),
    query: t.Object({ start: t.Optional(t.Numeric()), audio: t.Optional(t.Numeric()) }),
  })

  /**
   * Serve artwork locally. Local sidecars are served directly; TMDB images are
   * served from locally cached originals and Bun.Image-generated derivatives
   * so artwork remains available even when completely offline. `?w=` asks for
   * a display-sized derivative (posters 500, backdrops 1600, thumbs 300).
   */
  .get("/images/:artworkId", async (ctx) => {
    const row = q<Row, [number]>("SELECT id, kind, source, url FROM artwork WHERE id = ?")
      .get(Number(ctx.params.artworkId));
    if (!row) return Response.json({ error: "Not found" }, { status: 404 });

    const widthParam = ctx.query.w ? Number(ctx.query.w) : null;
    const defaultWidth = row.kind === "backdrop" ? 1600 : row.kind === "thumb" ? 300 : 500;
    const targetWidth = widthParam && widthParam > 50 && widthParam <= 3840 ? widthParam : defaultWidth;

    if (row.source === "local") {
      const path = String(row.url);
      try {
        const st = await stat(path);
        if (!st.isFile()) throw new Error("not a file");
        const ext = path.toLowerCase().match(/\.(jpe?g|png|webp|avif|gif)$/)?.[1] ?? "";
        const mime = { jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png", webp: "image/webp", avif: "image/avif", gif: "image/gif" }[ext] ?? "image/jpeg";
        return new Response(Bun.file(path), {
          headers: { "Content-Type": mime, "Cache-Control": "public, max-age=86400" },
        });
      } catch {
        return Response.json({ error: "Not found" }, { status: 404 });
      }
    }

    // TMDB artwork: serve from local originals/derived cache
    const { cacheArtworkOriginal, getOrCreateDerivative } = await import("./artwork");
    const meta = await cacheArtworkOriginal(String(row.url));
    if (meta) {
      const derivedFile = await getOrCreateDerivative(meta.originalPath, targetWidth);
      return new Response(Bun.file(derivedFile), {
        headers: {
          "Content-Type": derivedFile.endsWith(".webp") ? "image/webp" : "image/jpeg",
          "Cache-Control": "public, max-age=31536000, immutable",
        },
      });
    }

    // Fallback if offline and not yet cached
    return Response.redirect(String(row.url), 302);
  }, {
    params: t.Object({ artworkId: t.Numeric() }),
    query: t.Object({ w: t.Optional(t.Numeric()) }),
  })

  /** Artwork storage statistics. */
  .get("/admin/artwork/storage", async () => {
    const { getArtworkStorageStats } = await import("./artwork");
    return await getArtworkStorageStats();
  })

  /**
   * Trickplay track: a WebVTT metadata list whose cues point at cached JPEGs
   * with `#xywh=` coordinates. Media Chrome consumes this natively, so the
   * scrub preview works in every browser without a custom overlay.
   */
  .get("/trickplay/:fileId/track.vtt", async (ctx) => {
    const row = getFile(Number(ctx.params.fileId));
    if (!row) return new Response("WEBVTT\n\n", { headers: { "Content-Type": "text/vtt; charset=utf-8" } });
    return new Response(trickplayVtt(row), {
      headers: {
        "Content-Type": "text/vtt; charset=utf-8",
        // The body changes from empty to populated once extraction finishes.
        "Cache-Control": "no-cache",
      },
    });
  }, { params: t.Object({ fileId: t.Numeric() }) })

  /** One cached trickplay frame or sprite sheet (JPEG). */
  .get("/trickplay/:fileId/:frame", async (ctx) => {
    const row = getFile(Number(ctx.params.fileId));
    if (!row) return Response.json({ error: "Not found" }, { status: 404 });
    const frameName = String(ctx.params.frame);
    if (!/^sprite_\d+\.jpe?g$/i.test(frameName) && !/^\d+\.jpe?g$/i.test(frameName)) {
      return Response.json({ error: "Bad frame" }, { status: 400 });
    }
    const path = await trickplayFilePath(row, frameName);
    if (!path) return Response.json({ error: "Not found" }, { status: 404 });
    return new Response(Bun.file(path), {
      headers: {
        "Content-Type": "image/jpeg",
        "Cache-Control": "public, max-age=31536000, immutable",
      },
    });
  }, { params: t.Object({ fileId: t.Numeric(), frame: t.String() }) })

  /** Track discovery for the player: embedded + sidecar names together. */
  .get("/subtitles/:fileId", async (ctx) => {
    const row = getFile(Number(ctx.params.fileId));
    if (!row) return Response.json({ tracks: [] });
    return { tracks: await listSubtitleTracks(row) };
  }, { params: t.Object({ fileId: t.Numeric() }) })

  /**
   * Subtitles as WebVTT (PRD 5.8). `:track` is either `sidecar-<label>` or
   * `embedded-<index>`. Embedded tracks are extracted once and cached on disk,
   * so opening the caption menu never re-reads the video container.
   */
  .get("/subtitles/:fileId/:track", async (ctx) => {
    const row = getFile(Number(ctx.params.fileId));
    if (!row) return Response.json({ error: "File unavailable" }, { status: 404 });
    // Decode once here; tolerate clients that already sent a decoded label.
    let track = ctx.params.track;
    try { track = decodeURIComponent(track); } catch { /* already decoded */ }
    track = track.replace(/\.vtt$/i, "");

    if (track.startsWith("embedded-")) {
      const index = Number(track.slice("embedded-".length));
      if (!Number.isInteger(index) || index < 0) {
        return Response.json({ error: "Bad track" }, { status: 400 });
      }
      try {
        const file = await cachedEmbeddedSubtitle(row, index);
        if (!file) return Response.json({ error: "Track is empty" }, { status: 404 });
        return new Response(Bun.file(file), {
          headers: {
            "Content-Type": "text/vtt; charset=utf-8",
            "Cache-Control": "public, max-age=86400",
          },
        });
      } catch (err) {
        log.warn("player", "embedded subtitle extraction failed", {
          fileId: ctx.params.fileId, message: err instanceof Error ? err.message : String(err),
        });
        return Response.json({ error: "Subtitle extraction failed" }, { status: 500 });
      }
    }

    // Sidecars are matched against the discovered list, never against a
    // caller-provided path; that keeps `../` out of the request handling.
    const label = track.startsWith("sidecar-") ? track.slice("sidecar-".length) : track;
    const sidecars = await findSidecarSubtitles(row);
    const found = sidecars.find((entry) => entry.label.toLowerCase() === label.toLowerCase());
    if (!found) return Response.json({ error: "No subtitle file with that name" }, { status: 404 });

    if (found.ext === "vtt") {
      return new Response(Bun.file(found.path), {
        headers: {
          "Content-Type": "text/vtt; charset=utf-8",
          "Cache-Control": "public, max-age=86400",
        },
      });
    }
    const text = srtToVtt(await Bun.file(found.path).text());
    return new Response(text, {
      headers: {
        "Content-Type": "text/vtt; charset=utf-8",
        "Cache-Control": "public, max-age=86400",
      },
    });
  }, {
    params: t.Object({ fileId: t.Numeric(), track: t.String() }),
  });
