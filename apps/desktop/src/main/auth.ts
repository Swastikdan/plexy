/// The desktop uses the same account login and persistent cookie as every client.
/// It never mints a credential just because it runs on the server computer.
import { app, session } from "electron";
import { rmSync } from "node:fs";
import { join } from "node:path";
export const SESSION_COOKIE = "plexy_session";
export async function ensureDesktopAuth(serverUrl: string): Promise<boolean> {
  for (const name of ["auth-token", "auth-token.bin"]) {
    try {
      rmSync(join(app.getPath("userData"), name), { force: true });
    } catch {
      /* best effort */
    }
  }
  try {
    const base = new URL(serverUrl).origin;
    const cookies = await session.defaultSession.cookies.get({
      url: base,
      name: SESSION_COOKIE,
    });
    const token = cookies[0]?.value;
    if (!token) return false;
    const response = await fetch(`${base}/api/auth/me`, {
      headers: { Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(3000),
    });
    return response.ok;
  } catch {
    return false;
  }
}
