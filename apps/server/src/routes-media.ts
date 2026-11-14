import { canAccessFile } from "./access";
import { requestUser } from "./auth";
/// Media routes (PRD 5.8, 9).
///
/// - `GET /api/play/:fileId`             one-shot manifest: play path, title,
///                                       resume point, next episode, subtitles,
///                                       optimization state.
/// - `GET /api/stream/:fileId`           direct HTTP Range streaming. Serves
///                                       the prepared fast-start copy when one
///                                       exists, otherwise the original.
/// - `GET /api/stream/:fileId/remux`     rejects live conversion (409).
/// - `GET /api/stream/:fileId/transcode` rejects live conversion (409).
/// - `GET /api/subtitles/:fileId`        discovered tracks (embedded + sidecar).
/// - `GET /api/subtitles/:fileId/:track` WebVTT, from the extracted cache.
///
/// Files resolve only through database ids and paths constrained to a
/// configured library (PRD 11). Prepared copies live in app data; the original
/// media file is never modified.
import { Elysia, t } from "elysia";
import { stat } from "node:fs/promises";
import { extname } from "node:path";
import { q, type Row } from "./db";
import { log } from "./logger";
import {
  classifyPlayability,
  isStreamableContainer,
  mimeForContainer,
  rangeResponse, rowPlayabilityFacts, type BrowserCaps,
} from "./playback";
import {
  audioVariantView, enqueueAudioVariant, enqueueOptimization, optimizationView,
  usableAudioVariant, usableOptimizedPath,
} from "./optimize";
import { cachedEmbeddedSubtitle, findSidecarSubtitles, listSubtitleTracks, srtToVtt } from "./subtitles";
import { getConfig } from "./config";
import { storeProbeFacts } from "./media-facts";
import { getSkipSegments } from "./skip-segments";
import {
  trickplayFilePath, trickplayFrame, trickplayVtt, trickplayView,
} from "./trickplay";

// --- helpers -----------------------------------------------------------------

function getFile(fileOrItemId: number): Row | null {
  return (
    q<Row, [number]>("SELECT * FROM media_files WHERE id = ?").get(fileOrItemId) ??
    q<Row, [number]>("SELECT * FROM media_files WHERE item_id = ? AND unavailable = 0 ORDER BY id DESC LIMIT 1").get(fileOrItemId) ??
    null
  );
}

/** The requested file, or the item's newest available file. Null when missing on disk. */
async function openableFile(fileOrItemId: number): Promise<Row | null> {
  const row = getFile(fileOrItemId);
  if (!row) return null;
  try {
    if ((await stat(String(row.path))).isFile()) return row;
  } catch { /* fall through */ }
  q("UPDATE media_files SET unavailable = 1 WHERE id = ?").run(Number(row.id));
  return null;
}

function watchStateFor(itemId: number | null, request: Request) {
  if (!itemId) return null;
  const watch = q<Row>(
    `SELECT position_seconds, duration_seconds, played
     FROM watch_state WHERE item_id = ? AND user_id = ? LIMIT 1`,
  ).get(itemId, requestUser(request)?.id ?? 0);
  return watch ? {
    position: Number(watch.position_seconds),
    duration: watch.duration_seconds != null ? Number(watch.duration_seconds) : null,
    played: !!Number(watch.played),
  } : null;
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
      storeProbeFacts(Number(row.id), facts);
      const fresh = getFile(Number(row.id));
      if (fresh) return fresh;
    }
  } catch (err) {
    log.warn("media", "just-in-time probe failed", { fileId: row.id, message: String(err) });
  }
  return row;
}

/**
 * Serve an original file exactly as stored on disk. Used by native players via
 * `/api/stream/:fileId/original`; the browser route keeps its own policy.
 */
async function serveOriginal(request: Request, fileId: number): Promise<Response> {
  const row = await openableFile(fileId);
  if (!row) return Response.json({ error: "File unavailable" }, { status: 404 });
  const path = String(row.path);
  const info = await stat(path).catch(() => null);
  if (!info?.isFile()) return Response.json({ error: "File unavailable" }, { status: 404 });
  const response = await rangeResponse(
    request,
    Bun.file(path),
    info.size,
    mimeForContainer(row.container == null ? null : String(row.container)),
  );
  response.headers.set("X-Plexy-Source", "original");
  return response;
}

/**
 * Human label for a Matroska/MP4 language code. ffprobe reports ISO 639-2
 * ("hin", "eng"); Intl expects ISO 639-1, so the common cases are mapped.
 */
const LANGUAGE_639_1: Record<string, string> = {
  eng: "en", hin: "hi", tam: "ta", tel: "te", kan: "kn", mal: "ml", ben: "bn",
  mar: "mr", guj: "gu", pan: "pa", urd: "ur", san: "sa", spa: "es", fra: "fr",
  fre: "fr", deu: "de", ger: "de", ita: "it", jpn: "ja", kor: "ko", zho: "zh",
  chi: "zh", cmn: "zh", yue: "zh", rus: "ru", ara: "ar", por: "pt", nld: "nl",
  dut: "nl", swe: "sv", nor: "no", dan: "da", fin: "fi", pol: "pl", ces: "cs",
  cze: "cs", slk: "sk", slo: "sk", hun: "hu", ron: "ro", rum: "ro", tur: "tr",
  ell: "el", gre: "el", heb: "he", tha: "th", vie: "vi", ind: "id", msa: "ms",
  may: "ms", fil: "fil", ukr: "uk", fas: "fa", per: "fa",
};

function canonicalLanguage(code: string): string {
  const base = String(code ?? "").trim().toLowerCase().split(/[-_]/)[0] ?? "";
  return LANGUAGE_639_1[base] ?? base;
}

function languageLabel(code: string): string {
  const raw = String(code ?? "").trim().toLowerCase();
  if (!raw) return "selected";
  const iso = canonicalLanguage(raw);
  try {
    const name = new Intl.DisplayNames(["en"], { type: "language" }).of(iso);
    if (name && name !== iso) return name;
  } catch {
    /* older runtime without Intl.DisplayNames */
  }
  return iso.toUpperCase();
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
  /** Item the player's back control should open: the series for episodes, self otherwise. */
  parentItemId: number | null;
  parentPublicId: string | null;
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
    parentItemId: null as number | null,
    parentPublicId: null as string | null,
  };
  if (!itemId) return empty;

  const item = q<Row, [number]>(
    "SELECT id, name, kind, parent_id, public_id, season_number, episode_number FROM items WHERE id = ?",
  ).get(itemId);
  if (!item) return empty;

  if (String(item.kind) !== "episode" || item.parent_id == null) {
    // Movies and unparented files point back at themselves, so the player can
    // route to the title detail page without a second lookup.
    return {
      ...empty,
      title: String(item.name),
      parentItemId: itemId,
      parentPublicId: item.public_id ? String(item.public_id) : null,
    };
  }

  const parent = q<{ name: string; public_id: string | null }, [number]>("SELECT name, public_id FROM items WHERE id = ?")
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
    parentItemId: Number(item.parent_id),
    parentPublicId: parent?.public_id ? String(parent.public_id) : null,
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

    // Native clients (the desktop app's mpv window) read the original bytes and
    // do their own decoding, so browser codec rules and preparation do not
    // apply. They still use the same authorized file lookup and watch state.
    const nativeRequested = ctx.query.native === "1" || ctx.query.native === "true";

    const audioTracks = audioTracksFor(row).map((track, index) => ({ ...track, index }));
    const requestedAudioIndex = ctx.query.audio;
    const config = await getConfig();
    // The container's default track is index 0 unless the viewer explicitly
    // asked for another language. The preferred-language setting is a hint for
    // the native player's track choice, not an override of the file's default.
    const selectedAudioIndex = requestedAudioIndex != null
      && Number.isInteger(requestedAudioIndex)
      && requestedAudioIndex >= 0
      && requestedAudioIndex < audioTracks.length
      ? requestedAudioIndex
      : 0;

    let verdict = classifyPlayability(rowPlayabilityFacts(row), parseCaps(ctx.query.caps));
    const originalDirect = verdict.path === "direct";

    // Track 0 is served by the primary prepared copy (or the original when it
    // is directly playable). Any other language needs its own prepared copy,
    // because browsers cannot switch audio tracks inside one MP4.
    const preparedPrimary = nativeRequested ? null : await usableOptimizedPath(row);
    const preparedVariant = !nativeRequested && selectedAudioIndex > 0
      ? await usableAudioVariant(row, selectedAudioIndex)
      : null;
    const prepared = selectedAudioIndex === 0 ? preparedPrimary : preparedVariant;

    if (prepared) {
      verdict = { path: "direct", reason: "Prepared for instant playback and seeking" };
    }
    if (nativeRequested) {
      verdict = { path: "direct", reason: "Playing the original file in the native player" };
    } else if (!prepared && selectedAudioIndex > 0) {
      enqueueAudioVariant(Number(row.id), selectedAudioIndex);
      const label = languageLabel(audioTracks[selectedAudioIndex]?.language ?? "");
      verdict = {
        path: "unsupported",
        reason: `Preparing the ${label} audio track. This is a one-time step and takes a few seconds.`,
      };
    }
    // Identify the fallback immediately and prepare it in the background so the
    // next play is direct. This never blocks the current request.
    if (!nativeRequested && !prepared && selectedAudioIndex === 0
      && (verdict.path === "remux" || verdict.path === "transcode")) {
      enqueueOptimization(Number(row.id), { urgent: true });
      const state = optimizationView(getFile(Number(row.id)) ?? row);
      const waiting = state.status === "running" || state.status === "queued";
      verdict = { path: "unsupported", reason: waiting
        ? "Plexy is preparing this file so it plays smoothly in your browser. This is a one-time step."
        : "This file must finish preparation before playback. Live conversion is disabled." };
    }

    // Every language the menu may offer, marked with whether its copy exists.
    const audioTracksWithState = await Promise.all(audioTracks.map(async (track) => ({
      ...track,
      prepared: nativeRequested || (track.index === 0
        ? Boolean(preparedPrimary) || originalDirect
        : Boolean(await usableAudioVariant(row, track.index))),
    })));
    const watch = watchStateFor(row.item_id == null ? null : Number(row.item_id), ctx.request);

    const context = itemContext(row);
    const versions = row.item_id == null ? [] : q<Row>(
      `SELECT id, width, height, video_codec, hdr, size FROM media_files
       WHERE item_id = ? AND unavailable = 0 ORDER BY height DESC, size DESC, id DESC`,
    ).all(row.item_id as number).filter(version => !requestUser(ctx.request) || canAccessFile(requestUser(ctx.request), Number(version.id))).map((version) => {
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
    // Thumbnail extraction is queued by scanning, never by playback.
    const trickplay = trickplayView(row);

    log.debug("player", "play manifest", {
      fileId: row.id, path: verdict.path, prepared: Boolean(prepared),
      trickplay: trickplay.status,
    });

    return {
      ...verdict,
      fileId: Number(row.id),
      itemId: row.item_id as number | null,
      directPlayOnly: !nativeRequested,
      audioTracks: audioTracksWithState,
      selectedAudioIndex,
      versions,
      title: context.title,
      subtitle: context.subtitle,
      seasonNumber: context.seasonNumber,
      episodeNumber: context.episodeNumber,
      duration: context.duration,
      nextFileId: context.nextFileId,
      next: context.next,
      parentItemId: context.parentItemId,
      parentPublicId: context.parentPublicId,
      watch,
      tracks,
      trickplay,
      optimization: !nativeRequested && selectedAudioIndex > 0
        ? audioVariantView(getFile(Number(row.id)) ?? row, selectedAudioIndex)
        : optimizationView(getFile(Number(row.id)) ?? row),
      ...(nativeRequested
        ? {
            native: {
              streamUrl: `/api/stream/${Number(row.id)}/original`,
              preferredAudioLanguage: config.preferredAudioLanguage,
            },
          }
        : {}),
    };
  }, {
    params: t.Object({ fileId: t.Numeric() }),
    query: t.Object({
      caps: t.Optional(t.String()),
      audio: t.Optional(t.Numeric()),
      native: t.Optional(t.String()),
    }),
  })

  /** Community segment lookup is separately opt-in and never blocks stream startup. */
  .get("/skip-segments/:fileId", async ({ params }) => {
    const config = await getConfig();
    if (!config.skipSegmentsEnabled) {
      return { enabled: false, intro: null, recap: null, outro: null };
    }
    const file = getFile(Number(params.fileId));
    if (!file?.item_id) return { enabled: true, intro: null, recap: null, outro: null };
    const segments = await getSkipSegments(
      Number(file.item_id),
      file.duration == null ? null : Number(file.duration),
    );
    return { enabled: true, ...segments };
  }, { params: t.Object({ fileId: t.Numeric() }) })

  /** Playpath judgment for the current browser (kept for older clients). */
  .get("/playability/:fileId", async (ctx) => {
    let row = getFile(Number(ctx.params.fileId));
    if (!row) return Response.json({ error: "Not found" }, { status: 404 });
    row = await ensureFileProbed(row);
    let verdict = classifyPlayability(rowPlayabilityFacts(row), parseCaps(ctx.query.caps));

    if (await usableOptimizedPath(row)) {
      verdict = { path: "direct", reason: "Prepared for playback" };
    } else if (verdict.path === "remux" || verdict.path === "transcode") {
      enqueueOptimization(Number(row.id), { urgent: true });
      verdict = { path: "unsupported", reason: "This file must finish preparation before playback. Live conversion is disabled." };
    }
    const watch = watchStateFor(row.item_id == null ? null : Number(row.item_id), ctx.request);
    return {
      ...verdict,
      fileId: Number(row.id),
      itemId: row.item_id as number | null,
      watch,
    };
  }, {
    params: t.Object({ fileId: t.Numeric() }),
    query: t.Object({ caps: t.Optional(t.String()) }),
  })

  /** Direct HTTP Range streaming; prefers the prepared fast-start copy. */
  .get("/stream/:fileId", async (ctx) => {
    const row = await openableFile(Number(ctx.params.fileId));
    if (!row) return Response.json({ error: "File unavailable" }, { status: 404 });
    // A non-zero audio selection is served from its own prepared copy; the
    // primary copy only carries the first track.
    const requestedAudio = ctx.query.audio;
    if (requestedAudio != null && Number.isInteger(requestedAudio) && requestedAudio > 0) {
      const variant = await usableAudioVariant(row, requestedAudio);
      if (!variant) {
        return Response.json(
          { error: "This audio track is still being prepared." },
          { status: 409 },
        );
      }
      const variantInfo = await stat(variant);
      const response = await rangeResponse(ctx.request, Bun.file(variant), variantInfo.size, "video/mp4");
      response.headers.set("X-Plexy-Source", "audio-variant");
      return response;
    }
    const path = String(row.path);
    const prepared = await usableOptimizedPath(row);
    // Stale clients can request the direct URL even when the manifest says
    // preparation is required. Never send an MKV as video/mp4 in that case.
    if (!prepared && !isStreamableContainer(row.container == null ? null : String(row.container))) {
      return Response.json({ error: "This file must finish preparation before playback." }, { status: 409 });
    }
    const servePath = prepared ?? path;
    const st = await stat(servePath);
    const container = String(row.container ?? "").toLowerCase();
    const mime = prepared
      ? "video/mp4"
      : container === "webm" ? "video/webm" : "video/mp4";

    const response = await rangeResponse(ctx.request, Bun.file(servePath), st.size, mime);
    response.headers.set("X-Plexy-Source", prepared ? "optimized" : "original");
    return response;
  }, {
    params: t.Object({ fileId: t.Numeric() }),
    query: t.Object({ audio: t.Optional(t.Numeric()) }),
  })

  /**
   * Original media bytes, untouched, for native players (mpv). Unlike the
   * browser stream route this ignores the prepared copy and never rejects an
   * MKV: mpv decodes the source itself. Authorization is enforced by the
   * global access guard (`canAccessFile`) before this handler runs.
   */
  .get("/stream/:fileId/original", async (ctx) =>
    serveOriginal(ctx.request, Number(ctx.params.fileId)), {
    params: t.Object({ fileId: t.Numeric() }),
  })
  .head("/stream/:fileId/original", async (ctx) =>
    serveOriginal(ctx.request, Number(ctx.params.fileId)), {
    params: t.Object({ fileId: t.Numeric() }),
  })

  /** Authenticated download of the original file, untouched. */
  .get("/download/:fileId/info", async ({ params }) => {
    const row = await openableFile(Number(params.fileId));
    if (!row) return Response.json({ error: "File unavailable" }, { status: 404 });
    // Source downloads preserve every audio track and subtitle in the original.
    const info = await stat(String(row.path));
    return {
      size: info.size,
      etag: `"${Number(row.id)}-original-${info.size}-${Math.trunc(info.mtimeMs)}"`,
      source: "original",
    };
  }, { params: t.Object({ fileId: t.Numeric() }) })
  .get("/download/:fileId", async (ctx) => {
    const fileId = Number(ctx.params.fileId);
    const row = await openableFile(fileId);
    if (!row) return Response.json({ error: "File unavailable" }, { status: 404 });
    const path = String(row.path);

    const info = await stat(path);
    // A mobile download may resume days later, after the source was replaced.
    // If-Range prevents appending a new representation to an old one.
    const etag = `"${fileId}-original-${info.size}-${Math.trunc(info.mtimeMs)}"`;
    const ifRange = ctx.request.headers.get("If-Range");
    let downloadRequest = ctx.request;
    if (ifRange && ifRange !== etag) {
      const headers = new Headers(ctx.request.headers);
      headers.delete("Range");
      downloadRequest = new Request(ctx.request, { headers });
    }
    const response = await rangeResponse(downloadRequest, Bun.file(path), info.size, "application/octet-stream");
    response.headers.set("ETag", etag);
    const extension = extname(path).toLowerCase();
    response.headers.set("Content-Disposition", `attachment; filename=plexy-${fileId}${/^\.[a-z0-9]{1,8}$/.test(extension) ? extension : ".media"}`);
    response.headers.set("X-Plexy-Source", "original");
    return response;
  }, {
    params: t.Object({ fileId: t.Numeric() }),
  })

  /** Legacy clients receive an explicit rejection instead of starting conversion. */
  .get("/stream/:fileId/remux", () => {
    return Response.json({ error: "Live conversion is disabled. Prepare the file before playback." }, { status: 409 });
  }, {
    params: t.Object({ fileId: t.Numeric() }),
    query: t.Object({ start: t.Optional(t.Numeric()), audio: t.Optional(t.Numeric()) }),
  })

  .get("/stream/:fileId/transcode", () => {
    return Response.json({ error: "Live conversion is disabled. Prepare the file before playback." }, { status: 409 });
  }, {
    params: t.Object({ fileId: t.Numeric() }),
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

    const isBackdrop = row.kind === "backdrop";
    const h = isBackdrop ? Math.round(targetWidth * 0.5625) : Math.round(targetWidth * 1.5);
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${targetWidth}" height="${h}" viewBox="0 0 ${targetWidth} ${h}">
      <rect width="100%" height="100%" fill="#16181d"/>
    </svg>`;
    return new Response(svg, {
      status: 200,
      headers: {
        "Content-Type": "image/svg+xml",
        "Cache-Control": "public, max-age=60",
      },
    });
  }, {
    params: t.Object({ artworkId: t.Numeric() }),
    query: t.Object({ w: t.Optional(t.Numeric()) }),
  })

  /** Cast & crew profile photos served locally from originals/derived cache. */
  .get("/people/:personId/photo", async (ctx) => {
    const person = q<Row, [number]>("SELECT id, name, profile_path FROM people WHERE id = ?")
      .get(Number(ctx.params.personId));
    if (!person || !person.profile_path) {
      return Response.json({ error: "Not found" }, { status: 404 });
    }

    const widthParam = ctx.query.w ? Number(ctx.query.w) : null;
    const targetWidth = widthParam && widthParam > 50 && widthParam <= 1000 ? widthParam : 300;

    const { cacheArtworkOriginal, getOrCreateDerivative } = await import("./artwork");
    const meta = await cacheArtworkOriginal(String(person.profile_path));
    if (meta) {
      const derivedFile = await getOrCreateDerivative(meta.originalPath, targetWidth);
      return new Response(Bun.file(derivedFile), {
        headers: {
          "Content-Type": derivedFile.endsWith(".webp") ? "image/webp" : "image/jpeg",
          "Cache-Control": "public, max-age=31536000, immutable",
        },
      });
    }

    const initial = (String(person.name ?? "?")[0] ?? "?").toUpperCase();
    const h = Math.round(targetWidth * 1.5);
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${targetWidth}" height="${h}" viewBox="0 0 ${targetWidth} ${h}">
      <rect width="100%" height="100%" fill="#1a1c22"/>
      <text x="50%" y="50%" dominant-baseline="middle" text-anchor="middle" fill="#505462" font-family="system-ui, -apple-system, sans-serif" font-size="${Math.round(targetWidth * 0.35)}" font-weight="600">${initial}</text>
    </svg>`;
    return new Response(svg, {
      headers: {
        "Content-Type": "image/svg+xml",
        "Cache-Control": "public, max-age=300",
      },
    });
  }, {
    params: t.Object({ personId: t.Numeric() }),
    query: t.Object({ w: t.Optional(t.Numeric()) }),
  })

  /** Artwork storage statistics. */
  .get("/admin/artwork/storage", async () => {
    const { getArtworkStorageStats } = await import("./artwork");
    return await getArtworkStorageStats();
  })

  /** Trigger background pre-caching for all uncached library artwork. */
  .post("/admin/artwork/cache-all", async () => {
    const { cacheMissingArtwork } = await import("./artwork");
    void cacheMissingArtwork();
    return { ok: true, status: "started" };
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
