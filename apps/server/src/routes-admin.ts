/// Admin routes (PRD 5.1, 5.2, 9).
///
/// Loopback-only per PRD 5.10: settings + TMDB test, server-side folder
/// browsing, library management, scan control with SSE progress, and crash
/// reports. The guard reads the socket address, which cannot be spoofed by
/// request headers.
import { Elysia, t } from "elysia";
import { readdir, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { isAbsolute, join, resolve, sep } from "node:path";
import { db, q, run, type Row } from "./db";
import { getConfig, save, redactedView } from "./config";
import { setLogLevel, getLogLevel, log } from "./logger";
import { APP_VERSION, crashDir } from "./crash";
import { testToken } from "./tmdb";
import { denyIfNotLocal, isLoopbackContext } from "./essentials";
import { startScan, currentScan, onScanProgress } from "./scan";
import { clearOptimizerCache, enqueueMissingOptimizations, optimizerStatus } from "./optimize";
import { VIDEO_EXTENSIONS } from "./parse";

const startedAt = Date.now();

// --- helpers -----------------------------------------------------------------

function sseHeaders(): HeadersInit {
  return {
    "Cache-Control": "no-cache",
    Connection: "keep-alive",
    "Content-Type": "text/event-stream",
  };
}

function expandPath(raw: string): string {
  if (raw === "~") return homedir();
  if (raw.startsWith("~" + sep)) return join(homedir(), raw.slice(2));
  return isAbsolute(raw) ? resolve(raw) : homedir();
}

interface FolderEntry { name: string; path: string; isDirectory: boolean; hasVideos: boolean }

/** List one directory for the server-side folder browser. */
async function listFolder(target: string): Promise<FolderEntry[]> {
  let dirents: import("node:fs").Dirent[] = [];
  try {
    dirents = await readdir(target, { withFileTypes: true });
  } catch {
    return [];
  }
  const out: FolderEntry[] = [];
  for (const d of dirents) {
    if (d.name.startsWith(".")) continue;
    const childPath = join(target, d.name);
    let hasVideos = false;
    if (d.isDirectory()) {
      // A quick peek: mark roots that plausibly contain media.
      try {
        const children = await readdir(childPath);
        hasVideos = children.some((c) =>
          VIDEO_EXTENSIONS.has(c.slice(c.lastIndexOf(".")).toLowerCase()));
      } catch { /* unreadable folders still render in the picker */ }
      out.push({ name: d.name, path: childPath, isDirectory: true, hasVideos });
    }
  }
  return out.sort((a, b) => a.name.localeCompare(b.name));
}

/** Crash report listing plus stored timestamps from the filenames. */
async function listCrashFiles(): Promise<Array<{ id: string; ts: string }>> {
  try {
    const files = await readdir(crashDir());
    return files
      .filter((f) => f.endsWith(".json") && f.startsWith("crash-"))
      .sort()
      .reverse()
      .map((name) => ({
        id: name.replace(/\.json$/, ""),
        ts: name.slice("crash-".length, -".json".length) || name,
      }));
  } catch {
    return [];
  }
}

// --- routes ------------------------------------------------------------------

export const adminRoutes = new Elysia({ prefix: "/api", normalize: "typebox" })
  /** Read-only status for both admin and viewer shells. */
  .get("/server/status", async (ctx) => {
    const cfg = await getConfig();
    const recentScans = q<Row>(
      "SELECT id, status, files_seen, issues, started_at, finished_at FROM scans ORDER BY id DESC LIMIT 5",
    ).all();
    const hasLibraries = Boolean(q<Row>("SELECT id FROM libraries LIMIT 1").get());
    const hasTmdbToken = Boolean(cfg.tmdbToken);
    return {
      version: APP_VERSION,
      bun: Bun.version,
      startedAt: new Date(startedAt).toISOString(),
      uptimeSeconds: Math.round((Date.now() - startedAt) / 1000),
      adminAvailable: isLoopbackContext(ctx),
      bind: cfg.bindAddress,
      port: cfg.port,
      hasTmdbToken,
      hasLibraries,
      setupComplete: hasTmdbToken && hasLibraries,
      scan: currentScan,
      recentScans,
      optimizer: await optimizerStatus(),
    };
  })

  // --- settings (loopback-only) ---------------------------------------------
  .get("/settings", async () => {
    const cfg = await getConfig();
    return { settings: redactedView(cfg), logLevel: getLogLevel() };
  })

  .put("/settings", async ({ body, server, request }) => {
    const denied = denyIfNotLocal({ server, request }, "PUT /api/settings");
    if (denied) return denied;
    const patch: Record<string, unknown> = {};
    if (body.logLevel) setLogLevel(body.logLevel);
    if (body.metadataLanguage) patch.metadataLanguage = body.metadataLanguage;
    if (body.metadataRegion) patch.metadataRegion = body.metadataRegion;
    if (body.imageQuality) patch.imageQuality = body.imageQuality;
    if (body.autoOptimize !== undefined) patch.autoOptimize = body.autoOptimize;
    if (body.optimizeMaxCacheGb !== undefined) patch.optimizeMaxCacheGb = body.optimizeMaxCacheGb;
    if (body.probeConcurrency !== undefined) patch.probeConcurrency = body.probeConcurrency;
    if (body.note !== undefined) patch.note = body.note;
    // Tokens only round-trip when genuinely provided; the UI never echoes the
    // stored value, so "{redacted}" sentinels are ignored.
    if (body.tmdbToken !== undefined && body.tmdbToken.trim() !== ""
      && !body.tmdbToken.startsWith("{")) {
      patch.tmdbToken = body.tmdbToken.trim();
    }
    const cfg = await save(patch);
    if (body.autoOptimize) {
      void enqueueMissingOptimizations().catch(() => {});
    }
    log.info("server", "settings updated", { logLevel: body.logLevel ?? undefined });
    return { settings: redactedView(cfg) };
  }, {
    body: t.Object({
      logLevel: t.Optional(t.Union([t.Literal("debug"), t.Literal("info"), t.Literal("warn"), t.Literal("error")])),
      metadataLanguage: t.Optional(t.String()),
      metadataRegion: t.Optional(t.String()),
      imageQuality: t.Optional(t.Union([t.Literal("w342"), t.Literal("w500"), t.Literal("w780"), t.Literal("original")])),
      autoOptimize: t.Optional(t.Boolean()),
      optimizeMaxCacheGb: t.Optional(t.Numeric()),
      probeConcurrency: t.Optional(t.Numeric()),
      tmdbToken: t.Optional(t.String()),
      note: t.Optional(t.String()),
    }),
  })

  /** Preparation queue state: what is running, how far along, cache size. */
  .get("/optimize/status", async () => optimizerStatus())

  /** Queue every probed file again, including previous failures. */
  .post("/optimize/run", async (ctx) => {
    const denied = denyIfNotLocal(ctx, "POST /api/optimize/run");
    if (denied) return denied;
    const requested = await enqueueMissingOptimizations({ includeFailed: true });
    log.info("optimizer", "manual preparation run requested", { queued: requested });
    return { ...(await optimizerStatus()), requested };
  })

  /** Delete every prepared copy; the originals are untouched. */
  .post("/optimize/clear", async (ctx) => {
    const denied = denyIfNotLocal(ctx, "POST /api/optimize/clear");
    if (denied) return denied;
    const removed = await clearOptimizerCache();
    log.info("optimizer", "prepared copies cleared", { removed });
    return { removed };
  })

  /** "Test TMDB token": success message or the exact failure (PRD 5.1). */
  .post("/settings/tmdb/test", async (ctx) => {
    const denied = denyIfNotLocal(ctx, "POST /api/settings/tmdb/test");
    if (denied) return denied;
    return await testToken();
  })

  /**
   * Server-side folder browser (PRD 10.1): browses the machine running
   * Plexy. The UI must never imply this is a browser-side file picker.
   */
  .get("/local-folders", async ({ query, server, request }) => {
    const denied = denyIfNotLocal({ server, request }, "GET /api/local-folders");
    if (denied) return denied;
    const target = expandPath(query.path || "~");
    try {
      let isDirectory = true;
      try {
        const st = await stat(target);
        isDirectory = st.isDirectory();
      } catch {
        // If stat is restricted on special macOS folders, still attempt to list
      }
      if (!isDirectory) {
        return Response.json({ error: `${target} is not a directory` }, { status: 400 });
      }
      const entries = await listFolder(target);
      const parent = target.length > sep.length ? join(target, "..") : null;
      return { path: target, parent, entries };
    } catch (err) {
      return Response.json(
        { error: `Cannot browse ${target}: ${err instanceof Error ? err.message : String(err)}` },
        { status: 400 },
      );
    }
  }, { query: t.Object({ path: t.Optional(t.String()) }) })

  // --- libraries (loopback-only per PRD 5.10) --------------------------------
  .get("/libraries", async (ctx) => {
    const denied = denyIfNotLocal(ctx, "GET /api/libraries");
    if (denied) return denied;
    const rows = q<Row>("SELECT * FROM libraries ORDER BY id").all();
    return {
      libraries: rows.map((row) => {
        const id = Number(row.id);
        const count = (status: string): number => {
          const r = q<Row>(
            "SELECT COUNT(*) as n FROM items WHERE library_id = ? AND kind IN ('movie','series')" +
            " AND match_status = ?",
          ).get(id, status);
          return Number(r?.n ?? 0);
        };
        return {
          id,
          name: String(row.name),
          type: String(row.type),
          language: String(row.language),
          paths: q<Row>("SELECT path FROM library_paths WHERE library_id = ?")
            .all(id).map((p) => String(p.path)),
          counts: {
            items: count("matched"),
            review: count("review"),
            unmatched: count("unmatched"),
          },
        };
      }),
    };
  })

  .post("/libraries", async ({ body, server, request }) => {
    const denied = denyIfNotLocal({ server, request }, "POST /api/libraries");
    if (denied) return denied;

    // Validate each root: exists, readable, not overlapping another library.
    const existing = q<Row>("SELECT path FROM library_paths").all().map((r) => String(r.path));
    const resolvedPaths: string[] = [];
    for (const rawPath of body.paths) {
      const current = expandPath(rawPath);
      let exists = false;
      try {
        const st = await stat(current);
        exists = st.isDirectory();
      } catch {
        try {
          await readdir(current);
          exists = true;
        } catch {}
      }
      if (!exists) {
        return Response.json(
          { error: `Path does not exist or is not a directory: ${rawPath}` },
          { status: 400 },
        );
      }
      const overlap = existing.find((e) =>
        e === current || current.startsWith(e + sep) || e.startsWith(current + sep));
      if (overlap) {
        return Response.json(
          { error: `This path overlaps an existing library root (${overlap})` },
          { status: 400 },
        );
      }
      existing.push(current);
      resolvedPaths.push(current);
    }

    run("INSERT INTO libraries (name, type, language) VALUES (?,?,?)",
      body.name.trim(), body.type, body.language ?? "en-US");
    const created = q<Row>("SELECT id FROM libraries ORDER BY id DESC LIMIT 1").get() as Row;
    const id = Number(created.id);
    for (const path of resolvedPaths) {
      q("INSERT INTO library_paths (library_id, path) VALUES (?,?)").run(id, path);
    }
    log.info("scanner", "library added", { name: body.name, paths: resolvedPaths });
    // Scan immediately so the setup flow feels complete (PRD 10.1).
    startScan([id]);
    return { id };
  }, {
    body: t.Object({
      name: t.String({ minLength: 1 }),
      type: t.Union([t.Literal("movies"), t.Literal("tv")]),
      language: t.Optional(t.String()),
      paths: t.Array(t.String({ minLength: 1 }), { minLength: 1 }),
    }),
  })

  /** Removing a library deletes its records only — media is never touched. */
  .delete("/libraries/:id", async ({ params, server, request }) => {
    const denied = denyIfNotLocal({ server, request }, "DELETE /api/libraries/:id");
    if (denied) return denied;
    q("DELETE FROM libraries WHERE id = ?").run(Number(params.id));
    log.info("scanner", "library removed", { id: Number(params.id) });
    return { ok: true };
  })

  .post("/libraries/:id/scan", async ({ params, server, request }) => {
    const denied = denyIfNotLocal({ server, request }, "POST /api/libraries/:id/scan");
    if (denied) return denied;
    const id = Number(params.id);
    const scanId = startScan([id]);
    if (scanId == null && currentScan) {
      return { alreadyRunning: true, scanId: currentScan.scanId };
    }
    return { scanId };
  })

  /**
   * SSE scan progress (PRD 9). Sends the current snapshot (if it matches),
   * then every update, and closes when that scan finishes.
   */
  .get("/scans/:id/events", ({ params }) => {
    const wanted = Number(params.id);
    const encoder = new TextEncoder();
    let live = true;
    const stream = new ReadableStream({
      start(controller) {
        const push = (event: object) => {
          if (!live) return;
          try {
            controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
          } catch {
            live = false;
          }
        };
        const unsubscribe = onScanProgress((p) => {
          if (p.scanId !== wanted) return;
          push(p);
          if (p.status !== "running") {
            live = false;
            try { controller.close(); } catch { /* already closed */ }
            unsubscribe();
          }
        });
        if (currentScan) push(currentScan);
        else {
          live = false;
          try { controller.close(); } catch { /* already closed */ }
        }
      },
      cancel() { live = false; },
    });
    return new Response(stream, { headers: sseHeaders() });
  });
