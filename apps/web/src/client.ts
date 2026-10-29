/// Typed RPC and REST client for Plexy web app (PRD 9, 10).
///
/// Uses @elysiajs/eden Treaty to connect to the Elysia backend API over typed RPC,
/// while maintaining standard individual HTTP endpoints for direct access, video streaming,
/// WebVTT subtitles, images, and SSE feeds.
import { treaty } from "@elysiajs/eden";
import type { App } from "../../server/src/app";
import { getApiBase } from "./server-config";
import { reportConnectionHealth } from "./lib/connection-health";
import { isPlaybackDiagnosticsEnabled } from "./lib/playback-diagnostics-consent";
import {
  type BrowserCaps,
  type FileFacts,
  type HomePayload,
  type ItemCard,
  type LibraryItem,
  type OptimizerStatus,
  type Playability,
  type PlayPath,
  type PlaybackDiagnostic,
  type ReviewEntry,
  type ReviewPayload,
  type ServerSettings,
  type ServerStatus,
  type SubtitleTrack,
  type SkipSegments,
  type TitleDetail,
  type Watch,
  probeBrowserCaps,
} from "@plexy/api-client";

export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly requestId?: string,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

/** Let the connection gate replace the UI with the pairing screen. */
function notifyUnauthorized(): void {
  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent("plexy:unauthorized"));
  }
}

// The base URL is resolved per call: a hosted web build lets the viewer pick
// their server at runtime, and the desktop app can fall back to a remote one.
const createTreaty = (base: string) =>
  treaty<App>(base, {
    fetch: {
      credentials: "include",
      signal: AbortSignal.timeout(12_000),
    },
  });

function rpc() {
  // Create a fresh request deadline per RPC operation. Caching a Treaty with a
  // single AbortSignal would make every call fail once that signal expires.
  return createTreaty(getApiBase());
}

const READ_RETRY_DELAYS = [250, 650] as const;
const RETRYABLE_STATUSES = new Set([502, 503, 504]);

function pause(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function errorMessage(error: unknown, status: number): string {
  if (!error) return `Request failed (${status || 500})`;
  const value = error as { value?: { error?: unknown } | string; message?: unknown };
  if (typeof value.value === "object" && typeof value.value?.error === "string") return value.value.error;
  if (typeof value.message === "string") return value.message;
  if (typeof value.value === "string") return value.value;
  return `Request failed (${status || 500})`;
}

// Read-only RPC calls are safe to retry after a timeout or transient gateway
// error. Callers pass a factory so every attempt creates a fresh request.
async function unwrap<T>(
  request: () => Promise<{ data: unknown; error: unknown; status: number }>,
  retryRead = true,
): Promise<T> {
  let lastError: unknown;
  const retries = retryRead ? READ_RETRY_DELAYS.length : 0;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const res = await request();
      if (res.status === 401) notifyUnauthorized();
      if (RETRYABLE_STATUSES.has(res.status) && attempt < retries) {
        await pause(READ_RETRY_DELAYS[attempt]!);
        continue;
      }
      reportConnectionHealth(res.status >= 500 ? "unavailable" : "online");
      if (res.error || res.data === null || res.data === undefined) {
        throw new ApiError(res.status || 500, errorMessage(res.error, res.status));
      }
      return res.data as T;
    } catch (error) {
      if (error instanceof ApiError && error.status >= 400 && error.status < 500) throw error;
      lastError = error;
      if (attempt < retries) {
        await pause(READ_RETRY_DELAYS[attempt]!);
        continue;
      }
    }
  }
  reportConnectionHealth(lastError instanceof ApiError ? "unavailable" : "offline");
  if (lastError instanceof ApiError) throw lastError;
  throw new ApiError(503, `Cannot reach the Plexy server at ${getApiBase()}.`);
}

// Direct fetch for plain REST endpoints with safe JSON parsing
async function restFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const base = getApiBase();
  const url = path.startsWith("http") ? path : `${base}${path.startsWith("/") ? "" : "/"}${path}`;
  const method = (init?.method ?? "GET").toUpperCase();
  const canRetry = method === "GET" || method === "HEAD";
  let lastError: unknown;
  for (let attempt = 0; attempt <= (canRetry ? READ_RETRY_DELAYS.length : 0); attempt++) {
    try {
      const res = await fetch(url, {
        credentials: "include",
        ...init,
        signal: init?.signal
          ? AbortSignal.any([init.signal, AbortSignal.timeout(12_000)])
          : AbortSignal.timeout(12_000),
      });
      if (canRetry && RETRYABLE_STATUSES.has(res.status) && attempt < READ_RETRY_DELAYS.length) {
        await res.body?.cancel();
        await pause(READ_RETRY_DELAYS[attempt]!);
        continue;
      }
      const text = await res.text();
      if (res.status === 401) notifyUnauthorized();
      reportConnectionHealth(res.status >= 500 ? "unavailable" : "online");
      let body: unknown = null;
      try {
        body = text ? JSON.parse(text) : null;
      } catch {
        body = text;
      }
      if (!res.ok) {
        const msg = (body as { error?: string } | null)?.error ?? `Request failed (${res.status})`;
        throw new ApiError(res.status, msg, res.headers.get("x-request-id") ?? undefined);
      }
      return body as T;
    } catch (error) {
      if (error instanceof ApiError && error.status >= 400 && error.status < 500) throw error;
      lastError = error;
      if (canRetry && attempt < READ_RETRY_DELAYS.length) {
        await pause(READ_RETRY_DELAYS[attempt]!);
        continue;
      }
      if (error instanceof ApiError) throw error;
    }
  }
  reportConnectionHealth(lastError instanceof ApiError ? "unavailable" : "offline");
  if (lastError instanceof ApiError) throw lastError;
  throw new ApiError(503, `Cannot reach the Plexy server at ${base}.`);
}

export const api = {
  // --- Viewer endpoints (RPC) ---

  serverStatus: async (): Promise<ServerStatus> => {
    return restFetch<ServerStatus>("/api/server/status");
  },

  playbackDiagnostics: async (): Promise<{ events: PlaybackDiagnostic[] }> => {
    return restFetch<{ events: PlaybackDiagnostic[] }>("/api/diagnostics/playback");
  },

  reportPlaybackDiagnostic: async (event: {
    kind: PlaybackDiagnostic["kind"];
    path?: Exclude<PlaybackDiagnostic["path"], null>;
    durationMs?: number;
    mediaErrorCode?: number;
  }): Promise<void> => {
    if (!isPlaybackDiagnosticsEnabled()) return;
    await restFetch<{ ok: true }>("/api/diagnostics/playback", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(event),
    });
  },

  home: async (): Promise<HomePayload> => {
    return unwrap<HomePayload>(() => rpc().api.home.get());
  },

  items: async (query: {
    kind?: "movie" | "series";
    libraryId?: number;
    sort?: string;
    unwatched?: boolean;
    q?: string;
    limit?: number;
    offset?: number;
  }): Promise<{ items: ItemCard[] }> => {
    return unwrap<{ items: ItemCard[] }>(() =>
      rpc().api.items.get({
        query: {
          kind: query.kind,
          libraryId: query.libraryId,
          sort: query.sort,
          unwatched: query.unwatched ? true : undefined,
          q: query.q,
          limit: query.limit ?? 60,
          offset: query.offset ?? 0,
        },
      }),
    );
  },

  title: async (id: number | string): Promise<TitleDetail> => {
    return unwrap<TitleDetail>(() => rpc().api.items({ id: String(id) }).get());
  },

  search: async (q: string): Promise<{ titles: ItemCard[]; episodes: ItemCard[] }> => {
    const result = await unwrap<{
      titles?: ItemCard[];
      episodes?: ItemCard[];
      items?: ItemCard[];
    }>(() => rpc().api.search.get({ query: { q } }));
    if (result.titles || result.episodes) {
      return { titles: result.titles ?? [], episodes: result.episodes ?? [] };
    }
    // Support servers that still return the legacy flat search response.
    const items = result.items ?? [];
    return {
      titles: items.filter((item) => item.kind !== "episode"),
      episodes: items.filter((item) => item.kind === "episode"),
    };
  },

  /**
   * Everything the player needs in one request: play path, title, resume point,
   * next episode, subtitle tracks and preparation state. Uses REST rather than
   * Eden so the response shape is not coupled to route type inference.
   */
  play: async (fileId: number, caps?: BrowserCaps, audioIndex = -1): Promise<Playability> => {
    const params = new URLSearchParams();
    if (caps) params.set("caps", JSON.stringify(caps));
    if (audioIndex >= 0) params.set("audio", String(audioIndex));
    const query = params.size ? `?${params.toString()}` : "";
    return restFetch<Playability>(`/api/play/${fileId}${query}`);
  },

  skipSegments: async (fileId: number): Promise<{ enabled: boolean } & SkipSegments> => {
    return restFetch<{ enabled: boolean } & SkipSegments>(`/api/skip-segments/${fileId}`);
  },

  subtitles: async (fileId: number): Promise<{ tracks: SubtitleTrack[] }> => {
    return unwrap<{ tracks: SubtitleTrack[] }>(() => rpc().api.subtitles({ fileId: String(fileId) }).get());
  },

  progress: async (
    itemId: number,
    position: number,
    duration: number | null,
    played: boolean,
  ): Promise<{ ok: boolean }> => {
    return unwrap<{ ok: boolean }>(
      () => rpc().api.progress.post({
        itemId,
        position,
        duration: duration ?? undefined,
        played,
      }),
      false,
    );
  },

  markWatched: async (itemId: number): Promise<{ ok: boolean; played: boolean }> => {
    return restFetch<{ ok: boolean; played: boolean }>(`/api/watch/${itemId}/played`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ played: true }),
    });
  },

  /**
   * Explicit watched state. Unlike `progress`, this may unmark a title, so the
   * "watched" toggle on the title page works in both directions.
   */
  setWatched: async (itemId: number, played: boolean): Promise<{ ok: boolean; played: boolean }> => {
    return restFetch<{ ok: boolean; played: boolean }>(`/api/watch/${itemId}/played`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ played }),
    });
  },

  /** Remove the watch-state row: clears progress and Continue Watching entry. */
  clearWatch: async (itemId: number): Promise<{ ok: boolean }> => {
    return restFetch<{ ok: boolean }>(`/api/watch/${itemId}`, { method: "DELETE" });
  },

  // --- Admin endpoints (Loopback-only, RPC / REST) ---

  libraries: async (): Promise<{ libraries: LibraryItem[] }> => {
    return restFetch<{ libraries: LibraryItem[] }>("/api/libraries");
  },

  createLibrary: async (name: string, type: "movies" | "tv" | "anime", paths: string[]): Promise<{ id: number }> => {
    return restFetch<{ id: number }>("/api/libraries", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, type, paths }),
    });
  },

  updateLibrary: async (
    id: number,
    patch: { name: string; type: "movies" | "tv" | "anime"; paths: string[] },
  ): Promise<{ ok: true }> => {
    return restFetch<{ ok: true }>(`/api/libraries/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(patch),
    });
  },

  deleteLibrary: async (id: number): Promise<{ ok: boolean }> => {
    return restFetch<{ ok: boolean }>(`/api/libraries/${id}`, {
      method: "DELETE",
    });
  },

  scanLibrary: async (id: number): Promise<{ id: number }> => {
    return restFetch<{ id: number }>(`/api/libraries/${id}/scan`, {
      method: "POST",
    });
  },

  settings: async (): Promise<{ settings: ServerSettings; logLevel: string }> => {
    return restFetch<{ settings: ServerSettings; logLevel: string }>("/api/settings");
  },

  updateSettings: async (patch: Record<string, unknown>): Promise<{ settings: unknown }> => {
    return restFetch<{ settings: unknown }>("/api/settings", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(patch),
    });
  },

  streamPreparationStatus: async (): Promise<{
    total: number;
    ready: number;
    queued: number;
    running: number;
    failed: number;
    cancelled: number;
    error: string | null;
    progress: number;
    current: { title: string; progress: number } | null;
  }> => restFetch<{
    total: number;
    ready: number;
    queued: number;
    running: number;
    failed: number;
    cancelled: number;
    error: string | null;
    progress: number;
    current: { title: string; progress: number } | null;
  }>("/api/stream-preparation/status"),

  runStreamPreparation: async (itemIds: number[]): Promise<{ started: boolean }> => {
    return restFetch<{ started: boolean }>("/api/stream-preparation/run", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ itemIds }),
    });
  },

  deleteTitle: async (itemId: number): Promise<{ ok: boolean }> => {
    return restFetch<{ ok: boolean }>(`/api/items/${itemId}`, { method: "DELETE" });
  },

  cancelStreamPreparation: async (): Promise<void> => {
    await restFetch("/api/stream-preparation/cancel", { method: "POST" });
  },

  clearTmdbCache: async (): Promise<{ removed: number }> => {
    return restFetch<{ removed: number }>("/api/tmdb/cache/clear", { method: "POST" });
  },

  resetLocalData: async (): Promise<{ ok: true; libraries: number; files: number; titles: number }> => {
    return restFetch<{ ok: true; libraries: number; files: number; titles: number }>("/api/database/reset", { method: "POST" });
  },

  testTmdb: async (): Promise<{ ok: boolean; message: string }> => {
    return restFetch<{ ok: boolean; message: string }>("/api/settings/tmdb/test", {
      method: "POST",
    });
  },

  localFolders: async (
    path?: string,
  ): Promise<{
    path: string;
    parent: string | null;
    entries: Array<{ name: string; path: string; isDirectory: boolean; hasVideos: boolean }>;
  }> => {
    return restFetch(`/api/local-folders${path ? `?path=${encodeURIComponent(path)}` : ""}`);
  },

  review: async (params?: {
    status?: "attention" | "all" | "matched" | "review" | "unmatched";
    q?: string;
  }): Promise<ReviewPayload> => {
    const p = new URLSearchParams();
    if (params?.status && params.status !== "attention") p.set("status", params.status);
    if (params?.q?.trim()) p.set("q", params.q.trim());
    return restFetch<ReviewPayload>(`/api/matches/review${p.size ? `?${p}` : ""}`);
  },

  matchSearch: async (
    type: "movie" | "tv",
    query: string,
    year?: number | null,
  ): Promise<{
    results: Array<{
      tmdbId: number;
      type: string;
      title: string;
      year: number | null;
      overview: string | null;
      poster: string | null;
    }>;
  }> => {
    return restFetch<{
      results: Array<{
        tmdbId: number;
        type: string;
        title: string;
        year: number | null;
        overview: string | null;
        poster: string | null;
      }>;
    }>("/api/match/search", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ type, query, year: year ?? undefined }),
    });
  },

  applyMatch: async (itemId: number, tmdbId: number, type: "movie" | "tv"): Promise<{ ok: boolean }> => {
    return restFetch<{ ok: boolean }>(`/api/items/${itemId}/match`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ tmdbId, type }),
    });
  },

  refreshItem: async (itemId: number): Promise<{ ok: boolean }> => {
    return restFetch<{ ok: boolean }>(`/api/items/${itemId}/refresh`, {
      method: "POST",
    });
  },

  logs: async (filter?: { level?: string; component?: string; search?: string }): Promise<{ lines: string[] }> => {
    const p = new URLSearchParams();
    if (filter?.level) p.set("level", filter.level);
    if (filter?.component) p.set("component", filter.component);
    if (filter?.search) p.set("search", filter.search);
    return restFetch<{ lines: string[] }>(`/api/logs${p.size ? `?${p}` : ""}`);
  },

  crashes: async (): Promise<{ crashes: Array<{ id: string; ts: string }> }> => {
    return restFetch<{ crashes: Array<{ id: string; ts: string }> }>("/api/crashes");
  },

  optimizeStatus: async (): Promise<OptimizerStatus> => {
    return restFetch<OptimizerStatus>("/api/optimize/status");
  },

  runOptimization: async (): Promise<{ requested: number } & OptimizerStatus> => {
    return restFetch<{ requested: number } & OptimizerStatus>("/api/optimize/run", { method: "POST" });
  },

  clearOptimizationCache: async (): Promise<{ removed: number }> => {
    return restFetch<{ removed: number }>("/api/optimize/clear", { method: "POST" });
  },

  // --- Direct Streaming & Media REST URLs ---

  streamUrl: (fileId: number, playPath: string, start?: number, audioIndex = 0): string => {
    const base = (
      playPath === "hls"
        ? `/api/stream/${fileId}/hls/master.m3u8`
        : playPath === "remux"
        ? `/api/stream/${fileId}/remux`
        : playPath === "transcode"
          ? `/api/stream/${fileId}/transcode`
          : `/api/stream/${fileId}`
    );
    const params = new URLSearchParams();
    if (playPath !== "hls" && start && start > 0) params.set("start", String(Math.floor(start)));
    if (audioIndex > 0 || (audioIndex === 0 && playPath !== "direct")) params.set("audio", String(audioIndex));
    const query = params.size ? `?${params.toString()}` : "";
    return `${getApiBase()}${base}${query}`;
  },

  subtitlesUrl: (fileId: number, track: string): string => {
    return `${getApiBase()}/api/subtitles/${fileId}/${track}`;
  },

  trickplayTrackUrl: (fileId: number): string => {
    return `${getApiBase()}/api/trickplay/${fileId}/track.vtt`;
  },

  imageUrl: (artworkId: number): string => {
    return `${getApiBase()}/api/images/${artworkId}`;
  },

  scanEventsUrl: (scanId: number): string => {
    return `${getApiBase()}/api/scans/${scanId}/events`;
  },

  logsStreamUrl: (): string => {
    return `${getApiBase()}/api/logs/stream`;
  },
};

// Re-export browser probe and shared types for convenience
export { probeBrowserCaps };
export const browserCaps = (video: HTMLVideoElement) => probeBrowserCaps(video);

export type {
  BrowserCaps,
  FileFacts,
  HomePayload,
  ItemCard,
  LibraryItem,
  OptimizerStatus,
  Playability,
  PlayPath,
  ReviewEntry,
  ReviewPayload,
  ServerSettings,
  ServerStatus,
  SubtitleTrack,
  TitleDetail,
  Watch,
};
