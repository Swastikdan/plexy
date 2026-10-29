/// Authentication endpoints: device pairing, the desktop's automatic local
/// login, and device management for the owner.
import { Elysia, t } from "elysia";
import {
  clearSessionCookie,
  createDevice,
  createPairingCode,
  listDevices,
  pairingAllowed,
  peekToken,
  redeemPairingCode,
  revokeByToken,
  revokeDevice,
  sessionCookie,
  tokenFromRequest,
} from "./auth";
import { isLoopbackContext, remoteAddress, type LoopbackContext } from "./essentials";
import { log } from "./logger";

const LOCAL_ONLY_ERROR = "This action is only available on the computer running Plexy.";

function loopbackDenied(ctx: LoopbackContext): Response | null {
  if (isLoopbackContext(ctx)) return null;
  return Response.json({ error: LOCAL_ONLY_ERROR }, { status: 403 });
}

/**
 * Loopback that did not arrive through a reverse proxy. A Cloudflare Tunnel or
 * similar proxy running on the same machine connects from 127.0.0.1, so the
 * socket address alone would let remote visitors mint a token without a code.
 */
function isDirectLoopback(ctx: LoopbackContext): boolean {
  if (!isLoopbackContext(ctx)) return false;
  return !["x-forwarded-for", "forwarded", "cf-connecting-ip", "x-real-ip", "x-forwarded-host"]
    .some((header) => Boolean(ctx.request.headers.get(header)));
}

function deviceName(value: string | undefined, fallback: string): string {
  const name = String(value ?? "").trim();
  return name ? name.slice(0, 80) : fallback;
}

export const authRoutes = new Elysia({ prefix: "/api/auth" })
  /** Who am I? Returns 401 when the caller has no valid credential. */
  .get("/me", ({ request }) => {
    const token = tokenFromRequest(request);
    const device = token ? peekToken(token) : null;
    if (!device) {
      return Response.json({ authenticated: false }, { status: 401 });
    }
    return { authenticated: true as const, device };
  })

  /**
   * Automatic login for the desktop app's bundled server (loopback only).
   * The caller stores the returned token in the OS keychain; the server keeps
   * only its hash, so relaunching and even replacing the .app keeps working.
   */
  .post(
    "/local",
    (ctx) => {
      if (!isDirectLoopback(ctx)) {
        return Response.json({ error: LOCAL_ONLY_ERROR }, { status: 403 });
      }

      const body = (ctx.body ?? {}) as { deviceId?: string; name?: string };
      const deviceId = body.deviceId ? String(body.deviceId) : undefined;
      const result = createDevice(deviceName(body.name, "This Mac"), deviceId);
      log.info("auth", "local device authenticated", {
        id: result.device.id,
        name: result.device.name,
      });

      return Response.json(
        { token: result.token, device: result.device },
        { headers: { "Set-Cookie": sessionCookie(ctx.request, result.token) } },
      );
    },
    {
      body: t.Object({
        deviceId: t.Optional(t.String()),
        name: t.Optional(t.String()),
      }),
    },
  )

  /** Redeem a six-digit code shown on the server. */
  .post(
    "/pair",
    (ctx) => {
      const remote = remoteAddress(ctx);
      if (!pairingAllowed(remote)) {
        return Response.json(
          { error: "Too many pairing attempts. Wait a minute and try again." },
          { status: 429 },
        );
      }

      const body = (ctx.body ?? {}) as { code?: string; name?: string; deviceId?: string };
      const result = redeemPairingCode(
        String(body.code ?? ""),
        deviceName(body.name, "Paired device"),
        body.deviceId ? String(body.deviceId) : undefined,
      );
      if (!result) {
        return Response.json(
          { error: "That code is invalid or has expired. Generate a new code on the server." },
          { status: 401 },
        );
      }

      return Response.json(
        { token: result.token, device: result.device },
        { headers: { "Set-Cookie": sessionCookie(ctx.request, result.token) } },
      );
    },
    {
      body: t.Object({
        code: t.String({ minLength: 1 }),
        name: t.Optional(t.String()),
        deviceId: t.Optional(t.String()),
      }),
    },
  )

  /** Revoke the calling device and clear its cookie. */
  .post("/logout", ({ request }) => {
    const token = tokenFromRequest(request);
    if (token) revokeByToken(token);
    return Response.json(
      { ok: true },
      { headers: { "Set-Cookie": clearSessionCookie(request) } },
    );
  })

  /** Generate a pairing code (owner on the server machine only). */
  .post(
    "/pairing-code",
    (ctx) => {
      const denied = loopbackDenied(ctx);
      if (denied) return denied;

      const body = (ctx.body ?? {}) as { label?: string };
      const { code, expiresAt } = createPairingCode(deviceName(body.label, "Device"));
      log.info("auth", "pairing code generated", { expiresAt });
      return { code, expiresAt };
    },
    { body: t.Optional(t.Object({ label: t.Optional(t.String()) })) },
  )

  /** Paired devices (owner on the server machine only). */
  .get("/devices", (ctx) => {
    const denied = loopbackDenied(ctx);
    if (denied) return denied;
    return { devices: listDevices() };
  })

  /** Revoke one device (owner on the server machine only). */
  .delete(
    "/devices/:id",
    (ctx) => {
      const denied = loopbackDenied(ctx);
      if (denied) return denied;

      const id = Number(ctx.params.id);
      if (!Number.isInteger(id) || id <= 0) {
        return Response.json({ error: "Invalid device id." }, { status: 400 });
      }
      const ok = revokeDevice(id);
      if (!ok) return Response.json({ error: "Device not found." }, { status: 404 });
      return { ok: true as const };
    },
    { params: t.Object({ id: t.Numeric() }) },
  );
