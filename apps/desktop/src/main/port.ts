/// Port selection for the bundled backend.
///
/// The desktop app used to pick a random free port on every launch, which broke
/// LAN bookmarks (`http://192.168.x.x:<port>`) and hid the server's address
/// from the owner. Prefer the stable Plexy port and only fall back to a random
/// one when something else already owns it.
import { createServer } from "node:net";

/** Preferred port so LAN bookmarks (`http://<ip>:8765`) survive a relaunch. */
export const PREFERRED_PORT = 8765;

/** True when `port` can be bound on every interface (nothing else owns it). */
function isPortFree(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const srv = createServer();
    srv.unref();
    srv.once("error", () => resolve(false));
    srv.listen(port, "0.0.0.0", () => {
      srv.close(() => resolve(true));
    });
  });
}

/** Pick a random free port on loopback. */
function randomPort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const srv = createServer();
    srv.unref();
    srv.on("error", reject);
    srv.listen(0, "127.0.0.1", () => {
      const address = srv.address();
      if (address && typeof address === "object") {
        const port = address.port;
        srv.close(() => resolve(port));
      } else {
        srv.close(() => resolve(PREFERRED_PORT));
      }
    });
  });
}

/**
 * Prefer the stable Plexy port, then fall back to a random free port when
 * something else already owns it (another instance, or a dev server).
 */
export async function getAvailablePort(preferredPort = PREFERRED_PORT): Promise<number> {
  if (await isPortFree(preferredPort)) return preferredPort;
  return randomPort();
}
