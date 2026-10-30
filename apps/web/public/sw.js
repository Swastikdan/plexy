/// Plexy service worker: installable app shell plus read-through artwork cache.
///
/// Two jobs in one worker, because a second registration on the same scope
/// would replace this one:
///
/// 1. **App shell** (`plexy-shell-v1`). Navigations are network-first, so a
///    running server always wins and a redeploy is picked up on the next load;
///    the last good shell is kept only as an offline fallback. Vite's hashed
///    build output and the static identity assets are stale-while-revalidate.
/// 2. **Artwork** (`cache` query parameter). Cache Storage is not an HTTP
///    interception layer: without this worker a normal `<img src>` never reads
///    what `src/lib/asset-prefetch.ts` stored. The page owns those writes, the
///    LRU index and the size budget, so nothing is stored here.
///
/// Deliberately not intercepted: everything else under `/api/` (status, play
/// manifests, media, HLS segments, scans, event streams) stays online-first, so
/// range requests reach the server untouched. Trickplay `track.vtt` is excluded
/// too, because the server marks it `no-cache` and its body changes once
/// extraction finishes.
const params = new URL(self.location.href).searchParams;
const PREFETCH_CACHE = params.get("cache") || "plexy-prefetch-v1";
const SHELL_CACHE = "plexy-shell-v1";
const SHELL_URL = "/";
const MANAGED_PATH = /^\/api\/(?:images|trickplay|people)\//;
const TRACK_PATH = /\/track\.vtt$/;
const STATIC_PATH = /^\/(?:assets|icons)\//;
const STATIC_FILE =
  /^\/(?:index\.html|manifest\.webmanifest|favicon\.svg|icon\.svg|client-icon\.svg|apple-touch-icon\.png)$/;

self.addEventListener("install", () => {
  // Take over without waiting for every tab to close. Nothing is precached:
  // the first navigation fills the shell cache, and an install that cannot
  // reach the server still completes.
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      try {
        const storage = await caches.keys();
        await Promise.all(
          storage
            .filter((name) => name.startsWith("plexy-shell-") && name !== SHELL_CACHE)
            .map((name) => caches.delete(name)),
        );
      } catch {
        /* Cache Storage disabled */
      }
      await self.clients.claim();
    })(),
  );
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;

  let url;
  try {
    url = new URL(request.url);
  } catch {
    return;
  }
  if (url.origin !== self.location.origin) return;

  // SPA navigations: the server's HTML when online, the last shell when not.
  if (request.mode === "navigate") {
    event.respondWith(navigate(request));
    return;
  }

  if (url.pathname.startsWith("/api/")) {
    if (!MANAGED_PATH.test(url.pathname) || TRACK_PATH.test(url.pathname)) return;
    event.respondWith(readThroughArtwork(request));
    return;
  }

  if (STATIC_PATH.test(url.pathname) || STATIC_FILE.test(url.pathname)) {
    event.respondWith(staleWhileRevalidate(request));
  }
});

async function navigate(request) {
  try {
    const response = await fetch(request);
    const type = response.headers.get("content-type") || "";
    if (response.ok && type.includes("text/html")) {
      void rememberShell(response.clone());
    }
    return response;
  } catch {
    const cached = await matchShell(request);
    if (cached) return cached;
    return new Response(offlineDocument(), {
      status: 503,
      headers: { "Content-Type": "text/html; charset=utf-8" },
    });
  }
}

/// Every route is rendered by the same SPA shell, so one entry serves all of
/// them; the request URL is tried as well for servers that rewrite routes.
async function matchShell(request) {
  try {
    const cache = await caches.open(SHELL_CACHE);
    return (await cache.match(SHELL_URL)) || (await cache.match(request));
  } catch {
    return undefined;
  }
}

async function rememberShell(response) {
  try {
    const cache = await caches.open(SHELL_CACHE);
    await cache.put(SHELL_URL, response);
  } catch {
    /* quota or storage disabled */
  }
}

async function staleWhileRevalidate(request) {
  let cache;
  try {
    cache = await caches.open(SHELL_CACHE);
  } catch {
    return fetch(request);
  }

  const hit = await cache.match(request, { ignoreVary: true });
  const network = fetch(request)
    .then((response) => {
      if (response.ok) {
        void cache.put(request, response.clone()).catch(() => {});
      }
      return response;
    })
    .catch(() => null);

  if (hit) return hit;
  const response = await network;
  return response || new Response("", { status: 504 });
}

async function readThroughArtwork(request) {
  try {
    const cache = await caches.open(PREFETCH_CACHE);
    const hit = await cache.match(request, { ignoreVary: true });
    if (hit) return hit;
  } catch {
    // Cache Storage disabled: fall through to the network.
  }
  return fetch(request);
}

/// Shown only when the shell was never cached and the server is unreachable.
function offlineDocument() {
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
<title>Plexy · Offline</title>
<style>
  html,body{margin:0;background:#080808;color:#f5f5f7;font:15px/1.6 -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}
  main{min-height:100dvh;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:.75rem;padding:2rem;text-align:center}
  h1{margin:0;font-size:1.05rem;font-weight:600}
  p{margin:0;max-width:22rem;color:#8b8b93;font-size:.85rem}
</style></head>
<body><main>
  <h1>Cannot reach your Plexy server</h1>
  <p>Plexy Client streams from a server on your network. Reconnect to the
  network, then reload once the server is running.</p>
</main></body></html>`;
}
