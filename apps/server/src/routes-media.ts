/// Media routes (PRD 5.8, 9).
///
/// - `GET /api/stream/:fileId`           direct HTTP Range streaming.
/// - `GET /api/stream/:fileId/remux`     container-only fix (copy packets into
///                                       fragmented MP4 — no re-encode).
/// - `GET /api/stream/:fileId/transcode` on-demand re-encode to H.264 + AAC;
///                                       the player surfaces measured
///                                       startup/realtime state because M0
///                                       sets the final throughput limits.
/// - `GET /api/playability/:fileId`      classification for the current browser.
/// - `GET /api/subtitles/:fileId/:track.vtt` sidecar + embedded text as WebVTT.
///
/// Files resolve only through database ids and paths constrained to a
/// configured library (PRD 11). Conversion streams straight to the wire, so no
/// temporary segments are written to disk and there is nothing to clean up.
import { Elysia, t } from "elysia";
import { stat, readdir } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import { q, type Row } from "./db";
import { log } from "./logger";
import { classifyPlayability, rangeResponse, type BrowserCaps } from "./playback";
import {
  ALL_FORMATS, BlobSource, Input, Output, Conversion, Mp4OutputFormat,
  StreamTarget, EncodedPacketSink, type StreamTargetChunk,
} from "mediabunny";
import { registerMediabunnyServer } from "@mediabunny/server";

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

/** Output video bitrate for conversion, by source height (documented M0 cap). */
function pickVideoBitrate(height: number | null): number {
  if (height && height > 1600) return 14_000_000; // 4K: honest, heavy
  if (height && height > 1000) return 6_000_000;  // 1080p
  if (height && height > 600) return 3_000_000;   // 720p
  return 1_500_000;
}

interface ConversionOptions {
  trimStart?: number;
  mode: "remux" | "transcode";
  height: number | null;
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
    // remux: copy whenever possible (no codec change). transcode: always
    // re-encode into browser-native AVC/AAC.
    ...(options.mode === "remux" ? {} : {
      copy: false,
      video: { codec: "avc" as const, bitrate: pickVideoBitrate(options.height) },
      audio: { codec: "aac" as const, bitrate: 160_000 },
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

/** Minimal SRT → WebVTT (comma → dot milliseconds, WEBVTT header). */
function srtToVtt(srt: string): string {
  const body = srt
    .replace(/\r+/g, "")
    .replace(/^\uFEFF/, "")
    .replace(/(\d{2}:\d{2}:\d{2}),(\d{3})/g, "$1.$2");
  return `WEBVTT\n\n${body.trim()}\n`;
}

/** ASS/SSA dialogue → plain text lines (v1 conversion per PRD 5.8). */
function stripAssDialogue(text: string): string {
  return text
    .replace(/\{[^}]*\}/g, "")           // override blocks {\an8}
    .replace(/<[^>]+>/g, "")             // html-ish tags
    .replace(/\\N|\\n/g, "\n");
}

/** Extract one embedded text track as WebVTT text. */
async function embeddedVtt(path: string, trackIndex: number): Promise<string | null> {
  const input = new Input({ source: new BlobSource(Bun.file(path)), formats: ALL_FORMATS });
  try {
    const tracks = await input.getTracks();
    const subs = tracks.filter((tr) => tr.type === "subtitle");
    const track = subs[trackIndex];
    if (!track) return null;
    const codec = await track.getCodec();
    const sink = new EncodedPacketSink(track);
    const cues: string[] = [];
    for await (const packet of sink.packets()) {
      const text = new TextDecoder().decode(packet.data);
      const plain = codec === "webvtt"
        ? text.replace(/^WEBVTT[^\n]*\n?/, "")
        : stripAssDialogue(text)
          // bare SRT payloads: drop leading index + timestamp lines
          .replace(/^\s*\d+\s*$/m, "")
          .replace(/^\d{2}:\d{2}:\d{2}.{0,12}\s*-->.*$/m, "")
          .trim();
      if (!plain) continue;
      cues.push(`${fmtTs(packet.timestamp)}\n${plain}\n`);
    }
    if (!cues.length) return null;
    return `WEBVTT\n\n${cues.join("\n")}`;
  } finally {
    input.dispose();
  }
}

function fmtTs(seconds: number): string {
  const s = Math.max(0, seconds);
  const h = String(Math.floor(s / 3600)).padStart(2, "0");
  const m = String(Math.floor((s % 3600) / 60)).padStart(2, "0");
  const sec = String(Math.floor(s % 60)).padStart(2, "0");
  const ms = String(Math.round((s % 1) * 1000)).padStart(3, "0");
  return `${h}:${m}:${sec}.${ms}`;
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

// --- routes ------------------------------------------------------------------

export const mediaRoutes = new Elysia({ prefix: "/api", normalize: "typebox" })
  /** Playpath judgment for the current browser (PRD 5.6). */
  .get("/playability/:fileId", (ctx) => {
    const targetId = Number(ctx.params.fileId);
    const row = getFile(targetId)
      ?? q<Row>("SELECT * FROM media_files WHERE item_id = ? AND unavailable = 0 ORDER BY id DESC LIMIT 1").get(targetId);
    if (!row) return Response.json({ error: "Not found" }, { status: 404 });
    const verdict = classifyPlayability({
      container: (row.container as string | null) ?? "",
      videoCodec: row.video_codec as string | null,
      audioJson: (row.audio_json as string | null) ?? "[]",
      subtitlesJson: (row.subtitles_json as string | null) ?? "[]",
    }, parseCaps(ctx.query.caps));
    log.debug("player", "playability", { fileId: row.id, path: verdict.path });

    // Resume data for the player, resolved by the file alone.
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

  /** Direct HTTP Range streaming of the original file (PRD 5.8). */
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
    const st = await stat(path);
    const mime = (row.container as string | null) === "webm" ? "video/webm" : "video/mp4";
    return rangeResponse(ctx.request, Bun.file(path), st.size, mime);
  }, { params: t.Object({ fileId: t.Numeric() }) })

  /** Remux = container-only problem (PRD 5.8). Copy packets, near instant. */
  .get("/stream/:fileId/remux", async (ctx) => {
    const fileId = Number(ctx.params.fileId);
    const path = await openablePath(fileId);
    if (!path) return Response.json({ error: "File unavailable" }, { status: 404 });
    const row = getFile(fileId)!;
    try {
      return await conversionResponse(path, {
        mode: "remux", height: (row.height as number | null) ?? null,
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
  }, { params: t.Object({ fileId: t.Numeric() }) })

  /**
   * On-demand transcode (PRD 5.8). `start=` seconds resumes conversion from a
   * position; the player restarts the stream on long seeks. Failures return
   * honest errors, never a fake stream.
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
   * Local sidecar artwork (folder.jpg, seasonNN-poster.jpg, ...) referenced
   * only by artwork id. LAN-allowed like the stream routes; filesystem paths
   * never appear in any response (PRD 11). Remote rows redirect to the TMDB
   * image so cards can use one URL scheme either way.
   */
  /**
   * Serve artwork locally. Local sidecars are served directly; TMDB images are
   * served from locally cached originals and Bun.Image-generated derivatives
   * so artwork remains available even when completely offline.
   */
  .get("/images/:artworkId", async (ctx) => {
    const row = q<Row, [number]>("SELECT id, kind, source, url FROM artwork WHERE id = ?")
      .get(Number(ctx.params.artworkId));
    if (!row) return Response.json({ error: "Not found" }, { status: 404 });

    const widthParam = ctx.query.w ? Number(ctx.query.w) : null;
    const defaultWidth = row.kind === "backdrop" ? 1280 : row.kind === "thumb" ? 300 : 780;
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
    const path = await openablePath(Number(ctx.params.fileId));
    const row = getFile(Number(ctx.params.fileId));
    if (!row || !path) return Response.json({ tracks: [] });

    const embedded = row.subtitles_json
      ? JSON.parse(String(row.subtitles_json)) as Array<{ codec: string | null; language: string | null; title: string | null }>
      : [];
    const tracks = embedded.map((s, i) => ({
      track: `embedded-${i}`,
      kind: "embedded",
      language: s.language,
      title: s.title ?? s.language ?? `Track ${i + 1}`,
    }));

    const dir = dirname(path);
    const entries = await readdir(dir).catch(() => [] as string[]);
    for (const name of entries) {
      const m = name.toLowerCase().match(/^(.+)\.(vtt|srt)$/);
      if (!m || String(row.path).toLowerCase() === join(dir, name).toLowerCase()) continue;
      const label = m[1]!;
      tracks.push({ track: `sidecar-${label}`, kind: "sidecar", language: /(\.\w{2,3})$/.exec(label)?.[1]?.slice(1) ?? null, title: label });
    }
    return { tracks };
  }, { params: t.Object({ fileId: t.Numeric() }) })

  /**
   * Subtitles as WebVTT (PRD 5.8). `:track` is either `sidecar-<basename>` or
   * `embedded-<index>`. Styled ASS renders as plain text in v1.
   */
  .get("/subtitles/:fileId/:track", async (ctx) => {
    const path = await openablePath(Number(ctx.params.fileId));
    if (!path) return Response.json({ error: "File unavailable" }, { status: 404 });
    const track = ctx.params.track.replace(/\.vtt$/, "");

    if (track.startsWith("embedded-")) {
      const index = Number(track.slice("embedded-".length));
      if (!Number.isInteger(index)) return Response.json({ error: "Bad track" }, { status: 400 });
      try {
        const text = await embeddedVtt(path, index);
        if (!text) return Response.json({ error: "Track is empty" }, { status: 404 });
        return new Response(text, { headers: { "Content-Type": "text/vtt" } });
      } catch (err) {
        log.warn("player", "embedded subtitle extraction failed", {
          fileId: ctx.params.fileId, message: err instanceof Error ? err.message : String(err),
        });
        return Response.json({ error: "Subtitle extraction failed" }, { status: 500 });
      }
    }

    // Sidecar: plexy picks `<basename>.vtt` then `.srt` next to the video.
    const base = track.startsWith("sidecar-") ? track.slice("sidecar-".length) : track;
    if (!/^[\w .+\-()']+$/.test(base)) return Response.json({ error: "Bad track name" }, { status: 400 });
    const dir = dirname(path);
    for (const ext of ["vtt", "srt"]) {
      const file = Bun.file(join(dir, `${base}.${ext}`));
      if (await file.exists()) {
        const text = ext === "vtt" ? await file.text() : srtToVtt(await file.text());
        return new Response(text, { headers: { "Content-Type": "text/vtt" } });
      }
    }
    return Response.json({ error: "No subtitle file with that name" }, { status: 404 });
  }, {
    params: t.Object({ fileId: t.Numeric(), track: t.String() }),
  });
