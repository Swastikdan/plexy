import { apiError, isDirectLoopbackContext } from "./essentials";
/// The Elysia application (PRD 4, 9).
///
/// Assembles every route module plus the embedded SPA fallback so one process
/// serves the API and the built web app. The settings response never carries
/// secrets: `config.ts redactedView` is the only projection. Admin routes
/// enforce loopback-only access with `essentials.denyIfNotLocal`.
import { readFile } from "node:fs/promises";
import { existsSync, statSync } from "node:fs";
import { networkInterfaces } from "node:os";
import { join, dirname } from "node:path";
import { Elysia } from "elysia";
import { cors } from "@elysiajs/cors";
import { adminRoutes } from "./routes-admin";
import { authRoutes } from "./routes-auth";
import { catalogRoutes } from "./routes-catalog";
import { collectionRoutes } from "./routes-collections";
import { matchingRoutes } from "./routes-matching";
import { mediaRoutes } from "./routes-media";
import { logsRoutes } from "./routes-logs";
import { diagnosticsRoutes } from "./routes-diagnostics";
import { log } from "./logger";
import { accessGuard } from "./access";
import { authGuard } from "./auth";

function configuredCorsOrigins(): Set<string> {
  return new Set(
    String(Bun.env.PLEXY_ALLOWED_ORIGINS ?? "")
      .split(",")
      .map((value) => value.trim())
      .filter(Boolean)
      .flatMap((value) => {
        try {
          const url = new URL(value);
          return url.origin === "null" ? [] : [url.origin];
        } catch {
          return [];
        }
      }),
  );
}

/// `bun dev` serves the UI from Vite on a different origin than the API, so the
/// allow-list above would reject the developer's own browser. Trust browser
/// origins on this machine's own addresses while the server runs from source;
/// packaged builds and binaries keep the strict allow-list.
function devOriginTrusted(): boolean {
  const entry = (Bun.main ?? import.meta.path).replaceAll("\\", "/");
  return entry.includes("/apps/server/src/");
}

function localHostnames(): Set<string> {
  const hosts = new Set(["localhost", "127.0.0.1", "::1"]);
  for (const entry of Object.values(networkInterfaces()).flat()) {
    if (!entry || entry.internal) continue;
    hosts.add(entry.address.toLowerCase());
  }
  return hosts;
}

export function buildApp(
  options: {
    requireAuth?: boolean;
    allowedOrigins?: string[];
    ui?: boolean;
  } = {},
) {
  const allowedOrigins = new Set(
    (options.allowedOrigins ?? [...configuredCorsOrigins()]).flatMap(
      (value) => {
        try {
          const url = new URL(value);
          return url.origin === "null" ? [] : [url.origin];
        } catch {
          return [];
        }
      },
    ),
  );
  const trustDevOrigins = devOriginTrusted();
  const localHosts = trustDevOrigins ? localHostnames() : new Set<string>();
  const originAllowed = (request: Request): boolean => {
    const origin = request.headers.get("origin");
    if (!origin) return false;
    try {
      const parsed = new URL(origin);
      const normalized = parsed.origin;
      if (normalized === new URL(request.url).origin) return true;
      if (allowedOrigins.has(normalized)) return true;
      if (!trustDevOrigins || parsed.protocol !== "http:") return false;
      const hostname = parsed.hostname.toLowerCase().replace(/^\[|\]$/g, "");
      return localHosts.has(hostname);
    } catch {
      return false;
    }
  };
  const app = new Elysia({ normalize: "typebox" })
    .use(
      cors({
        origin: originAllowed,
        credentials: true,
        // Range/If-Range matter for cross-origin HLS and seeking; the rest are
        // the request headers used by the typed client.
        allowedHeaders: ["Content-Type", "Authorization", "Range", "If-Range"],
        exposeHeaders: [
          "Accept-Ranges",
          "Content-Range",
          "Content-Length",
          "ETag",
          "X-Request-Id",
        ],
        methods: ["GET", "POST", "PUT", "DELETE", "PATCH", "HEAD", "OPTIONS"],
      }),
    )
    // Credential gate runs after CORS so 401 responses still carry the CORS
    // headers a hosted client needs to read them.
    .onRequest(({ request, set }) => {
      const requestId = crypto.randomUUID();
      (request as Request & { __plexyRequestId?: string }).__plexyRequestId =
        requestId;
      set.headers["x-request-id"] = requestId;
      set.headers["x-content-type-options"] = "nosniff";
      set.headers["referrer-policy"] = "no-referrer";
      if (new URL(request.url).pathname.startsWith("/api/"))
        set.headers["cache-control"] = "private, no-store";
      if (request.headers.has("origin") && !originAllowed(request)) {
        return Response.json(
          { error: "This browser origin is not allowed." },
          { status: 403 },
        );
      }
    })
    .onRequest((ctx) => {
      const path = new URL(ctx.request.url).pathname;
      if (
        path.startsWith("/api/") &&
        path !== "/api/server/status" &&
        path !== "/api/auth/setup" &&
        ctx.request.method !== "OPTIONS" &&
        new URL(ctx.request.url).protocol !== "https:" &&
        !isDirectLoopbackContext(ctx)
      ) {
        return Response.json(
          {
            error: "Use the server’s HTTPS address to sign in or access media.",
            code: "HTTPS_REQUIRED",
          },
          { status: 426 },
        );
      }
    })
    .onRequest((ctx) => authGuard(ctx, options.requireAuth))
    .onRequest((ctx) => {
      if (Bun.env.NODE_ENV !== "test" || options.requireAuth)
        return accessGuard(ctx);
    })
    .onError({ as: "global" }, ({ error, code, request }) => {
      // Validation errors are client bugs; everything else we log loudly.
      if (code === "VALIDATION") {
        log.debug("http", "validation failed", { message: String(error) });
        return apiError("Invalid request.", 422);
      }
      log.error("http", "request failed", {
        requestId: (request as Request & { __plexyRequestId?: string })
          .__plexyRequestId,
        method: request.method,
        path: new URL(request.url).pathname,
        message: error instanceof Error ? error.message : String(error),
      });
      return Response.json(
        { error: "Something went wrong on the server." },
        { status: 500 },
      );
    })
    .use(authRoutes)
    .use(adminRoutes)
    .use(catalogRoutes)
    .use(collectionRoutes)
    .use(matchingRoutes)
    .use(mediaRoutes)
    .use(logsRoutes)
    .use(diagnosticsRoutes)
    .onRequest(({ request }) => {
      // Cheap start marker for the slow-request log below. Kept on the Request
      // object so concurrent requests cannot race on a shared variable.
      (request as Request & { __plexyStartedAt?: number }).__plexyStartedAt =
        performance.now();
    })
    .onAfterResponse({ as: "global" }, ({ request, set }) => {
      const started = (request as Request & { __plexyStartedAt?: number })
        .__plexyStartedAt;
      if (started == null) return;
      const ms = performance.now() - started;
      if (ms < 500) return;
      const url = new URL(request.url);
      // Streams and image bodies can legitimately run for a long time; log only
      // slow API metadata calls, which is where lag actually shows up.
      if (url.pathname.startsWith("/api/stream/")) return;
      log.warn("http", "slow request", {
        requestId: (request as Request & { __plexyRequestId?: string })
          .__plexyRequestId,
        method: request.method,
        path: url.pathname,
        status: set.status ?? 200,
        ms: Math.round(ms),
      });
    })

    .all(
      "/*",
      options.ui === false || !browserUiEnabled()
        ? () =>
            apiError("Browser UI is disabled.", 404)
        : staticFallback,
    );

  return app;
}

export function browserUiEnabled(
  argv = process.argv,
  env = process.env,
): boolean {
  return (
    !argv.includes("--no-ui") &&
    env.PLEXY_NO_UI !== "1" &&
    env.PLEXY_NO_UI !== "true"
  );
}

export type App = ReturnType<typeof buildApp>;

function resolveDistDir(): string {
  const exeDir = process.argv[1] ? dirname(process.argv[1]) : "";
  const candidates = [
    process.env.PLEXY_RESOURCES_DIR
      ? join(process.env.PLEXY_RESOURCES_DIR, "web")
      : "",
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
 * One built index.html, retained between requests. The identity (path, mtime,
 * size) is checked on every request so a rebuilt `dist/web` is picked up
 * without a restart; encoded copies are read from the build output once, and
 * only generated in memory when the build did not emit them.
 */
interface EncodedBody {
  body: Uint8Array<ArrayBuffer>;
  etag: string;
}

interface CachedIndex {
  path: string;
  mtimeMs: number;
  size: number;
  body: Uint8Array<ArrayBuffer>;
  etag: string;
  gzip: EncodedBody;
  brotli: EncodedBody | null;
}

let cachedIndex: CachedIndex | null = null;

function contentEtag(body: Uint8Array): string {
  return `"${body.byteLength.toString(16)}-${Bun.hash(body).toString(16)}"`;
}

function acceptsEncoding(header: string | null, encoding: "gzip" | "br"): boolean {
  if (!header) return false;
  let wildcard = false;
  for (const part of header.split(",")) {
    const [name, ...params] = part.trim().toLowerCase().split(";");
    const q = params.find((param) => param.trim().startsWith("q="));
    const accepted = !q || Number(q.trim().slice(2)) > 0;
    if (name === encoding) return accepted; // an explicit entry wins
    if (name === "*") wildcard = accepted;
  }
  return wildcard;
}

function etagMatches(header: string | null, etag: string): boolean {
  if (!header) return false;
  return header
    .split(",")
    .some((value) => value.trim() === "*" || value.trim() === etag);
}

/** Read a build-time `.br`/`.gz` sibling when it is not older than the source. */
async function readEncoded(
  indexPath: string,
  suffix: "br" | "gz",
  sourceMtimeMs: number,
): Promise<EncodedBody | null> {
  const path = `${indexPath}.${suffix}`;
  const stat = statSync(path, { throwIfNoEntry: false });
  if (!stat?.isFile() || stat.mtimeMs + 1_000 < sourceMtimeMs) return null;
  const body = new Uint8Array(await readFile(path));
  return {
    body,
    etag: `${contentEtag(body).slice(0, -1)}-${suffix === "br" ? "br" : "gzip"}"`,
  };
}

async function cachedIndexFor(indexPath: string): Promise<CachedIndex | null> {
  const stat = statSync(indexPath, { throwIfNoEntry: false });
  if (!stat?.isFile()) return null;
  if (
    cachedIndex &&
    cachedIndex.path === indexPath &&
    cachedIndex.mtimeMs === stat.mtimeMs &&
    cachedIndex.size === stat.size
  ) {
    return cachedIndex;
  }
  // Copy out of Bun's pooled Buffer into a plain ArrayBuffer-backed view:
  // Response bodies must not reference shared/pooled memory.
  const body = new Uint8Array(await readFile(indexPath));
  const etag = contentEtag(body);
  const precompressed = await Promise.all([
    readEncoded(indexPath, "br", stat.mtimeMs),
    readEncoded(indexPath, "gz", stat.mtimeMs),
  ]);
  const gzip =
    precompressed[1] ?? {
      body: new Uint8Array(Bun.gzipSync(body)),
      etag: `${etag.slice(0, -1)}-gzip"`,
    };
  cachedIndex = {
    path: indexPath,
    mtimeMs: stat.mtimeMs,
    size: stat.size,
    body,
    etag,
    gzip,
    brotli: precompressed[0],
  };
  return cachedIndex;
}

/**
 * Embedded SPA (PRD 7): serve `dist/web` with an index.html fallback for
 * client-side routing. Dev runs Vite itself; a missing dist answers with a
 * one-line pointer so the API is still testable with curl.
 */
async function staticFallback({
  request,
}: {
  request: Request;
}): Promise<Response> {
  const url = new URL(request.url);
  if (url.pathname.startsWith("/api/")) {
    return apiError("Not found", 404);
  }
  const distDir = resolveDistDir();
  if (!existsSync(distDir)) {
    return new Response(
      "Plexy dev: run `bun run dev` and open the Vite URL printed there.",
      { headers: { "Content-Type": "text/plain" } },
    );
  }
  if (url.pathname === "/" || !/\.[a-z0-9]+$/i.test(url.pathname)) {
    const index = await cachedIndexFor(join(distDir, "index.html"));
    if (index) {
      const accept = request.headers.get("accept-encoding");
      const brotli = index.brotli && acceptsEncoding(accept, "br") ? index.brotli : null;
      const gzip = !brotli && acceptsEncoding(accept, "gzip") ? index.gzip : null;
      const encoded = brotli ?? gzip;
      const etag = encoded?.etag ?? index.etag;
      const headers: Record<string, string> = {
        ETag: etag,
        "Cache-Control": "no-cache",
        // Origin is part of the CORS plugin's contract; keep it alongside the
        // compression variant so shared caches never mix origins or encodings.
        Vary: "Origin, Accept-Encoding",
      };
      if (etagMatches(request.headers.get("if-none-match"), etag)) {
        return new Response(null, { status: 304, headers });
      }
      if (brotli) headers["Content-Encoding"] = "br";
      else if (gzip) headers["Content-Encoding"] = "gzip";
      return new Response(encoded?.body ?? index.body, {
        headers: {
          ...headers,
          "Content-Type": "text/html; charset=utf-8",
        },
      });
    }
  }
  // Assets: prevent traversal, then serve with a cache lifetime. Vite output
  // under /assets is content-hashed, so it can be cached forever; the rest is
  // short-lived so a rebuild is picked up. The weak validator is derived from
  // file metadata, so serving an asset never reads its bytes into memory.
  const rel = url.pathname.replace(/^\/+/, "").replace(/\.\./g, "");
  const file = Bun.file(join(distDir, rel));
  if (await file.exists()) {
    const immutable = url.pathname.startsWith("/assets/");
    const etag = `W/"${file.size.toString(16)}-${Math.trunc(file.lastModified).toString(16)}"`;
    const headers: Record<string, string> = {
      ...(file.type ? { "Content-Type": file.type } : {}),
      ETag: etag,
      "Cache-Control": immutable
        ? "public, max-age=31536000, immutable"
        : "public, max-age=3600",
    };
    if (etagMatches(request.headers.get("if-none-match"), etag)) {
      return new Response(null, { status: 304, headers });
    }
    return new Response(file, { headers });
  }
  return apiError("Not found", 404);
}
