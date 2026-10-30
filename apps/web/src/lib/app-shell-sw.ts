/// Registers the shared service worker for every client shape.
///
/// The same worker (`public/sw.js`) also backs local artwork prefetch, so it is
/// registered from one URL; a second registration on `/` would replace it.
/// Prefetch only registers it for loopback viewers, which left phones without a
/// worker and therefore without install ability — that is what this adds.
///
/// Media and API traffic is never intercepted (see `sw.js`), and registration
/// is production-only so `bun run dev` never serves a cached shell.
import { PREFETCH_CACHE_NAME } from "./asset-prefetch";

let requested = false;

function workerUrl(): string {
  return `/sw.js?cache=${encodeURIComponent(PREFETCH_CACHE_NAME)}`;
}

export function registerAppShellServiceWorker(): void {
  if (requested) return;
  if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) return;
  // Service workers require a secure context: HTTPS or loopback. Opening the
  // server over plain http://192.168.x.x on a phone cannot register one at all,
  // so that failure is expected and stays silent.
  if (typeof window !== "undefined" && !window.isSecureContext) return;

  // `import.meta.env` is typed as strings here (Bun's ambient types win over
  // Vite's), so read it as the flag Vite sets instead of a boolean.
  let production = false;
  try {
    production = String(import.meta.env?.PROD ?? "").toLowerCase() === "true";
  } catch {
    return;
  }
  if (!production) return;

  requested = true;
  try {
    void navigator.serviceWorker.register(workerUrl(), { scope: "/" }).catch(() => {
      // Browsers without service workers, or a blocked registration, must not
      // affect the viewer: the app still runs online-first without the shell.
    });
  } catch {
    /* unsupported */
  }
}
