import type {
  HomePayload,
  ItemCard,
  Playability,
  ServerStatus,
  SkipSegments,
  TitleDetail,
} from "../../api-client/src/types";
export type {
  HomePayload,
  ItemCard,
  Playability,
  ServerStatus,
  SkipSegments,
  TitleDetail,
} from "../../api-client/src/types";

export interface Profile {
  id: string;
  serverId: string;
  url: string;
  name: string;
  userId: number;
  username: string;
}
export interface Session {
  profile: Profile;
  token: string;
}
export interface AuthResult {
  token: string;
  serverId: string;
  user: { id: number; username: string };
  device: { id: number };
}
export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
    public retryAfter?: number,
  ) {
    super(message);
  }
}
export function normalizeServerUrl(value: string) {
  const url = new URL(value.trim());
  if (
    !["http:", "https:"].includes(url.protocol) ||
    url.username ||
    url.password ||
    url.search ||
    url.hash
  )
    throw new Error(
      "Enter an HTTP or HTTPS server address without credentials or query parameters.",
    );
  if (url.pathname !== "/" && url.pathname !== "")
    throw new Error("Use the server address without a path.");
  return url.origin;
}

export interface CatalogCache {
  get<T>(path: string): Promise<T | null>;
  put(path: string, value: unknown): Promise<void>;
}
export interface DetailCache {
  get(scope: string, id: string | number): Promise<TitleDetail | null>;
  set(scope: string, id: string | number, value: TitleDetail): Promise<void>;
}
export class PlexyApi {
  readonly base: string;
  constructor(
    url: string,
    private token?: string,
    private options?: {
      cache?: CatalogCache;
      detailCache?: DetailCache;
      onCacheUsed?: () => void;
      onFreshCatalog?: () => void;
      onOffline?: () => void;
      onOnline?: () => void;
      scope?: string;
    },
  ) {
    this.base = normalizeServerUrl(url);
  }
  headers(): Record<string, string> {
    return this.token ? { Authorization: `Bearer ${this.token}` } : {};
  }
  url(path: string) {
    const url = new URL(path, this.base);
    if (url.origin !== this.base || url.username || url.password)
      throw new Error(
        "The server returned a media address outside this server.",
      );
    return url.toString();
  }
  // Source objects are cached by path so React never sees a changed identity
  // for the same image. On the new architecture Android clears the native
  // image view whenever the source object identity changes, even for an
  // identical URI, which leaves blank posters until the card is re-rendered
  // by a focus event.
  private imageCache = new Map<string, { uri: string; headers?: Record<string, string> }>();

  image(path: string | null) {
    if (!path) return undefined;
    const cached = this.imageCache.get(path);
    if (cached) return cached;
    let source: { uri: string; headers?: Record<string, string> } | undefined;
    if (path.startsWith("file://")) {
      source = { uri: path };
    } else {
      const url = new URL(path, this.base);
      if (!(url.username || url.password)) {
        if (url.origin === this.base)
          source = { uri: url.toString(), headers: this.headers() };
        else if (url.protocol === "https:")
          source = { uri: url.toString() };
      }
    }
    if (source) this.imageCache.set(path, source);
    return source;
  }
  private cacheable(path: string, init: RequestInit) {
    return (
      (!init.method || init.method === "GET") &&
      /^\/api\/(home|items|search)(?:[/?]|$)/.test(path)
    );
  }
  async request<T>(path: string, init: RequestInit = {}): Promise<T> {
    const controller = new AbortController();
    const abort = () => controller.abort();
    init.signal?.addEventListener("abort", abort, { once: true });
    if (init.signal?.aborted) controller.abort();
    const timeout = setTimeout(abort, 20000);
    try {
      const response = await fetch(this.url(path), {
        ...init,
        signal: controller.signal,
        headers: {
          ...this.headers(),
          ...(init.body ? { "Content-Type": "application/json" } : {}),
          ...init.headers,
        },
      });
      if (!response.ok) {
        const data = (await response.json().catch(() => ({}))) as {
          error?: string;
        };
        throw new ApiError(
          response.status,
          response.status === 401 &&
            !/^\/api\/auth\/(?:login|pair|pairing-code|password)(?:[/?]|$)/.test(
              path,
            )
            ? "Your session has expired. Reconnect to this server."
            : data.error ||
                (response.status === 401
                  ? "The username, password or pairing code was not accepted."
                  : `The server returned ${response.status}.`),
          Number(response.headers.get("Retry-After")) || undefined,
        );
      }
      const value = (await response.json()) as T;
      this.options?.onOnline?.();
      if (this.cacheable(path, init)) {
        void this.options?.cache?.put(path, value).catch(() => {});
        this.options?.onFreshCatalog?.();
      }
      return value;
    } catch (error) {
      if (!(error instanceof ApiError)) {
        this.options?.onOffline?.();
      }
      if (
        !(error instanceof ApiError) &&
        !init.signal?.aborted &&
        this.cacheable(path, init)
      ) {
        const cached = await this.options?.cache
          ?.get<T>(path)
          .catch(() => null);
        if (cached != null) {
          this.options?.onCacheUsed?.();
          return cached;
        }
      }
      throw error;
    } finally {
      clearTimeout(timeout);
      init.signal?.removeEventListener("abort", abort);
    }
  }
  async text(path: string, signal?: AbortSignal) {
    const controller = new AbortController();
    const abort = () => controller.abort();
    signal?.addEventListener("abort", abort, { once: true });
    if (signal?.aborted) abort();
    const timeout = setTimeout(abort, 20000);
    try {
      const response = await fetch(this.url(path), {
        headers: this.headers(),
        signal: controller.signal,
      });
      if (!response.ok)
        throw new ApiError(
          response.status,
          "Could not load subtitles or seek previews.",
        );
      return await response.text();
    } finally {
      clearTimeout(timeout);
      signal?.removeEventListener("abort", abort);
    }
  }
  status(timeoutMs = 3500) {
    const controller = new AbortController();
    const t = setTimeout(() => controller.abort(), timeoutMs);
    return this.request<ServerStatus>("/api/server/status", {
      signal: controller.signal,
    }).finally(() => clearTimeout(t));
  }
  pair(code: string, name: string) {
    return this.request<AuthResult>("/api/auth/pair", {
      method: "POST",
      body: JSON.stringify({ code: code.trim(), name }),
    });
  }
  login(username: string, password: string, name: string) {
    return this.request<AuthResult>("/api/auth/login", {
      method: "POST",
      body: JSON.stringify({ username: username.trim(), password, name }),
    });
  }
  me() {
    return this.request<{ user: { username: string } }>("/api/auth/me");
  }
  logout() {
    return this.request("/api/auth/logout", { method: "POST" });
  }
  home(signal?: AbortSignal) {
    return this.request<HomePayload>("/api/home", { signal });
  }
  items(
    kind: "movie" | "series" | "anime",
    offset = 0,
    sort = "name",
    signal?: AbortSignal,
    unwatched = false,
  ) {
    return this.request<{ items: ItemCard[] }>(
      `/api/items?kind=${kind}&offset=${offset}&limit=60&sort=${encodeURIComponent(sort)}&unwatched=${unwatched}`,
      { signal },
    );
  }
  deleteItem(id: string | number) {
    return this.request<{ ok: boolean }>(`/api/items/${encodeURIComponent(id)}`, {
      method: "DELETE",
    });
  }
  search(q: string, signal?: AbortSignal) {
    return this.request<{ titles: ItemCard[]; episodes: ItemCard[] }>(
      `/api/search?q=${encodeURIComponent(q)}`,
      { signal },
    );
  }
  async detail(id: string | number, signal?: AbortSignal) {
    const path = `/api/items/${encodeURIComponent(id)}`;
    try {
      const result = await this.request<TitleDetail>(path, { signal });
      if (this.options?.scope && this.options.detailCache) {
        void this.options.detailCache.set(this.options.scope, id, result).catch(() => {});
      }
      return result;
    } catch (error) {
      if (
        this.options?.scope &&
        this.options.detailCache &&
        !(error instanceof ApiError && error.status === 401)
      ) {
        const cached = await this.options.detailCache
          .get(this.options.scope, id)
          .catch(() => null);
        if (cached) {
          this.options?.onCacheUsed?.();
          return cached;
        }
      }
      throw error;
    }
  }
  play(fileId: number, audio?: number) {
    // Conservative baseline; users can retry server conversion if device decoding fails.
    const query = new URLSearchParams({
      caps: JSON.stringify({
        videoCodecs: ["h264", "vp8", "vp9"],
        audioCodecs: ["aac", "mp3", "opus", "flac"],
      }),
    });
    if (audio != null) query.set("audio", String(audio));
    return this.request<Playability>(`/api/play/${fileId}?${query}`);
  }
  skips(fileId: number) {
    return this.request<SkipSegments>(`/api/skip-segments/${fileId}`);
  }
  progress(
    itemId: number,
    position: number,
    duration?: number,
    played = false,
  ) {
    return this.request("/api/progress", {
      method: "POST",
      body: JSON.stringify({ itemId, position, duration, played }),
    });
  }
  watched(itemId: number, played: boolean) {
    return this.request(`/api/watch/${itemId}/played`, {
      method: "POST",
      body: JSON.stringify({ played }),
    });
  }
  clearWatch(itemId: number) {
    return this.request(`/api/watch/${itemId}`, { method: "DELETE" });
  }
  stream(
    fileId: number,
    path: string,
    start = 0,
    audio = 0,
    maxHeight?: number,
  ) {
    const suffix =
      path === "hls"
        ? "/hls/master.m3u8"
        : path === "remux"
          ? "/remux"
          : path === "transcode"
            ? "/transcode"
            : "";
    const query = new URLSearchParams();
    if (path === "remux" || path === "transcode")
      query.set("start", String(Math.max(0, Math.floor(start))));
    if (path !== "direct" || audio > 0) query.set("audio", String(audio));
    if (path === "transcode" && maxHeight)
      query.set("maxHeight", String(maxHeight));
    return this.url(
      `/api/stream/${fileId}${suffix}${query.size ? "?" + query : ""}`,
    );
  }
  download(fileId: number, maxHeight?: number, audio?: number) {
    const query = new URLSearchParams();
    if (maxHeight) query.set("maxHeight", String(maxHeight));
    if (audio != null) query.set("audio", String(audio));
    return this.url(`/api/download/${fileId}${query.size ? "?" + query : ""}`);
  }
}
