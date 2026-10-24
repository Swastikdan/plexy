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
 * Return a 403 Response when the caller is not on the host, else null.
 * Handlers: `const denied = denyIfNotLocal(ctx); if (denied) return denied;`
 */
export function denyIfNotLocal(
  ctx: LoopbackContext,
  what: string,
): Response | null {
  if (isLoopbackContext(ctx)) return null;
  return Response.json(
    { error: "This area is only available on the computer running Plexy." },
    { status: 403 },
  );
}
