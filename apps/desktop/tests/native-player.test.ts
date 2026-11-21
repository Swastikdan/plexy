/// Native player manager: a fake embedded engine exercises the manifest,
/// relay registration, event mapping, commands and cleanup without libmpv on
/// the test machine.
import { expect, test } from "bun:test";
import {
  NativePlayerManager,
  type NativePlaybackEvent,
} from "../src/main/native-player";

interface FakeEvent {
  type: "property" | "event" | "error";
  name?: string;
  value?: number | string | boolean;
  message?: string;
}

const TRACKS = [
  { id: 1, type: "video", selected: true },
  { id: 2, type: "audio", lang: "en", title: "English", default: true, selected: true },
  { id: 3, type: "audio", lang: "hi", title: "Hindi", selected: false },
  { id: 4, type: "sub", lang: "en", title: "English", selected: false },
  { id: 5, type: "sub", lang: "fr", title: "French", selected: false },
];

class FakeEmbed {
  calls: string[] = [];
  detached = false;
  private readonly onEvent: (event: FakeEvent) => void;

  constructor(_libPath: string, onEvent: (event: FakeEvent) => void) {
    this.onEvent = onEvent;
    this.calls.push("create");
  }

  attach(_handle: Buffer, x: number, y: number, width: number, height: number): boolean {
    this.calls.push(`attach:${x},${y},${width},${height}`);
    return true;
  }

  setBounds(): boolean {
    return true;
  }

  setVisible(visible: boolean): boolean {
    this.calls.push(`visible:${visible}`);
    return true;
  }

  load(url: string, start: number, title: string, audioLanguage: string): boolean {
    this.calls.push(`load:${url}:${start}:${title}:${audioLanguage}`);
    queueMicrotask(() => this.onEvent({ type: "event", name: "loaded" }));
    return true;
  }

  setProperty(name: string, value: string | number | boolean): boolean {
    this.calls.push(`set:${name}=${String(value)}`);
    return true;
  }

  getPropertyString(name: string): string | null {
    return name === "track-list" ? JSON.stringify(TRACKS) : null;
  }

  command(parts: string[]): boolean {
    this.calls.push(`command:${parts.join(",")}`);
    return true;
  }

  destroy(): void {
    this.destroyed = true;
    this.calls.push("destroy");
  }

  destroyed = false;

  emit(event: FakeEvent): void {
    this.onEvent(event);
  }
}

function manifestResponse(overrides: Record<string, unknown> = {}): Response {
  return new Response(
    JSON.stringify({
      fileId: 7,
      title: "Pilot",
      subtitle: "Episode 1",
      duration: 1_800,
      watch: { position: 120, duration: 1_800, played: false },
      tracks: [],
      native: { streamUrl: "/api/stream/7/original", preferredAudioLanguage: "en" },
      ...overrides,
    }),
    { status: 200, headers: { "content-type": "application/json" } },
  );
}

function setup(
  manifest = manifestResponse(),
  fetch = async () => manifest.clone(),
) {
  const events: NativePlaybackEvent[] = [];
  const embeds: FakeEmbed[] = [];
  const manager = new NativePlayerManager(
    (event) => events.push(event),
    {
      platform: "darwin",
      libmpv: "/fake/libmpv.2.dylib",
      surface: () => ({ handle: Buffer.alloc(8), width: 1280, height: 820 }),
      fetch,
      createEmbed: (libPath, onEvent) => {
        const embed = new FakeEmbed(libPath, onEvent);
        embeds.push(embed);
        return embed;
      },
    },
  );
  return { manager, events, embeds };
}

test("play attaches the in-window surface and loads the relayed original file", async () => {
  const { manager, events, embeds } = setup();
  const result = await manager.play({
    fileId: 7,
    serverUrl: "http://127.0.0.1:8765",
    serverOrigin: "http://127.0.0.1:8765",
    resumeSeconds: 120,
    autoSubtitles: false,
    subtitleLanguage: "en",
  });

  const embed = embeds[0]!;
  expect(result.fileId).toBe(7);
  expect(result.title).toBe("Pilot · Episode 1");
  expect(embed.calls).toContain("attach:0,0,1280,820");
  const load = embed.calls.find((call) => call.startsWith("load:"));
  expect(load).toContain("http://127.0.0.1:");
  expect(load).toContain("/s/");
  expect(load).not.toContain("127.0.0.1:8765/api/stream");
  expect(load).toContain(":120:Pilot · Episode 1:en");
  expect(events.some((event) => event.type === "ready")).toBe(true);

  await manager.dispose();
  expect(embed.destroyed).toBe(true);
});

test("mpv property events become player events", async () => {
  const { manager, events, embeds } = setup();
  const { sessionId } = await manager.play({
    fileId: 7,
    serverUrl: "http://127.0.0.1:8765",
    serverOrigin: "http://127.0.0.1:8765",
  });
  const embed = embeds[0]!;

  embed.emit({ type: "property", name: "duration", value: 2_400 });
  embed.emit({ type: "property", name: "time-pos", value: 42.5 });
  embed.emit({ type: "property", name: "pause", value: true });
  embed.emit({ type: "property", name: "paused-for-cache", value: true });
  embed.emit({ type: "property", name: "volume", value: 65 });
  embed.emit({ type: "property", name: "mute", value: true });
  embed.emit({ type: "property", name: "speed", value: 1.5 });
  embed.emit({ type: "event", name: "ended" });

  expect(events.find((event) => event.type === "duration")?.duration).toBe(2_400);
  expect(events.find((event) => event.type === "time")?.position).toBe(42.5);
  expect(events.find((event) => event.type === "pause")?.paused).toBe(true);
  expect(events.find((event) => event.type === "buffering")?.buffering).toBe(true);
  const volumeEvents = events.filter((event) => event.type === "volume");
  expect(volumeEvents[0]?.volume).toBe(65);
  expect(volumeEvents.at(-1)?.muted).toBe(true);
  expect(events.find((event) => event.type === "speed")?.speed).toBe(1.5);
  const ended = events.find((event) => event.type === "ended");
  expect(ended?.sessionId).toBe(sessionId);

  const tracks = events.find((event) => event.type === "tracks");
  expect(tracks?.audioTracks?.map((track) => track.language)).toEqual(["en", "hi"]);
  expect(tracks?.subtitleTracks?.map((track) => track.title)).toEqual(["English", "French"]);
});

test("commands steer only the active session and map to mpv", async () => {
  const { manager, embeds } = setup();
  const { sessionId } = await manager.play({
    fileId: 7,
    serverUrl: "http://127.0.0.1:8765",
    serverOrigin: "http://127.0.0.1:8765",
  });
  const embed = embeds[0]!;
  embed.emit({ type: "property", name: "duration", value: 1_800 });

  await manager.command({ sessionId, action: "seek", value: 60 });
  await manager.command({ sessionId, action: "set-audio", value: 3 });
  await manager.command({ sessionId, action: "set-subtitle", value: 0 });
  await manager.command({ sessionId, action: "set-volume", value: 55 });
  await manager.command({ sessionId, action: "set-mute", value: 1 });
  await manager.command({ sessionId, action: "set-speed", value: 1.25 });
  await manager.command({ sessionId, action: "pause" });
  await manager.command({ sessionId, action: "resume" });

  expect(embed.calls).toContain("command:seek,60.000,absolute+exact");
  expect(embed.calls).toContain("set:aid=3");
  expect(embed.calls).toContain("set:sid=no");
  expect(embed.calls).toContain("set:volume=55");
  expect(embed.calls).toContain("set:mute=true");
  expect(embed.calls).toContain("set:speed=1.25");
  expect(embed.calls).toContain("set:pause=true");
  expect(embed.calls).toContain("set:pause=false");

  await manager.stop(sessionId);
  await expect(manager.command({ sessionId, action: "pause" })).rejects.toThrow(
    "That native playback session has ended",
  );
});

test("rejects foreign servers, invalid files and missing engines", async () => {
  const { manager } = setup();
  await expect(
    manager.play({
      fileId: 7,
      serverUrl: "http://evil.example:8765",
      serverOrigin: "http://localhost:5173",
    }),
  ).rejects.toThrow("Native playback only connects to the active Plexy server");

  await expect(
    manager.play({
      fileId: 0,
      serverUrl: "http://127.0.0.1:8765",
      serverOrigin: "http://127.0.0.1:8765",
    }),
  ).rejects.toThrow("Invalid file id");

  const events: NativePlaybackEvent[] = [];
  const unavailable = new NativePlayerManager((event) => events.push(event), {
    platform: "darwin",
    libmpv: "/definitely/missing/libmpv.2.dylib",
    surface: () => ({ handle: Buffer.alloc(8), width: 800, height: 600 }),
  });
  expect(unavailable.info().available).toBe(false);
  await expect(
    unavailable.play({
      fileId: 7,
      serverUrl: "http://127.0.0.1:8765",
      serverOrigin: "http://127.0.0.1:8765",
    }),
  ).rejects.toThrow();
});

test("a failed load tears down the relay and surface", async () => {
  const { manager, embeds } = setup();
  const failing = new NativePlayerManager(
    () => {},
    {
      platform: "darwin",
      libmpv: "/fake/libmpv.2.dylib",
      surface: () => ({ handle: Buffer.alloc(8), width: 800, height: 600 }),
      fetch: async () => manifestResponse(),
      createEmbed: (libPath, onEvent) => {
        const embed = new FakeEmbed(libPath, onEvent);
        embed.load = () => {
          throw new Error("engine failed");
        };
        embeds.push(embed);
        return embed;
      },
    },
  );
  await expect(
    failing.play({
      fileId: 7,
      serverUrl: "http://127.0.0.1:8765",
      serverOrigin: "http://127.0.0.1:8765",
    }),
  ).rejects.toThrow("engine failed");
  expect(embeds[0]!.destroyed).toBe(true);
  await manager.dispose();
});

test("a delayed open cannot replace a newer paused session", async () => {
  const delayedManifest = Promise.withResolvers<Response>();
  let requests = 0;
  const { manager, embeds } = setup(manifestResponse(), async () => {
    return ++requests === 1 ? delayedManifest.promise : manifestResponse();
  });
  const request = {
    fileId: 7,
    serverUrl: "http://127.0.0.1:8765",
    serverOrigin: "http://127.0.0.1:8765",
  };

  const stale = manager.play(request).catch((error: unknown) => error);
  try {
    const { sessionId } = await manager.play(request);
    await manager.command({ sessionId, action: "pause" });

    delayedManifest.resolve(manifestResponse());
    expect(await stale).toEqual(new Error("Playback request was superseded"));

    expect(embeds).toHaveLength(1);
    expect(embeds[0]?.calls.at(-1)).toBe("set:pause=true");
    expect(embeds[0]?.destroyed).toBe(false);
  } finally {
    delayedManifest.resolve(manifestResponse());
    await manager.dispose();
  }
});
