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
const PROBE_TIMEOUT_MS = 7_000;

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
  return typeof window !== "undefined" && Boolean(window.electronAPI?.isElectron);
}

/** Normalise user input into a usable base URL, or return "" when invalid. */
export function normalizeServerUrl(raw: string): string {
  const value = String(raw ?? "").trim();
  if (!value) return "";

  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(value) && !/^https?:\/\//i.test(value)) {
    return "";
  }

  const withScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(value) ? value : `http://${value}`;

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
  return (
    typeof window !== "undefined" &&
    window.location.protocol === "https:"
  );
}

/**
 * A packaged Electron app starts its bundled backend on a fresh port every
 * launch. A loopback override from a previous launch is therefore stale and
 * must not mask the server that is actually serving this window.
 */
function isStaleElectronLoopback(url: string): boolean {
  if (!isElectron() || !url) return false;
  try {
    const parsed = new URL(url);
    if (!isLoopbackHostname(parsed.hostname)) return false;
    return (
      parsed.protocol !== window.location.protocol ||
      parsed.port !== window.location.port
    );
  } catch {
    return true;
  }
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
  if (override === undefined) {
    override = readLocalOverride();
  }
  const value = override ?? "";
  if (value && isStaleElectronLoopback(value)) {
    override = "";
    writeLocalOverride("");
    return "";
  }
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
  const saved = ensureOverrideLoaded();
  if (saved) return saved;
  if (ENV_API_BASE) return ENV_API_BASE;
  if (typeof window !== "undefined" && window.location.origin) {
    return normalizeServerUrl(window.location.origin) || window.location.origin;
  }
  return "http://127.0.0.1:8765";
}

/** Save a server address and make it effective immediately. */
export function setServerUrl(raw: string): string {
  const url = normalizeServerUrl(raw);
  override = url;
  writeLocalOverride(url);
  if (isElectron()) {
    void window.electronAPI?.setServerUrl(url).catch(() => {
      /* the in-memory + localStorage copy still works for this session */
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
  try {
    const saved = await window.electronAPI?.getServerUrl();
    const url = normalizeServerUrl(saved ?? "");
    if (url && isStaleElectronLoopback(url)) {
      // The bundled backend picked a new port since this was saved.
      override = "";
      writeLocalOverride("");
      void window.electronAPI?.setServerUrl("").catch(() => {});
      return;
    }
    if (url) {
      override = url;
      writeLocalOverride(url);
    }
  } catch {
    /* fall back to localStorage / same-origin */
  }
}

export type ProbeResult =
  | { ok: true; url: string; status: ServerStatus }
  | { ok: false; error: string };

/**
 * Verify that an address is a reachable Plexy server. A static host returns
 * its SPA shell for `/api/server/status`, so a successful HTTP status alone is
 * not enough: the response must be Plexy's JSON status payload.
 */
export async function probeServer(raw: string): Promise<ProbeResult> {
  const base = normalizeServerUrl(raw);
  if (!base) {
    return {
      ok: false,
      error: "Enter a valid server address, for example http://192.168.1.20:8765.",
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
        "This page is served over HTTPS, so the browser blocks a plain HTTP server. Use an HTTPS address (for example a Cloudflare Tunnel or Tailscale HTTPS URL) or open Plexy over HTTP on your local network.",
    };
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), PROBE_TIMEOUT_MS);

  try {
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
        error: "That address is not a Plexy server. Check the address and port.",
      };
    }

    return { ok: true, url: base, status: data as ServerStatus };
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") {
      return {
        ok: false,
        error: `${base} did not answer within ${Math.round(PROBE_TIMEOUT_MS / 1000)} seconds.`,
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
