/// Loopback media relay for native playback.
///
/// mpv does not share Chromium's cookie jar, so it must never receive backend
/// credentials. Electron registers the few URLs one playback session needs
/// (the original file, sidecar subtitles) and mpv receives an unguessable
/// loopback URL instead. The relay forwards Range requests and response
/// headers with streaming backpressure; it is not a general proxy: only URLs
/// explicitly registered for the active session on the active server resolve.
import { randomBytes } from "node:crypto";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { Socket } from "node:net";
import { Readable } from "node:stream";
import type * as Electron from "electron";

const FORWARDED_HEADERS = [
  "content-type",
  "content-length",
  "content-range",
  "accept-ranges",
  "etag",
  "last-modified",
] as const;

/** Injectable upstream fetch so tests can exercise the relay without Electron. */
export type RelayFetch = (
  url: string,
  init: { method: string; headers: Record<string, string>; signal: AbortSignal },
) => Promise<Response>;

/** Electron's network stack carries the session cookies mpv does not have. */
const electronFetch: RelayFetch = (url, init) => {
  const electron = require("electron") as typeof Electron;
  return electron.net.fetch(url, init as Parameters<typeof electron.net.fetch>[1]);
};

export class MediaRelay {
  private readonly token = randomBytes(24).toString("hex");
  private readonly slots = new Map<string, URL>();
  private readonly sockets = new Set<Socket>();
  private server: Server | null = null;
  private port = 0;
  private closed = false;

  constructor(
    private readonly origin: string,
    private readonly fetcher: RelayFetch = electronFetch,
  ) {
    this.origin = new URL(origin).origin;
  }

  async start(): Promise<number> {
    if (this.server) return this.port;
    const server = createServer((request, response) => {
      void this.handle(request, response);
    });
    server.on("connection", (socket) => {
      this.sockets.add(socket);
      socket.on("close", () => this.sockets.delete(socket));
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
      throw new Error("Media relay could not bind to loopback");
    }
    this.server = server;
    this.port = address.port;
    return this.port;
  }

  /**
   * Register one backend resource and return the loopback URL mpv should use.
   * The target must live on this session's server; anything else is rejected
   * so a compromised renderer cannot turn the relay into an open proxy.
   */
  register(rawUrl: string): string {
    const target = new URL(rawUrl, this.origin);
    if (target.origin !== this.origin) {
      throw new Error("Native playback can only relay resources from the active server");
    }
    const slot = randomBytes(12).toString("hex");
    this.slots.set(slot, target);
    return `http://127.0.0.1:${this.port}/s/${this.token}/${slot}`;
  }

  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    for (const socket of this.sockets) socket.destroy();
    this.sockets.clear();
    this.slots.clear();
    const server = this.server;
    this.server = null;
    if (!server) return;
    await new Promise<void>((resolve) => {
      server.close(() => resolve());
      setTimeout(resolve, 1_500);
    });
  }

  private async handle(request: IncomingMessage, response: ServerResponse): Promise<void> {
    const path = (request.url ?? "").split("?")[0] ?? "";
    const match = /^\/s\/([a-f0-9]+)\/([a-f0-9]+)$/.exec(path);
    if (!match || match[1] !== this.token) {
      response.writeHead(404, { "Cache-Control": "no-store" });
      response.end();
      return;
    }
    const target = this.slots.get(match[2]!);
    if (!target) {
      response.writeHead(404, { "Cache-Control": "no-store" });
      response.end();
      return;
    }
    if (request.method !== "GET" && request.method !== "HEAD") {
      response.writeHead(405, { Allow: "GET, HEAD", "Cache-Control": "no-store" });
      response.end();
      return;
    }

    const controller = new AbortController();
    const abort = () => controller.abort();
    request.on("close", abort);

    const headers: Record<string, string> = {};
    if (request.headers.range) headers.range = String(request.headers.range);
    if (request.headers["if-range"]) headers["if-range"] = String(request.headers["if-range"]);

    let upstream: Response;
    try {
      upstream = await this.fetcher(target.toString(), {
        method: request.method === "HEAD" ? "HEAD" : "GET",
        headers,
        signal: controller.signal,
      });
    } catch {
      request.off("close", abort);
      if (!response.headersSent) {
        response.writeHead(502, { "Cache-Control": "no-store" });
      }
      response.end();
      return;
    }

    const responseHeaders: Record<string, string> = { "Cache-Control": "no-store" };
    for (const name of FORWARDED_HEADERS) {
      const value = upstream.headers.get(name);
      if (value != null) responseHeaders[name] = value;
    }
    response.writeHead(upstream.status, responseHeaders);

    if (request.method === "HEAD" || !upstream.body) {
      request.off("close", abort);
      response.end();
      return;
    }

    // Stream body -> response with backpressure; destroying the response stops
    // the upstream read instead of buffering the rest of a multi-gigabyte file.
    const body = Readable.fromWeb(upstream.body as Parameters<typeof Readable.fromWeb>[0]);
    const cleanup = () => {
      body.destroy();
      controller.abort();
    };
    response.on("close", cleanup);
    body.on("error", () => {
      if (!response.destroyed) response.destroy();
    });
    body.pipe(response);
  }
}
