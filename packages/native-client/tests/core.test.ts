import { afterEach, describe, expect, test } from "bun:test";
import { ApiError, normalizeServerUrl, PlexyApi } from "../src/api";
import { ProgressQueue, mergeProgress, type Progress } from "../src/progress";
import {
  parseHlsVariants,
  parsePreviews,
  parseVtt,
  subtitleText,
} from "../src/vtt";
import { validateTransfer } from "../src/download-policy";
const originalFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = originalFetch;
});
describe("server and authenticated media contract", () => {
  test("normalizes addresses and rejects credentials or URL query tokens", () => {
    expect(normalizeServerUrl(" https://nas.example:3240/ ")).toBe(
      "https://nas.example:3240",
    );
    for (const url of [
      "https://user:pass@nas.example",
      "https://nas.example/?token=secret",
      "file:///tmp/video",
      "https://nas.example/api",
    ])
      expect(() => normalizeServerUrl(url)).toThrow();
  });
  test("never forwards auth to external images or media", () => {
    const api = new PlexyApi("https://nas.example", "secret");
    expect(api.image("/api/images/7")?.headers).toEqual({
      Authorization: "Bearer secret",
    });
    expect(
      api.image("https://image.tmdb.org/art.jpg")?.headers,
    ).toBeUndefined();
    expect(api.image("http://external.example/a")).toBeUndefined();
    expect(() => api.url("https://external.example/stream")).toThrow();
    expect(() => api.url("//external.example/stream")).toThrow();
  });
  test("manifest and progress use current server contracts with Bearer headers", async () => {
    const seen: Array<{ url: string; init?: RequestInit }> = [];
    globalThis.fetch = (async (url, init) => {
      seen.push({ url: String(url), init });
      return Response.json({ path: "direct", fileId: 3 });
    }) as typeof fetch;
    const api = new PlexyApi("https://nas.example", "secret");
    await api.play(3, 1);
    await api.progress(5, 123, 600);
    const query = new URL(seen[0]!.url).searchParams;
    expect(query.get("audio")).toBe("1");
    expect(JSON.parse(query.get("caps")!).videoCodecs).toContain("h264");
    expect(seen[0]!.init?.headers).toEqual({ Authorization: "Bearer secret" });
    expect(JSON.parse(seen[1]!.init?.body as string)).toEqual({
      itemId: 5,
      position: 123,
      duration: 600,
      played: false,
    });
    expect(seen.every((call) => !call.url.includes("secret"))).toBe(true);
  });
  test("conversion seeks carry server offset; HLS seeks remain local", () => {
    const api = new PlexyApi("http://10.0.2.2:3240");
    const converted = new URL(api.stream(7, "transcode", 99.8, 2, 720));
    expect(converted.pathname).toBe("/api/stream/7/transcode");
    expect(converted.searchParams.get("start")).toBe("99");
    expect(converted.searchParams.get("maxHeight")).toBe("720");
    expect(converted.searchParams.get("audio")).toBe("2");
    const hls = new URL(api.stream(7, "hls", 99, 1));
    expect(hls.pathname).toEndWith("/hls/master.m3u8");
    expect(hls.searchParams.has("start")).toBe(false);
    expect(hls.searchParams.get("audio")).toBe("1");
  });
  test("revoked credentials produce a re-pair error, with retry-after preserved", async () => {
    globalThis.fetch = (async () =>
      Response.json(
        { error: "Denied" },
        { status: 401, headers: { "Retry-After": "5" } },
      )) as typeof fetch;
    try {
      await new PlexyApi("https://nas.example", "secret").home();
      throw new Error("Expected rejection");
    } catch (error) {
      expect(error).toBeInstanceOf(ApiError);
      expect((error as ApiError).status).toBe(401);
      expect((error as ApiError).retryAfter).toBe(5);
      expect((error as Error).message).toContain("Reconnect");
    }
  });
});
describe("authentication failure messages", () => {
  test("does not label rejected sign-in or pairing credentials as an expired session", async () => {
    const api = new PlexyApi("https://nas.example");
    globalThis.fetch = (async () =>
      Response.json(
        { error: "Incorrect username or password." },
        { status: 401 },
      )) as typeof fetch;
    await expect(
      api.login("swastikdan", "incorrect-example", "Android"),
    ).rejects.toThrow("Incorrect username or password.");
    globalThis.fetch = (async () =>
      Response.json(
        { error: "The pairing key is invalid, expired, or already used." },
        { status: 401 },
      )) as typeof fetch;
    await expect(api.pair("invalid-example", "Android")).rejects.toThrow(
      "The pairing key is invalid, expired, or already used.",
    );
  });
  test("preserves password-confirmation errors in an existing session", async () => {
    globalThis.fetch = (async () =>
      Response.json(
        { error: "Incorrect password." },
        { status: 401 },
      )) as typeof fetch;
    await expect(
      new PlexyApi("https://nas.example", "session-token").request(
        "/api/auth/pairing-code",
        { method: "POST", body: "{}" },
      ),
    ).rejects.toThrow("Incorrect password.");
  });
});
describe("catalog cache authorization boundaries", () => {
  test("uses cached catalog only for connectivity failures, never authorization failures", async () => {
    let hit = false;
    const api = new PlexyApi("https://nas.example", "secret", {
      cache: {
        get: async <T>() => ({ rows: [], featured: null }) as T,
        put: async () => {},
      },
      onCacheUsed: () => {
        hit = true;
      },
    });
    globalThis.fetch = (async () => {
      throw new TypeError("Network request failed");
    }) as typeof fetch;
    expect((await api.home()).rows).toEqual([]);
    expect(hit).toBe(true);
    hit = false;
    globalThis.fetch = (async () =>
      Response.json({ error: "Revoked" }, { status: 401 })) as typeof fetch;
    await expect(api.home()).rejects.toBeInstanceOf(ApiError);
    expect(hit).toBe(false);
  });
  test("does not cache account or playback credentials", async () => {
    const paths: string[] = [];
    const api = new PlexyApi("https://nas.example", "secret", {
      cache: {
        get: async () => null,
        put: async (path) => {
          paths.push(path);
        },
      },
    });
    globalThis.fetch = (async () =>
      Response.json({ ok: true })) as typeof fetch;
    await api.me();
    await api.play(1);
    await api.home();
    expect(paths).toEqual(["/api/home"]);
  });
});
describe("offline progress reconciliation", () => {
  const record = (position: number, played = false): Progress => ({
    itemId: 1,
    position,
    duration: 100,
    played,
    updatedAt: position,
  });
  test("backward seeks win without unmarking completed items", () => {
    expect(mergeProgress(record(99, true), record(10))).toEqual({
      ...record(10),
      played: true,
    });
  });
  test("keeps failed syncs on disk and does not delete a newer seek while flushing", async () => {
    let disk: Progress[] = [record(20)];
    const queue = new ProgressQueue({
      load: async () => disk,
      save: async (values) => {
        disk = values;
      },
    });
    await queue.restore();
    await expect(
      queue.flush({
        progress: async () => {
          throw new Error("offline");
        },
      } as unknown as PlexyApi),
    ).rejects.toThrow();
    expect(disk).toHaveLength(1);
    let resolve!: () => void;
    const blocked = new Promise<void>((r) => {
      resolve = r;
    });
    const flushing = queue.flush({
      progress: async () => blocked,
    } as unknown as PlexyApi);
    await queue.record(record(5));
    resolve();
    await flushing;
    expect(queue.latest(1)?.position).toBe(5);
    expect(disk[0]?.position).toBe(5);
    await queue.flush({ progress: async () => {} } as unknown as PlexyApi);
    expect(disk[0]).toMatchObject({ position: 5, synced: true });
    const restarted = new ProgressQueue({
      load: async () => disk,
      save: async () => {},
    });
    await restarted.restore();
    expect(restarted.latest(1)?.position).toBe(5);
  });
});
describe("subtitles, seek previews and adaptive variants", () => {
  const track =
    "WEBVTT\n\n1\n00:00:01.000 --> 00:00:03.000 align:start\n<i>Hello</i> &amp; goodbye\n\n2\n00:03.000 --> 00:04.000\nNext line\n";
  test("parses cue settings, strips markup and applies signed timing offsets", () => {
    const cues = parseVtt(track);
    expect(cues).toHaveLength(2);
    expect(subtitleText(cues, 1.2)).toBe("Hello & goodbye");
    expect(subtitleText(cues, 1.2, 1)).toBe("");
    expect(subtitleText(cues, 2.2, 1)).toBe("Hello & goodbye");
    expect(subtitleText(cues, 3)).toBe("Next line");
  });
  test("discards invalid intervals and preserves preview crop and version query", () => {
    expect(parseVtt("WEBVTT\n\n00:05 --> 00:04\nbad")).toEqual([]);
    const previews = parsePreviews(
      "WEBVTT\n\n00:00 --> 00:10\nsprite.jpg?v=7#xywh=160,90,160,90",
      "https://nas.example/api/trickplay/1/track.vtt",
    );
    expect(previews[0]).toMatchObject({
      uri: "https://nas.example/api/trickplay/1/sprite.jpg?v=7",
      x: 160,
      y: 90,
      width: 160,
      height: 90,
    });
  });
  test("resolves HLS variants relative to the master manifest", () => {
    expect(
      parseHlsVariants(
        "#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=3000,RESOLUTION=1280x720\n720.m3u8?audio=1",
        "https://nas.example/api/stream/1/hls/master.m3u8?audio=1",
      ),
    ).toEqual([
      {
        label: "720p",
        uri: "https://nas.example/api/stream/1/hls/720.m3u8?audio=1",
      },
    ]);
  });
});
describe("download integrity", () => {
  test("accepts a complete source and a validated resumed range", () => {
    expect(
      validateTransfer(0, 200, { "Content-Length": "1000" }, 1000),
    ).toBeNull();
    expect(
      validateTransfer(
        400,
        206,
        { "Content-Range": "bytes 400-999/1000" },
        1000,
      ),
    ).toBeNull();
  });
  test("rejects ignored ranges, wrong ranges, truncated bytes and HTTP error bodies", () => {
    expect(
      validateTransfer(400, 200, { "Content-Length": "1000" }, 1400),
    ).toContain("resume");
    expect(
      validateTransfer(
        400,
        206,
        { "Content-Range": "bytes 300-999/1000" },
        1000,
      ),
    ).toContain("resume");
    expect(
      validateTransfer(0, 200, { "Content-Length": "1000" }, 500),
    ).toContain("incomplete");
    expect(validateTransfer(0, 401, {}, 20)).toContain("Reconnect");
    expect(validateTransfer(0, 503, {}, 20)).toContain("busy");
  });
});
