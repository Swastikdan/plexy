/// Native player manager: a fake mpv process exercises JSON IPC framing,
/// resume seeks, stale-session rejection, crashes and cleanup without needing
/// a real engine on the test machine.
import { afterAll, expect, test } from "bun:test";
import { chmod, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { NativePlayerManager, type NativePlaybackEvent } from "../src/main/native-player";

const dirs: string[] = [];

const FAKE_MPV = `#!/usr/bin/env bun
const net = require("node:net");
const fs = require("node:fs");
const args = process.argv.slice(2);
const socketArg = args.find((arg) => arg.startsWith("--input-ipc-server=")) || "";
const socketPath = socketArg.split("=").slice(1).join("=");
const log = process.env.FAKE_MPV_LOG || "";
const TRACKS = [
  { id: 1, type: "video", selected: true },
  { id: 2, type: "audio", lang: "en", title: "English", default: true, selected: true },
  { id: 3, type: "audio", lang: "hi", title: "Hindi", selected: false },
  { id: 4, type: "sub", lang: "en", title: "English", selected: false },
  { id: 5, type: "sub", lang: "fr", title: "French", selected: false },
];
const write = (entry) => { if (log) fs.appendFileSync(log, JSON.stringify(entry) + "\\n"); };
if (process.env.FAKE_MPV_EXIT_AFTER_MS) {
  setTimeout(() => process.exit(3), Number(process.env.FAKE_MPV_EXIT_AFTER_MS));
}
const server = net.createServer((socket) => {
  let buffer = "";
  socket.on("data", (chunk) => {
    buffer += chunk.toString();
    let index;
    while ((index = buffer.indexOf("\\n")) >= 0) {
      const line = buffer.slice(0, index).trim();
      buffer = buffer.slice(index + 1);
      if (!line) continue;
      const message = JSON.parse(line);
      write({ command: message.command, request_id: message.request_id });
      const id = message.request_id;
      const name = message.command[0];
      if (name === "quit") {
        socket.write(JSON.stringify({ request_id: id, error: "success" }) + "\\n");
        setTimeout(() => process.exit(0), 10);
        continue;
      }
      const property = message.command[1];
      const data = name === "get_property" && property === "track-list" ? TRACKS : null;
      socket.write(JSON.stringify({ request_id: id, error: "success", data }) + "\\n");
      if (name === "seek") {
        socket.write(JSON.stringify({ event: "property-change", name: "time-pos", data: Number(message.command[1]) }) + "\\n");
      }
      if (name === "set_property" && property === "volume") {
        socket.write(JSON.stringify({ event: "property-change", name: "volume", data: Number(message.command[2]) }) + "\\n");
      }
      if (name === "set_property" && property === "mute") {
        socket.write(JSON.stringify({ event: "property-change", name: "mute", data: Boolean(message.command[2]) }) + "\\n");
      }
      if (name === "set_property" && property === "fullscreen") {
        socket.write(JSON.stringify({ event: "property-change", name: "fullscreen", data: Boolean(message.command[2]) }) + "\\n");
      }
      if (name === "observe_property" && message.command[2] === "duration") {
        socket.write(JSON.stringify({ event: "file-loaded" }) + "\\n");
        socket.write(JSON.stringify({ event: "property-change", name: "duration", data: 120 }) + "\\n");
      }
    }
  });
});
server.listen(socketPath);
`;

async function setup(): Promise<{ dir: string; binary: string; log: string }> {
  const dir = await mkdtemp(join(tmpdir(), "plexy-mpv-test-"));
  dirs.push(dir);
  const binary = join(dir, "mpv");
  const log = join(dir, "commands.jsonl");
  await writeFile(binary, FAKE_MPV);
  await chmod(binary, 0o755);
  process.env.PLEXY_MPV = binary;
  process.env.FAKE_MPV_LOG = log;
  return { dir, binary, log };
}

const manifestFetch = async () =>
  new Response(
    JSON.stringify({
      fileId: 7,
      title: "Test Movie",
      subtitle: "S01E01 · Pilot",
      duration: 120,
      watch: { position: 0, duration: 120, played: false },
      tracks: [],
      native: { streamUrl: "/api/stream/7/original", preferredAudioLanguage: "en" },
    }),
    { status: 200, headers: { "content-type": "application/json" } },
  );

async function waitFor(check: () => Promise<boolean>, timeoutMs = 5_000): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await check()) return true;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  return false;
}

async function readCommands(log: string): Promise<Array<{ command: unknown[] }>> {
  try {
    const text = await readFile(log, "utf8");
    return text.trim().split("\n").filter(Boolean).map((line) => JSON.parse(line));
  } catch {
    return [];
  }
}

afterAll(async () => {
  delete process.env.PLEXY_MPV;
  delete process.env.FAKE_MPV_LOG;
  delete process.env.FAKE_MPV_EXIT_AFTER_MS;
  for (const dir of dirs.splice(0)) await rm(dir, { recursive: true, force: true });
});

test("native session loads the relay URL, resumes, and accepts commands", async () => {
  const { log } = await setup();
  const events: NativePlaybackEvent[] = [];
  const manager = new NativePlayerManager((event) => events.push(event), { fetch: manifestFetch, platform: "darwin" });

  const result = await manager.play({
    fileId: 7,
    serverUrl: "http://127.0.0.1:8765",
    serverOrigin: "http://127.0.0.1:8765",
    resumeSeconds: 42,
    autoSubtitles: false,
  });
  expect(result.fileId).toBe(7);
  expect(result.title).toContain("Test Movie");

  expect(await waitFor(() => Promise.resolve(events.some((event) => event.type === "ready")))).toBe(true);
  expect(await waitFor(async () => (await readCommands(log)).some(
    (entry) => entry.command[0] === "seek" && Number(entry.command[1]) === 42,
  ))).toBe(true);

  await manager.command({ sessionId: result.sessionId, action: "pause" });
  expect(await waitFor(async () => (await readCommands(log)).some(
    (entry) => entry.command[0] === "set_property" && entry.command[1] === "pause" && entry.command[2] === true,
  ))).toBe(true);

  await expect(
    manager.command({ sessionId: "stale-session", action: "pause" }),
  ).rejects.toThrow();

  await manager.stop(result.sessionId);
  expect(events.some((event) => event.type === "closed")).toBe(true);
  await expect(
    manager.command({ sessionId: result.sessionId, action: "pause" }),
  ).rejects.toThrow();
});

test("player controls map onto mpv properties", async () => {
  const { log } = await setup();
  const events: NativePlaybackEvent[] = [];
  const manager = new NativePlayerManager((event) => events.push(event), { fetch: manifestFetch, platform: "darwin" });
  const result = await manager.play({
    fileId: 7,
    serverUrl: "http://127.0.0.1:8765",
    serverOrigin: "http://127.0.0.1:8765",
  });
  expect(await waitFor(() => Promise.resolve(events.some((event) => event.type === "ready")))).toBe(true);

  await manager.command({ sessionId: result.sessionId, action: "set-volume", value: 40 });
  await manager.command({ sessionId: result.sessionId, action: "set-mute", value: 1 });
  await manager.command({ sessionId: result.sessionId, action: "set-speed", value: 1.5 });
  await manager.command({ sessionId: result.sessionId, action: "set-subtitle", value: 4 });
  await manager.command({ sessionId: result.sessionId, action: "toggle-fullscreen" });

  const commands = await readCommands(log);
  const has = (...expected: unknown[]) => commands.some(
    (entry) => expected.every((value, index) => entry.command[index] === value),
  );
  expect(has("set_property", "volume", 40)).toBe(true);
  expect(has("set_property", "mute", true)).toBe(true);
  expect(has("set_property", "speed", 1.5)).toBe(true);
  expect(has("set_property", "sid", 4)).toBe(true);
  expect(has("set_property", "fullscreen", true)).toBe(true);

  // Volume and track state come back to the player surface.
  expect(await waitFor(() => Promise.resolve(events.some(
    (event) => event.type === "volume" && event.volume === 40 && event.muted === true,
  )))).toBe(true);
  expect(events.some(
    (event) => event.type === "tracks"
      && (event.audioTracks?.length ?? 0) >= 2
      && (event.subtitleTracks?.length ?? 0) >= 2,
  )).toBe(true);

  await expect(
    manager.command({ sessionId: result.sessionId, action: "set-speed", value: 99 }),
  ).rejects.toThrow();
  await manager.dispose();
});

test("stopping a session removes its IPC socket and relay", async () => {
  await setup();
  const manager = new NativePlayerManager(() => {}, { fetch: manifestFetch, platform: "darwin" });
  const result = await manager.play({
    fileId: 7,
    serverUrl: "http://127.0.0.1:8765",
    serverOrigin: "http://127.0.0.1:8765",
  });
  await manager.stop(result.sessionId);
  // The engine's socket lives in the OS temp dir; cleanup must not throw and a
  // second stop must be a no-op.
  await manager.stop(result.sessionId);
});

test("an engine crash surfaces an error and a closed event", async () => {
  process.env.FAKE_MPV_EXIT_AFTER_MS = "250";
  const { log } = await setup();
  process.env.FAKE_MPV_EXIT_AFTER_MS = "250";
  const events: NativePlaybackEvent[] = [];
  const manager = new NativePlayerManager((event) => events.push(event), { fetch: manifestFetch, platform: "darwin" });
  await manager.play({
    fileId: 7,
    serverUrl: "http://127.0.0.1:8765",
    serverOrigin: "http://127.0.0.1:8765",
  });
  expect(await waitFor(() => Promise.resolve(
    events.some((event) => event.type === "error") && events.some((event) => event.type === "closed"),
  ), 8_000)).toBe(true);
  expect(await readCommands(log)).not.toBeUndefined();
  delete process.env.FAKE_MPV_EXIT_AFTER_MS;
  await manager.dispose();
});

test("a native manifest without a stream URL is rejected", async () => {
  await setup();
  const manager = new NativePlayerManager(() => {}, {
    fetch: async () => new Response(JSON.stringify({ fileId: 7 }), { status: 200 }),
    platform: "darwin",
  });
  await expect(manager.play({
    fileId: 7,
    serverUrl: "http://127.0.0.1:8765",
    serverOrigin: "http://127.0.0.1:8765",
  })).rejects.toThrow(/native playback/i);
});

test("native playback is unavailable on unsupported platforms", async () => {
  await setup();
  const manager = new NativePlayerManager(() => {}, { fetch: manifestFetch, platform: "linux" });
  expect(manager.info().available).toBe(false);
  await expect(manager.play({
    fileId: 7,
    serverUrl: "http://127.0.0.1:8765",
    serverOrigin: "http://127.0.0.1:8765",
  })).rejects.toThrow(/macOS/i);
});

test("the renderer cannot point native playback at another server", async () => {
  await setup();
  const manager = new NativePlayerManager(() => {}, { fetch: manifestFetch, platform: "darwin" });
  await expect(manager.play({
    fileId: 7,
    serverUrl: "https://evil.example.com",
    serverOrigin: "http://127.0.0.1:8765",
  })).rejects.toThrow(/active Plexy server/i);
});
