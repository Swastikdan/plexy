import { afterEach, expect, test } from "bun:test";
import { MediaRelay, type RelayFetch } from "../src/main/native-relay";

const relays: MediaRelay[] = [];

afterEach(async () => {
  for (const relay of relays.splice(0)) await relay.close();
});

function fakeFetch(calls: Array<{ url: string; method: string; headers: Record<string, string> }>): RelayFetch {
  return async (url, init) => {
    calls.push({ url, method: init.method, headers: init.headers });
    const body = new TextEncoder().encode("0123456789");
    const range = init.headers.range;
    if (range === "bytes=2-5") {
      return new Response(body.slice(2, 6), {
        status: 206,
        headers: {
          "content-type": "video/x-matroska",
          "content-length": "4",
          "content-range": "bytes 2-5/10",
          "accept-ranges": "bytes",
        },
      });
    }
    return new Response(body, {
      status: 200,
      headers: { "content-type": "video/x-matroska", "content-length": "10", "accept-ranges": "bytes" },
    });
  };
}

test("relay forwards range requests and response headers", async () => {
  const calls: Array<{ url: string; method: string; headers: Record<string, string> }> = [];
  const relay = new MediaRelay("http://127.0.0.1:8765", fakeFetch(calls));
  relays.push(relay);
  await relay.start();
  const url = relay.register("http://127.0.0.1:8765/api/stream/4/original");

  const response = await fetch(url, { headers: { Range: "bytes=2-5" } });
  expect(response.status).toBe(206);
  expect(response.headers.get("content-range")).toBe("bytes 2-5/10");
  expect(response.headers.get("content-type")).toBe("video/x-matroska");
  expect(await response.text()).toBe("2345");
  expect(calls[0]?.headers.range).toBe("bytes=2-5");
});

test("relay only relays resources on the active server", async () => {
  const relay = new MediaRelay("http://127.0.0.1:8765", fakeFetch([]));
  relays.push(relay);
  await relay.start();
  expect(() => relay.register("http://evil.example.com/steal")).toThrow();
  expect(() => relay.register("https://127.0.0.1:9999/api/x")).toThrow();
});

test("relay rejects unknown capability tokens", async () => {
  const relay = new MediaRelay("http://127.0.0.1:8765", fakeFetch([]));
  relays.push(relay);
  await relay.start();
  const url = relay.register("http://127.0.0.1:8765/api/stream/4/original");
  const wrong = url.replace(/\/s\/[a-f0-9]+/, "/s/deadbeef");
  expect((await fetch(wrong)).status).toBe(404);
});

test("relay rejects write methods and answers HEAD without a body", async () => {
  const relay = new MediaRelay("http://127.0.0.1:8765", fakeFetch([]));
  relays.push(relay);
  await relay.start();
  const url = relay.register("http://127.0.0.1:8765/api/stream/4/original");
  expect((await fetch(url, { method: "POST" })).status).toBe(405);
  const head = await fetch(url, { method: "HEAD" });
  expect(head.status).toBe(200);
  expect(await head.text()).toBe("");
});

test("closing the relay releases its loopback port", async () => {
  const relay = new MediaRelay("http://127.0.0.1:8765", fakeFetch([]));
  await relay.start();
  const url = relay.register("http://127.0.0.1:8765/api/stream/4/original");
  await relay.close();
  await expect(fetch(url)).rejects.toThrow();
});
