/// Desktop native (mpv) playback helpers.
///
/// The native player exists only in the Electron desktop app. Everything here
/// degrades to "not available" in a browser so the existing browser player
/// stays untouched for website visitors.
import { getApiBase } from "../server-config";

export type PlayerEngine = "native" | "browser";

const ENGINE_KEY = "plexy:player-engine:v1";

export function nativeBridge() {
  return typeof window !== "undefined" ? window.electronAPI?.nativePlayer : undefined;
}

export function readPlayerEngine(): PlayerEngine {
  try {
    return localStorage.getItem(ENGINE_KEY) === "browser" ? "browser" : "native";
  } catch {
    return "native";
  }
}

export function savePlayerEngine(engine: PlayerEngine): void {
  try {
    localStorage.setItem(ENGINE_KEY, engine);
  } catch {
    /* private mode / storage disabled */
  }
}

/** Fired when the engine choice changes so the watch route can re-mount. */
export const PLAYER_ENGINE_EVENT = "plexy:player-engine";

let nativeAvailable = false;

/** Capability is resolved once per page load by the watch route wrapper. */
export function markNativeAvailable(available: boolean): void {
  nativeAvailable = available;
}

export function isNativeAvailable(): boolean {
  return nativeAvailable;
}

/**
 * Backend origin for the main process to fetch from. In the Vite dev harness
 * the page is served from :5173 while the API is proxied to the dev backend,
 * so point native playback at that backend directly.
 */
export function nativeServerUrl(): string {
  const base = getApiBase();
  try {
    const url = new URL(base);
    const devPort = String(import.meta.env?.VITE_PLEXY_PORT ?? "8765");
    if (url.port === "5173") return `http://127.0.0.1:${devPort}`;
    return url.origin;
  } catch {
    return base;
  }
}

/** "about 4 min left" style labels for preparation/playback surfaces. */
export function formatClock(seconds: number | null | undefined): string {
  if (seconds == null || !Number.isFinite(seconds) || seconds < 0) return "0:00";
  const total = Math.floor(seconds);
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const secs = total % 60;
  return hours > 0
    ? `${hours}:${String(minutes).padStart(2, "0")}:${String(secs).padStart(2, "0")}`
    : `${minutes}:${String(secs).padStart(2, "0")}`;
}
