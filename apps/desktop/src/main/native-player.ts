/// Native mpv playback manager (desktop, macOS first).
///
/// Flow: renderer asks to play a file id -> this module fetches the native
/// manifest from the active Plexy server with Chromium's session cookies ->
/// the original file and any sidecar subtitles are exposed through a
/// short-lived loopback relay -> a bundled mpv process opens the relay URL and
/// is driven over mpv's JSON IPC socket.
///
/// mpv never sees backend credentials or arbitrary filesystem paths: it gets
/// unguessable loopback URLs, and the renderer can only name a file id and a
/// small set of playback actions. Transport lives in `native-relay.ts`.
import { spawn, type ChildProcess } from "node:child_process";
import { existsSync, readFileSync, statSync, unlinkSync } from "node:fs";
import { mkdir as mkdirAsync } from "node:fs/promises";
import * as net from "node:net";
import os from "node:os";
import path from "node:path";
import { randomBytes, randomUUID } from "node:crypto";
import { MediaRelay } from "./native-relay";

/**
 * Electron APIs are loaded lazily so the manager can be unit-tested with a fake
 * engine process outside the Electron runtime.
 */
function electron(): typeof import("electron") {
  return require("electron") as typeof import("electron");
}

function isPackagedApp(): boolean {
  try {
    return Boolean(electron()?.app?.isPackaged);
  } catch {
    return false;
  }
}

type ManifestFetch = (url: string, init: RequestInit) => Promise<Response>;

export interface NativePlaybackInfo {
  available: boolean;
  platform: string;
  engine: "bundled" | "system" | null;
  version: string | null;
  reason?: string;
}

export interface NativePlayRequest {
  fileId: number;
  serverUrl: string;
  /** Origin of the trusted renderer frame; the server must belong to it. */
  serverOrigin: string;
  resumeSeconds?: number;
  autoSubtitles?: boolean;
  subtitleLanguage?: string;
}

export interface NativeCommandRequest {
  sessionId: string;
  action: "pause" | "resume" | "seek" | "stop" | "set-audio";
  value?: number;
}

export interface NativeAudioTrack {
  id: number;
  title: string | null;
  language: string | null;
  default: boolean;
  selected: boolean;
}

export interface NativePlaybackEvent {
  sessionId: string;
  fileId: number;
  type: "ready" | "time" | "duration" | "pause" | "buffering" | "ended" | "error" | "closed" | "audio";
  position?: number;
  duration?: number;
  paused?: boolean;
  buffering?: boolean;
  message?: string;
  audioTracks?: NativeAudioTrack[];
}

export interface NativePlayResult {
  sessionId: string;
  fileId: number;
  title: string | null;
}

interface NativeTrack {
  track: string;
  kind: "embedded" | "sidecar";
  language: string | null;
  title: string;
}

interface NativeManifest {
  fileId: number;
  title?: string;
  subtitle?: string | null;
  duration?: number | null;
  watch?: { position: number; duration: number | null; played: boolean } | null;
  tracks?: NativeTrack[];
  native?: { streamUrl: string; preferredAudioLanguage: string };
}

interface MpvTrack {
  id: number;
  type: "audio" | "video" | "sub";
  lang?: string;
  title?: string;
  default?: boolean;
  selected?: boolean;
}

interface PendingRequest {
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}

interface Session {
  id: string;
  fileId: number;
  title: string;
  manifest: NativeManifest;
  relay: MediaRelay;
  serverOrigin: string;
  binary: string;
  socketPath: string;
  proc: ChildProcess | null;
  socket: net.Socket | null;
  buffer: string;
  nextRequestId: number;
  pending: Map<number, PendingRequest>;
  duration: number | null;
  position: number;
  paused: boolean;
  stopping: boolean;
  cleaned: boolean;
  startedAt: number;
  lastTimeEvent: number;
  stderr: string;
  autoSubtitles: boolean;
  subtitleLanguage: string;
  preferredAudioLanguage: string;
}

const MPV_IPC_TIMEOUT_MS = 5_000;
const TIME_EVENT_INTERVAL_MS = 1_000;

function isExecutable(file: string): boolean {
  try {
    return existsSync(file) && statSync(file).isFile();
  } catch {
    return false;
  }
}

function pathLookup(binary: string): string | null {
  const dirs = (process.env.PATH ?? "").split(path.delimiter).filter(Boolean);
  for (const dir of dirs) {
    const candidate = path.join(dir, binary);
    if (isExecutable(candidate)) return candidate;
  }
  return null;
}

function repoRoot(): string {
  // apps/desktop/dist/main.cjs -> repo root
  return path.resolve(__dirname, "..", "..", "..");
}

/** Locate a usable mpv: explicit override, bundled binary, then PATH. */
export function resolveMpv(): { binary: string; engine: "bundled" | "system" } | null {
  const override = process.env.PLEXY_MPV;
  if (override && isExecutable(override)) return { binary: override, engine: "system" };

  const bundled = isPackagedApp()
    ? path.join(process.resourcesPath, "bin", "mpv")
    : path.join(repoRoot(), "dist", "bin", "mpv");
  if (isExecutable(bundled)) return { binary: bundled, engine: "bundled" };

  const onPath = pathLookup("mpv");
  if (onPath) return { binary: onPath, engine: "system" };

  // GUI-launched Electron apps inherit a minimal PATH, so a Homebrew install
  // is often invisible even though it is present.
  const home = process.env.HOME ?? "";
  for (const candidate of [
    "/opt/homebrew/bin/mpv",
    "/usr/local/bin/mpv",
    "/usr/bin/mpv",
    path.join(home, ".local", "bin", "mpv"),
    "/Applications/mpv.app/Contents/MacOS/mpv",
  ]) {
    if (isExecutable(candidate)) return { binary: candidate, engine: "system" };
  }
  return null;
}

/** The bundling step writes `<binary>.version` next to the engine. */
function bundledVersion(binary: string): string | null {
  try {
    const text = readFileSync(binary + ".version", "utf8").trim();
    return text || null;
  } catch {
    return null;
  }
}

function validateServerUrl(raw: string, frameOrigin: string): URL {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error("Invalid Plexy server address");
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error("Invalid Plexy server address");
  }
  if (url.username || url.password || url.search || url.hash) {
    throw new Error("Invalid Plexy server address");
  }
  const host = url.hostname.toLowerCase();
  const loopback = host === "127.0.0.1" || host === "localhost" || host === "::1" || host === "[::1]";
  // The renderer may talk to the page's own server, or to a loopback backend in
  // development; it can never point the relay at an arbitrary remote host.
  if (url.origin !== frameOrigin && !loopback) {
    throw new Error("Native playback only connects to the active Plexy server");
  }
  return new URL(url.origin);
}

function clampPosition(value: unknown, duration: number | null): number {
  const number = Number(value);
  if (!Number.isFinite(number) || number <= 0) return 0;
  const limit = duration && duration > 0 ? Math.max(0, duration - 3) : number;
  return Math.min(number, limit);
}

function redact(value: string): string {
  return value.replace(/\/s\/[a-f0-9]+\/[a-f0-9]+/g, "/s/<redacted>");
}

function displayTitle(manifest: NativeManifest): string {
  return [manifest.title, manifest.subtitle].filter(Boolean).join(" · ") || "Plexy";
}

/** Send one mpv IPC command and await its response. */
function sendCommand(session: Session, command: unknown[], timeoutMs = MPV_IPC_TIMEOUT_MS): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const socket = session.socket;
    if (!socket || socket.destroyed) {
      reject(new Error("The native player is not ready"));
      return;
    }
    const requestId = session.nextRequestId++;
    const timer = setTimeout(() => {
      session.pending.delete(requestId);
      reject(new Error("The native player did not answer"));
    }, timeoutMs);
    session.pending.set(requestId, { resolve, reject, timer });
    try {
      socket.write(JSON.stringify({ command, request_id: requestId }) + "\n");
    } catch (error) {
      clearTimeout(timer);
      session.pending.delete(requestId);
      reject(error instanceof Error ? error : new Error(String(error)));
    }
  });
}

export class NativePlayerManager {
  private session: Session | null = null;

  constructor(
    private readonly emit: (event: NativePlaybackEvent) => void,
    private readonly options: {
      fetch?: ManifestFetch;
      /** Injectable so the manager can be exercised on non-macOS CI runners. */
      platform?: NodeJS.Platform;
    } = {},
  ) {}

  info(): NativePlaybackInfo {
    const mpv = resolveMpv();
    const platform = this.options.platform ?? process.platform;
    const supported = platform === "darwin";
    return {
      available: supported && Boolean(mpv),
      platform,
      engine: mpv?.engine ?? null,
      version: mpv ? bundledVersion(mpv.binary) : null,
      ...(supported && mpv
        ? {}
        : {
            reason: supported
              ? "The native playback engine is not installed. Run the app's mpv bundling step or set PLEXY_MPV to an mpv binary."
              : "Native playback is only available on macOS.",
          }),
    };
  }
  async play(request: NativePlayRequest): Promise<NativePlayResult> {
    const info = this.info();
    if (!info.available) throw new Error(info.reason ?? "Native playback is unavailable");

    const fileId = Number(request.fileId);
    if (!Number.isSafeInteger(fileId) || fileId <= 0) throw new Error("Invalid file id");
    const serverUrl = validateServerUrl(String(request.serverUrl ?? ""), String(request.serverOrigin ?? ""));

    const manifest = await this.fetchManifest(serverUrl, fileId);
    const mpv = resolveMpv();
    if (!mpv) throw new Error(info.reason ?? "The native playback engine is not installed");

    await this.stop();

    const relay = new MediaRelay(serverUrl.origin);
    await relay.start();
    const session: Session = {
      id: randomUUID(),
      fileId,
      title: displayTitle(manifest),
      manifest,
      relay,
      serverOrigin: serverUrl.origin,
      binary: mpv.binary,
      socketPath: path.join(os.tmpdir(), `plexy-mpv-${randomBytes(5).toString("hex")}.sock`),
      proc: null,
      socket: null,
      buffer: "",
      nextRequestId: 1,
      pending: new Map(),
      duration: manifest.duration ?? manifest.watch?.duration ?? null,
      position: 0,
      paused: false,
      stopping: false,
      cleaned: false,
      startedAt: Date.now(),
      lastTimeEvent: 0,
      stderr: "",
      autoSubtitles: request.autoSubtitles !== false,
      subtitleLanguage: String(request.subtitleLanguage ?? "en").toLowerCase().split(/[-_]/)[0] ?? "en",
      preferredAudioLanguage: String(manifest.native?.preferredAudioLanguage ?? "en")
        .toLowerCase()
        .split(/[-_]/)[0] ?? "en",
    };

    let streamUrl: string;
    try {
      streamUrl = relay.register(new URL(manifest.native!.streamUrl, serverUrl).toString());
    } catch (error) {
      await relay.close();
      throw error;
    }

    try {
      await this.spawn(session, streamUrl, request.resumeSeconds);
    } catch (error) {
      await this.stopSession(session, false);
      throw error;
    }
    this.session = session;
    return { sessionId: session.id, fileId, title: session.title };
  }

  async command(request: NativeCommandRequest): Promise<{ ok: true }> {
    const session = this.session;
    if (!session || session.id !== request.sessionId) {
      // A stale renderer must never steer a newer title.
      throw new Error("That native playback session has ended");
    }
    switch (request.action) {
      case "pause":
        await sendCommand(session, ["set_property", "pause", true]);
        return { ok: true };
      case "resume":
        await sendCommand(session, ["set_property", "pause", false]);
        return { ok: true };
      case "seek": {
        const target = clampPosition(request.value, session.duration ?? session.manifest.watch?.duration ?? null);
        await sendCommand(session, ["seek", target, "absolute+exact"]);
        session.position = target;
        this.publishTime(session, true);
        return { ok: true };
      }
      case "set-audio": {
        const trackId = Number(request.value);
        if (!Number.isInteger(trackId) || trackId < 0) throw new Error("Invalid audio track");
        await sendCommand(session, ["set_property", "aid", trackId]);
        await this.emitAudioTracks(session);
        return { ok: true };
      }
      case "stop":
        await this.stop(session.id);
        return { ok: true };
      default:
        throw new Error("Unsupported player action");
    }
  }

  async stop(sessionId?: string): Promise<void> {
    const session = this.session;
    if (!session) return;
    if (sessionId && session.id !== sessionId) return;
    this.session = null;
    await this.stopSession(session, true);
  }

  async dispose(): Promise<void> {
    await this.stop();
  }

  // --- internals -------------------------------------------------------------

  private async fetchManifest(serverUrl: URL, fileId: number): Promise<NativeManifest> {
    const url = new URL(`/api/play/${fileId}?native=1`, serverUrl).toString();
    let response: Response;
    try {
      const fetcher: ManifestFetch = this.options.fetch
        ?? ((url, init) => electron().net.fetch(url, init));
      response = await fetcher(url, {
        headers: { accept: "application/json" },
        credentials: "include",
        signal: AbortSignal.timeout(12_000),
      });
    } catch (error) {
      throw new Error(
        `Could not reach the Plexy server: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
    if (response.status === 401) throw new Error("Sign in to Plexy again to use the native player.");
    if (!response.ok) throw new Error(`The Plexy server returned ${response.status}`);
    const manifest = (await response.json()) as NativeManifest;
    if (!manifest?.native?.streamUrl) {
      throw new Error("This Plexy server does not support native playback. Update the server and try again.");
    }
    return manifest;
  }

  private async spawn(session: Session, streamUrl: string, resumeSeconds: unknown): Promise<void> {
    await mkdirAsync(path.dirname(session.socketPath), { recursive: true }).catch(() => {});
    try {
      unlinkSync(session.socketPath);
    } catch {
      /* no stale socket */
    }

    const resume = clampPosition(resumeSeconds, session.duration ?? session.manifest.watch?.duration ?? null);
    session.position = resume;
    const args = [
      "--no-config",
      "--load-scripts=no",
      `--input-ipc-server=${session.socketPath}`,
      "--idle=yes",
      "--force-window=yes",
      "--keep-open=no",
      "--hwdec=auto-safe",
      "--no-resume-playback",
      "--save-position-on-quit=no",
      "--sub-auto=no",
      "--audio-file-auto=no",
      "--user-agent=Plexy-Native",
      `--title=${session.title}`,
      ...(resume > 1 ? [`--start=${resume.toFixed(3)}`] : []),
      streamUrl,
    ];

    // The official macOS mpv bundle ships MoltenVK; the ICD path is rewritten
    // during bundling so Vulkan works from inside the Plexy app resources.
    const icd = path.join(path.dirname(session.binary), "vulkan", "icd.d", "MoltenVK_icd.json");
    const env = existsSync(icd)
      ? { ...process.env, VK_ICD_FILENAMES: icd }
      : process.env;
    const proc = spawn(session.binary, args, { stdio: ["ignore", "ignore", "pipe"], env });
    session.proc = proc;
    proc.stderr?.on("data", (chunk: Buffer) => {
      const text = redact(chunk.toString());
      session.stderr = (session.stderr + text).slice(-2_000);
    });
    proc.on("error", (error: Error) => {
      this.failSession(session, `The native player failed to start: ${error.message}`);
    });
    proc.on("exit", (code: number | null, signal: string | null) => {
      const unexpected = !session.stopping;
      this.cleanup(session).catch(() => {});
      // A zero exit is the viewer closing the mpv window; only a non-zero exit
      // is a crash worth surfacing as an error.
      if (unexpected && code !== 0) {
        const detail = session.stderr.trim().split("\n").slice(-3).join(" ").slice(0, 300);
        this.emitEvent(session, {
          type: "error",
          message: detail
            ? `The native player stopped unexpectedly (${code ?? signal}): ${detail}`
            : `The native player stopped unexpectedly (${code ?? signal})`,
        });
      }
      this.emitEvent(session, { type: "closed" });
    });

    await this.connectIpc(session);
  }

  private async connectIpc(session: Session): Promise<void> {
    const deadline = Date.now() + 7_000;
    while (Date.now() < deadline) {
      if (session.stopping) throw new Error("Native playback stopped before it started");
      const socket = new net.Socket();
      const connected = await new Promise<boolean>((resolve) => {
        const onError = () => {
          socket.destroy();
          resolve(false);
        };
        socket.once("error", onError);
        socket.once("connect", () => {
          socket.off("error", onError);
          resolve(true);
        });
        socket.connect(session.socketPath);
      });
      if (connected) {
        session.socket = socket;
        this.attachSocket(session, socket);
        // Observe only what the Plexy session surface needs.
        for (const [index, name] of ["time-pos", "duration", "pause", "paused-for-cache"].entries()) {
          void sendCommand(session, ["observe_property", index + 1, name]).catch(() => {});
        }
        return;
      }
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    throw new Error("The native player did not start in time");
  }

  private attachSocket(session: Session, socket: net.Socket): void {
    socket.on("data", (chunk: Buffer) => {
      session.buffer += chunk.toString();
      let index: number;
      while ((index = session.buffer.indexOf("\n")) >= 0) {
        const line = session.buffer.slice(0, index).trim();
        session.buffer = session.buffer.slice(index + 1);
        if (!line) continue;
        try {
          this.handleMessage(session, JSON.parse(line));
        } catch {
          /* ignore malformed IPC lines */
        }
      }
    });
    socket.on("close", () => {
      session.socket = null;
    });
    socket.on("error", () => {
      session.socket = null;
    });
  }

  private handleMessage(session: Session, message: Record<string, unknown>): void {
    if (typeof message.request_id === "number") {
      const pending = session.pending.get(message.request_id);
      if (!pending) return;
      session.pending.delete(message.request_id);
      clearTimeout(pending.timer);
      if (message.error === "success") pending.resolve(message.data ?? null);
      else pending.reject(new Error(String(message.error ?? "The native player rejected the command")));
      return;
    }
    const event = String(message.event ?? "");
    if (event === "property-change") {
      this.handleProperty(session, String(message.name ?? ""), message.data);
      return;
    }
    if (event === "file-loaded") {
      void this.afterLoad(session).catch((error) =>
        this.emitEvent(session, {
          type: "error",
          message: error instanceof Error ? error.message : String(error),
        }));
      this.emitEvent(session, { type: "ready" });
      return;
    }
    if (event === "end-file") {
      const reason = String(message.reason ?? "");
      if (reason === "eof") {
        this.emitEvent(session, { type: "ended", position: session.duration ?? session.position });
      } else if (reason === "error") {
        const detail = String(message.file_error ?? message.error ?? "Playback failed");
        this.emitEvent(session, { type: "error", message: redact(detail) });
      }
    }
  }

  private handleProperty(session: Session, name: string, data: unknown): void {
    switch (name) {
      case "time-pos": {
        const position = Number(data);
        if (!Number.isFinite(position) || position < 0) return;
        session.position = position;
        this.publishTime(session, false);
        return;
      }
      case "duration": {
        const duration = Number(data);
        if (!Number.isFinite(duration) || duration <= 0) return;
        session.duration = duration;
        this.emitEvent(session, { type: "duration", duration });
        return;
      }
      case "pause": {
        session.paused = Boolean(data);
        this.emitEvent(session, { type: "pause", paused: session.paused, position: session.position });
        return;
      }
      case "paused-for-cache":
        this.emitEvent(session, { type: "buffering", buffering: Boolean(data) });
        return;
      default:
        return;
    }
  }

  private publishTime(session: Session, force: boolean): void {
    const now = Date.now();
    if (!force && now - session.lastTimeEvent < TIME_EVENT_INTERVAL_MS) return;
    session.lastTimeEvent = now;
    this.emitEvent(session, {
      type: "time",
      position: session.position,
      duration: session.duration ?? session.manifest.duration ?? session.manifest.watch?.duration ?? undefined,
    });
  }

  private async afterLoad(session: Session): Promise<void> {
    const resume = clampPosition(session.position, session.duration ?? session.manifest.watch?.duration ?? null);
    if (resume > 1) {
      await sendCommand(session, ["seek", resume, "absolute+exact"]).catch(() => {});
    }
    await this.selectAudio(session).catch(() => {});
    await this.addSidecarSubtitles(session).catch(() => {});
    // Let the in-app surface show every embedded language, not just the one
    // mpv selected; the viewer can switch without opening mpv's own menus.
    await this.emitAudioTracks(session).catch(() => {});
  }

  private async readTracks(session: Session): Promise<MpvTrack[] | null> {
    const tracks = await sendCommand(session, ["get_property", "track-list"]);
    return Array.isArray(tracks) ? tracks as MpvTrack[] : null;
  }

  private async emitAudioTracks(session: Session): Promise<void> {
    const tracks = await this.readTracks(session);
    if (!tracks) return;
    this.emitEvent(session, {
      type: "audio",
      audioTracks: tracks
        .filter((track) => track.type === "audio")
        .map((track) => ({
          id: track.id,
          title: track.title ?? null,
          language: track.lang ?? null,
          default: Boolean(track.default),
          selected: Boolean(track.selected),
        })),
    });
  }

  private async selectAudio(session: Session): Promise<void> {
    const tracks = await this.readTracks(session);
    if (!tracks) return;
    const audio = tracks.filter((track) => track.type === "audio");
    if (audio.length < 2) return;
    const preferred = session.preferredAudioLanguage.toLowerCase();
    const match =
      (preferred ? audio.find((track) => (track.lang ?? "").toLowerCase().startsWith(preferred)) : undefined)
      ?? audio.find((track) => track.default)
      ?? audio[0];
    if (match) await sendCommand(session, ["set_property", "aid", match.id]).catch(() => {});
  }

  private async addSidecarSubtitles(session: Session): Promise<void> {
    const sidecars = (session.manifest.tracks ?? []).filter(
      (track) => track.kind === "sidecar" && track.track.startsWith("sidecar-"),
    );
    const added: Array<{ id: number; language: string }> = [];
    for (const track of sidecars.slice(0, 12)) {
      try {
        const url = session.relay.register(
          new URL(`/api/subtitles/${session.fileId}/${encodeURIComponent(track.track)}`, session.serverOrigin).toString(),
        );
        const id = (await sendCommand(session, [
          "sub-add", url, "auto", track.title, track.language ?? "",
        ])) as number;
        if (typeof id === "number" && Number.isFinite(id)) {
          added.push({ id, language: (track.language ?? "").toLowerCase() });
        }
      } catch {
        /* a broken sidecar must not fail playback */
      }
    }
    if (!session.autoSubtitles || added.length === 0) return;
    const preferred = session.subtitleLanguage.toLowerCase();
    const match = preferred
      ? added.find((entry) => entry.language.startsWith(preferred))
      : undefined;
    if (match) await sendCommand(session, ["set_property", "sid", match.id]).catch(() => {});
  }

  private failSession(session: Session, message: string): void {
    this.emitEvent(session, { type: "error", message });
  }

  private emitEvent(
    session: Session,
    event: Omit<NativePlaybackEvent, "sessionId" | "fileId" | "type"> & {
      type: NativePlaybackEvent["type"];
    },
  ): void {
    this.emit({ sessionId: session.id, fileId: session.fileId, ...event });
  }

  private async stopSession(session: Session, notify: boolean): Promise<void> {
    if (!session.stopping) {
      session.stopping = true;
      // Let mpv exit on its own (flush + close its window) before force-killing.
      if (session.socket && !session.socket.destroyed) {
        await sendCommand(session, ["quit"], 800).catch(() => {});
      }
      session.socket?.destroy();
      session.socket = null;
    }
    await this.cleanup(session);
    if (notify) this.emitEvent(session, { type: "closed" });
  }

  private async cleanup(session: Session): Promise<void> {
    if (session.cleaned) return;
    session.cleaned = true;
    for (const [, pending] of session.pending) {
      clearTimeout(pending.timer);
      pending.reject(new Error("Native playback ended"));
    }
    session.pending.clear();
    const proc = session.proc;
    if (proc && proc.exitCode === null) {
      await new Promise<void>((resolve) => {
        const timer = setTimeout(() => {
          try {
            if (proc.exitCode === null) proc.kill("SIGKILL");
          } catch {
            /* already gone */
          }
          resolve();
        }, 1_200);
        proc.once("exit", () => {
          clearTimeout(timer);
          resolve();
        });
      });
    }
    try {
      unlinkSync(session.socketPath);
    } catch {
      /* already removed */
    }
    await session.relay.close().catch(() => {});
  }
}
