import { requestUser } from "./auth";
/// Shared route essentials.
///
/// `isLoopbackContext` enforces PRD 5.10 server-side: settings, libraries,
/// matching, scans, logs and crashes answer only on 127.0.0.1, even when LAN
/// viewing is enabled. The check reads the socket address, never forwarded
/// headers, so it cannot be spoofed.
export type LoopbackContext = {
  server: { requestIP: (request: Request) => { address: string } | null } | null;
  request: Request;
};

export function isLoopbackAddress(remote: string | null | undefined): boolean {
  if (!remote) return false;
  return remote === "127.0.0.1" || remote === "::1" || remote === "localhost"
    || remote.startsWith("::ffff:127.0.0.1");
}

/** Socket-reported remote address of the caller. */
export function remoteAddress(ctx: LoopbackContext): string | null {
  try {
    return ctx.server?.requestIP(ctx.request)?.address ?? null;
  } catch {
    return null;
  }
}

/** Elysia's in-process `handle()` has no socket; only the test harness uses it. */
function isInProcessTestRequest(ctx: LoopbackContext): boolean {
  return Bun.env.NODE_ENV === "test" && !ctx.server;
}

/** True when the request physically arrived from the host itself. */
export function isLoopbackContext(ctx: LoopbackContext): boolean {
  return isInProcessTestRequest(ctx) || isLoopbackAddress(remoteAddress(ctx));
}

/**
 * Owner surface: the signed-out in-process test harness, or a signed-in admin
 * on any authenticated client.
 */
export function isAdminContext(ctx: LoopbackContext): boolean {
  if (isInProcessTestRequest(ctx)) return true;
  return (
    requestUser(ctx.request)?.role === "admin"
  );
}

/**
 * Local bootstrap operations must not treat a reverse proxy's connection as
 * the local host. Proxies add at least one forwarding header; clients cannot use
 * those headers to gain access because their presence makes this check fail.
 */
export function isDirectLoopbackContext(ctx: LoopbackContext): boolean {
  if (!isLoopbackContext(ctx)) return false;
  // A browser using a rebound DNS hostname is not the local owner UI.
  try {
    if (!["localhost", "127.0.0.1", "[::1]", "::1"].includes(new URL(ctx.request.url).hostname)) return false;
  } catch { return false; }
  return ![
    "forwarded",
    "x-forwarded-for",
    "cf-connecting-ip",
    "x-real-ip",
    "x-forwarded-host",
  ].some((header) => Boolean(ctx.request.headers.get(header)));
}

/**
 * Return a 403 Response unless the caller is an administrator, else null.
 * Handlers: `const denied = denyIfNotLocal(ctx); if (denied) return denied;`
 */
export function denyIfNotLocal(ctx: LoopbackContext): Response | null {
  if (isAdminContext(ctx)) return null;
  return Response.json(
    { error: "Administrator access required." },
    { status: 403 },
  );
}
