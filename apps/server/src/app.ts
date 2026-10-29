/// The Elysia application (PRD 4, 9).
///
/// Assembles every route module plus the embedded SPA fallback so one process
/// serves the API and the built web app. The settings response never carries
/// secrets: `config.ts redactedView` is the only projection. Admin routes
/// enforce loopback-only access with `essentials.denyIfNotLocal`.
import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { Elysia } from "elysia";
import { cors } from "@elysiajs/cors";
import { adminRoutes } from "./routes-admin";
import { authRoutes } from "./routes-auth";
import { catalogRoutes } from "./routes-catalog";
import { matchingRoutes } from "./routes-matching";
import { mediaRoutes } from "./routes-media";
import { logsRoutes } from "./routes-logs";
import { log } from "./logger";
import { authGuard } from "./auth";

export function buildApp(options: { requireAuth?: boolean } = {}) {
  const app = new Elysia({ normalize: "typebox" })
    .use(
      cors({
        origin: true,
        credentials: true,
        // Range/If-Range matter for cross-origin HLS and seeking; the rest are
        // the request headers used by the typed client.
        allowedHeaders: ["Content-Type", "Authorization", "Range", "If-Range"],
        exposeHeaders: ["Accept-Ranges", "Content-Range", "Content-Length"],
        methods: ["GET", "POST", "PUT", "DELETE", "PATCH", "HEAD", "OPTIONS"],
      }),
    )
    // Credential gate runs after CORS so 401 responses still carry the CORS
    // headers a hosted client needs to read them.
    .onRequest((ctx) => authGuard(ctx, options.requireAuth))
    .use(authRoutes)
    .use(adminRoutes)
    .use(catalogRoutes)
    .use(matchingRoutes)
    .use(mediaRoutes)
    .use(logsRoutes)
    .onRequest(({ request }) => {
      // Cheap start marker for the slow-request log below. Kept on the Request
      // object so concurrent requests cannot race on a shared variable.
      (request as Request & { __plexyStartedAt?: number }).__plexyStartedAt = performance.now();
    })
    .onAfterResponse({ as: "global" }, ({ request, set }) => {
      const started = (request as Request & { __plexyStartedAt?: number }).__plexyStartedAt;
      if (started == null) return;
      const ms = performance.now() - started;
      if (ms < 500) return;
      const url = new URL(request.url);
      // Streams and image bodies can legitimately run for a long time; log only
      // slow API metadata calls, which is where lag actually shows up.
      if (url.pathname.startsWith("/api/stream/")) return;
      log.warn("http", "slow request", {
        method: request.method,
        path: url.pathname,
        status: set.status ?? 200,
        ms: Math.round(ms),
      });
    })
    .onError({ as: "global" }, ({ error, code }) => {
      // Validation errors are client bugs; everything else we log loudly.
      if (code === "VALIDATION") {
        log.debug("http", "validation failed", { message: String(error) });
        return Response.json({ error: "Invalid request." }, { status: 422 });
      }
      log.error("http", "request failed", {
        message: error instanceof Error ? error.message : String(error),
      });
      return Response.json({ error: "Something went wrong on the server." }, { status: 500 });
    })
    .all("/*", staticFallback);

  return app;
}

export type App = ReturnType<typeof buildApp>;

function resolveDistDir(): string {
  const exeDir = process.argv[1] ? dirname(process.argv[1]) : "";
  const candidates = [
    process.env.PLEXY_RESOURCES_DIR ? join(process.env.PLEXY_RESOURCES_DIR, "web") : "",
    process.env.PLEXY_WEB_DIR || "",
    join(exeDir, "web"),
    join(exeDir, "..", "Resources", "web"),
    join(process.cwd(), "dist", "web"),
    join(import.meta.dir, "..", "..", "..", "dist", "web"),
    join(import.meta.dir, "..", "..", "dist", "web"),
    join(import.meta.dir, "web"),
  ].filter(Boolean);
  for (const c of candidates) {
    if (existsSync(c)) return c;
  }
  return candidates[0];
}

/**
 * Embedded SPA (PRD 7): serve `dist/web` with an index.html fallback for
 * client-side routing. Dev runs Vite itself; a missing dist answers with a
 * one-line pointer so the API is still testable with curl.
 */
async function staticFallback({ request }: { request: Request }): Promise<Response> {
  const url = new URL(request.url);
  if (url.pathname.startsWith("/api/")) {
    return Response.json({ error: "Not found" }, { status: 404 });
  }
  const distDir = resolveDistDir();
  if (!existsSync(distDir)) {
    return new Response(
      "Plexy dev: run `bun run dev` and open the Vite URL printed there.",
      { headers: { "Content-Type": "text/plain" } },
    );
  }
  if (url.pathname === "/" || !/\.[a-z0-9]+$/i.test(url.pathname)) {
    const indexPath = join(distDir, "index.html");
    if (existsSync(indexPath)) {
      const index = await readFile(indexPath);
      return new Response(index, {
        headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-cache" },
      });
    }
  }
  // Assets: prevent traversal, then serve with a cache lifetime. Vite output
  // under /assets is content-hashed, so it can be cached forever; the rest is
  // short-lived so a rebuild is picked up.
  const rel = url.pathname.replace(/^\/+/, "").replace(/\.\./g, "");
  const file = Bun.file(join(distDir, rel));
  if (await file.exists()) {
    const immutable = url.pathname.startsWith("/assets/");
    return new Response(file, {
      headers: {
        ...(file.type ? { "Content-Type": file.type } : {}),
        "Cache-Control": immutable
          ? "public, max-age=31536000, immutable"
          : "public, max-age=3600",
      },
    });
  }
  return Response.json({ error: "Not found" }, { status: 404 });
}
