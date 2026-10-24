/// Logs + diagnostics routes (PRD 6, 9).
///
/// `GET /api/logs/stream` tails structured log lines over SSE,
/// `GET /api/logs` filters recent lines from memory, crash listing and
/// reports are served from the crash dir. All loopback-only because logs and
/// crash reports can contain sensitive local details.
import { Elysia, t } from "elysia";
import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import { subscribe, recentLogLines, log } from "./logger";
import { crashDir } from "./crash";
import { denyIfNotLocal } from "./essentials";

export const logsRoutes = new Elysia({ prefix: "/api", normalize: "typebox" })
  .get("/logs/stream", (ctx) => {
    const denied = denyIfNotLocal(ctx, "GET /api/logs/stream");
    if (denied) return denied;
    const encoder = new TextEncoder();
    const stream = new ReadableStream({
      start(controller) {
        const unsubscribe = subscribe((line) => {
          try { controller.enqueue(encoder.encode(`data: ${JSON.stringify({ line })}\n\n`)); }
          catch { /* client vanished */ }
        });
        // Historical tail so a fresh page shows context immediately.
        const history = recentLogLines().slice(-50);
        controller.enqueue(encoder.encode(
          `event: backfill\ndata: ${JSON.stringify(history)}\n\n`,
        ));
        (controller as unknown as { _unsubscribe?: () => void })._unsubscribe = unsubscribe;
      },
      cancel() {
        // subscriber cleanup happens through `subscribe`'s handle below
      },
    });
    // Attach cleanup by wrapping: ReadableStream has no close hook for cancel
    // with started subscriptions only — the cancel method suffices in Bun.
    return new Response(stream, {
      headers: { "Content-Type": "text/event-stream", "Cache-Control": "no-cache" },
    });
  })

  .get("/logs", ({ query, server, request }) => {
    const denied = denyIfNotLocal({ server, request }, "GET /api/logs");
    if (denied) return denied;
    let lines = recentLogLines();
    if (query.level) lines = lines.filter((l) => l.includes(`"level":"${query.level}"`));
    if (query.component) lines = lines.filter((l) => l.includes(`"component":"${query.component}"`));
    if (query.search) lines = lines.filter((l) => l.toLowerCase().includes(query.search!.toLowerCase()));
    return { lines: lines.slice(-500) };
  }, {
    query: t.Object({
      level: t.Optional(t.String()),
      component: t.Optional(t.String()),
      search: t.Optional(t.String()),
    }),
  })

  .get("/crashes", async (ctx) => {
    const denied = denyIfNotLocal(ctx, "GET /api/crashes");
    if (denied) return denied;
    try {
      const files = await readdir(crashDir());
      return {
        crashes: files
          .filter((f) => f.endsWith(".json") && f.startsWith("crash-"))
          .sort()
          .reverse()
          .map((name) => ({
            id: name.replace(/\.json$/, ""),
            ts: name.slice("crash-".length, -".json".length) || name,
          })),
      };
    } catch {
      return { crashes: [] as Array<{ id: string; ts: string }> };
    }
  })

  .get("/crashes/:id", async ({ params, server, request }) => {
    const denied = denyIfNotLocal({ server, request }, "GET /api/crashes/:id");
    if (denied) return denied;
    const id = params.id.replace(/[^\w.-]/g, ""); // no traversal
    if (!id.startsWith("crash-")) {
      return Response.json({ error: "Not found" }, { status: 404 });
    }
    try {
      const body = await readFile(join(crashDir(), `${id}.json`), "utf8");
      return new Response(body, {
        headers: {
          "Content-Type": "application/json",
          "Content-Disposition": `attachment; filename="${id}.json"`,
        },
      });
    } catch {
      return Response.json({ error: "Not found" }, { status: 404 });
    }
  });

void log;
