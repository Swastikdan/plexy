/// Desktop auto-login.
///
/// The bundled server is only reachable on loopback, so it can mint a device
/// token for this installation without a pairing code. The token is persisted
/// as a `0600` file in the userData directory and also installed as an
/// HttpOnly cookie on the server origin, which means `<img>`, `<video>`, HLS
/// segment requests and EventSource all authenticate without client changes.
///
/// The token is deliberately *not* stored with Electron `safeStorage`. macOS
/// grants keychain access to an app by its code signature, and this build is
/// ad-hoc signed (`identity: "-"`), so the grant never matches after a rebuild
/// and macOS asks for the login password on every launch. The token is worth
/// exactly as much as the database and device id sitting next to it in
/// userData, so a `0600` file gives the same protection without the prompt.
///
/// The device id lives in the userData directory next to the database, so
/// replacing the .app keeps the same identity; if the token file is missing the
/// loopback call simply issues a new token.
import { app, session } from "electron";
import { chmodSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { hostname } from "node:os";
import path from "node:path";

export const SESSION_COOKIE = "plexy_session";

const TOKEN_FILE = "auth-token";
const LEGACY_TOKEN_FILE = "auth-token.bin";
const DEVICE_FILE = "device-id";

function dataFile(name: string): string {
  return path.join(app.getPath("userData"), name);
}

function readDeviceId(): string {
  const file = dataFile(DEVICE_FILE);
  try {
    const existing = readFileSync(file, "utf8").trim();
    if (existing) return existing;
  } catch {
    /* first launch */
  }

  const id = randomUUID();
  try {
    mkdirSync(path.dirname(file), { recursive: true });
    writeFileSync(file, id, { mode: 0o600 });
  } catch (error) {
    console.warn("[Plexy Desktop] Could not persist the device id:", error);
  }
  return id;
}

/** Drop the safeStorage-era token; reading it would trigger a Keychain prompt. */
function removeLegacyToken(): void {
  const legacy = dataFile(LEGACY_TOKEN_FILE);
  if (!existsSync(legacy)) return;
  try {
    rmSync(legacy, { force: true });
    console.log("[Plexy Desktop] Removed the old Keychain-encrypted auth token.");
  } catch (error) {
    console.warn("[Plexy Desktop] Could not remove the old auth token:", error);
  }
}

function readToken(): string | null {
  removeLegacyToken();
  const file = dataFile(TOKEN_FILE);
  if (!existsSync(file)) return null;
  try {
    return readFileSync(file, "utf8").trim() || null;
  } catch {
    return null;
  }
}

function writeToken(token: string): void {
  const file = dataFile(TOKEN_FILE);
  try {
    mkdirSync(path.dirname(file), { recursive: true });
    writeFileSync(file, token, { mode: 0o600 });
    try {
      chmodSync(file, 0o600);
    } catch {
      /* best effort */
    }
  } catch (error) {
    console.warn("[Plexy Desktop] Could not store the auth token:", error);
  }
}

function timeoutSignal(ms: number): AbortSignal {
  return AbortSignal.timeout(ms);
}

async function isTokenValid(base: string, token: string): Promise<boolean> {
  try {
    const res = await fetch(`${base}/api/auth/me`, {
      headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
      cache: "no-store",
      signal: timeoutSignal(3_000),
    });
    if (!res.ok) return false;
    const body = (await res.json()) as { authenticated?: boolean } | null;
    return body?.authenticated === true;
  } catch {
    return false;
  }
}

/** Install the token as a cookie so every renderer request is authenticated. */
async function installSessionCookie(base: string, token: string): Promise<void> {
  const url = new URL(base);
  try {
    await session.defaultSession.cookies.set({
      url: url.origin,
      name: SESSION_COOKIE,
      value: token,
      httpOnly: true,
      secure: url.protocol === "https:",
      sameSite: "lax",
      expirationDate: Math.floor(Date.now() / 1000) + 60 * 60 * 24 * 365,
    });
  } catch (error) {
    console.warn("[Plexy Desktop] Could not install the session cookie:", error);
  }
}

interface LocalAuthResponse {
  token?: string;
  device?: { id?: number; name?: string };
}

/**
 * Make sure this installation holds a valid token for the bundled server.
 * Returns false when the server could not authenticate us; the UI then falls
 * back to the pairing screen rather than showing empty pages.
 */
export async function ensureDesktopAuth(serverUrl: string): Promise<boolean> {
  const base = serverUrl.replace(/\/+$/, "");
  if (!/^https?:\/\//i.test(base)) return false;

  const stored = readToken();
  if (stored && (await isTokenValid(base, stored))) {
    await installSessionCookie(base, stored);
    console.log("[Plexy Desktop] Reused stored device token.");
    return true;
  }

  const deviceId = readDeviceId();
  try {
    const res = await fetch(`${base}/api/auth/local`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({
        deviceId,
        name: `Plexy on ${hostname()}`,
      }),
      signal: timeoutSignal(8_000),
    });
    if (!res.ok) {
      console.warn(`[Plexy Desktop] Local authentication failed (HTTP ${res.status}).`);
      return false;
    }

    const body = (await res.json()) as LocalAuthResponse | null;
    const token = body?.token;
    if (!token) {
      console.warn("[Plexy Desktop] Local authentication returned no token.");
      return false;
    }

    writeToken(token);
    await installSessionCookie(base, token);
    console.log("[Plexy Desktop] Authenticated with the bundled server.");
    return true;
  } catch (error) {
    console.warn(
      "[Plexy Desktop] Could not authenticate with the bundled server:",
      error instanceof Error ? error.message : String(error),
    );
    return false;
  }
}
