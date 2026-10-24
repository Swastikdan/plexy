/// Media routes (PRD 5.8, 9).
///
/// - `GET /api/play/:fileId`             one-shot manifest: play path, title,
///                                       resume point, next episode, subtitles,
///                                       optimization state.
/// - `GET /api/stream/:fileId`           direct HTTP Range streaming. Serves
///                                       the prepared fast-start copy when one
///                                       exists, otherwise the original.
/// - `GET /api/stream/:fileId/remux`     fallback container fix while a file is
///                                       still waiting in the preparation queue.
/// - `GET /api/stream/:fileId/transcode` fallback re-encode for the same case.
/// - `GET /api/subtitles/:fileId`        discovered tracks (embedded + sidecar).
/// - `GET /api/subtitles/:fileId/:track` WebVTT, from the extracted cache.
///
/// Files resolve only through database ids and paths constrained to a
/// configured library (PRD 11). Prepared copies live in app data; the original
/// media file is never modified.
import { Elysia, t } from "elysia";
import { stat } from "node:fs/promises";
import { q, type Row } from "./db";
import { log } from "./logger";
import {
  classifyPlayability, preferredAudioBitrate, preferredVideoBitrate, rangeResponse,
  type BrowserCaps,
} from "./playback";
import {
  ALL_FORMATS, BlobSource, Input, Output, Conversion, Mp4OutputFormat,
  StreamTarget, type StreamTargetChunk,
} from "mediabunny";
import { registerMediabunnyServer } from "@mediabunny/server";
import { optimizationView, usableOptimizedPath, enqueueOptimization } from "./optimize";
import { cachedEmbeddedSubtitle, findSidecarSubtitles, listSubtitleTracks, srtToVtt } from "./subtitles";

try {
  registerMediabunnyServer();
} catch (err) {
  log.warn("media", "Native @mediabunny/server codecs unavailable in compiled bundle; pure-TS mediabunny will handle demux/remux", { error: String(err) });
}

// --- helpers -----------------------------------------------------------------

function getFile(fileOrItemId: number): Row | null {
  return (
    q<Row, [number]>("SELECT * FROM media_files WHERE id = ?").get(fileOrItemId) ??
    q<Row, [number]>("SELECT * FROM media_files WHERE item_id = ? AND unavailable = 0 ORDER BY id DESC LIMIT 1").get(fileOrItemId) ??
    null
  );
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
  mode: "remux" | "transcode";
  height: number | null;
  sourceBitrate: number | null;
  channels: number | null;
}

/**
 * Build the streaming Response for one conversion. Mediabunny writes
 * fragmented MP4 (fastStart 'fragmented') into a StreamTarget whose writable
 * pushes chunks into a ReadableStream — push semantics in both directions.
 */
async function conversionResponse(path: string, options: ConversionOptions): Promise<Response> {
  const input = new Input({ source: new BlobSource(Bun.file(path)), formats: ALL_FORMATS });

  let controller: ReadableStreamDefaultController<Uint8Array> | null = null;
  const stream = new ReadableStream<Uint8Array>({
    start(c) { controller = c; },
    // Client disconnect → stop the decode loop and release the input.
    async cancel() {
      try { await conversion.cancel(); } catch { /* already done */ }
      input.dispose();
    },
  });
  const writable = new WritableStream<StreamTargetChunk>({
    write(chunk) { controller?.enqueue(chunk.data); },
    close() { try { controller?.close(); } catch { /* done */ } input.dispose(); },
    abort(reason) {
      try { controller?.error(reason instanceof Error ? reason : new Error(String(reason))); } catch {}
      input.dispose();
    },
  });

  const output = new Output({
    format: new Mp4OutputFormat({ fastStart: "fragmented" }),
    target: new StreamTarget(writable),
  });

  const conversion = await Conversion.init({
    input,
    output,
    // remux: copy whatever is already compatible. transcode: always re-encode
    // into browser-native AVC/AAC at (at least) the source bitrate so quality
    // is not thrown away.
    ...(options.mode === "remux" ? {} : {
      copy: false,
      video: {
        codec: "avc" as const,
        bitrate: preferredVideoBitrate(options.height, options.sourceBitrate),
      },
      audio: { codec: "aac" as const, bitrate: preferredAudioBitrate(options.channels) },
    }),
    ...(options.trimStart ? { trim: { start: options.trimStart } } : {}),
  });

  // Drive the conversion in the background; the Response streams as data
  // arrives. Any failure errors the stream → visible client-side.
  void conversion.execute().catch((err) => {
    log.error("media", `${options.mode} conversion failed`, {
      path, message: err instanceof Error ? err.message : String(err),
    });
    try { controller?.error(new Error("conversion failed")); } catch { /* done */ }
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "video/mp4",
      "Cache-Control": "no-store",
      "X-Plexy-Path": options.mode,
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

function firstChannelCount(row: Row): number | null {
  try {
    const audio = JSON.parse(String(row.audio_json ?? "[]"));
    return Array.isArray(audio) && audio[0] ? Number(audio[0].channels ?? 0) || null : null;
  } catch {
    return null;
  }
}

interface ItemContext {
  title: string;
  subtitle: string | null;
  duration: number | null;
  nextFileId: number | null;
}

/** Title, episode label and "next episode" for the player header. */
function itemContext(row: Row): ItemContext {
  const duration = row.duration == null ? null : Number(row.duration);
  const itemId = row.item_id == null ? null : Number(row.item_id);
  if (!itemId) return { title: "", subtitle: null, duration, nextFileId: null };

  const item = q<Row, [number]>(
    "SELECT id, name, kind, parent_id, season_number, episode_number FROM items WHERE id = ?",
  ).get(itemId);
  if (!item) return { title: "", subtitle: null, duration, nextFileId: null };

  if (String(item.kind) !== "episode" || item.parent_id == null) {
    return { title: String(item.name), subtitle: null, duration, nextFileId: null };
  }

  const parent = q<{ name: string }, [number]>("SELECT name FROM items WHERE id = ?")
    .get(Number(item.parent_id));
  const season = item.season_number == null ? 0 : Number(item.season_number);
  const episode = item.episode_number == null ? 0 : Number(item.episode_number);
  const label = `S${String(season).padStart(2, "0")}E${String(episode).padStart(2, "0")}`;
  const name = String(item.name);
  const subtitle = name.toUpperCase().startsWith(label) ? name : `${label} · ${name}`;

  const siblings = q<Row, [number]>(
    `SELECT e.id AS item_id, e.season_number, e.episode_number,
            (SELECT f.id FROM media_files f
              WHERE f.item_id = e.id AND f.unavailable = 0 ORDER BY f.id DESC LIMIT 1) AS file_id
     FROM items e
     WHERE e.parent_id = ? AND e.kind = 'episode'
     ORDER BY e.season_number, e.episode_number`,
  ).all(Number(item.parent_id));
  const index = siblings.findIndex((sibling) => Number(sibling.item_id) === itemId);
  const next = index >= 0
    ? siblings.slice(index + 1).find((sibling) => sibling.file_id != null)
    : undefined;

  return {
    title: parent ? String(parent.name) : name,
    subtitle,
    duration,
    nextFileId: next ? Number(next.file_id) : null,
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
    const row = getFile(Number(ctx.params.fileId));
    if (!row) return Response.json({ error: "Not found" }, { status: 404 });

    let verdict = classifyPlayability({
      container: (row.container as string | null) ?? "",
      videoCodec: row.video_codec as string | null,
      audioJson: (row.audio_json as string | null) ?? "[]",
      subtitlesJson: (row.subtitles_json as string | null) ?? "[]",
    }, parseCaps(ctx.query.caps));

    // A prepared copy is a plain fast-start MP4: the browser can play and seek
    // it natively, so the "likely" path from probe facts no longer applies.
    const prepared = await usableOptimizedPath(row);
    if (prepared) {
      verdict = { path: "direct", reason: "Prepared for instant playback and seeking" };
    } else if (String(row.optimized_status ?? "") === "done") {
      // The cache file vanished (cleared by hand or a failed disk). Rebuild it
      // in the background; playback still works through the fallback route.
      enqueueOptimization(Number(row.id));
    }

    const watch = row.item_id
      ? q<Row>(
          `SELECT position_seconds, duration_seconds, played
           FROM watch_state WHERE item_id = ? LIMIT 1`,
        ).get(row.item_id as number) ?? null
      : null;

    const context = itemContext(row);
    const tracks = await listSubtitleTracks(row).catch((err) => {
      log.warn("player", "subtitle discovery failed", {
        fileId: row.id, message: err instanceof Error ? err.message : String(err),
      });
      return [];
    });

    log.debug("player", "play manifest", {
      fileId: row.id, path: verdict.path, prepared: Boolean(prepared),
    });

    return {
      ...verdict,
      fileId: Number(row.id),
      itemId: row.item_id as number | null,
      title: context.title,
      subtitle: context.subtitle,
      duration: context.duration,
      nextFileId: context.nextFileId,
      watch: watch ? {
        position: Number(watch.position_seconds),
        duration: watch.duration_seconds != null ? Number(watch.duration_seconds) : null,
        played: !!Number(watch.played),
      } : null,
      tracks,
      optimization: optimizationView(row),
    };
  }, {
    params: t.Object({ fileId: t.Numeric() }),
    query: t.Object({ caps: t.Optional(t.String()) }),
  })

  /** Playpath judgment for the current browser (kept for older clients). */
  .get("/playability/:fileId", async (ctx) => {
    const row = getFile(Number(ctx.params.fileId));
    if (!row) return Response.json({ error: "Not found" }, { status: 404 });
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
    try {
      return await conversionResponse(path, {
        mode: "remux",
        height: (row.height as number | null) ?? null,
        sourceBitrate: (row.bitrate as number | null) ?? null,
        channels: firstChannelCount(row),
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
    query: t.Object({ start: t.Optional(t.Numeric()) }),
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
        channels: firstChannelCount(row),
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
    query: t.Object({ start: t.Optional(t.Numeric()) }),
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
