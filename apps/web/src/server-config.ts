/// Resolves the Plexy API server for every client shape.
///
/// - Local/desktop builds talk to the server that served the page (same origin).
/// - A hosted web build has no backend of its own, so the viewer picks a server
///   address once and it is persisted on the device.
/// - `VITE_API_URL` can still seed a default address at build time.
///
/// The chosen address is stored in localStorage and, inside Electron, also in
/// the app's userData directory so it survives the dynamic local server port
/// changing between launches.
import type { ServerStatus } from "@plexy/api-client";

const STORAGE_KEY = "plexy.api-base";
const CANDIDATES_KEY = "plexy.api-candidates";
const PROBE_TIMEOUT_MS = 7_000;

/** One remembered server address for the same Plexy installation. */
export interface ServerCandidate {
  url: string;
  label: string;
  kind: "lan" | "remote" | "manual";
  /** Stable server identity from `/api/server/status`, when known. */
  serverId?: string;
  lastUsedAt?: string;
}

function envApiBase(): string {
  try {
    return typeof import.meta !== "undefined"
      ? String(import.meta.env?.VITE_API_URL ?? "").trim()
      : "";
  } catch {
    return "";
  }
}

const ENV_API_BASE = normalizeServerUrl(envApiBase());

/** The override is `undefined` until localStorage has been read. */
let override: string | null | undefined;

export function isElectron(): boolean {
  return (
    typeof window !== "undefined" && Boolean(window.electronAPI?.isElectron)
  );
}

/** Normalise user input into a usable base URL, or return "" when invalid. */
export function normalizeServerUrl(raw: string): string {
  const value = String(raw ?? "").trim();
  if (!value) return "";

  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(value) && !/^https?:\/\//i.test(value)) {
    return "";
  }

  const withScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(value)
    ? value
    : `http://${value}`;

  try {
    const url = new URL(withScheme);
    if (url.protocol !== "http:" && url.protocol !== "https:") return "";
    if (!url.hostname) return "";
    url.hash = "";
    url.search = "";
    const path = url.pathname.replace(/\/+$/, "");
    url.pathname = path || "/";
    return url.toString().replace(/\/$/, "");
  } catch {
    return "";
  }
}

export function isLoopbackHostname(hostname: string): boolean {
  const host = hostname.toLowerCase();
  return (
    host === "localhost" ||
    host === "127.0.0.1" ||
    host === "::1" ||
    host === "[::1]"
  );
}

export function isLoopbackServerUrl(raw: string): boolean {
  const url = normalizeServerUrl(raw);
  if (!url) return false;
  try {
    return isLoopbackHostname(new URL(url).hostname);
  } catch {
    return false;
  }
}

export function isSecurePage(): boolean {
  return typeof window !== "undefined" && window.location.protocol === "https:";
}

function privateNetworkHost(hostname: string): boolean {
  const host = hostname.toLowerCase();
  if (host.endsWith(".local") || host.endsWith(".lan")) return true;
  return /^(?:10\.|192\.168\.|172\.(?:1[6-9]|2\d|3[01])\.)/.test(host);
}

/** Classify an address for the saved-server list. */
export function serverCandidateKind(raw: string): ServerCandidate["kind"] {
  const url = normalizeServerUrl(raw);
  if (!url) return "manual";
  try {
    return privateNetworkHost(new URL(url).hostname) ? "lan" : "remote";
  } catch {
    return "manual";
  }
}

function candidateLabel(url: string, kind: ServerCandidate["kind"]): string {
  if (kind === "lan") return "Local network";
  if (kind === "remote") return "Remote";
  return "Saved server";
}

function readCandidates(): ServerCandidate[] {
  try {
    const raw = JSON.parse(localStorage.getItem(CANDIDATES_KEY) ?? "[]") as unknown;
    if (!Array.isArray(raw)) return [];
    return raw.flatMap((entry): ServerCandidate[] => {
      if (!entry || typeof entry !== "object") return [];
      const record = entry as Record<string, unknown>;
      const url = normalizeServerUrl(String(record.url ?? ""));
      if (!url) return [];
      const kind = record.kind === "lan" || record.kind === "remote" || record.kind === "manual"
        ? record.kind
        : serverCandidateKind(url);
      return [{
        url,
        label: typeof record.label === "string" && record.label.trim()
          ? record.label.trim().slice(0, 80)
          : candidateLabel(url, kind),
        kind,
        serverId: typeof record.serverId === "string" && record.serverId.trim()
          ? record.serverId.trim().slice(0, 120)
          : undefined,
        lastUsedAt: typeof record.lastUsedAt === "string" ? record.lastUsedAt : undefined,
      }];
    });
  } catch {
    return [];
  }
}

function writeCandidates(list: ServerCandidate[]): void {
  const capped = list.slice(0, 12);
  try {
    localStorage.setItem(CANDIDATES_KEY, JSON.stringify(capped));
  } catch {
    /* private mode / storage disabled */
  }
  if (isElectron()) {
    void window.electronAPI?.setServerCandidates?.(capped).catch(() => {
      /* the renderer copy still works for this session */
    });
  }
}

/** Saved addresses for this server, active address first. */
export function getServerCandidates(): ServerCandidate[] {
  const active = ensureOverrideLoaded();
  const list = readCandidates();
  if (active && !list.some((candidate) => candidate.url === active)) {
    const kind = serverCandidateKind(active);
    list.unshift({ url: active, label: candidateLabel(active, kind), kind, lastUsedAt: new Date().toISOString() });
  }
  return list.sort((a, b) => {
    if (a.url === active) return -1;
    if (b.url === active) return 1;
    return String(b.lastUsedAt ?? "").localeCompare(String(a.lastUsedAt ?? ""));
  });
}

/** Remember an address so it can be offered after a network change. */
export function rememberServerCandidate(
  raw: string,
  label?: string,
  serverId?: string,
): ServerCandidate | null {
  const url = normalizeServerUrl(raw);
  if (!url) return null;
  const kind = serverCandidateKind(url);
  const list = readCandidates();
  const existing = list.find((candidate) => candidate.url === url);
  const entry: ServerCandidate = {
    url,
    label: label?.trim().slice(0, 80) || existing?.label || candidateLabel(url, kind),
    kind,
    serverId: serverId?.trim().slice(0, 120) || existing?.serverId,
    lastUsedAt: new Date().toISOString(),
  };
  writeCandidates([entry, ...list.filter((candidate) => candidate.url !== url)]);
  return entry;
}

export function forgetServerCandidate(raw: string): void {
  const url = normalizeServerUrl(raw);
  if (!url) return;
  writeCandidates(readCandidates().filter((candidate) => candidate.url !== url));
}

function readLocalOverride(): string {
  try {
    return normalizeServerUrl(localStorage.getItem(STORAGE_KEY) ?? "");
  } catch {
    return "";
  }
}

function writeLocalOverride(url: string): void {
  try {
    if (url) localStorage.setItem(STORAGE_KEY, url);
    else localStorage.removeItem(STORAGE_KEY);
  } catch {
    /* private mode / storage disabled */
  }
}

function ensureOverrideLoaded(): string {
  if (typeof window !== "undefined" && window.electronAPI?.localOnly) return "";
  if (override === undefined) {
    override = readLocalOverride();
  }
  const value = override ?? "";
  return value;
}

/** The user-picked server address, or "" when following the default. */
export function getServerOverride(): string {
  return ensureOverrideLoaded();
}

/** Whether an explicit server address is stored on this device. */
export function hasServerOverride(): boolean {
  return Boolean(getServerOverride());
}

/** The address every API, image, subtitle and stream URL should use. */
export function getApiBase(): string {
  if (typeof window !== "undefined" && window.electronAPI)
    return window.location.origin;
  if (typeof window !== "undefined" && window.electronAPI?.localOnly)
    return window.location.origin;
  const saved = ensureOverrideLoaded();
  if (saved) return saved;
  if (ENV_API_BASE) return ENV_API_BASE;
  if (typeof window !== "undefined" && window.location.origin) {
    return normalizeServerUrl(window.location.origin) || window.location.origin;
  }
  return "http://127.0.0.1:8765";
}

/**
 * The server used by native playback. In desktop remote mode the browser API
 * stays on the localhost proxy (so cookies remain same-origin), but mpv can
 * fetch the chosen server directly. In bundled/server-hosted mode this is just
 * the page origin.
 */
export function getConfiguredServerBase(): string {
  if (typeof window !== "undefined" && window.electronAPI && !window.electronAPI.localOnly) {
    const saved = ensureOverrideLoaded();
    if (saved) return saved;
  }
  return getApiBase();
}

/** Save a server address and make it effective immediately. */
export function setServerUrl(raw: string): string {
  if (typeof window !== "undefined" && window.electronAPI?.localOnly) {
    override = "";
    writeLocalOverride("");
    return window.location.origin;
  }
  const url = normalizeServerUrl(raw);
  override = url;
  writeLocalOverride(url);
  if (url) rememberServerCandidate(url);
  if (isElectron()) {
    void window.electronAPI?.setServerUrl(url).catch(() => {
      /* the in-memory + localStorage copy still works for this session */
    });
  }
  return url;
}

/**
 * Save an address and wait for the desktop main process to apply it. Used for
 * explicit server switches and automatic failover so the next request cannot
 * race the proxy/TLS preference update.
 */
export async function activateServerUrl(raw: string): Promise<string> {
  if (typeof window !== "undefined" && window.electronAPI?.localOnly) {
    override = "";
    writeLocalOverride("");
    return window.location.origin;
  }
  const url = normalizeServerUrl(raw);
  override = url;
  writeLocalOverride(url);
  if (url) rememberServerCandidate(url);
  if (isElectron() && window.electronAPI?.setServerUrl) {
    await window.electronAPI.setServerUrl(url).catch(() => {
      /* in-memory override still applies to this session */
    });
  }
  return url;
}

/** Forget the explicit address and fall back to env / same-origin. */
export function clearServerUrl(): void {
  override = "";
  writeLocalOverride("");
  if (isElectron()) {
    void window.electronAPI?.setServerUrl("").catch(() => {});
  }
}

/**
 * Load the Electron-persisted override before the app renders. No-op in a
 * normal browser, where localStorage is synchronous.
 */
export async function hydrateServerUrl(): Promise<void> {
  if (!isElectron()) return;
  const localEnabled = await window.electronAPI?.getLocalServerEnabled();
  if (localEnabled) {
    override = "";
    writeLocalOverride("");
  } else {
    try {
      const saved = await window.electronAPI?.getServerUrl();
      const url = normalizeServerUrl(saved ?? "");
      if (url) {
        override = url;
        writeLocalOverride(url);
      }
    } catch {
      /* fall back to localStorage / same-origin */
    }
  }

  // The static UI server uses a fresh port each launch, so renderer
  // localStorage cannot be the long-term home for connection profiles.
  try {
    const persisted = await window.electronAPI?.getServerCandidates?.();
    if (Array.isArray(persisted) && persisted.length) {
      const merged: ServerCandidate[] = [];
      for (const entry of [...persisted, ...readCandidates()]) {
        const url = normalizeServerUrl(String(entry.url ?? ""));
        if (!url || merged.some((candidate) => candidate.url === url)) continue;
        const kind = entry.kind === "lan" || entry.kind === "remote" || entry.kind === "manual"
          ? entry.kind
          : serverCandidateKind(url);
        merged.push({
          url,
          label: String(entry.label ?? "").trim().slice(0, 80) || candidateLabel(url, kind),
          kind,
          serverId: typeof entry.serverId === "string" ? entry.serverId.trim().slice(0, 120) : undefined,
          lastUsedAt: typeof entry.lastUsedAt === "string" ? entry.lastUsedAt : undefined,
        });
      }
      const active = ensureOverrideLoaded();
      if (active && !merged.some((candidate) => candidate.url === active)) {
        const kind = serverCandidateKind(active);
        merged.unshift({ url: active, label: candidateLabel(active, kind), kind });
      }
      try {
        localStorage.setItem(CANDIDATES_KEY, JSON.stringify(merged.slice(0, 12)));
      } catch {
        /* private mode / storage disabled */
      }
      if (merged.length) {
        void window.electronAPI?.setServerCandidates?.(merged.slice(0, 12)).catch(() => {
          /* the renderer copy still works */
        });
      }
    }
  } catch {
    /* local candidates remain usable */
  }
}

export type ProbeResult =
  | { ok: true; url: string; status: ServerStatus; latencyMs?: number }
  | { ok: false; error: string };

export interface ProbeOptions {
  timeoutMs?: number;
  /** Retry once on a dropped handshake. Defaults to true. */
  retry?: boolean;
}

/**
 * Verify that an address is a reachable Plexy server. A static host returns
 * its SPA shell for `/api/server/status`, so a successful HTTP status alone is
 * not enough: the response must be Plexy's JSON status payload.
 */
export async function probeServer(raw: string, options: ProbeOptions = {}): Promise<ProbeResult> {
  const first = await probeServerOnce(raw, options.timeoutMs ?? PROBE_TIMEOUT_MS);
  if (first.ok || options.retry === false) return first;
  // One quiet retry turns a dropped handshake or a laptop waking from sleep
  // into a successful connection instead of another manual attempt.
  if (!/Could not reach|did not answer/.test(first.error)) return first;
  await new Promise((resolve) => setTimeout(resolve, 300));
  return probeServerOnce(raw, options.timeoutMs ?? PROBE_TIMEOUT_MS);
}

async function probeServerOnce(raw: string, timeoutMs: number): Promise<ProbeResult> {
  if (
    typeof window !== "undefined" &&
    window.electronAPI?.localOnly &&
    normalizeServerUrl(raw) !== window.location.origin
  ) {
    return {
      ok: false,
      error: "This app uses its own library on this device.",
    };
  }
  const base = normalizeServerUrl(raw);
  if (!base) {
    return {
      ok: false,
      error:
        "Enter a valid server address, for example http://192.168.1.20:8765.",
    };
  }

  if (
    isSecurePage() &&
    base.startsWith("http://") &&
    !isLoopbackServerUrl(base)
  ) {
    return {
      ok: false,
      error:
        "This page is served over HTTPS, so the browser blocks a plain HTTP server. Use a private-network HTTPS address, or open Plexy directly over HTTP on the local network.",
    };
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const started = performance.now();

  try {
    if (window.electronAPI?.probeServer) {
      const status = await Promise.race([
        window.electronAPI.probeServer(base),
        new Promise<never>((_, reject) => {
          setTimeout(() => reject(new DOMException("Timed out", "AbortError")), timeoutMs);
        }),
      ]);
      if (
        typeof status.version !== "string" ||
        typeof status.setupComplete !== "boolean"
      )
        throw new Error("Invalid server response");
      return {
        ok: true,
        url: base,
        status: status as ServerStatus,
        latencyMs: Math.max(1, Math.round(performance.now() - started)),
      };
    }
    const response = await fetch(`${base}/api/server/status`, {
      method: "GET",
      headers: { Accept: "application/json" },
      cache: "no-store",
      signal: controller.signal,
    });

    if (!response.ok) {
      let detail = "";
      try {
        const body = (await response.json()) as { error?: unknown } | null;
        if (body && typeof body.error === "string") detail = body.error;
      } catch {
        /* not a JSON error body */
      }
      return {
        ok: false,
        error:
          detail ||
          (response.status === 404
            ? `No Plexy server found at ${base}.`
            : `${base} answered with HTTP ${response.status}. Make sure the address is correct and Plexy is running.`),
      };
    }

    const contentType = response.headers.get("content-type") ?? "";
    if (!contentType.toLowerCase().includes("application/json")) {
      return {
        ok: false,
        error:
          "That address returned a webpage, not a Plexy server. Enter the address of the Plexy server itself (it usually uses port 8765).",
      };
    }

    const data = (await response.json()) as Partial<ServerStatus> | null;
    if (
      !data ||
      typeof data.version !== "string" ||
      typeof data.setupComplete !== "boolean"
    ) {
      return {
        ok: false,
        error:
          "That address is not a Plexy server. Check the address and port.",
      };
    }

    return {
      ok: true,
      url: base,
      status: data as ServerStatus,
      latencyMs: Math.max(1, Math.round(performance.now() - started)),
    };
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") {
      return {
        ok: false,
        error: `${base} did not answer within ${Math.round(timeoutMs / 1000)} seconds.`,
      };
    }
    return {
      ok: false,
      error: `Could not reach ${base}. Make sure Plexy is running and this device is on the same network (or that the address is publicly reachable).`,
    };
  } finally {
    clearTimeout(timer);
  }
}

export interface CandidateProbe {
  candidate: ServerCandidate;
  result: ProbeResult;
  latencyMs: number | null;
}

/** Probe every remembered address in parallel, fastest first. */
export async function probeServerCandidates(
  options: ProbeOptions = {},
): Promise<CandidateProbe[]> {
  const candidates = getServerCandidates();
  if (!candidates.length) return [];
  const probes = await Promise.all(candidates.map(async (candidate) => {
    const started = performance.now();
    const result = await probeServer(candidate.url, {
      timeoutMs: options.timeoutMs ?? 3_000,
      retry: options.retry ?? false,
    });
    return {
      candidate,
      result,
      latencyMs: result.ok ? Math.max(1, Math.round(performance.now() - started)) : null,
    };
  }));
  return probes.sort((a, b) =>
    Number(b.result.ok) - Number(a.result.ok) ||
    (a.latencyMs ?? Number.MAX_SAFE_INTEGER) - (b.latencyMs ?? Number.MAX_SAFE_INTEGER),
  );
}

/** First reachable address other than the one that just failed. */
export async function findReachableAlternative(
  current: string,
): Promise<{ candidate: ServerCandidate; latencyMs: number } | null> {
  const normalized = normalizeServerUrl(current);
  const currentId = getServerCandidates()
    .find((candidate) => candidate.url === normalized)?.serverId;
  const probes = await probeServerCandidates({ timeoutMs: 2_500, retry: false });
  for (const probe of probes) {
    if (!probe.result.ok) continue;
    if (normalizeServerUrl(probe.candidate.url) === normalized) continue;
    // Never silently fail over to a different Plexy installation.
    if (currentId && probe.result.status.serverId && probe.result.status.serverId !== currentId) {
      continue;
    }
    return {
      candidate: probe.candidate,
      latencyMs: probe.latencyMs ?? 0,
    };
  }
  return null;
}
