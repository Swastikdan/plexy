import { afterEach, expect, test } from "bun:test";
import { createServer, type Server } from "node:http";
import { proxyApi } from "../src/main/remote-api";
const servers: Server[] = [];
afterEach(async () => {
  for (const server of servers.splice(0))
    await new Promise<void>((resolve) => {
      server.close(() => resolve());
      server.closeAllConnections();
    });
});
async function start(base: string, fetchRemote: typeof fetch) {
  const server = createServer((request, response) => {
    void proxyApi(request, response, base, fetchRemote).catch(() => {
      response.writeHead(502);
      response.end();
    });
  });
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  return `http://127.0.0.1:${(server.address() as { port: number }).port}`;
}
test("remote media preserves ranges and streams without forwarding another origin's credentials", async () => {
  let received: RequestInit | undefined;
  const url = await start("https://media.example", (async (input, init) => {
    expect(String(input)).toBe("https://media.example/api/stream/1");
    received = init;
    return new Response("video", {
      status: 206,
      headers: {
        "content-range": "bytes 0-4/10",
        "content-length": "5",
        "set-cookie": "plexy_session=remote-secret",
      },
    });
  }) as typeof fetch);
  const response = await fetch(`${url}/api/stream/1`, {
    headers: {
      Range: "bytes=0-4",
      Cookie: "plexy_session=local-secret",
      Authorization: "Bearer local-secret",
    },
  });
  expect(response.status).toBe(206);
  expect(response.headers.get("content-range")).toBe("bytes 0-4/10");
  expect(response.headers.has("set-cookie")).toBe(false);
  expect(await response.text()).toBe("video");
  const headers = new Headers(received?.headers);
  expect(headers.get("range")).toBe("bytes=0-4");
  expect(headers.has("cookie")).toBe(false);
  expect(headers.has("authorization")).toBe(false);
  expect(received?.credentials).toBe("include");
});
test("forwards API JSON writes and reports missing server selection", async () => {
  const url = await start("https://media.example", (async (_input, init) => {
    expect(init?.method).toBe("POST");
    expect(Buffer.from(init?.body as Uint8Array).toString()).toBe(
      '{"position":42}',
    );
    return Response.json({ ok: true });
  }) as typeof fetch);
  expect(
    await (
      await fetch(`${url}/api/progress`, {
        method: "POST",
        body: '{"position":42}',
      })
    ).json(),
  ).toEqual({ ok: true });
  const empty = await start("", fetch);
  expect((await fetch(`${empty}/api/server/status`)).status).toBe(503);
});
