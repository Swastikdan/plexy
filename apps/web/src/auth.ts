/// Client-side authentication helpers.
///
/// The server issues an HttpOnly `plexy_session` cookie, so normal API calls,
/// images, video streams and HLS segments authenticate automatically. The
/// desktop app additionally stores a token in the macOS Keychain and installs
/// the same cookie before the window loads; this module only needs to report
/// whether a credential exists and to pair new devices.
import { getApiBase } from "./server-config";

export interface AuthDevice {
  id: number;
  deviceId: string | null;
  name: string;
  createdAt: string;
  lastSeen: string | null;
  revoked?: boolean;
}

interface AuthAttempt {
  ok: boolean;
  error?: string;
  device?: AuthDevice;
}

async function readError(res: Response): Promise<string> {
  try {
    const body = (await res.json()) as { error?: unknown } | null;
    if (body && typeof body.error === "string") return body.error;
  } catch {
    /* not JSON */
  }
  if (res.status === 401) return "Authentication required.";
  if (res.status === 403) return "This action is only available on the server machine.";
  return `Request failed (${res.status}).`;
}

function apiUrl(path: string): string {
  return `${getApiBase()}${path}`;
}

/**
 * A cross-origin HTTP page cannot store a `SameSite=None; Secure` cookie, so a
 * successful pair can silently lose the session. Detect that immediately
 * instead of reloading into the pairing screen again.
 */
function cookieBlockedMessage(): string {
  return `Signed in, but this browser blocked the session cookie. Open ${getApiBase()} directly in this browser instead.`;
}

/** The authenticated device for this browser/app, or null. */
export async function getAuthDevice(): Promise<AuthDevice | null> {
  try {
    const res = await fetch(apiUrl("/api/auth/me"), {
      credentials: "include",
      cache: "no-store",
      headers: { Accept: "application/json" },
    });
    if (!res.ok) return null;
    const body = (await res.json()) as { authenticated?: boolean; device?: AuthDevice } | null;
    return body?.authenticated && body.device ? body.device : null;
  } catch {
    return null;
  }
}

/** True when the page itself is served from the machine running the server. */
export function isLocalPage(): boolean {
  if (typeof window === "undefined") return false;
  const host = window.location.hostname.toLowerCase();
  return host === "localhost" || host === "127.0.0.1" || host === "::1" || host === "[::1]";
}

/**
 * First-run login on the server machine. Loopback is already the owner trust
 * boundary on the server, so no code is needed here; the server still records
 * the device and returns the same cookie a paired device would get.
 */
export async function loginOnServerMachine(name?: string): Promise<AuthAttempt> {
  try {
    const res = await fetch(apiUrl("/api/auth/local"), {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({ name: name || "This Mac" }),
    });
    if (!res.ok) return { ok: false, error: await readError(res) };
    const body = (await res.json()) as { device?: AuthDevice } | null;
    const device = await getAuthDevice();
    if (!device) return { ok: false, error: cookieBlockedMessage() };
    return { ok: true, device: device ?? body?.device };
  } catch {
    return { ok: false, error: `Cannot reach the Plexy server at ${getApiBase()}.` };
  }
}

/** Exchange a six-digit pairing code for a session. */
export async function pairDevice(code: string, name?: string): Promise<AuthAttempt> {
  const digits = String(code ?? "").replace(/\D/g, "");
  if (digits.length !== 6) {
    return { ok: false, error: "Enter the six-digit code shown in Plexy on the server." };
  }
  try {
    const res = await fetch(apiUrl("/api/auth/pair"), {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({ code: digits, name: name || "Paired device" }),
    });
    if (!res.ok) return { ok: false, error: await readError(res) };
    const body = (await res.json()) as { device?: AuthDevice } | null;
    const device = await getAuthDevice();
    if (!device) return { ok: false, error: cookieBlockedMessage() };
    return { ok: true, device: device ?? body?.device };
  } catch {
    return { ok: false, error: `Cannot reach the Plexy server at ${getApiBase()}.` };
  }
}

export async function logout(): Promise<void> {
  try {
    await fetch(apiUrl("/api/auth/logout"), {
      method: "POST",
      credentials: "include",
    });
  } catch {
    /* the cookie may already be gone */
  }
}

export interface PairingCode {
  code: string;
  expiresAt: string;
}

/** Owner-only: mint a code to type on another device. */
export async function createPairingCode(label?: string): Promise<PairingCode> {
  const res = await fetch(apiUrl("/api/auth/pairing-code"), {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({ label: label || "Device" }),
  });
  if (!res.ok) throw new Error(await readError(res));
  return (await res.json()) as PairingCode;
}

/** Owner-only: list paired devices. */
export async function listDevices(): Promise<AuthDevice[]> {
  const res = await fetch(apiUrl("/api/auth/devices"), {
    credentials: "include",
    cache: "no-store",
    headers: { Accept: "application/json" },
  });
  if (!res.ok) throw new Error(await readError(res));
  const body = (await res.json()) as { devices?: AuthDevice[] } | null;
  return body?.devices ?? [];
}

/** Owner-only: revoke a device. */
export async function revokeDevice(id: number): Promise<void> {
  const res = await fetch(apiUrl(`/api/auth/devices/${id}`), {
    method: "DELETE",
    credentials: "include",
  });
  if (!res.ok) throw new Error(await readError(res));
}
