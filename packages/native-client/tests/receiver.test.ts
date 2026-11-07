import { expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import vm from "node:vm";
test("Cast receiver keeps credentials out of URLs/metadata and bounds media authorization to the server", async () => {
  let interceptor!: (value: Record<string, any>) => Promise<any>;
  let config: Record<string, any> = {};
  const events: Record<string, () => void> = {};
  const sent: Array<{ url: string; init: RequestInit }> = [];
  class ErrorData {
    constructor(public type: string) {}
  }
  const manager = {
    setMessageInterceptor: (_type: string, fn: typeof interceptor) => {
      interceptor = fn;
    },
    setPlaybackConfig: (value: typeof config) => {
      config = value;
    },
    addEventListener: (type: string, fn: () => void) => {
      events[type] = fn;
    },
    getCurrentTimeSec: () => 50,
    getDurationSec: () => 100,
  };
  const context = {
    getPlayerManager: () => manager,
    addEventListener: () => {},
    start: () => {},
  };
  const script = await readFile(
    new URL("../cast-receiver/receiver.js", import.meta.url),
    "utf8",
  );
  vm.runInNewContext(script, {
    URL,
    Date,
    fetch: async (url: string, init: RequestInit) => {
      sent.push({ url, init });
      return Response.json({ ok: true });
    },
    cast: {
      framework: {
        CastReceiverContext: { getInstance: () => context },
        messages: {
          MessageType: { LOAD: "load" },
          ErrorType: { LOAD_FAILED: "failed" },
          ErrorData,
        },
        PlaybackConfig: class {},
        events: {
          EventType: {
            TIME_UPDATE: "time",
            PAUSE: "pause",
            MEDIA_FINISHED: "end",
          },
        },
        system: { EventType: { SHUTDOWN: "shutdown" } },
      },
    },
  });
  const loaded = await interceptor({
    credentials: "secret",
    credentialsType: "plexy-bearer",
    customData: { server: "https://nas.example", itemId: 7 },
    media: { contentUrl: "https://nas.example/api/stream/1/hls/master.m3u8" },
  });
  expect(JSON.stringify(loaded)).not.toContain("secret");
  expect(loaded).not.toHaveProperty("credentials");
  expect(
    config.manifestRequestHandler({
      url: "https://nas.example/api/stream/1/hls/master.m3u8",
    }).headers.Authorization,
  ).toBe("Bearer secret");
  expect(
    config.segmentRequestHandler({
      url: "https://nas.example/api/stream/1/hls/0.ts",
    }).headers.Authorization,
  ).toBe("Bearer secret");
  expect(() =>
    config.segmentRequestHandler({ url: "https://other.example/stolen" }),
  ).toThrow();
  events.pause!();
  await new Promise((resolve) => setTimeout(resolve, 0));
  expect(sent[0]?.url).toBe("https://nas.example/api/progress");
  expect(sent[0]?.init.headers).toMatchObject({
    Authorization: "Bearer secret",
  });
  expect(JSON.parse(sent[0]!.init.body as string)).toMatchObject({
    itemId: 7,
    position: 50,
    duration: 100,
  });
  const rejected = await interceptor({
    credentials: "secret",
    credentialsType: "plexy-bearer",
    customData: { server: "https://nas.example", itemId: 7 },
    media: { contentUrl: "https://attacker.example/stream" },
  });
  expect(rejected).toBeInstanceOf(ErrorData);
});
