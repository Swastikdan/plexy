/// Client-side authentication helpers.
///
/// The server issues an HttpOnly `plexy_session` cookie, so normal API calls,
/// images, video streams and HLS segments authenticate automatically. The
/// desktop uses the same persistent cookie. Account credentials are required
/// on every client, including the server machine.
import { getApiBase, isLoopbackServerUrl } from "./server-config";

export interface AuthDevice {
  id: number;
  deviceId: string | null;
  name: string;
  createdAt: string;
  lastSeen: string | null;
  lastIp?: string | null;
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
    if (!res.ok) { currentUser = null; return null; }
    const body = (await res.json()) as { authenticated?: boolean; device?: AuthDevice; user?: AccountUser } | null;
    currentUser = body?.user ?? null;
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

/** Exchange a single-use account pairing code for a session. */
export async function pairDevice(code: string, name?: string): Promise<AuthAttempt> {
  try {
    await accountRequest("/pair", { code: code.trim(), name: name || "Paired device" });
    const device = await getAuthDevice();
    return device ? { ok: true, device } : { ok: false, error: cookieBlockedMessage() };
  } catch (error) { return { ok: false, error: error instanceof Error ? error.message : "Could not pair." }; }
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

/** Mint a code to type on another device. For signed-in users, password is not required. */
export async function createPairingCode(password?: string): Promise<PairingCode> {
  const res = await fetch(apiUrl("/api/auth/pairing-code"), {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify(password ? { password } : {}),
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
  const res = await fetch(apiUrl(`/api/auth/devices/${id}/revoke`), {
    method: "POST",
    credentials: "include",
  });
  if (!res.ok) throw new Error(await readError(res));
}

/** Owner-only: permanently remove a device after it has been revoked. */
export async function removeRevokedDevice(id: number): Promise<void> {
  const res = await fetch(apiUrl(`/api/auth/devices/${id}`), {
    method: "DELETE",
    credentials: "include",
  });
  if (!res.ok) throw new Error(await readError(res));
}

export interface AccountUser { id: number; username: string; role: "admin" | "user"; disabled: boolean; maxAge: number | null; blockUnrated: boolean }
export interface SetupState { ownerCreated: boolean; setupComplete: boolean; step: number }
export async function accountRequest<T = any>(path: string, body?: unknown, method?: string): Promise<T> {
  if (!isLoopbackServerUrl(getApiBase()) && new URL(getApiBase()).protocol !== "https:") throw new Error("Use the server’s HTTPS address to sign in securely.");
  const response = await fetch(apiUrl(`/api/auth${path}`), { method: method || (body === undefined ? "GET" : "POST"), credentials: "include", cache: "no-store", headers: { "Content-Type": "application/json" }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  if (!response.ok) throw new Error(await readError(response));
  return response.json() as Promise<T>;
}
export async function login(username: string, password: string): Promise<void> {
  await accountRequest("/login", { username, password });
  if (!await getAuthDevice()) throw new Error(cookieBlockedMessage());
}

let currentUser: AccountUser | null = null;
export function getSignedInUser(): AccountUser | null { return currentUser; }
