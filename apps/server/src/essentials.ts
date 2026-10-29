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

/** True when the request physically arrived from the host itself. */
export function isLoopbackContext(ctx: LoopbackContext): boolean {
  if (Bun.env.NODE_ENV === "test" && !ctx.server) return true;
  return isLoopbackAddress(remoteAddress(ctx));
}

/**
 * Owner-only operations must not treat a reverse proxy's local connection as
 * the owner. Proxies add at least one forwarding header; clients cannot use
 * those headers to gain access because their presence makes this check fail.
 */
export function isDirectLoopbackContext(ctx: LoopbackContext): boolean {
  if (!isLoopbackContext(ctx)) return false;
  return ![
    "forwarded",
    "x-forwarded-for",
    "cf-connecting-ip",
    "x-real-ip",
    "x-forwarded-host",
  ].some((header) => Boolean(ctx.request.headers.get(header)));
}

/**
 * Return a 403 Response when the caller is not on the host, else null.
 * Handlers: `const denied = denyIfNotLocal(ctx); if (denied) return denied;`
 */
export function denyIfNotLocal(
  ctx: LoopbackContext,
  what: string,
): Response | null {
  if (isDirectLoopbackContext(ctx)) return null;
  return Response.json(
    { error: "This area is only available on the computer running Plexy." },
    { status: 403 },
  );
}
