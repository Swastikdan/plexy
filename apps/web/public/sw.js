/// Read-through cache for the artwork and trickplay sprites the app prefetched.
///
/// Cache Storage is not an HTTP interception layer: without this worker a
/// normal `<img src>` never reads what `src/lib/asset-prefetch.ts` stored. The
/// worker therefore handles only same-origin GETs for `/api/images/` and
/// `/api/trickplay/`, serves a managed hit, and otherwise defers to the
/// network. The page owns writes, the LRU index and the budget, so nothing is
/// stored here — that keeps item counts and the size estimate honest.
///
/// Trickplay `track.vtt` is deliberately excluded (the server marks it
/// `no-cache` and its body changes once extraction finishes), and errors are
/// never returned from the cache.
const params = new URL(self.location.href).searchParams;
const CACHE_NAME = params.get("cache") || "plexy-prefetch-v1";
const MANAGED_PATH = /^\/api\/(?:images|trickplay)\//;
const TRACK_PATH = /\/track\.vtt$/;

self.addEventListener("install", () => {
  // Take over without waiting for every tab to close.
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
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
  if (!MANAGED_PATH.test(url.pathname) || TRACK_PATH.test(url.pathname)) return;

  event.respondWith(serve(request));
});

async function serve(request) {
  try {
    const cache = await caches.open(CACHE_NAME);
    const hit = await cache.match(request, { ignoreVary: true });
    if (hit) return hit;
  } catch {
    // Cache Storage disabled: fall through to the network.
  }
  return fetch(request);
}
