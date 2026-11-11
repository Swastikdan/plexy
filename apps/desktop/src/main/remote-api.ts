import type { IncomingMessage, ServerResponse } from "node:http";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";

/** Forward API traffic while Chromium keeps each server's cookies on its own origin. */
export async function proxyApi(
  request: IncomingMessage,
  response: ServerResponse,
  base: string,
  fetchRemote: (input: string, init?: RequestInit) => Promise<Response>,
): Promise<void> {
  if (!base) {
    response.writeHead(503, { "Content-Type": "application/json" });
    response.end(
      JSON.stringify({ error: "Choose a server or enable the local server." }),
    );
    return;
  }
  const target = new URL(request.url!, base);
  const headers = new Headers();
  const omitted = new Set([
    "host",
    "origin",
    "referer",
    "cookie",
    "authorization",
    "connection",
    "content-length",
    "accept-encoding",
    "x-forwarded-for",
    "x-forwarded-host",
    "x-forwarded-proto",
  ]);
  for (const [name, value] of Object.entries(request.headers)) {
    if (!omitted.has(name) && value !== undefined)
      headers.set(name, Array.isArray(value) ? value.join(", ") : value);
  }
  // UI API writes are small JSON requests. Bound buffering independently of media responses.
  const chunks: Buffer[] = [];
  let length = 0;
  for await (const chunk of request) {
    const bytes = Buffer.from(chunk);
    length += bytes.length;
    if (length > 2 * 1024 * 1024) {
      response.writeHead(413);
      response.end("Request is too large");
      return;
    }
    chunks.push(bytes);
  }
  const controller = new AbortController();
  response.on("close", () => controller.abort());
  const remote = await fetchRemote(target.toString(), {
    method: request.method,
    headers,
    credentials: "include",
    redirect: "manual",
    signal: controller.signal,
    ...(chunks.length ? { body: Buffer.concat(chunks) } : {}),
  });
  const outgoing: Record<string, string> = {};
  for (const [name, value] of remote.headers) {
    // Do not copy remote credentials into the localhost browser origin.
    if (
      ![
        "set-cookie",
        "access-control-allow-origin",
        "access-control-allow-credentials",
        "content-encoding",
        "transfer-encoding",
        "connection",
      ].includes(name)
    )
      outgoing[name] = value;
  }
  // Chromium fetch decompresses responses. Keep lengths only for identity media responses.
  if (remote.headers.has("content-encoding")) delete outgoing["content-length"];
  response.writeHead(remote.status, outgoing);
  if (remote.body)
    await pipeline(
      Readable.fromWeb(
        remote.body as import("node:stream/web").ReadableStream<Uint8Array>,
      ),
      response,
    );
  else response.end();
}
