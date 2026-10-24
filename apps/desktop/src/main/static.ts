/// Minimal static server used only when the bundled Plexy backend cannot start.
///
/// The normal desktop app loads the UI from its own backend. If that backend
/// fails, this keeps the window alive so the shared connection screen can ask
/// for a different Plexy server instead of quitting with a native error box.
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { app } from "electron";

const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".gif": "image/gif",
  ".ico": "image/x-icon",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".ttf": "font/ttf",
  ".otf": "font/otf",
  ".map": "application/json; charset=utf-8",
  ".txt": "text/plain; charset=utf-8",
  ".vtt": "text/vtt; charset=utf-8",
  ".wasm": "application/wasm",
  ".webmanifest": "application/manifest+json",
};

function resolveWebDir(): string | null {
  const candidates = [
    path.join(process.resourcesPath, "web"),
    path.resolve(app.getAppPath(), "..", "..", "dist", "web"),
    path.join(app.getAppPath(), "dist", "web"),
    path.join(process.cwd(), "dist", "web"),
  ];

  for (const candidate of candidates) {
    if (existsSync(path.join(candidate, "index.html"))) return candidate;
  }
  return null;
}

export async function startStaticUi(): Promise<{
  url: string;
  close: () => Promise<void>;
}> {
  const webDir = resolveWebDir();
  if (!webDir) {
    throw new Error("Could not find the bundled Plexy web UI.");
  }

  const indexPath = path.join(webDir, "index.html");
  const indexHtml = await readFile(indexPath);

  const server = createServer((request, response) => {
    void handleRequest(request, response, webDir, indexHtml).catch((error) => {
      console.error("[Plexy Desktop] Static UI request failed:", error);
      if (!response.headersSent) {
        response.writeHead(500, { "Content-Type": "text/plain; charset=utf-8" });
      }
      response.end("Could not load the Plexy UI.");
    });
  });

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      server.off("error", reject);
      resolve();
    });
  });

  const address = server.address();
  if (!address || typeof address === "string") {
    server.close();
    throw new Error("Could not allocate a local port for the Plexy window.");
  }

  return {
    url: `http://127.0.0.1:${address.port}`,
    close: () =>
      new Promise<void>((resolve) => {
        server.close(() => resolve());
        // Chromium keeps connections alive; don't let shutdown hang on them.
        server.closeAllConnections();
      }),
  };
}

async function handleRequest(
  request: IncomingMessage,
  response: ServerResponse,
  webDir: string,
  indexHtml: Buffer,
): Promise<void> {
  if (request.method !== "GET" && request.method !== "HEAD") {
    response.writeHead(405, { Allow: "GET, HEAD" });
    response.end();
    return;
  }

  const url = new URL(request.url ?? "/", "http://127.0.0.1");

  // The connection screen probes this endpoint; answer like a Plexy server
  // that is simply not running, rather than with the SPA shell.
  if (url.pathname.startsWith("/api/")) {
    response.writeHead(503, {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
    });
    response.end(
      JSON.stringify({
        error:
          "Plexy's built-in server is not running. Choose another server from the connection screen.",
      }),
    );
    return;
  }

  let relative: string;
  try {
    relative = decodeURIComponent(url.pathname).replace(/^\/+/, "");
  } catch {
    response.writeHead(400, { "Content-Type": "text/plain; charset=utf-8" });
    response.end("Bad request");
    return;
  }

  const resolved = path.resolve(webDir, relative);
  const insideWebDir =
    resolved === webDir || resolved.startsWith(webDir + path.sep);
  const looksLikeAsset = /\.[a-z0-9]+$/i.test(relative);

  let target = resolved;
  let serveIndex = false;

  if (!insideWebDir || !relative || !looksLikeAsset) {
    // Client-side route: serve the SPA shell.
    serveIndex = true;
  } else if (!existsSync(resolved)) {
    response.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
    response.end("Not found");
    return;
  }

  if (serveIndex) target = path.join(webDir, "index.html");

  const body = serveIndex ? indexHtml : await readFile(target);
  const extension = path.extname(target).toLowerCase();

  response.writeHead(200, {
    "Content-Type": MIME[extension] ?? "application/octet-stream",
    "Cache-Control": serveIndex ? "no-cache" : "public, max-age=3600",
  });

  if (request.method === "HEAD") response.end();
  else response.end(body);
}
