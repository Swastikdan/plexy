import { Platform } from "react-native";
import {
  MovyError,
  type MovyAccount,
  type MovyDownload,
  type MovyQualityOption,
  type MovyQuota,
  type MovyTitleRef,
} from "./types";

/// Client for the online download source (`backend.movy.sx`).
///
/// The account is used only for `/downloads/options` and `/downloads`. Vidy
/// playback never uses it.

const MOVY_API = "https://backend.movy.sx/v1";
const SUBTITLE_API = "https://subtitles.vidy.st";
const TIMEOUT_MS = 15_000;
const RETRY_DELAYS = [400, 1_200];

export interface MovyAuthReply {
  token: string;
  username: string;
}

export interface MovyDownloadOptions {
  options: (MovyQualityOption & { size: string })[];
  quota: MovyQuota;
}

function abortable(signal: AbortSignal | undefined) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  const forward = () => controller.abort();
  signal?.addEventListener("abort", forward, { once: true });
  return {
    signal: controller.signal,
    dispose() {
      clearTimeout(timer);
      signal?.removeEventListener("abort", forward);
    },
  };
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function retryAfter(response: Response): number | null {
  const header = response.headers.get("retry-after");
  if (!header) return null;
  const seconds = Number(header);
  if (Number.isFinite(seconds) && seconds > 0) return seconds;
  const date = Date.parse(header);
  return Number.isFinite(date)
    ? Math.max(1, Math.ceil((date - Date.now()) / 1_000))
    : null;
}

async function send(
  url: string,
  init: RequestInit,
  signal: AbortSignal | undefined,
  attempts: number,
): Promise<Response> {
  let lastError: unknown = null;
  for (let attempt = 0; attempt <= attempts; attempt += 1) {
    if (attempt > 0) {
      await sleep(RETRY_DELAYS[Math.min(attempt - 1, RETRY_DELAYS.length - 1)]);
    }
    const gate = abortable(signal);
    try {
      const response = await fetch(url, { ...init, signal: gate.signal });
      if (response.status >= 500 && attempt < attempts) {
        lastError = new MovyError(
          "server",
          `The source returned ${response.status}.`,
          { status: response.status },
        );
        continue;
      }
      return response;
    } catch (error) {
      if (signal?.aborted) throw new MovyError("network", "Request cancelled.");
      lastError = error;
      if (attempt >= attempts) break;
    } finally {
      gate.dispose();
    }
  }
  throw lastError instanceof MovyError
    ? lastError
    : new MovyError("network", "Could not reach the online source.");
}

async function parse<T>(response: Response): Promise<T> {
  const text = await response.text();
  let body: unknown = null;
  if (text.trim()) {
    try {
      body = JSON.parse(text);
    } catch {
      body = null;
    }
  }
  if (response.ok) return body as T;

  const message =
    (body && typeof body === "object" && "message" in body
      ? String((body as { message: unknown }).message)
      : "") || `The source returned ${response.status}.`;
  if (response.status === 429) {
    throw new MovyError("quota", message || "Download limit reached.", {
      status: 429,
      retryAfterSeconds: retryAfter(response),
    });
  }
  if (response.status === 403 || response.status === 401) {
    throw new MovyError(
      "auth",
      message || "The download account is no longer signed in.",
      { status: response.status },
    );
  }
  if (response.status === 404) {
    throw new MovyError(
      "not-found",
      message || "This title is not available.",
      { status: 404 },
    );
  }
  if (response.status === 400 || response.status === 409) {
    throw new MovyError("invalid", message, { status: response.status });
  }
  throw new MovyError("server", message, { status: response.status });
}

interface RequestOptions {
  method?: "GET" | "POST";
  body?: unknown;
  token?: string;
  deviceId?: string;
  signal?: AbortSignal;
  attempts?: number;
}

async function request<T>(
  path: string,
  options: RequestOptions = {},
): Promise<T> {
  const headers: Record<string, string> = { accept: "application/json" };
  if (options.body !== undefined) headers["content-type"] = "application/json";
  if (options.token) headers.authorization = `Bearer ${options.token}`;
  if (options.deviceId) headers["x-device-fingerprint"] = options.deviceId;

  const response = await send(
    `${MOVY_API}${path}`,
    {
      method: options.method ?? "GET",
      headers,
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
    },
    options.signal,
    options.attempts ?? 2,
  );
  return parse<T>(response);
}

export function deviceName(): string {
  return Platform.OS === "android" ? "Plexy for Android" : `Plexy for ${Platform.OS}`;
}

interface AuthReply {
  token: string;
  username: string;
}

/** Register then sign in. Movy has no email-verification step. */
export async function registerAccount(input: {
  username: string;
  password: string;
  deviceId: string;
  signal?: AbortSignal;
}): Promise<MovyAuthReply> {
  await request<{ username: string }>("/auth/register", {
    method: "POST",
    body: {
      username: input.username,
      email: `${input.username}@plexy.app`,
      password: input.password,
    },
    signal: input.signal,
    attempts: 0,
  });
  return loginAccount({
    username: input.username,
    password: input.password,
    deviceId: input.deviceId,
    signal: input.signal,
  });
}

export async function loginAccount(input: {
  username: string;
  password: string;
  deviceId: string;
  signal?: AbortSignal;
}): Promise<MovyAuthReply> {
  const reply = await request<AuthReply>("/auth/login", {
    method: "POST",
    body: {
      username: input.username.trim(),
      password: input.password,
      deviceName: deviceName(),
      deviceId: input.deviceId,
    },
    signal: input.signal,
    attempts: 1,
  }).catch((cause) => {
    if (cause instanceof MovyError && cause.code === "auth") {
      throw new MovyError("auth", "Incorrect username or password.", {
        status: 403,
      });
    }
    throw cause;
  });
  if (!reply?.token) {
    throw new MovyError("auth", "The online source did not return a session.");
  }
  return reply;
}

function titleQuery(ref: MovyTitleRef) {
  const parts: string[] = [
    `title=${encodeURIComponent(ref.title)}`,
    `mediaType=${encodeURIComponent(ref.mediaType)}`,
    `tmdbId=${encodeURIComponent(String(ref.tmdbId))}`,
  ];
  if (ref.year) parts.push(`year=${encodeURIComponent(String(ref.year))}`);
  if (ref.imdbId) parts.push(`imdbId=${encodeURIComponent(ref.imdbId)}`);
  if (ref.mediaType === "tv") {
    parts.push(`season=${encodeURIComponent(String(ref.season ?? 1))}`);
    parts.push(`episode=${encodeURIComponent(String(ref.episode ?? 1))}`);
  }
  return parts.join("&");
}

export async function fetchDownloadOptions(
  account: Pick<MovyAccount, "username" | "token" | "deviceId">,
  ref: MovyTitleRef,
  signal?: AbortSignal,
): Promise<MovyDownloadOptions> {
  const reply = await request<{
    options?: MovyDownloadOptions["options"];
    quota?: MovyQuota;
  }>(
    `/user/${encodeURIComponent(account.username)}/downloads/options?${titleQuery(ref)}`,
    {
      token: account.token,
      deviceId: account.deviceId,
      signal,
    },
  );
  return {
    options: reply.options ?? [],
    quota:
      reply.quota ?? { limit: 0, used: 0, remaining: 0, resetAt: null },
  };
}

export async function createDownload(
  account: Pick<MovyAccount, "username" | "token" | "deviceId">,
  ref: MovyTitleRef,
  quality: string,
  signal?: AbortSignal,
): Promise<MovyDownload> {
  const body: Record<string, string | number> = {
    title: ref.title,
    mediaType: ref.mediaType,
    quality,
    tmdbId: String(ref.tmdbId),
  };
  if (ref.year) body.year = ref.year;
  if (ref.imdbId) body.imdbId = ref.imdbId;
  if (ref.mediaType === "tv") {
    body.season = String(ref.season ?? 1);
    body.episode = String(ref.episode ?? 1);
  }
  const reply = await request<MovyDownload>(
    `/user/${encodeURIComponent(account.username)}/downloads`,
    {
      method: "POST",
      body,
      token: account.token,
      deviceId: account.deviceId,
      signal,
      // Never retry a metered mutation: one POST is one download credit.
      attempts: 0,
    },
  );
  if (!reply?.url) {
    throw new MovyError("no-source", "No source is available for this title.");
  }
  return reply;
}

export interface MovySubtitle {
  id: string;
  url: string;
  format: string;
  language: string;
  display: string;
  isHearingImpaired?: boolean;
  source?: string;
}

export async function searchSubtitles(
  tmdbId: number,
  season?: number | null,
  episode?: number | null,
  signal?: AbortSignal,
): Promise<MovySubtitle[]> {
  let query = `id=${encodeURIComponent(String(tmdbId))}`;
  if (season != null && episode != null) {
    query += `&season=${encodeURIComponent(String(season))}&episode=${encodeURIComponent(String(episode))}`;
  }
  const response = await send(
    `${SUBTITLE_API}/search?${query}`,
    { headers: { accept: "application/json" } },
    signal,
    1,
  );
  if (!response.ok) return [];
  const body = (await response.json().catch(() => null)) as
    | MovySubtitle[]
    | null;
  return Array.isArray(body) ? body : [];
}

export async function fetchSubtitleText(
  url: string,
  signal?: AbortSignal,
): Promise<string> {
  const response = await send(
    url,
    { headers: { accept: "text/plain" } },
    signal,
    1,
  );
  if (!response.ok) {
    throw new MovyError("server", "That subtitle could not be loaded.");
  }
  return response.text();
}
