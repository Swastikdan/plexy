/// Device authentication (tokens, pairing codes, session cookies).
///
/// The server stores only token hashes; the raw token exists in the client's
/// secure storage (macOS Keychain via Electron `safeStorage`) or in an
/// HttpOnly cookie. Loopback remains the trust boundary for owner-only admin
/// routes (`essentials.denyIfNotLocal`), while every `/api/*` endpoint now
/// requires a valid device token — including on LAN.
import { q, run, type Row } from "./db";
import { log } from "./logger";
import { remoteAddress, type LoopbackContext } from "./essentials";

const TOKEN_BYTES = 32;
const PAIRING_CODE_TTL_MINUTES = 10;
const PAIRING_MAX_ATTEMPTS_PER_MINUTE = 12;
const LAST_SEEN_THROTTLE_MS = 60_000;

export interface AuthDevice {
  id: number;
  deviceId: string | null;
  name: string;
  createdAt: string;
  lastSeen: string | null;
  lastIp: string | null;
}

export interface AuthResult {
  token: string;
  device: AuthDevice;
}

/** Cryptographically random, URL-safe device token. */
function newToken(): string {
  const bytes = new Uint8Array(TOKEN_BYTES);
  crypto.getRandomValues(bytes);
  return Buffer.from(bytes).toString("base64url");
}

function newPairingCode(): string {
  const bytes = new Uint32Array(1);
  crypto.getRandomValues(bytes);
  return String(bytes[0]! % 1_000_000).padStart(6, "0");
}

function hash(value: string): string {
  return new Bun.CryptoHasher("sha256").update(value).digest("hex");
}

function shaEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

function toDevice(row: Row): AuthDevice {
  return {
    id: Number(row.id),
    deviceId: row.device_id == null ? null : String(row.device_id),
    name: String(row.name ?? "Device"),
    createdAt: String(row.created_at ?? ""),
    lastSeen: row.last_seen == null ? null : String(row.last_seen),
    lastIp: row.last_ip == null ? null : String(row.last_ip),
  };
}

const lastSeenWrites = new Map<number, number>();

function touch(device: AuthDevice, remoteIp?: string | null): void {
  const now = Date.now();
  const previous = lastSeenWrites.get(device.id) ?? 0;
  if (now - previous < LAST_SEEN_THROTTLE_MS) {
    if (remoteIp && remoteIp !== device.lastIp) {
      try {
        run("UPDATE auth_devices SET last_ip = ? WHERE id = ?", remoteIp, device.id);
        device.lastIp = remoteIp;
      } catch {
        /* last_ip is advisory; never fail a request over it */
      }
    }
    return;
  }
  lastSeenWrites.set(device.id, now);
  try {
    run(
      "UPDATE auth_devices SET last_seen = datetime('now'), last_ip = COALESCE(?, last_ip) WHERE id = ?",
      remoteIp ?? null,
      device.id,
    );
    if (remoteIp) device.lastIp = remoteIp;
  } catch {
    /* last_seen is advisory; never fail a request over it */
  }
}

/** Resolve a raw bearer token to its device, or null when invalid/revoked. */
export function verifyToken(token: string, remoteIp?: string | null): AuthDevice | null {
  const raw = String(token ?? "").trim();
  if (!raw) return null;
  const row = q<Row, [string]>(
    "SELECT id, device_id, name, created_at, last_seen, last_ip FROM auth_devices WHERE token_hash = ? AND revoked = 0",
  ).get(hash(raw));
  if (!row) return null;
  const device = toDevice(row);
  touch(device, remoteIp);
  return device;
}

/** Current device for a token, without bumping last_seen (used by /me). */
export function peekToken(token: string): AuthDevice | null {
  const raw = String(token ?? "").trim();
  if (!raw) return null;
  const row = q<Row, [string]>(
    "SELECT id, device_id, name, created_at, last_seen, last_ip FROM auth_devices WHERE token_hash = ? AND revoked = 0",
  ).get(hash(raw));
  return row ? toDevice(row) : null;
}

/**
 * Mint a token. When `deviceId` matches an existing row the old token is
 * replaced in place, so the desktop app can rotate credentials on every launch
 * without leaving stale entries behind.
 */
export function createDevice(name: string, deviceId?: string | null, lastIp?: string | null): AuthResult {
  const token = newToken();
  const label = String(name ?? "").trim().slice(0, 80) || "Device";
  const id = deviceId ? String(deviceId).trim().slice(0, 120) || null : null;

  if (id) {
    const existing = q<Row, [string]>("SELECT id FROM auth_devices WHERE device_id = ?").get(id);
    if (existing) {
      run(
        "UPDATE auth_devices SET name = ?, token_hash = ?, revoked = 0, last_seen = datetime('now'), last_ip = COALESCE(?, last_ip) WHERE id = ?",
        label,
        hash(token),
        lastIp ?? null,
        Number(existing.id),
      );
      const device = peekToken(token);
      if (device) return { token, device };
    }
  }

  run(
    "INSERT INTO auth_devices (device_id, name, token_hash, last_ip) VALUES (?, ?, ?, ?)",
    id,
    label,
    hash(token),
    lastIp ?? null,
  );
  const row = q<Row, [string]>("SELECT id, device_id, name, created_at, last_seen, last_ip FROM auth_devices WHERE token_hash = ?")
    .get(hash(token))!;
  return { token, device: toDevice(row) };
}

export function revokeDevice(id: number): boolean {
  const row = q<Row, [number]>("SELECT id FROM auth_devices WHERE id = ? AND revoked = 0").get(id);
  if (!row) return false;
  run("UPDATE auth_devices SET revoked = 1 WHERE id = ?", id);
  lastSeenWrites.delete(id);
  return true;
}

/** Permanently remove a device only after its credential has been revoked. */
export function removeRevokedDevice(id: number): boolean {
  const row = q<{ id: number }, [number]>(
    "DELETE FROM auth_devices WHERE id = ? AND revoked = 1 RETURNING id",
  ).get(id);
  if (!row) return false;
  lastSeenWrites.delete(id);
  return true;
}

export function revokeByToken(token: string): boolean {
  const device = peekToken(token);
  return device ? revokeDevice(device.id) : false;
}

export function listDevices(): Array<AuthDevice & { revoked: boolean }> {
  return q<Row>("SELECT id, device_id, name, created_at, last_seen, last_ip, revoked FROM auth_devices ORDER BY created_at DESC")
    .all()
    .map((row) => ({ ...toDevice(row), revoked: Number(row.revoked) === 1 }));
}

export function hasAnyDevice(): boolean {
  return Boolean(q<Row>("SELECT id FROM auth_devices LIMIT 1").get());
}

// --- pairing codes -----------------------------------------------------------

export interface PairingCode {
  code: string;
  expiresAt: string;
}

export function createPairingCode(label = "Device"): PairingCode {
  const code = newPairingCode();
  // Housekeeping: expired codes are useless and can be dropped on every mint.
  run("DELETE FROM auth_pairing WHERE expires_at < datetime('now', '-1 day')");
  run(
    "INSERT INTO auth_pairing (code_hash, label, expires_at) VALUES (?, ?, datetime('now', ?))",
    hash(code),
    String(label ?? "Device").slice(0, 80),
    `+${PAIRING_CODE_TTL_MINUTES} minutes`,
  );
  const row = q<Row, [string]>("SELECT expires_at FROM auth_pairing WHERE code_hash = ? ORDER BY id DESC LIMIT 1")
    .get(hash(code));
  return { code, expiresAt: String(row?.expires_at ?? "") };
}

const pairingAttempts = new Map<string, number[]>();

/** Cheap in-memory throttle so a LAN client cannot brute-force six digits. */
export function pairingAllowed(remote: string | null): boolean {
  const key = remote ?? "unknown";
  const now = Date.now();
  const attempts = (pairingAttempts.get(key) ?? []).filter((t) => now - t < 60_000);
  if (attempts.length >= PAIRING_MAX_ATTEMPTS_PER_MINUTE) {
    pairingAttempts.set(key, attempts);
    return false;
  }
  attempts.push(now);
  pairingAttempts.set(key, attempts);
  return true;
}

export function redeemPairingCode(
  code: string,
  name: string,
  deviceId?: string | null,
  lastIp?: string | null,
): AuthResult | null {
  const raw = String(code ?? "").replace(/\D/g, "").slice(0, 6);
  if (raw.length !== 6) return null;

  // Claim the code in one statement so simultaneous requests cannot both
  // observe it as unused and mint two device tokens.
  const row = q<{ id: number }, [string]>(`
    UPDATE auth_pairing
    SET used = 1
    WHERE id = (
      SELECT id FROM auth_pairing
      WHERE code_hash = ? AND used = 0 AND expires_at > datetime('now')
      ORDER BY id DESC LIMIT 1
    )
    AND used = 0 AND expires_at > datetime('now')
    RETURNING id
  `).get(hash(raw));
  if (!row) return null;

  const result = createDevice(name || "Device", deviceId, lastIp);
  log.info("auth", "device paired", { id: result.device.id, name: result.device.name });
  return result;
}

// --- request helpers ---------------------------------------------------------

/** Bearer header for API clients, then the HttpOnly session cookie for browser media. */
export function tokenFromRequest(request: Request): string | null {
  const header = request.headers.get("authorization");
  if (header) {
    const match = /^Bearer\s+(.+)$/i.exec(header.trim());
    if (match?.[1]) return match[1].trim();
  }

  const cookie = request.headers.get("cookie");
  if (cookie) {
    for (const part of cookie.split(";")) {
      const [key, ...rest] = part.trim().split("=");
      if (key === "plexy_session") {
        const value = rest.join("=").trim();
        if (value) {
          try {
            return decodeURIComponent(value);
          } catch {
            return null;
          }
        }
      }
    }
  }

  return null;
}

export function isSecureRequest(request: Request): boolean {
  try {
    if (new URL(request.url).protocol === "https:") return true;
  } catch {
    /* ignore */
  }
  const forwarded = request.headers.get("x-forwarded-proto");
  if (forwarded?.split(",")[0]?.trim().toLowerCase() === "https") return true;
  const origin = request.headers.get("origin");
  return Boolean(origin?.startsWith("https://"));
}

/**
 * Session cookie. Same-site clients (the desktop app, a browser pointed at the
 * LAN address) get `SameSite=Lax`; a hosted HTTPS UI calling a remote HTTPS
 * server gets `SameSite=None; Secure`, which is what cross-site media requests
 * require.
 */
export function sessionCookie(request: Request, token: string): string {
  const secure = isSecureRequest(request);
  const origin = request.headers.get("origin");
  let crossSite = false;
  if (origin) {
    try {
      crossSite = origin !== new URL(request.url).origin;
    } catch {
      crossSite = false;
    }
  }
  const sameSite = crossSite && secure ? "None" : "Lax";
  const maxAge = 60 * 60 * 24 * 365;
  return [
    `plexy_session=${encodeURIComponent(token)}`,
    "Path=/",
    "HttpOnly",
    `Max-Age=${maxAge}`,
    `SameSite=${sameSite}`,
    ...(secure ? ["Secure"] : []),
  ].join("; ");
}

export function clearSessionCookie(request: Request): string {
  const secure = isSecureRequest(request);
  return [
    "plexy_session=",
    "Path=/",
    "HttpOnly",
    "Max-Age=0",
    `SameSite=${isSecureRequest(request) ? "None" : "Lax"}`,
    ...(secure ? ["Secure"] : []),
  ].join("; ");
}

/** Constant-time-ish digest comparison used by tests and diagnostics. */
export function tokensMatch(a: string, b: string): boolean {
  return shaEqual(hash(a), hash(b));
}

/** Endpoints a client must reach before it can hold a token. */
const PUBLIC_API_PATHS = new Set(["/api/server/status", "/api/server/status/"]);

/**
 * Global auth gate. Returns a 401 for `/api/*` requests without a valid device
 * token; static UI assets stay public so the login/pairing screen can render.
 *
 * The test suite drives `app.handle()` directly through `buildApp()`, where
 * there is no socket to pair from, so authentication is opt-out there.
 */
export function authGuard(ctx: LoopbackContext, force = false): Response | undefined {
  const { request } = ctx;
  if (Bun.env.PLEXY_AUTH_DISABLED === "1") return undefined;
  if (Bun.env.NODE_ENV === "test" && !force) return undefined;

  let url: URL;
  try {
    url = new URL(request.url);
  } catch {
    return undefined;
  }

  if (!url.pathname.startsWith("/api/")) return undefined;
  if (request.method === "OPTIONS") return undefined;
  if (PUBLIC_API_PATHS.has(url.pathname)) return undefined;
  // The login surface itself: /me reports 401 deliberately, the rest mint or
  // redeem credentials.
  if (url.pathname.startsWith("/api/auth/")) return undefined;

  const token = tokenFromRequest(request);
  if (token && verifyToken(token, remoteAddress(ctx))) return undefined;

  return Response.json(
    {
      error: "Authentication required. Pair this device with your Plexy server.",
      code: "UNAUTHORIZED",
    },
    { status: 401 },
  );
}
