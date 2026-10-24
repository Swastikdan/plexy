/// Typed RPC and REST client for Plexy web app (PRD 9, 10).
///
/// Uses @elysiajs/eden Treaty to connect to the Elysia backend API over typed RPC,
/// while maintaining standard individual HTTP endpoints for direct access, video streaming,
/// WebVTT subtitles, images, and SSE feeds.
import { treaty } from "@elysiajs/eden";
import type { App } from "../../server/src/app";
import {
  type BrowserCaps,
  type FileFacts,
  type HomePayload,
  type ItemCard,
  type LibraryItem,
  type OptimizerStatus,
  type Playability,
  type PlayPath,
  type ReviewEntry,
  type ReviewPayload,
  type ServerSettings,
  type ServerStatus,
  type SubtitleTrack,
  type TitleDetail,
  type Watch,
  probeBrowserCaps,
} from "@plexy/api-client";

export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

// Configurable base URL:
// In development: Vite proxies /api/ to backend, so window.location.origin works seamlessly.
// In web-hosted mode: VITE_API_URL specifies the remote Plexy backend.
export const API_BASE = (
  typeof import.meta !== "undefined" && import.meta.env?.VITE_API_URL
    ? String(import.meta.env.VITE_API_URL).replace(/\/+$/, "")
    : typeof window !== "undefined"
      ? window.location.origin
      : "http://localhost:8765"
);

// Low-level Eden Treaty client
export const rpc = treaty<App>(API_BASE);

// Unwrap Eden responses into data or throw ApiError
async function unwrap<T>(promise: Promise<{ data: unknown; error: unknown; status: number }>): Promise<T> {
  try {
    const res = await promise;
    if (res.error || res.data === null || res.data === undefined) {
      let msg = `Request failed (${res.status || 500})`;
      if (res.error) {
        const anyErr = res.error as any;
        if (anyErr?.value?.error) {
          msg = anyErr.value.error;
        } else if (anyErr?.message && typeof anyErr.message === "string") {
          msg = anyErr.message;
        } else if (typeof anyErr?.value === "string") {
          msg = anyErr.value;
        }
      }
      throw new ApiError(res.status || 500, msg);
    }
    return res.data as T;
  } catch (err) {
    if (err instanceof ApiError) throw err;
    throw new ApiError(503, "Cannot reach Plexy server. Make sure the server is running on port 8765.");
  }
}

// Direct fetch for plain REST endpoints with safe JSON parsing
async function restFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const url = path.startsWith("http") ? path : `${API_BASE}${path.startsWith("/") ? "" : "/"}${path}`;
  try {
    const res = await fetch(url, init);
    const text = await res.text();
    let body: unknown = null;
    try {
      body = text ? JSON.parse(text) : null;
    } catch {
      body = text;
    }
    if (!res.ok) {
      const msg = (body as { error?: string } | null)?.error ?? `Request failed (${res.status})`;
      throw new ApiError(res.status, msg);
    }
    return body as T;
  } catch (err) {
    if (err instanceof ApiError) throw err;
    throw new ApiError(503, "Cannot reach Plexy server. Make sure the server is running on port 8765.");
  }
}

export const api = {
  // --- Viewer endpoints (RPC) ---

  serverStatus: async (): Promise<ServerStatus> => {
    return restFetch<ServerStatus>("/api/server/status");
  },

  home: async (): Promise<HomePayload> => {
    return unwrap<HomePayload>(rpc.api.home.get());
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
    return unwrap<{ items: ItemCard[] }>(
      rpc.api.items.get({
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

  title: async (id: number): Promise<TitleDetail> => {
    return unwrap<TitleDetail>(rpc.api.items({ id: String(id) }).get());
  },

  search: async (q: string): Promise<{ items: ItemCard[] }> => {
    return unwrap<{ items: ItemCard[] }>(rpc.api.search.get({ query: { q } }));
  },

  playability: async (fileId: number, caps: BrowserCaps): Promise<Playability> => {
    const query = { caps: JSON.stringify(caps) };
    return unwrap<Playability>(rpc.api.playability({ fileId: String(fileId) }).get({ query }));
  },

  /**
   * Everything the player needs in one request: play path, title, resume point,
   * next episode, subtitle tracks and preparation state. Uses REST rather than
   * Eden so the response shape is not coupled to route type inference.
   */
  play: async (fileId: number, caps?: BrowserCaps): Promise<Playability> => {
    const query = caps ? `?caps=${encodeURIComponent(JSON.stringify(caps))}` : "";
    return restFetch<Playability>(`/api/play/${fileId}${query}`);
  },

  subtitles: async (fileId: number): Promise<{ tracks: SubtitleTrack[] }> => {
    return unwrap<{ tracks: SubtitleTrack[] }>(rpc.api.subtitles({ fileId: String(fileId) }).get());
  },

  progress: async (
    itemId: number,
    position: number,
    duration: number | null,
    played: boolean,
  ): Promise<{ ok: boolean }> => {
    return unwrap<{ ok: boolean }>(
      rpc.api.progress.post({
        itemId,
        position,
        duration: duration ?? undefined,
        played,
      }),
    );
  },

  markWatched: async (itemId: number, watched: boolean): Promise<{ ok: boolean }> => {
    return unwrap<{ ok: boolean }>(
      rpc.api.progress.post({
        itemId,
        position: 0,
        duration: undefined,
        played: watched,
      }),
    );
  },

  // --- Admin endpoints (Loopback-only, RPC / REST) ---

  libraries: async (): Promise<{ libraries: LibraryItem[] }> => {
    return restFetch<{ libraries: LibraryItem[] }>("/api/libraries");
  },

  createLibrary: async (name: string, type: "movies" | "tv", paths: string[]): Promise<{ id: number }> => {
    return restFetch<{ id: number }>("/api/libraries", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, type, paths }),
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

  streamUrl: (fileId: number, playPath: string, start?: number): string => {
    const base = (
      playPath === "remux"
        ? `/api/stream/${fileId}/remux`
        : playPath === "transcode"
          ? `/api/stream/${fileId}/transcode`
          : `/api/stream/${fileId}`
    );
    const query = start && start > 0 ? `?start=${Math.floor(start)}` : "";
    return `${API_BASE}${base}${query}`;
  },

  subtitlesUrl: (fileId: number, track: string): string => {
    return `${API_BASE}/api/subtitles/${fileId}/${track}`;
  },

  imageUrl: (artworkId: number): string => {
    return `${API_BASE}/api/images/${artworkId}`;
  },

  scanEventsUrl: (scanId: number): string => {
    return `${API_BASE}/api/scans/${scanId}/events`;
  },

  logsStreamUrl: (): string => {
    return `${API_BASE}/api/logs/stream`;
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
