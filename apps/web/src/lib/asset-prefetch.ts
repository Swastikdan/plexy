/// Bounded, local-only prefetch of artwork and trickplay sprites the server
/// already serves.
///
/// This module is the only writer of Plexy's managed Cache Storage bucket; the
/// read-through service worker (`public/sw.js`) lets ordinary `<img>` elements
/// consume those entries. Nothing here calls a preparation or generation
/// endpoint: only URLs that catalog/title/play data already returned, or cue
/// URLs parsed from an existing trickplay VTT, are ever fetched. Speculative
/// work is best-effort — every failure is swallowed so browsing and playback
/// never depend on it.
import { isLocalPage } from "../auth";
import { getApiBase, isElectron } from "../server-config";

/** Plexy-owned cache names. Any other version is stale and reclaimed. */
const CACHE_PREFIX = "plexy-prefetch-";
const CACHE_VERSION = 1;
export const PREFETCH_CACHE_NAME = `${CACHE_PREFIX}v${CACHE_VERSION}`;

const DB_NAME = "plexy-prefetch";
const DB_VERSION = 1;
const STORE = "assets";
const META_VERSION = 1;
const RECONCILED_KEY = "plexy.prefetch.reconciled-at";

/** Managed path prefixes. Playback streams, subtitles and pages are excluded. */
const ASSET_PATH_PREFIXES = ["/api/images/", "/api/trickplay/"];

export interface PrefetchRuntime {
  enabled: boolean;
  maxConcurrent: number;
  maxCacheMb: number;
  onHover: boolean;
  onScroll: boolean;
  nextCount: number;
}

export const PREFETCH_DEFAULTS: PrefetchRuntime = {
  enabled: false,
  maxConcurrent: 3,
  maxCacheMb: 50,
  onHover: true,
  onScroll: true,
  nextCount: 5,
};

export interface PrefetchStats {
  supported: boolean;
  count: number;
  bytes: number;
  budgetBytes: number;
  lastReconciledAt: number | null;
}

interface AssetMeta {
  url: string;
  bytes: number;
  lastAccess: number;
  version: number;
}

// --- locality and runtime ----------------------------------------------------

/** Electron, or a page served from the machine running the server. */
export function localPrefetchContext(): boolean {
  if (typeof window === "undefined") return false;
  return isElectron() || isLocalPage();
}

let runtime: PrefetchRuntime | null = null;

/** The last settings snapshot the app pushed in; `null` means "do nothing". */
export function getPrefetchRuntime(): PrefetchRuntime | null {
  return runtime;
}

/**
 * Prefetching only makes sense when the read-through worker can hand cached
 * entries to normal image requests; without it this would be wasted traffic.
 */
function managedCacheAvailable(): boolean {
  if (workerBlocked || !cacheStorage()) return false;
  return typeof navigator !== "undefined" && "serviceWorker" in navigator;
}

/** Aggressive work runs only for a local viewer with the preference enabled. */
export function isPrefetchActive(): boolean {
  if (!runtime?.enabled) return false;
  if (!localPrefetchContext()) return false;
  if (!managedCacheAvailable()) return false;
  return isOnline();
}

export function setPrefetchRuntime(next: PrefetchRuntime | null): void {
  const previous = runtime;
  runtime = next;
  ensureListeners();
  if (!next?.enabled || !localPrefetchContext()) {
    cancelPending();
    return;
  }
  if (previous?.maxConcurrent !== next.maxConcurrent) pump();
  // Apply a reduced budget promptly instead of waiting for the next insert.
  void evictToBudget();
}

function isOnline(): boolean {
  if (typeof navigator === "undefined") return true;
  return navigator.onLine !== false;
}

let listening = false;
function ensureListeners(): void {
  if (listening || typeof window === "undefined") return;
  listening = true;
  window.addEventListener("offline", () => cancelPending());
  window.addEventListener("online", () => pump());
}

// --- URL policy --------------------------------------------------------------

function apiOrigin(): string {
  try {
    return new URL(getApiBase()).origin;
  } catch {
    return typeof window !== "undefined" ? window.location.origin : "http://127.0.0.1";
  }
}

/**
 * Accept only same-origin Plexy artwork / trickplay URLs. Fragments (`#xywh=`)
 * are cache-key noise and are stripped; `?v=` query strings are preserved so a
 * regenerated trickplay sheet never resolves to a stale entry. The service
 * worker can only serve same-origin requests, so anything on another origin
 * (a LAN server behind a loopback page, `data:` URLs, credentials in the URL,
 * external artwork, playback streams) is rejected rather than cached.
 */
export function normalizeAssetUrl(
  raw: string | null | undefined,
  options: { allowTrack?: boolean } = {},
): string | null {
  if (typeof window === "undefined" || !raw) return null;
  const value = raw.trim();
  if (!value || /^(data|blob|javascript|filesystem):/i.test(value)) return null;
  let url: URL;
  try {
    url = new URL(value, apiOrigin());
  } catch {
    return null;
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return null;
  if (url.username || url.password) return null;
  if (url.origin !== window.location.origin) return null;
  if (!ASSET_PATH_PREFIXES.some((prefix) => url.pathname.startsWith(prefix))) return null;
  // Trickplay VTT is `no-cache` and changes from empty to populated; never store it.
  if (!options.allowTrack && url.pathname.endsWith("/track.vtt")) return null;
  url.hash = "";
  return url.toString();
}

// --- metadata index (IndexedDB, with an in-memory fallback) ------------------

let dbPromise: Promise<IDBDatabase | null> | null = null;
let memoryIndex: Map<string, AssetMeta> | null = null;
let lastReconciledAt: number | null = readReconciledAt();

function memory(): Map<string, AssetMeta> {
  if (!memoryIndex) memoryIndex = new Map();
  return memoryIndex;
}

function openDb(): Promise<IDBDatabase | null> {
  if (typeof indexedDB === "undefined") return Promise.resolve(null);
  if (!dbPromise) {
    dbPromise = new Promise((resolve) => {
      let request: IDBOpenDBRequest;
      try {
        request = indexedDB.open(DB_NAME, DB_VERSION);
      } catch {
        resolve(null);
        return;
      }
      request.onupgradeneeded = () => {
        try {
          const db = request.result;
          if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE, { keyPath: "url" });
        } catch {
          /* schema unavailable: the memory fallback still tracks the budget */
        }
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => resolve(null);
      request.onblocked = () => resolve(null);
    });
  }
  return dbPromise;
}

async function readAllMeta(): Promise<AssetMeta[]> {
  const db = await openDb();
  if (!db) return [...memory().values()];
  return await new Promise<AssetMeta[]>((resolve) => {
    try {
      const request = db.transaction(STORE, "readonly").objectStore(STORE).getAll();
      request.onsuccess = () => resolve((request.result as AssetMeta[]) ?? []);
      request.onerror = () => resolve([...memory().values()]);
    } catch {
      resolve([...memory().values()]);
    }
  });
}

async function readMeta(url: string): Promise<AssetMeta | null> {
  const db = await openDb();
  if (!db) return memory().get(url) ?? null;
  return await new Promise<AssetMeta | null>((resolve) => {
    try {
      const request = db.transaction(STORE, "readonly").objectStore(STORE).get(url);
      request.onsuccess = () => resolve((request.result as AssetMeta) ?? null);
      request.onerror = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
}

async function writeMeta(meta: AssetMeta): Promise<void> {
  const db = await openDb();
  if (!db) {
    memory().set(meta.url, meta);
    return;
  }
  await new Promise<void>((resolve) => {
    try {
      const request = db.transaction(STORE, "readwrite").objectStore(STORE).put(meta);
      request.onsuccess = () => resolve();
      request.onerror = () => {
        memory().set(meta.url, meta);
        resolve();
      };
    } catch {
      memory().set(meta.url, meta);
      resolve();
    }
  });
}

async function removeMeta(url: string): Promise<void> {
  const db = await openDb();
  if (!db) {
    memory().delete(url);
    return;
  }
  await new Promise<void>((resolve) => {
    try {
      const request = db.transaction(STORE, "readwrite").objectStore(STORE).delete(url);
      request.onsuccess = () => resolve();
      request.onerror = () => resolve();
    } catch {
      resolve();
    }
  });
}

async function clearMeta(): Promise<void> {
  memory().clear();
  const db = await openDb();
  if (!db) return;
  await new Promise<void>((resolve) => {
    try {
      const request = db.transaction(STORE, "readwrite").objectStore(STORE).clear();
      request.onsuccess = () => resolve();
      request.onerror = () => resolve();
    } catch {
      resolve();
    }
  });
}

function readReconciledAt(): number | null {
  try {
    const raw = typeof localStorage === "undefined" ? null : localStorage.getItem(RECONCILED_KEY);
    const value = raw ? Number(raw) : NaN;
    return Number.isFinite(value) ? value : null;
  } catch {
    return null;
  }
}

function writeReconciledAt(value: number): void {
  lastReconciledAt = value;
  try {
    localStorage.setItem(RECONCILED_KEY, String(value));
  } catch {
    /* private mode: the in-memory value still reports for this session */
  }
}

// --- cache helpers -----------------------------------------------------------

function cacheStorage(): CacheStorage | null {
  try {
    return typeof caches === "undefined" ? null : caches;
  } catch {
    return null;
  }
}

function budgetBytes(): number {
  const mb = runtime?.maxCacheMb ?? PREFETCH_DEFAULTS.maxCacheMb;
  return Math.max(1, mb) * 1024 * 1024;
}

async function measure(response: Response): Promise<number> {
  const declared = Number(response.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > 0) return declared;
  try {
    return (await response.clone().blob()).size;
  } catch {
    return 0;
  }
}

async function removeEntry(url: string): Promise<void> {
  const storage = cacheStorage();
  if (storage) {
    try {
      const cache = await storage.open(PREFETCH_CACHE_NAME);
      await cache.delete(url);
    } catch {
      /* the entry may already be gone */
    }
  }
  await removeMeta(url);
}

/** Drop least-recently-used entries until the estimate fits the budget. */
async function evictToBudget(): Promise<void> {
  const metas = await readAllMeta();
  let total = metas.reduce((sum, meta) => sum + meta.bytes, 0);
  if (total <= budgetBytes()) return;
  for (const meta of metas.sort((a, b) => a.lastAccess - b.lastAccess)) {
    if (total <= budgetBytes()) break;
    await removeEntry(meta.url);
    total -= meta.bytes;
  }
}

// --- queue -------------------------------------------------------------------

const pending: string[] = [];
const pendingUrls = new Set<string>();
const inFlight = new Map<string, AbortController>();
// Bumped when the user clears the cache or prefetch is turned off, so a fetch
// that completed just before cannot resurrect an entry afterwards.
let generation = 0;

function activeLimit(): number {
  return Math.max(1, runtime?.maxConcurrent ?? PREFETCH_DEFAULTS.maxConcurrent);
}

function cancelPending(): void {
  generation += 1;
  pending.length = 0;
  pendingUrls.clear();
  for (const controller of inFlight.values()) controller.abort();
  inFlight.clear();
}

function pump(): void {
  if (!isPrefetchActive()) {
    cancelPending();
    return;
  }
  const limit = activeLimit();
  while (inFlight.size < limit && pending.length > 0) {
    const url = pending.shift()!;
    pendingUrls.delete(url);
    const controller = new AbortController();
    inFlight.set(url, controller);
    void storeAsset(url, controller).finally(() => {
      inFlight.delete(url);
      pump();
    });
  }
}

async function storeAsset(url: string, controller: AbortController): Promise<void> {
  const storage = cacheStorage();
  if (!storage) return;
  const startedIn = generation;
  try {
    const response = await fetch(url, {
      credentials: "include",
      // Artwork responses are immutable; the header set by the server decides
      // freshness, while `no-cache` keeps a stale intermediate copy out of it.
      cache: "no-cache",
      signal: controller.signal,
    });
    // A redirect means the server handed us a remote (uncached) artwork
    // original; that is outside the managed artwork cache's contract.
    if (!response.ok || response.redirected || !/^image\//i.test(response.headers.get("content-type") ?? "")) {
      await response.body?.cancel().catch(() => {});
      return;
    }
    const bytes = await measure(response);
    // Opaque or unmeasurable responses cannot be bounded against the budget.
    if (bytes <= 0 || bytes > budgetBytes()) {
      await response.body?.cancel().catch(() => {});
      return;
    }
    if (!isPrefetchActive() || startedIn !== generation) {
      await response.body?.cancel().catch(() => {});
      return;
    }
    await evictToBudget();
    const cache = await storage.open(PREFETCH_CACHE_NAME);
    await cache.put(url, response);
    if (startedIn !== generation) {
      await cache.delete(url).catch(() => {});
      return;
    }
    await writeMeta({ url, bytes, lastAccess: Date.now(), version: META_VERSION });
    await evictToBudget();
  } catch {
    /* offline, aborted, quota exceeded or storage disabled: fine */
  }
}

async function enqueue(rawUrl: string): Promise<void> {
  const url = normalizeAssetUrl(rawUrl);
  if (!url || !isPrefetchActive()) return;
  if (inFlight.has(url) || pendingUrls.has(url)) return;
  const storage = cacheStorage();
  if (!storage) return;
  try {
    const cache = await storage.open(PREFETCH_CACHE_NAME);
    const hit = await cache.match(url);
    if (hit) {
      const meta = await readMeta(url);
      if (meta) await writeMeta({ ...meta, lastAccess: Date.now() });
      return;
    }
  } catch {
    return;
  }
  // The queue may have filled while the cache lookup was in flight.
  if (!isPrefetchActive() || inFlight.has(url) || pendingUrls.has(url)) return;
  pendingUrls.add(url);
  pending.push(url);
  pump();
}

/** Queue known asset URLs. Unknown, external and excluded URLs are ignored. */
export function prefetchAssets(urls: ReadonlyArray<string | null | undefined>): void {
  if (!isPrefetchActive()) return;
  for (const raw of urls) {
    if (raw) void enqueue(raw);
  }
}

// --- trickplay ---------------------------------------------------------------

const trackInFlight = new Set<string>();

/** Cue payload lines from an existing WebVTT track, deduplicated and cleaned. */
export function parseTrickplaySpriteUrls(vtt: string): string[] {
  const urls = new Set<string>();
  for (const line of vtt.split(/\r?\n/)) {
    const value = line.trim();
    if (!value || value === "WEBVTT" || value.startsWith("NOTE") || value.includes("-->")) continue;
    const url = normalizeAssetUrl(value);
    if (url) urls.add(url);
  }
  return [...urls];
}

/**
 * Fetch an existing trickplay track and prefetch the sprite sheets its cues
 * point at. Reading the VTT never starts extraction, and a missing or empty
 * track is simply skipped.
 */
export function prefetchTrickplayTrack(trackUrl: string | null | undefined): void {
  const url = normalizeAssetUrl(trackUrl, { allowTrack: true });
  if (!url || !isPrefetchActive() || trackInFlight.has(url)) return;
  trackInFlight.add(url);
  void (async () => {
    try {
      const response = await fetch(url, { credentials: "include", cache: "no-cache" });
      if (!response.ok) return;
      prefetchAssets(parseTrickplaySpriteUrls(await response.text()));
    } catch {
      /* no track generated yet, offline, or not a trickplay file */
    } finally {
      trackInFlight.delete(url);
    }
  })();
}

// --- stats, reconcile, clear -------------------------------------------------

export async function getPrefetchStats(): Promise<PrefetchStats> {
  const metas = await readAllMeta();
  return {
    supported: localPrefetchContext() && managedCacheAvailable(),
    count: metas.length,
    bytes: metas.reduce((sum, meta) => sum + meta.bytes, 0),
    budgetBytes: budgetBytes(),
    lastReconciledAt,
  };
}

/**
 * Remove stale Plexy-owned cache versions and reconcile the metadata index with
 * the entries that actually exist. Browser-managed eviction can remove entries
 * behind our back, so the reported total is an estimate of what is indexed.
 */
export async function reconcilePrefetchCache(): Promise<void> {
  const storage = cacheStorage();
  if (!storage) return;
  try {
    for (const name of await storage.keys()) {
      if (name.startsWith(CACHE_PREFIX) && name !== PREFETCH_CACHE_NAME) await storage.delete(name);
    }
    const cache = await storage.open(PREFETCH_CACHE_NAME);
    const live = new Set((await cache.keys()).map((request) => request.url));
    const metas = await readAllMeta();
    const indexed = new Set(metas.map((meta) => meta.url));
    for (const meta of metas) {
      if (!live.has(meta.url)) await removeMeta(meta.url);
    }
    // Adopt entries whose index write was interrupted so the budget still
    // accounts for them.
    for (const url of live) {
      if (indexed.has(url)) continue;
      const response = await cache.match(url);
      if (!response) continue;
      const bytes = await measure(response);
      if (bytes > 0) await writeMeta({ url, bytes, lastAccess: Date.now(), version: META_VERSION });
    }
    writeReconciledAt(Date.now());
    // Once a settings snapshot exists, make adopted entries respect its budget.
    if (runtime) await evictToBudget();
  } catch {
    /* Cache Storage unavailable or disabled: nothing to reconcile */
  }
}

/** Clear only Plexy's managed prefetch entries and metadata. */
export async function clearPrefetchCache(): Promise<{ removed: number; bytes: number }> {
  const metas = await readAllMeta();
  const storage = cacheStorage();
  if (storage) {
    try {
      for (const name of await storage.keys()) {
        if (name.startsWith(CACHE_PREFIX)) await storage.delete(name);
      }
    } catch {
      /* nothing cached yet */
    }
  }
  cancelPending();
  await clearMeta();
  return {
    removed: metas.length,
    bytes: metas.reduce((sum, meta) => sum + meta.bytes, 0),
  };
}

// --- service worker ----------------------------------------------------------

let workerRequested = false;
let workerBlocked = false;

/**
 * Register the read-through worker so normal `<img>` requests are served from
 * the managed cache. Only local viewers register it, and only when Cache
 * Storage exists; without it prefetching still works but the UI cannot consume
 * the cache, so nothing is queued in that case.
 */
export function registerPrefetchServiceWorker(): void {
  if (workerRequested) return;
  if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) return;
  if (!localPrefetchContext() || !cacheStorage() || workerBlocked) return;
  workerRequested = true;
  const cache = encodeURIComponent(PREFETCH_CACHE_NAME);
  try {
    void navigator.serviceWorker
      .register(`/sw.js?cache=${cache}`, { scope: "/" })
      .then(() => {
        workerBlocked = false;
      })
      .catch(() => {
        // A blocked worker must not break the viewer, and prefetch would only
        // spend bandwidth that the UI can never read back.
        workerBlocked = true;
        workerRequested = false;
        cancelPending();
      });
  } catch {
    workerBlocked = true;
    workerRequested = false;
  }
}
