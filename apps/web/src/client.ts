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
  type CrashesResponse,
  type FileFacts,
  type HomePayload,
  type ItemCard,
  type LibraryItem,
  type LibraryType,
  type LocalFoldersResponse,
  type LogsResponse,
  type OptimizerStatus,
  type Playability,
  type PlayPath,
  type PlaybackDiagnostic,
  type ReviewEntry,
  type ReviewPayload,
  type ServerSettings,
  type ServerStatus,
  type SettingsResponse,
  type StreamPreparationStatus,
  type SubtitleTrack,
  type SkipSegments,
  type TitleDetail,
  type TmdbMatchSearchResponse,
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
  if (typeof error === "string") return error;
  const value = error as {
    error?: unknown;
    value?: { error?: unknown } | string;
    message?: unknown;
  };
  if (typeof value.value === "object" && typeof value.value?.error === "string") return value.value.error;
  if (typeof value.error === "string") return value.error;
  if (typeof value.message === "string") return value.message;
  if (typeof value.value === "string") return value.value;
  return `Request failed (${status || 500})`;
}

/** Result of one network attempt, in the shape Eden and fetch both reduce to. */
interface Attempt<T> {
  ok: boolean;
  status: number;
  value: T;
  error: unknown;
  requestId?: string;
}

/**
 * Retry policy, health reporting and error conversion for every API call.
 * Read-only calls retry transient gateway failures; writes never do.
 */
async function runWithRetry<T>(
  attempt: () => Promise<Attempt<T>>,
  canRetry: boolean,
): Promise<T> {
  const retries = canRetry ? READ_RETRY_DELAYS.length : 0;
  for (let index = 0; index <= retries; index++) {
    try {
      const result = await attempt();
      if (result.status === 401) notifyUnauthorized();
      reportConnectionHealth(result.status >= 500 ? "unavailable" : "online");
      if (result.ok) return result.value;
      if (RETRYABLE_STATUSES.has(result.status) && index < retries) {
        await pause(READ_RETRY_DELAYS[index]!);
        continue;
      }
      throw new ApiError(
        result.status || 500,
        errorMessage(result.error, result.status),
        result.requestId,
      );
    } catch (error) {
      if (error instanceof ApiError) throw error;
      if (index < retries) {
        await pause(READ_RETRY_DELAYS[index]!);
        continue;
      }
    }
  }
  reportConnectionHealth("offline");
  throw new ApiError(503, `Cannot reach the Plexy server at ${getApiBase()}.`);
}

async function unwrap<T>(
  request: () => Promise<{ data: unknown; error: unknown; status: number }>,
  retryRead = true,
): Promise<T> {
  return runWithRetry<T>(async () => {
    const res = await request();
    const failed = Boolean(res.error) || res.data === null || res.data === undefined;
    return {
      ok: !failed,
      status: res.status,
      value: res.data as T,
      error: res.error,
    };
  }, retryRead);
}

/** Direct fetch for plain REST endpoints with safe JSON parsing. */
async function restFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const base = getApiBase();
  const url = path.startsWith("http") ? path : `${base}${path.startsWith("/") ? "" : "/"}${path}`;
  const method = (init?.method ?? "GET").toUpperCase();
  const canRetry = method === "GET" || method === "HEAD";
  return runWithRetry<T>(async () => {
    const res = await fetch(url, {
      credentials: "include",
      ...init,
      signal: init?.signal
        ? AbortSignal.any([init.signal, AbortSignal.timeout(12_000)])
        : AbortSignal.timeout(12_000),
    });
    const text = await res.text();
    let body: unknown = null;
    try {
      body = text ? JSON.parse(text) : null;
    } catch {
      body = text;
    }
    return {
      ok: res.ok,
      status: res.status,
      value: body as T,
      error: body,
      requestId: res.headers.get("x-request-id") ?? undefined,
    };
  }, canRetry);
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
    return api.setWatched(itemId, true);
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

  createLibrary: async (name: string, type: LibraryType, paths: string[]): Promise<{ id: number }> => {
    return restFetch<{ id: number }>("/api/libraries", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, type, paths }),
    });
  },

  updateLibrary: async (
    id: number,
    patch: { name: string; type: LibraryType; paths: string[] },
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

  settings: async (): Promise<SettingsResponse> => {
    return restFetch<SettingsResponse>("/api/settings");
  },

  updateSettings: async (patch: Record<string, unknown>): Promise<{ settings: unknown }> => {
    return restFetch<{ settings: unknown }>("/api/settings", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(patch),
    });
  },

  streamPreparationStatus: async (): Promise<StreamPreparationStatus> =>
    restFetch<StreamPreparationStatus>("/api/stream-preparation/status"),

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

  refreshSkipSegments: async (): Promise<{ checked: number; found: number }> => {
    return restFetch<{ checked: number; found: number }>("/api/skip-segments/refresh", { method: "POST" });
  },

  resetLocalData: async (): Promise<{ ok: true; libraries: number; files: number; titles: number }> => {
    return restFetch<{ ok: true; libraries: number; files: number; titles: number }>("/api/database/reset", { method: "POST" });
  },

  testTmdb: async (): Promise<{ ok: boolean; message: string }> => {
    return restFetch<{ ok: boolean; message: string }>("/api/settings/tmdb/test", {
      method: "POST",
    });
  },

  localFolders: async (path?: string): Promise<LocalFoldersResponse> => {
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
  ): Promise<TmdbMatchSearchResponse> => {
    return restFetch<TmdbMatchSearchResponse>("/api/match/search", {
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

  logs: async (filter?: { level?: string; component?: string; search?: string }): Promise<LogsResponse> => {
    const p = new URLSearchParams();
    if (filter?.level) p.set("level", filter.level);
    if (filter?.component) p.set("component", filter.component);
    if (filter?.search) p.set("search", filter.search);
    return restFetch<LogsResponse>(`/api/logs${p.size ? `?${p}` : ""}`);
  },

  crashes: async (): Promise<CrashesResponse> => {
    return restFetch<CrashesResponse>("/api/crashes");
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

  streamUrl: (fileId: number, playPath: string, start?: number, audioIndex = 0, maxHeight?: number): string => {
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
    if (playPath === "transcode" && maxHeight) params.set("maxHeight", String(maxHeight));
    const query = params.size ? `?${params.toString()}` : "";
    return `${getApiBase()}${base}${query}`;
  },

  subtitlesUrl: (fileId: number, track: string): string => {
    return `${getApiBase()}/api/subtitles/${fileId}/${track}`;
  },

  downloadUrl: (fileId: number, maxHeight?: number, audioIndex = 0): string => {
    const params = new URLSearchParams();
    if (maxHeight) params.set("maxHeight", String(maxHeight));
    if (audioIndex > 0) params.set("audio", String(audioIndex));
    const query = params.size ? `?${params.toString()}` : "";
    return `${getApiBase()}/api/download/${fileId}${query}`;
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
