/// Embedded mpv playback manager (desktop, macOS first).
///
/// Flow: renderer asks to play a file id -> this module fetches the native
/// manifest from the active Plexy server with Chromium's session cookies ->
/// the original file and any sidecar subtitles are exposed through a
/// short-lived loopback relay -> libmpv, loaded in the Electron main process,
/// decodes the original file into an NSView that sits below the web contents
/// view inside the Plexy window.
///
/// mpv never sees backend credentials or arbitrary filesystem paths: it gets
/// unguessable loopback URLs, and the renderer can only name a file id and a
/// small set of playback actions. Transport lives in `native-relay.ts`.
import { existsSync, statSync } from "node:fs";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { MediaRelay } from "./native-relay";

/**
 * Electron APIs are loaded lazily so the manager can be exercised with a fake
 * window outside the Electron runtime.
 */
function electron(): typeof import("electron") {
  return require("electron") as typeof import("electron");
}

export interface NativeWindowSurface {
  /** Native NSView pointer from `BrowserWindow.getNativeWindowHandle()`. */
  handle: Buffer;
  width: number;
  height: number;
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

export type NativePlayerAction =
  | "pause"
  | "resume"
  | "seek"
  | "stop"
  | "set-audio"
  | "set-subtitle"
  | "set-volume"
  | "set-mute"
  | "set-speed";

export interface NativeCommandRequest {
  sessionId: string;
  action: NativePlayerAction;
  value?: number;
}

/**
 * A language track as mpv sees it. Audio and subtitle tracks share the shape so
 * the Plexy player can render the same menu for both.
 */
export interface NativeAudioTrack {
  id: number;
  title: string | null;
  language: string | null;
  default: boolean;
  selected: boolean;
  /** External (sidecar) track rather than one embedded in the container. */
  external?: boolean;
}

export interface NativePlaybackEvent {
  sessionId: string;
  fileId: number;
  type:
    | "ready"
    | "time"
    | "duration"
    | "pause"
    | "buffering"
    | "ended"
    | "error"
    | "closed"
    | "audio"
    | "tracks"
    | "volume"
    | "speed";
  position?: number;
  duration?: number;
  paused?: boolean;
  buffering?: boolean;
  message?: string;
  audioTracks?: NativeAudioTrack[];
  subtitleTracks?: NativeAudioTrack[];
  /** Seconds of media mpv has cached ahead of the playhead. */
  cachedSeconds?: number;
  /** 0–100, mpv's own volume scale. */
  volume?: number;
  muted?: boolean;
  speed?: number;
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
  external?: boolean;
  image?: boolean;
}

interface MpvEmbedEvent {
  type: "property" | "event" | "error";
  name?: string;
  value?: number | string | boolean;
  message?: string;
}

interface MpvEmbedHandle {
  attach(handle: Buffer, x: number, y: number, width: number, height: number): boolean;
  setBounds(x: number, y: number, width: number, height: number): boolean;
  setVisible(visible: boolean): boolean;
  load(url: string, startSeconds: number, title: string, audioLanguage: string): boolean;
  setProperty(name: string, value: string | number | boolean): boolean;
  getPropertyString(name: string): string | null;
  command(parts: string[]): boolean;
  destroy(): void;
}

interface MpvEmbedConstructor {
  new (libmpvPath: string, onEvent: (event: MpvEmbedEvent) => void): MpvEmbedHandle;
}

interface Session {
  id: string;
  fileId: number;
  title: string;
  manifest: NativeManifest;
  relay: MediaRelay;
  serverOrigin: string;
  embed: MpvEmbedHandle;
  duration: number | null;
  position: number;
  paused: boolean;
  volume: number;
  muted: boolean;
  speed: number;
  cacheEnd: number;
  stopping: boolean;
  cleaned: boolean;
  lastTimeEvent: number;
  autoSubtitles: boolean;
  subtitleLanguage: string;
  preferredAudioLanguage: string;
  /** mpv track ids by kind, refreshed from `track-list`. */
  audioTracks: NativeAudioTrack[];
  subtitleTracks: NativeAudioTrack[];
}

const TIME_EVENT_INTERVAL_MS = 1_000;

function isFile(file: string): boolean {
  try {
    return existsSync(file) && statSync(file).isFile();
  } catch {
    return false;
  }
}

/**
 * The app directory. Bun rewrites `__dirname` to the source tree at build time,
 * so ask Electron where the running app lives instead.
 */
function appRoot(): string {
  try {
    return electron().app.getAppPath();
  } catch {
    return process.cwd();
  }
}

function repoRoot(): string {
  // dev: apps/desktop -> repo root
  return path.resolve(appRoot(), "..", "..");
}

function isPackagedApp(): boolean {
  try {
    return Boolean(electron()?.app?.isPackaged);
  } catch {
    return false;
  }
}

function packagedBinaries(): string {
  try {
    return path.join(process.resourcesPath, "bin");
  } catch {
    return "";
  }
}

/** Locate libmpv: explicit override, bundled copy, then Homebrew/system paths. */
export function resolveLibmpv(): string | null {
  const candidates: Array<string | undefined> = [];
  if (process.env.PLEXY_LIBMPV) candidates.push(process.env.PLEXY_LIBMPV);
  const bin = packagedBinaries();
  if (bin) {
    candidates.push(path.join(bin, "libmpv.2.dylib"), path.join(bin, "mpv-libs", "libmpv.2.dylib"));
  }
  candidates.push(
    path.join(repoRoot(), "dist", "bin", "libmpv.2.dylib"),
    path.join(repoRoot(), "dist", "bin", "mpv-libs", "libmpv.2.dylib"),
    "/opt/homebrew/opt/mpv/lib/libmpv.2.dylib",
    "/usr/local/opt/mpv/lib/libmpv.2.dylib",
    "/opt/homebrew/lib/libmpv.2.dylib",
    "/usr/local/lib/libmpv.2.dylib",
  );
  for (const candidate of candidates) {
    if (candidate && isFile(candidate)) return candidate;
  }
  return null;
}

/** The native addon lives next to the bundled main script. */
export function resolveEmbedAddon(): string | null {
  const candidates = [
    path.join(process.resourcesPath ?? "", "native", "mpv_embed.node"),
    path.join(appRoot(), "dist", "native", "mpv_embed.node"),
    path.join(appRoot(), "native", "mpv_embed.node"),
  ];
  for (const candidate of candidates) {
    if (candidate && isFile(candidate)) return candidate;
  }
  return null;
}

let cachedAddon: MpvEmbedConstructor | null | undefined;

function loadEmbedAddon(): MpvEmbedConstructor | null {
  if (cachedAddon !== undefined) return cachedAddon;
  const addonPath = resolveEmbedAddon();
  if (!addonPath) {
    cachedAddon = null;
    return null;
  }
  try {
    const module = { exports: {} as Record<string, unknown> };
    (process as NodeJS.Process & { dlopen: (m: unknown, p: string) => void }).dlopen(module, addonPath);
    const constructor = module.exports.MpvEmbed as MpvEmbedConstructor | undefined;
    cachedAddon = constructor ?? null;
  } catch (error) {
    console.error("[Plexy Desktop] Could not load the embedded player:", error);
    cachedAddon = null;
  }
  return cachedAddon;
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

function mapTrack(track: MpvTrack): NativeAudioTrack {
  return {
    id: track.id,
    title: track.title ?? null,
    language: track.lang ?? null,
    default: Boolean(track.default),
    selected: Boolean(track.selected),
    external: Boolean(track.external),
  };
}

export class NativePlayerManager {
  private session: Session | null = null;

  constructor(
    private readonly emit: (event: NativePlaybackEvent) => void,
    private readonly options: {
      fetch?: ManifestFetch;
      /** Injectable so the manager can be exercised on non-macOS CI runners. */
      platform?: NodeJS.Platform;
      /** The window the video surface is attached to. */
      surface?: () => NativeWindowSurface | null;
      /** Overrides for tests: a fake engine and module factory. */
      libmpv?: string;
      createEmbed?: (libmpvPath: string, onEvent: (event: MpvEmbedEvent) => void) => MpvEmbedHandle;
    } = {},
  ) {}

  info(): NativePlaybackInfo {
    const platform = this.options.platform ?? process.platform;
    const supported = platform === "darwin";
    const libmpv = this.options.libmpv ?? resolveLibmpv();
    const addon = this.options.createEmbed ?? loadEmbedAddon();
    const available = supported && Boolean(libmpv) && Boolean(addon);
    const engine = libmpv?.includes("/Cellar/") || libmpv?.includes("/opt/homebrew/")
      ? "system"
      : libmpv
        ? "bundled"
        : null;
    return {
      available,
      platform,
      engine,
      version: this.mpvVersion(libmpv),
      ...(available
        ? {}
        : {
            reason: !supported
              ? "Native playback is only available on macOS."
              : !libmpv
                ? "The embedded playback engine (libmpv) is not installed. Install mpv or bundle libmpv."
                : "The embedded player module is missing. Rebuild the desktop app.",
          }),
    };
  }

  private mpvVersion(libmpv: string | null): string | null {
    if (!libmpv) return null;
    try {
      const text = require("node:fs").readFileSync(libmpv + ".version", "utf8").trim();
      return text || null;
    } catch {
      return null;
    }
  }

  /** The renderer can move the surface when the player layout changes. */
  setSurfaceBounds(bounds: { x: number; y: number; width: number; height: number }): boolean {
    const session = this.session;
    if (!session) return false;
    return session.embed.setBounds(bounds.x, bounds.y, bounds.width, bounds.height);
  }

  async play(request: NativePlayRequest): Promise<NativePlayResult> {
    const info = this.info();
    if (!info.available) throw new Error(info.reason ?? "Native playback is unavailable");

    const fileId = Number(request.fileId);
    if (!Number.isSafeInteger(fileId) || fileId <= 0) throw new Error("Invalid file id");
    const serverUrl = validateServerUrl(String(request.serverUrl ?? ""), String(request.serverOrigin ?? ""));

    const surface = this.options.surface?.() ?? null;
    if (!surface) throw new Error("The Plexy window is not ready for playback.");

    const manifest = await this.fetchManifest(serverUrl, fileId);
    const libmpv = this.options.libmpv ?? resolveLibmpv();
    const Addon = this.options.createEmbed ?? loadEmbedAddon();
    if (!libmpv || !Addon) throw new Error(info.reason ?? "The native playback engine is not installed");

    await this.stop();

    const relay = new MediaRelay(serverUrl.origin);
    await relay.start();

    const session = {} as Session;
    Object.assign(session, {
      id: randomUUID(),
      fileId,
      title: displayTitle(manifest),
      manifest,
      relay,
      serverOrigin: serverUrl.origin,
      embed: null as unknown as MpvEmbedHandle,
      duration: manifest.duration ?? manifest.watch?.duration ?? null,
      position: 0,
      paused: false,
      volume: 100,
      muted: false,
      speed: 1,
      cacheEnd: 0,
      stopping: false,
      cleaned: false,
      lastTimeEvent: 0,
      autoSubtitles: request.autoSubtitles !== false,
      subtitleLanguage: String(request.subtitleLanguage ?? "en").toLowerCase().split(/[-_]/)[0] ?? "en",
      preferredAudioLanguage: String(manifest.native?.preferredAudioLanguage ?? "en")
        .toLowerCase()
        .split(/[-_]/)[0] ?? "en",
      audioTracks: [],
      subtitleTracks: [],
    });

    let streamUrl: string;
    try {
      streamUrl = relay.register(new URL(manifest.native!.streamUrl, serverUrl).toString());
    } catch (error) {
      await relay.close();
      throw error;
    }

    this.session = session;
    try {
      const embed = this.options.createEmbed
        ? this.options.createEmbed(libmpv, (event) => this.handleEmbedEvent(session, event))
        : new (Addon as MpvEmbedConstructor)(libmpv, (event) => this.handleEmbedEvent(session, event));
      session.embed = embed;
      embed.attach(surface.handle, 0, 0, surface.width, surface.height);
      embed.setVisible(true);

      const resume = clampPosition(request.resumeSeconds, session.duration);
      session.position = resume;
      embed.load(streamUrl, resume, session.title, session.preferredAudioLanguage);
    } catch (error) {
      this.session = null;
      session.stopping = true;
      session.cleaned = true;
      try {
        session.embed?.destroy?.();
      } catch {
        /* already gone */
      }
      await relay.close();
      throw error;
    }

    this.refreshTracks(session);
    return { sessionId: session.id, fileId, title: session.title };
  }

  async command(request: NativeCommandRequest): Promise<{ ok: true }> {
    const session = this.session;
    if (!session || session.id !== request.sessionId) {
      // A stale renderer must never steer a newer title.
      throw new Error("That native playback session has ended");
    }
    const embed = session.embed;
    switch (request.action) {
      case "pause":
        embed.setProperty("pause", true);
        return { ok: true };
      case "resume":
        embed.setProperty("pause", false);
        return { ok: true };
      case "seek": {
        const target = clampPosition(request.value, session.duration ?? session.manifest.watch?.duration ?? null);
        embed.command(["seek", target.toFixed(3), "absolute+exact"]);
        session.position = target;
        this.publishTime(session, true);
        return { ok: true };
      }
      case "set-audio": {
        const trackId = Number(request.value);
        if (!Number.isInteger(trackId) || trackId < 0) throw new Error("Invalid audio track");
        embed.setProperty("aid", String(trackId));
        return { ok: true };
      }
      case "set-subtitle": {
        const trackId = Number(request.value);
        if (!Number.isInteger(trackId) || trackId < 0) throw new Error("Invalid subtitle track");
        // 0 means "off"; any other value is an mpv subtitle track id.
        embed.setProperty("sid", trackId === 0 ? "no" : String(trackId));
        return { ok: true };
      }
      case "set-volume": {
        const volume = Number(request.value);
        if (!Number.isFinite(volume)) throw new Error("Invalid volume");
        embed.setProperty("volume", Math.min(130, Math.max(0, volume)));
        return { ok: true };
      }
      case "set-mute": {
        embed.setProperty("mute", Number(request.value) > 0);
        return { ok: true };
      }
      case "set-speed": {
        const speed = Number(request.value);
        if (!Number.isFinite(speed) || speed < 0.1 || speed > 4) throw new Error("Invalid playback speed");
        embed.setProperty("speed", speed);
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
    if (session.stopping) return;
    session.stopping = true;
    try {
      session.embed.setVisible(false);
      session.embed.destroy();
    } catch {
      /* the engine is already gone */
    }
    session.cleaned = true;
    await session.relay.close().catch(() => {});
    this.emitEvent(session, { type: "closed" });
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

  private handleEmbedEvent(session: Session, event: MpvEmbedEvent): void {
    if (session.stopping) return;
    if (event.type === "error") {
      this.emitEvent(session, { type: "error", message: redact(event.message ?? "Native playback failed") });
      return;
    }
    if (event.type === "event") {
      switch (event.name) {
        case "loaded": {
          session.paused = false;
          this.afterLoad(session).catch((error) =>
            this.emitEvent(session, {
              type: "error",
              message: error instanceof Error ? error.message : String(error),
            }));
          this.emitEvent(session, { type: "ready" });
          return;
        }
        case "ended":
          this.emitEvent(session, { type: "ended", position: session.duration ?? session.position });
          return;
        case "video-reconfig":
          this.refreshTracks(session);
          return;
        case "stopped":
          return;
        default:
          return;
      }
    }
    if (event.type !== "property") return;

    switch (event.name) {
      case "time-pos": {
        const position = Number(event.value);
        if (!Number.isFinite(position) || position < 0) return;
        session.position = position;
        this.publishTime(session, false);
        return;
      }
      case "duration": {
        const duration = Number(event.value);
        if (!Number.isFinite(duration) || duration <= 0) return;
        if (session.duration === duration) return;
        session.duration = duration;
        this.emitEvent(session, { type: "duration", duration });
        return;
      }
      case "pause": {
        session.paused = Boolean(event.value);
        this.emitEvent(session, { type: "pause", paused: session.paused, position: session.position });
        return;
      }
      case "paused-for-cache":
        this.emitEvent(session, { type: "buffering", buffering: Boolean(event.value) });
        return;
      case "demuxer-cache-time": {
        const cached = Number(event.value);
        session.cacheEnd = Number.isFinite(cached) && cached > 0 ? cached : 0;
        return;
      }
      case "volume": {
        const volume = Number(event.value);
        if (!Number.isFinite(volume)) return;
        session.volume = volume;
        this.emitEvent(session, { type: "volume", volume, muted: session.muted });
        return;
      }
      case "mute":
        session.muted = Boolean(event.value);
        this.emitEvent(session, { type: "volume", volume: session.volume, muted: session.muted });
        return;
      case "speed": {
        const speed = Number(event.value);
        if (!Number.isFinite(speed) || speed <= 0) return;
        session.speed = speed;
        this.emitEvent(session, { type: "speed", speed });
        return;
      }
      case "aid":
      case "sid":
        this.refreshTracks(session);
        return;
      default:
        return;
    }
  }

  private readTracks(session: Session): MpvTrack[] | null {
    const raw = session.embed.getPropertyString("track-list");
    if (!raw) return null;
    try {
      const parsed = JSON.parse(raw) as MpvTrack[];
      return Array.isArray(parsed) ? parsed : null;
    } catch {
      return null;
    }
  }

  private refreshTracks(session: Session): void {
    const tracks = this.readTracks(session);
    if (!tracks) return;
    session.audioTracks = tracks.filter((track) => track.type === "audio").map(mapTrack);
    // Image-based subtitles (PGS/VobSub) are still selectable; the menu only
    // needs their language and title.
    session.subtitleTracks = tracks.filter((track) => track.type === "sub").map(mapTrack);
    this.emitEvent(session, {
      type: "tracks",
      audioTracks: session.audioTracks,
      subtitleTracks: session.subtitleTracks,
    });
  }

  private async afterLoad(session: Session): Promise<void> {
    const resume = clampPosition(session.position, session.duration ?? session.manifest.watch?.duration ?? null);
    if (resume > 1) {
      session.embed.command(["seek", resume.toFixed(3), "absolute+exact"]);
    }
    await this.selectAudio(session).catch(() => {});
    await this.addSidecarSubtitles(session).catch(() => {});
    this.refreshTracks(session);
  }

  private async selectAudio(session: Session): Promise<void> {
    const tracks = this.readTracks(session);
    if (!tracks) return;
    const audio = tracks.filter((track) => track.type === "audio");
    if (audio.length < 2) return;
    const preferred = session.preferredAudioLanguage.toLowerCase();
    const match =
      (preferred ? audio.find((track) => (track.lang ?? "").toLowerCase().startsWith(preferred)) : undefined)
      ?? audio.find((track) => track.default)
      ?? audio[0];
    if (match) session.embed.setProperty("aid", String(match.id));
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
        session.embed.command(["sub-add", url, "auto", track.title ?? "", track.language ?? ""]);
        added.push({ id: 0, language: (track.language ?? "").toLowerCase() });
      } catch {
        /* a broken sidecar must not fail playback */
      }
    }
    if (!session.autoSubtitles || added.length === 0) return;
    const preferred = session.subtitleLanguage.toLowerCase();
    if (!preferred) return;
    const tracks = this.readTracks(session);
    if (!tracks) return;
    const match = tracks.find(
      (track) => track.type === "sub" && (track.lang ?? "").toLowerCase().startsWith(preferred),
    );
    if (match) session.embed.setProperty("sid", String(match.id));
  }

  private publishTime(session: Session, force: boolean): void {
    const now = Date.now();
    if (!force && now - session.lastTimeEvent < TIME_EVENT_INTERVAL_MS) return;
    session.lastTimeEvent = now;
    this.emitEvent(session, {
      type: "time",
      position: session.position,
      duration: session.duration ?? session.manifest.duration ?? session.manifest.watch?.duration ?? undefined,
      cachedSeconds: Math.max(0, session.cacheEnd - session.position),
    });
  }

  private emitEvent(
    session: Session,
    event: Omit<NativePlaybackEvent, "sessionId" | "fileId" | "type"> & {
      type: NativePlaybackEvent["type"];
    },
  ): void {
    this.emit({ sessionId: session.id, fileId: session.fileId, ...event });
  }
}
