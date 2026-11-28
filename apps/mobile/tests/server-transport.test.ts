import { afterAll, beforeEach, expect, test } from "bun:test";
import {
  authenticateServer,
  probeServer,
  serverAuthHeaders,
  serverJson,
  serverMediaUrl,
  serverResponse,
  ServerRequestError,
  ServerUnauthorizedError,
  type ServerSession,
} from "@/core/server/transport";

type Handler = (request: Request) => Response | Promise<Response>;

const requests: Array<{
  path: string;
  method: string;
  authorization: string | null;
  accept: string | null;
  body: string;
}> = [];
let handler: Handler = () => new Response("not configured", { status: 500 });

const server = Bun.serve({
  port: 0,
  async fetch(request) {
    const url = new URL(request.url);
    requests.push({
      path: `${url.pathname}${url.search}`,
      method: request.method,
      authorization: request.headers.get("authorization"),
      accept: request.headers.get("accept"),
      body: request.method === "POST" ? await request.text() : "",
    });
    return handler(request);
  },
});

const address = `http://127.0.0.1:${server.port}`;

const statusBody = {
  version: "1.0.0",
  serverId: "server-one",
  setupComplete: true,
  ownerCreated: true,
};

beforeEach(() => {
  requests.length = 0;
  handler = () => new Response("not configured", { status: 500 });
});

afterAll(() => {
  server.stop(true);
});

function json(value: unknown, init?: ResponseInit) {
  return Response.json(value, init);
}

test("probes a server, normalizes the address, and reads status flags", async () => {
  handler = () => json(statusBody);
  const status = await probeServer(` ${address}/ `);
  expect(status).toEqual(statusBody);
  expect(requests).toHaveLength(1);
  expect(requests[0]).toMatchObject({
    path: "/api/server/status",
    method: "GET",
    accept: "application/json",
  });
});

test("rejects addresses that are not a Plexy Server", async () => {
  handler = () => json({ version: "1.0.0" });
  await expect(probeServer(address)).rejects.toThrow(
    "That address does not look like a Plexy Server.",
  );
});

test("surfaces server errors from probe responses", async () => {
  handler = () => json({ error: "Server is starting." }, { status: 503 });
  const error = await probeServer(address).catch((reason: unknown) => reason);
  expect(error).toBeInstanceOf(ServerRequestError);
  expect((error as ServerRequestError).message).toBe("Server is starting.");
  expect((error as ServerRequestError).status).toBe(503);

  handler = () => new Response("<html>nope</html>", { status: 502 });
  const fallback = await probeServer(address).catch((reason: unknown) => reason);
  expect(fallback).toBeInstanceOf(ServerRequestError);
  expect((fallback as ServerRequestError).message).toBe(
    "The server returned HTTP 502.",
  );
});

test("reports an unreachable server", async () => {
  await expect(probeServer("http://127.0.0.1:1")).rejects.toThrow(
    "Could not reach the server. Check the address, the Wi-Fi network, and the server certificate.",
  );
});

test("signs in with a pairing code and trims the code", async () => {
  handler = (request) => {
    const url = new URL(request.url);
    if (url.pathname === "/api/server/status") return json(statusBody);
    return json({
      token: "pair-token",
      user: { id: 7, username: "owner", role: "owner" },
      device: { id: "device-1", name: "Pixel" },
    });
  };
  const session = await authenticateServer(address, {
    kind: "pairing",
    code: " 123456 ",
  });
  expect(session).toMatchObject({
    address,
    serverId: "server-one",
    token: "pair-token",
    user: { id: 7, username: "owner", role: "owner" },
    device: { id: "device-1", name: "Pixel" },
  });
  expect(session.connectedAt).toBeGreaterThan(0);
  expect(requests.map((request) => request.path)).toEqual([
    "/api/server/status",
    "/api/auth/pair",
  ]);
  expect(JSON.parse(requests[1]!.body)).toEqual({
    code: "123456",
    name: "Plexy for Android",
  });
});

test("signs in with a password and keeps a returned server id", async () => {
  handler = (request) => {
    const url = new URL(request.url);
    if (url.pathname === "/api/server/status") return json(statusBody);
    return json({
      token: "login-token",
      serverId: "server-two",
      user: { id: 2, username: "viewer", role: "user" },
      device: { id: "device-2", name: "Tablet" },
    });
  };
  const session = await authenticateServer(address, {
    kind: "password",
    username: " viewer ",
    password: "secret",
  });
  expect(session.serverId).toBe("server-two");
  expect(JSON.parse(requests[1]!.body)).toEqual({
    username: "viewer",
    password: "secret",
    name: "Plexy for Android",
  });
});

test("requires the server owner before signing in", async () => {
  handler = () => json({ ...statusBody, ownerCreated: false });
  await expect(
    authenticateServer(address, { kind: "pairing", code: "123456" }),
  ).rejects.toThrow("Finish creating the owner account on the server first.");
  expect(requests).toHaveLength(1);
});

test("rejects incomplete sign-in responses", async () => {
  handler = (request) => {
    const url = new URL(request.url);
    if (url.pathname === "/api/server/status") return json(statusBody);
    return json({
      token: "token",
      user: { id: "1", username: "owner", role: "owner" },
      device: { id: "device", name: "Phone" },
    });
  };
  await expect(
    authenticateServer(address, { kind: "pairing", code: "123456" }),
  ).rejects.toThrow("The server returned an incomplete sign-in response.");
});

test("passes through sign-in errors", async () => {
  handler = (request) => {
    const url = new URL(request.url);
    if (url.pathname === "/api/server/status") return json(statusBody);
    return json({ error: "That pairing code expired." }, { status: 401 });
  };
  const error = await authenticateServer(address, {
    kind: "pairing",
    code: "000000",
  }).catch((reason: unknown) => reason);
  expect(error).toBeInstanceOf(ServerRequestError);
  expect((error as ServerRequestError).message).toBe(
    "That pairing code expired.",
  );
  expect((error as ServerRequestError).status).toBe(401);
});

const session: ServerSession = {
  address,
  serverId: "server-one",
  token: "session-token",
  user: { id: 1, username: "owner", role: "owner" },
  device: { id: "device", name: "Phone" },
  connectedAt: 1_700_000_000_000,
};

test("adds auth headers and normalizes request paths", async () => {
  handler = () => json({ ok: true });
  const response = await serverResponse(session, "api/items?limit=1", {
    headers: { "Content-Type": "application/json" },
  });
  expect(response.ok).toBe(true);
  expect(requests[0]).toMatchObject({
    path: "/api/items?limit=1",
    method: "GET",
    authorization: "Bearer session-token",
    accept: "application/json",
  });
  await serverResponse(session, "/api/home");
  expect(requests[1]?.path).toBe("/api/home");
  expect(serverAuthHeaders(session)).toEqual({
    Authorization: "Bearer session-token",
  });
  expect(serverMediaUrl(session, "/api/stream/1")).toBe(
    `${address}/api/stream/1`,
  );
  expect(serverMediaUrl(session, "api/stream/1")).toBe(
    `${address}/api/stream/1`,
  );
});

test("turns a 401 into an unauthorized error", async () => {
  handler = () => new Response("expired", { status: 401 });
  await expect(serverResponse(session, "/api/home")).rejects.toBeInstanceOf(
    ServerUnauthorizedError,
  );
  await expect(serverJson(session, "/api/home")).rejects.toBeInstanceOf(
    ServerUnauthorizedError,
  );
});

test("returns non-401 responses and parses successful JSON", async () => {
  handler = () => new Response("missing", { status: 404 });
  const response = await serverResponse(session, "/api/missing");
  expect(response.status).toBe(404);

  handler = () => json({ items: [1, 2] });
  expect(await serverJson<{ items: number[] }>(session, "/api/items")).toEqual({
    items: [1, 2],
  });
});

test("reads error bodies for JSON requests", async () => {
  handler = () => json({ error: "Title not found." }, { status: 404 });
  const error = await serverJson(session, "/api/items/9").catch(
    (reason: unknown) => reason,
  );
  expect(error).toBeInstanceOf(ServerRequestError);
  expect((error as ServerRequestError).message).toBe("Title not found.");
  expect((error as ServerRequestError).status).toBe(404);

  handler = () => new Response("not json", { status: 500 });
  const fallback = await serverJson(session, "/api/items/9").catch(
    (reason: unknown) => reason,
  );
  expect((fallback as ServerRequestError).message).toBe(
    "The server returned HTTP 500.",
  );
});
