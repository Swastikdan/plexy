/// Transport for the Plexy HTTP API.
///
/// One client, one policy: URL building, retry, deadlines, credentials and
/// error normalization live here so every screen shares the same behaviour.
/// No module imports server source; the contracts in `contracts/` describe the
/// wire shapes and route modules type their handlers against the same shapes.
import type {
  BrowserCaps,
  CrashesResponse,
  CollectionDetail,
  CollectionSummary,
  HomePayload,
  ItemCard,
  ItemsResponse,
  LibraryItem,
  LibraryType,
  LocalFoldersResponse,
  LogsResponse,
  OptimizerStatus,
  PersonDetail,
  Playability,
  PlayPath,
  PlaybackDiagnostic,
  ReviewPayload,
  SearchResponse,
  ServerStatus,
  SettingsResponse,
  SkipSegments,
  SubtitleSearchResult,
  SubtitleTrack,
  TitleDetail,
  TmdbMatchSearchResponse,
} from "./types";

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

export type ConnectionHealth = "online" | "unavailable" | "offline";

export interface PlexyClientOptions {
  /** Base URL, or a getter so a hosted build can switch servers at runtime. */
  baseUrl: string | (() => string);
  credentials?: RequestCredentials;
  fetch?: typeof fetch;
  /** Per-request deadline. Long-lived URLs bypass the transport entirely. */
  timeoutMs?: number;
  /** Called on any 401 so the connection gate can show pairing again. */
  onUnauthorized?: () => void;
  /** Called after every attempt so the UI can report reachability. */
  onHealth?: (state: ConnectionHealth) => void;
}

const READ_RETRY_DELAYS = [250, 650] as const;
const RETRYABLE_STATUSES = new Set([502, 503, 504]);

function pause(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function errorMessage(body: unknown, status: number): string {
  if (!body) return `Request failed (${status || 500})`;
  if (typeof body === "string") return body || `Request failed (${status || 500})`;
  if (typeof body === "object") {
    const value = body as { error?: unknown; message?: unknown };
    if (typeof value.error === "string") return value.error;
    if (typeof value.message === "string") return value.message;
  }
  return `Request failed (${status || 500})`;
}

interface Attempt<T> {
  ok: boolean;
  status: number;
  value: T;
  error: unknown;
  requestId?: string;
}

export interface PlexyClient {
  status: {
    serverStatus(): Promise<ServerStatus>;
  };
  catalog: {
    home(): Promise<HomePayload>;
    history(
      limit?: number,
      offset?: number,
    ): Promise<{ items: ItemCard[]; total: number }>;
    removeHistory(itemId: number): Promise<{ ok: true }>;
    clearHistory(): Promise<{ ok: true }>;
    items(query: {
      kind?: "movie" | "series";
      libraryId?: number;
      sort?: string;
      unwatched?: boolean;
      q?: string;
      genre?: string;
      yearFrom?: number;
      yearTo?: number;
      minRating?: number;
      maxRuntime?: number;
      watchlist?: boolean;
      favorite?: boolean;
      hidden?: boolean;
      minUserRating?: number;
      limit?: number;
      offset?: number;
    }): Promise<ItemsResponse>;
    title(id: number | string): Promise<TitleDetail>;
    similar(itemId: number): Promise<{ items: ItemCard[] }>;
    person(personId: number): Promise<PersonDetail>;
    search(q: string): Promise<SearchResponse>;
    setFlags(
      itemId: number,
      flags: {
        watchlist?: boolean;
        favorite?: boolean;
        hidden?: boolean;
        rating?: number | null;
      },
    ): Promise<{ ok: true }>;
    collections(itemId?: number): Promise<{ collections: CollectionSummary[] }>;
    collection(id: number): Promise<CollectionDetail>;
    createCollection(name: string): Promise<{ collection: CollectionSummary }>;
    addToCollection(id: number, itemId: number): Promise<{ ok: true }>;
    removeFromCollection(id: number, itemId: number): Promise<{ ok: true }>;
    deleteCollection(id: number): Promise<{ ok: true }>;
    libraries(): Promise<{ libraries: LibraryItem[] }>;
    createLibrary(name: string, type: LibraryType, paths: string[]): Promise<{ id: number }>;
    updateLibrary(
      id: number,
      patch: { name: string; type: LibraryType; paths: string[] },
    ): Promise<{ ok: true }>;
    deleteLibrary(id: number): Promise<{ ok: boolean }>;
    scanLibrary(id: number): Promise<{ id: number }>;
    deleteTitle(itemId: number): Promise<{ ok: boolean }>;
  };
  watch: {
    progress(
      itemId: number,
      position: number,
      duration: number | null,
      played: boolean,
    ): Promise<{ ok: boolean }>;
    markWatched(itemId: number): Promise<{ ok: boolean; played: boolean }>;
    setWatched(itemId: number, played: boolean): Promise<{ ok: boolean; played: boolean }>;
    clearWatch(itemId: number): Promise<{ ok: boolean }>;
  };
  playback: {
    play(fileId: number, caps?: BrowserCaps, audioIndex?: number): Promise<Playability>;
    /** Manifest for the desktop native player: original bytes, no preparation. */
    playNative(fileId: number): Promise<Playability>;
    skipSegments(fileId: number): Promise<{ enabled: boolean } & SkipSegments>;
    subtitles(fileId: number): Promise<{ tracks: SubtitleTrack[] }>;
    searchSubtitles(
      fileId: number,
      language?: string,
    ): Promise<{ results: SubtitleSearchResult[] }>;
    downloadSubtitle(
      fileId: number,
      result: SubtitleSearchResult,
    ): Promise<{ track: SubtitleTrack }>;
  };
  admin: {
    settings(): Promise<SettingsResponse>;
    updateSettings(patch: Record<string, unknown>): Promise<{ settings: unknown }>;
    clearTmdbCache(): Promise<{ removed: number }>;
    refreshSkipSegments(): Promise<{ checked: number; found: number }>;
    backfillCertifications(limit?: number): Promise<{ checked: number; updated: number }>;
    resetLocalData(): Promise<{ ok: true; libraries: number; files: number; titles: number }>;
    testTmdb(): Promise<{ ok: boolean; message: string }>;
    localFolders(path?: string): Promise<LocalFoldersResponse>;
    optimizeStatus(): Promise<OptimizerStatus>;
    cancelOptimization(): Promise<OptimizerStatus>;
    resumeOptimization(): Promise<OptimizerStatus>;
    runOptimization(): Promise<{ requested: number } & OptimizerStatus>;
    clearOptimizationCache(): Promise<{ removed: number }>;
  };
  matching: {
    review(params?: {
      status?: "attention" | "all" | "matched" | "review" | "unmatched";
      q?: string;
    }): Promise<ReviewPayload>;
    matchSearch(
      type: "movie" | "tv",
      query: string,
      year?: number | null,
    ): Promise<TmdbMatchSearchResponse>;
    applyMatch(itemId: number, tmdbId: number, type: "movie" | "tv"): Promise<{ ok: boolean }>;
    refreshItem(itemId: number): Promise<{ ok: boolean }>;
  };
  diagnostics: {
    playbackDiagnostics(): Promise<{ events: PlaybackDiagnostic[] }>;
    reportPlaybackDiagnostic(event: {
      kind: PlaybackDiagnostic["kind"];
      path?: Exclude<PlaybackDiagnostic["path"], null>;
      durationMs?: number;
      mediaErrorCode?: number;
    }): Promise<void>;
    logs(filter?: { level?: string; component?: string; search?: string }): Promise<LogsResponse>;
    crashes(): Promise<CrashesResponse>;
  };
  urls: {
    streamUrl(fileId: number, playPath: PlayPath | string, start?: number, audioIndex?: number): string;
    subtitlesUrl(fileId: number, track: string): string;
    downloadUrl(fileId: number, audioIndex?: number): string;
    trickplayTrackUrl(fileId: number): string;
    imageUrl(artworkId: number): string;
    scanEventsUrl(scanId: number): string;
    logsStreamUrl(): string;
  };
}

/** Build the one client the browser contexts share. */
export function createPlexyClient(options: PlexyClientOptions): PlexyClient {
  const doFetch = options.fetch ?? ((...args) => fetch(...args));
  const timeoutMs = options.timeoutMs ?? 12_000;
  const credentials = options.credentials ?? "include";

  const base = (): string => {
    const value = typeof options.baseUrl === "function" ? options.baseUrl() : options.baseUrl;
    return value.replace(/\/+$/, "");
  };

  const absolute = (path: string): string =>
    path.startsWith("http") ? path : `${base()}${path.startsWith("/") ? "" : "/"}${path}`;

  async function attempt<T>(
    path: string,
    init: RequestInit = {},
    canRetry: boolean,
  ): Promise<T> {
    const method = (init.method ?? "GET").toUpperCase();
    const retries = canRetry && (method === "GET" || method === "HEAD") ? READ_RETRY_DELAYS.length : 0;

    for (let index = 0; index <= retries; index++) {
      let result: Attempt<T>;
      try {
        const response = await doFetch(absolute(path), {
          credentials,
          ...init,
          signal: init.signal
            ? AbortSignal.any([init.signal, AbortSignal.timeout(timeoutMs)])
            : AbortSignal.timeout(timeoutMs),
        });
        const text = await response.text();
        let body: unknown = null;
        try {
          body = text ? JSON.parse(text) : null;
        } catch {
          body = text;
        }
        result = {
          ok: response.ok,
          status: response.status,
          value: body as T,
          error: body,
          requestId: response.headers.get("x-request-id") ?? undefined,
        };
      } catch (error) {
        if (index < retries) {
          await pause(READ_RETRY_DELAYS[index]!);
          continue;
        }
        options.onHealth?.("offline");
        throw new ApiError(
          503,
          error instanceof Error && error.name === "TimeoutError"
            ? `The Plexy server at ${base()} did not answer in time.`
            : `Cannot reach the Plexy server at ${base()}.`,
        );
      }

      if (result.status === 401) options.onUnauthorized?.();
      options.onHealth?.(result.status >= 500 ? "unavailable" : "online");
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
    }
    options.onHealth?.("offline");
    throw new ApiError(503, `Cannot reach the Plexy server at ${base()}.`);
  }

  const get = <T>(path: string) => attempt<T>(path, { method: "GET" }, true);
  const send = <T>(path: string, method: string, body?: unknown) =>
    attempt<T>(
      path,
      {
        method,
        ...(body === undefined
          ? {}
          : { headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }),
      },
      false,
    );

  const query = (params: Record<string, string | number | boolean | undefined>): string => {
    const search = new URLSearchParams();
    for (const [key, value] of Object.entries(params)) {
      if (value === undefined) continue;
      search.set(key, String(value));
    }
    return search.size ? `?${search.toString()}` : "";
  };

  const catalog: PlexyClient["catalog"] = {
    home: () => get<HomePayload>("/api/home"),
    history: (limit = 60, offset = 0) =>
      get<{ items: ItemCard[]; total: number }>(
        `/api/history${query({ limit, offset })}`,
      ),
    removeHistory: (itemId) =>
      send<{ ok: true }>(`/api/history/${itemId}`, "DELETE"),
    clearHistory: () => send<{ ok: true }>("/api/history", "DELETE"),
    items: (params) =>
      get<ItemsResponse>(
        `/api/items${query({
          kind: params.kind,
          libraryId: params.libraryId,
          sort: params.sort,
          unwatched: params.unwatched ? true : undefined,
          q: params.q,
          genre: params.genre,
          yearFrom: params.yearFrom,
          yearTo: params.yearTo,
          minRating: params.minRating,
          maxRuntime: params.maxRuntime,
          watchlist: params.watchlist ? true : undefined,
          favorite: params.favorite ? true : undefined,
          hidden: params.hidden ? true : undefined,
          minUserRating: params.minUserRating,
          limit: params.limit ?? 60,
          offset: params.offset ?? 0,
        })}`,
      ),
    title: (id) => get<TitleDetail>(`/api/items/${encodeURIComponent(String(id))}`),
    similar: (itemId) => get<{ items: ItemCard[] }>(`/api/items/${itemId}/similar`),
    person: (personId) => get<PersonDetail>(`/api/people/${personId}`),
    search: async (text) => {
      const result = await get<{
        titles?: ItemCard[];
        episodes?: ItemCard[];
        people?: SearchResponse["people"];
        total?: number;
        items?: ItemCard[];
      }>(`/api/search${query({ q: text })}`);
      return {
        titles: result.titles ?? result.items?.filter((item) => item.kind !== "episode") ?? [],
        episodes: result.episodes ?? result.items?.filter((item) => item.kind === "episode") ?? [],
        people: result.people ?? [],
        total: result.total ?? (result.titles?.length ?? 0) + (result.episodes?.length ?? 0),
        query: text,
      };
    },
    setFlags: (itemId, flags) =>
      send<{ ok: true }>(`/api/items/${itemId}/flags`, "PUT", flags),
    collections: (itemId) =>
      get<{ collections: CollectionSummary[] }>(
        `/api/collections${query({ itemId })}`,
      ),
    collection: (id) => get<CollectionDetail>(`/api/collections/${id}`),
    createCollection: (name) =>
      send<{ collection: CollectionSummary }>("/api/collections", "POST", { name }),
    addToCollection: (id, itemId) =>
      send<{ ok: true }>(`/api/collections/${id}/items`, "POST", { itemId }),
    removeFromCollection: (id, itemId) =>
      send<{ ok: true }>(`/api/collections/${id}/items/${itemId}`, "DELETE"),
    deleteCollection: (id) =>
      send<{ ok: true }>(`/api/collections/${id}`, "DELETE"),
    libraries: () => get<{ libraries: LibraryItem[] }>("/api/libraries"),
    createLibrary: (name, type, paths) =>
      send<{ id: number }>("/api/libraries", "POST", { name, type, paths }),
    updateLibrary: (id, patch) =>
      send<{ ok: true }>(`/api/libraries/${id}`, "PATCH", patch),
    deleteLibrary: (id) => send<{ ok: boolean }>(`/api/libraries/${id}`, "DELETE"),
    scanLibrary: (id) => send<{ id: number }>(`/api/libraries/${id}/scan`, "POST"),
    deleteTitle: (itemId) => send<{ ok: boolean }>(`/api/items/${itemId}`, "DELETE"),
  };

  const watch: PlexyClient["watch"] = {
    progress: (itemId, position, duration, played) =>
      send<{ ok: boolean }>("/api/progress", "POST", {
        itemId,
        position,
        duration: duration ?? undefined,
        played,
      }),
    markWatched: (itemId) => watch.setWatched(itemId, true),
    setWatched: (itemId, played) =>
      send<{ ok: boolean; played: boolean }>(`/api/watch/${itemId}/played`, "POST", { played }),
    clearWatch: (itemId) => send<{ ok: boolean }>(`/api/watch/${itemId}`, "DELETE"),
  };

  const playback: PlexyClient["playback"] = {
    play: (fileId, caps, audioIndex = -1) =>
      get<Playability>(
        `/api/play/${fileId}${query({
          caps: caps ? JSON.stringify(caps) : undefined,
          audio: audioIndex >= 0 ? audioIndex : undefined,
        })}`,
      ),
    playNative: (fileId) => get<Playability>(`/api/play/${fileId}?native=1`),
    skipSegments: (fileId) =>
      get<{ enabled: boolean } & SkipSegments>(`/api/skip-segments/${fileId}`),
    subtitles: (fileId) =>
      get<{ tracks: SubtitleTrack[] }>(`/api/subtitles/${fileId}`),
    searchSubtitles: (fileId, language) =>
      get<{ results: SubtitleSearchResult[] }>(
        `/api/subtitles/${fileId}/search${query({ language })}`,
      ),
    downloadSubtitle: (fileId, result) =>
      send<{ track: SubtitleTrack }>(
        `/api/subtitles/${fileId}/download`,
        "POST",
        {
          url: result.url,
          language: result.language,
          name: result.name,
        },
      ),
  };

  const admin: PlexyClient["admin"] = {
    settings: () => get<SettingsResponse>("/api/settings"),
    updateSettings: (patch) => send<{ settings: unknown }>("/api/settings", "PUT", patch),
    clearTmdbCache: () => send<{ removed: number }>("/api/tmdb/cache/clear", "POST"),
    refreshSkipSegments: () =>
      send<{ checked: number; found: number }>("/api/skip-segments/refresh", "POST"),
    backfillCertifications: (limit = 100) =>
      send<{ checked: number; updated: number }>(
        "/api/metadata/certifications/backfill",
        "POST",
        { limit },
      ),
    resetLocalData: () =>
      send<{ ok: true; libraries: number; files: number; titles: number }>(
        "/api/database/reset",
        "POST",
      ),
    testTmdb: () => send<{ ok: boolean; message: string }>("/api/settings/tmdb/test", "POST"),
    localFolders: (path) => get<LocalFoldersResponse>(`/api/local-folders${query({ path })}`),
    optimizeStatus: () => get<OptimizerStatus>("/api/optimize/status"),
    cancelOptimization: () => send<OptimizerStatus>("/api/optimize/cancel", "POST"),
    resumeOptimization: () => send<OptimizerStatus>("/api/optimize/resume", "POST"),
    runOptimization: () =>
      send<{ requested: number } & OptimizerStatus>("/api/optimize/run", "POST"),
    clearOptimizationCache: () => send<{ removed: number }>("/api/optimize/clear", "POST"),
  };

  const matching: PlexyClient["matching"] = {
    review: (params) =>
      get<ReviewPayload>(
        `/api/matches/review${query({
          status: params?.status && params.status !== "attention" ? params.status : undefined,
          q: params?.q?.trim() || undefined,
        })}`,
      ),
    matchSearch: (type, text, year) =>
      send<TmdbMatchSearchResponse>("/api/match/search", "POST", {
        type,
        query: text,
        year: year ?? undefined,
      }),
    applyMatch: (itemId, tmdbId, type) =>
      send<{ ok: boolean }>(`/api/items/${itemId}/match`, "POST", { tmdbId, type }),
    refreshItem: (itemId) => send<{ ok: boolean }>(`/api/items/${itemId}/refresh`, "POST"),
  };

  const diagnostics: PlexyClient["diagnostics"] = {
    playbackDiagnostics: () =>
      get<{ events: PlaybackDiagnostic[] }>("/api/diagnostics/playback"),
    reportPlaybackDiagnostic: async (event) => {
      await send<{ ok: true }>("/api/diagnostics/playback", "POST", event);
    },
    logs: (filter) =>
      get<LogsResponse>(
        `/api/logs${query({
          level: filter?.level,
          component: filter?.component,
          search: filter?.search,
        })}`,
      ),
    crashes: () => get<CrashesResponse>("/api/crashes"),
  };

  const urls: PlexyClient["urls"] = {
    streamUrl: (fileId, playPath, start, audioIndex = 0) => {
      // Prepared copies are always plain fast-start MP4s. `playPath` is kept in
      // the signature for older callers; a non-zero audio index asks the server
      // for that language's prepared copy.
      void playPath;
      return `${base()}/api/stream/${fileId}${query({
        start: start && start > 0 ? Math.floor(start) : undefined,
        audio: audioIndex > 0 ? audioIndex : undefined,
      })}`;
    },
    subtitlesUrl: (fileId, track) => `${base()}/api/subtitles/${fileId}/${track}`,
    downloadUrl: (fileId, audioIndex = 0) =>
      `${base()}/api/download/${fileId}${query({ audio: audioIndex > 0 ? audioIndex : undefined })}`,
    trickplayTrackUrl: (fileId) => `${base()}/api/trickplay/${fileId}/track.vtt`,
    imageUrl: (artworkId) => `${base()}/api/images/${artworkId}`,
    scanEventsUrl: (scanId) => `${base()}/api/scans/${scanId}/events`,
    logsStreamUrl: () => `${base()}/api/logs/stream`,
  };

  return {
    status: { serverStatus: () => get<ServerStatus>("/api/server/status") },
    catalog,
    watch,
    playback,
    admin,
    matching,
    diagnostics,
    urls,
  };
}
