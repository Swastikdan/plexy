import { getSignedInUser } from "./auth";
/// Typed client runtime configuration
/// (docs/MOBILE_AND_DISTRIBUTION_DETAILED_PLAN.md, workstream B).
///
/// One module decides which delivery mode this client runs in and what it may
/// do. Screens read these flags instead of scattering `isElectron()` and origin
/// checks, so a remote or installed client never assumes a local server.
import {
  getApiBase,
  isElectron,
  isLoopbackServerUrl,
  normalizeServerUrl,
} from "./server-config";

/** Delivery format declared by the build (`VITE_CLIENT_MODE`). */
export type DeclaredClientMode = "bundled" | "remote";

/**
 * - `bundled`: Electron started a Plexy server and loaded this UI from it.
 * - `server-hosted`: the page is served by the Plexy server it talks to.
 * - `remote`: a separately hosted UI pointed at another machine's server.
 */
export type ClientMode = "bundled" | "server-hosted" | "remote";

/** Product name for any client-only delivery (desktop UI-only or mobile). */
export const CLIENT_DISPLAY_NAME = "Plexy Client";

function declaredMode(): DeclaredClientMode {
  let raw = "";
  try {
    raw = String(import.meta.env?.VITE_CLIENT_MODE ?? "").trim().toLowerCase();
  } catch {
    /* non-Vite host */
  }
  // A browser cannot start a server, so only Electron may claim bundled mode.
  if (raw === "bundled" && isElectron()) return "bundled";
  return "remote";
}

function pageOrigin(): string {
  if (typeof window === "undefined") return "";
  return normalizeServerUrl(window.location.origin);
}

/** True when the UI came from the server's own origin, not a static host. */
export function isServerHosted(): boolean {
  const origin = pageOrigin();
  return Boolean(origin) && getApiBase() === origin;
}

export function getClientMode(): ClientMode {
  if (declaredMode() === "bundled") return "bundled";
  return isServerHosted() ? "server-hosted" : "remote";
}

/** Launched from an installed home-screen or desktop-app window. */
export function isInstalledClient(): boolean {
  if (typeof window === "undefined") return false;
  const iOSStandalone =
    (window.navigator as Navigator & { standalone?: boolean }).standalone === true;
  const displayStandalone =
    typeof window.matchMedia === "function" &&
    window.matchMedia("(display-mode: standalone)").matches;
  return iOSStandalone || displayStandalone;
}

export interface ClientRuntime {
  mode: ClientMode;
  /** Address every API, artwork and stream URL currently uses. */
  serverUrl: string;
  /** The UI runs inside the Electron shell with a bundled server. */
  bundled: boolean;
  /** The UI is served by the server it talks to (same origin). */
  serverHosted: boolean;
  /**
   * Server administration is reachable. The server restricts admin routes to
   * loopback, so offering them to a phone or another computer is a dead end.
   */
  canManageServer: boolean;
  /** Installed to the home screen or app launcher rather than a browser tab. */
  installed: boolean;
}

export function getClientRuntime(): ClientRuntime {
  const mode = getClientMode();
  const serverUrl = getApiBase();
  return {
    mode,
    serverUrl,
    bundled: mode === "bundled",
    serverHosted: mode === "server-hosted",
    // Mirrors the server's own authorization boundary instead of inventing a
    // new one in the UI.
    canManageServer: getSignedInUser()?.role === "admin" && (mode === "bundled" || isLoopbackServerUrl(serverUrl)),
    installed: isInstalledClient(),
  };
}
