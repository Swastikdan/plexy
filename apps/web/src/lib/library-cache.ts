/// Offline library cache.
///
/// "Offline" here means the internet is down while the Plexy server is still
/// reachable (desktop child process or a server on the LAN). TMDB and remote
/// artwork origins need the internet; browsing, title pages, cast pages and
/// local playback must not.
///
/// Two stores, both client-owned:
/// - IndexedDB (`plexy-library`) keeps catalog records: home, the full item
///   list, title details and person pages.
/// - Cache Storage (managed by `asset-prefetch.ts`) keeps the images those
///   records point at, so ordinary `<img>` tags resolve offline through the
///   service worker.
///
/// A sync is a plain client pull: it calls the same read endpoints the UI uses
/// and performs no server-side work. It never runs while the player is open.
import type { HomePayload, ItemCard, PersonDetail, TitleDetail } from "@plexy/api-client";
import { api } from "../client";
import { cacheAssetUrls } from "./asset-prefetch";

const DB_NAME = "plexy-library";
const DB_VERSION = 1;
const STORE = "records";
const SYNCED_AT_KEY = "plexy.library.synced-at";

/** Detail fetches per sync. Keeps a first sync bounded on huge libraries. */
const DETAIL_LIMIT = 400;
const DETAIL_CONCURRENCY = 4;
const PERSON_LIMIT = 150;

export interface SyncResult {
  ok: boolean;
  reason?: "unsupported" | "offline" | "playing" | "failed";
  titles?: number;
  people?: number;
  assets?: number;
  message?: string;
}

interface CacheRecord<T = unknown> {
  key: string;
  value: T;
  updatedAt: number;
}

// --- database ----------------------------------------------------------------

let dbPromise: Promise<IDBDatabase | null> | null = null;

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
          if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE, { keyPath: "key" });
        } catch {
          /* the cache simply stays empty */
        }
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => resolve(null);
      request.onblocked = () => resolve(null);
    });
  }
  return dbPromise;
}

export async function readCached<T>(key: string): Promise<T | null> {
  const db = await openDb();
  if (!db) return null;
  return await new Promise<T | null>((resolve) => {
    try {
      const request = db.transaction(STORE, "readonly").objectStore(STORE).get(key);
      request.onsuccess = () => resolve(((request.result as CacheRecord<T> | undefined)?.value) ?? null);
      request.onerror = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
}

export async function writeCached<T>(key: string, value: T): Promise<void> {
  const db = await openDb();
  if (!db) return;
  await new Promise<void>((resolve) => {
    try {
      const record: CacheRecord<T> = { key, value, updatedAt: Date.now() };
      const request = db.transaction(STORE, "readwrite").objectStore(STORE).put(record);
      request.onsuccess = () => resolve();
      request.onerror = () => resolve();
    } catch {
      resolve();
    }
  });
}

export async function cachedKeys(): Promise<string[]> {
  const db = await openDb();
  if (!db) return [];
  return await new Promise<string[]>((resolve) => {
    try {
      const request = db.transaction(STORE, "readonly").objectStore(STORE).getAllKeys();
      request.onsuccess = () => resolve((request.result as string[]) ?? []);
      request.onerror = () => resolve([]);
    } catch {
      resolve([]);
    }
  });
}

/** Drop every cached record. Artwork is cleared through the asset cache. */
export async function clearLibraryCache(): Promise<void> {
  const db = await openDb();
  try {
    localStorage.removeItem(SYNCED_AT_KEY);
  } catch {
    /* private mode */
  }
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

export function getLastSyncedAt(): number | null {
  try {
    const raw = localStorage.getItem(SYNCED_AT_KEY);
    const value = raw ? Number(raw) : NaN;
    return Number.isFinite(value) ? value : null;
  } catch {
    return null;
  }
}

function markSynced(): void {
  try {
    localStorage.setItem(SYNCED_AT_KEY, String(Date.now()));
  } catch {
    /* private mode: the next visit syncs again */
  }
}

// --- record keys -------------------------------------------------------------

export const cacheKeys = {
  home: "home",
  allItems: "items:all",
  title: (id: number | string) => `title:${id}`,
  person: (id: number) => `person:${id}`,
};

// --- asset collection --------------------------------------------------------

function addArtwork(urls: Set<string>, ...values: Array<string | null | undefined>): void {
  for (const value of values) if (value) urls.add(value);
}

/** Every image URL a catalog payload renders, in one set. */
function collectItemAssets(items: ItemCard[], urls: Set<string>): void {
  for (const item of items) {
    addArtwork(urls, item.poster, item.backdrop, item.logo, item.still);
  }
}

function collectDetailAssets(detail: TitleDetail, urls: Set<string>): Set<number> {
  collectItemAssets([detail.item], urls);
  addArtwork(urls, detail.logo);
  for (const season of detail.seasons ?? []) addArtwork(urls, season.poster);
  const episodes = detail.episodes ?? [];
  collectItemAssets(episodes, urls);
  const people = new Set<number>();
  for (const member of detail.cast) {
    addArtwork(urls, member.photo);
    if (member.id) people.add(member.id);
  }
  return people;
}

/**
 * Cache the images a title detail renders. Called whenever a title page loads,
 * so a freshly matched title becomes offline-ready without a full resync.
 */
export function cacheTitleArtwork(detail: TitleDetail): void {
  const urls = new Set<string>();
  collectDetailAssets(detail, urls);
  cacheAssetUrls([...urls]);
}

/** Cache a person photo and the posters of their locally available titles. */
export function cachePersonArtwork(detail: PersonDetail): void {
  const urls = new Set<string>();
  addArtwork(urls, detail.person.photo);
  collectItemAssets(detail.items, urls);
  cacheAssetUrls([...urls]);
}

// --- sync --------------------------------------------------------------------

let syncing: Promise<SyncResult> | null = null;

/** Run the pull now, or join the sync already in flight. */
export function syncLibrary(): Promise<SyncResult> {
  if (syncing) return syncing;
  syncing = runSync().finally(() => {
    syncing = null;
  });
  return syncing;
}

function playing(): boolean {
  if (typeof window === "undefined") return false;
  return window.location.pathname.startsWith("/watch/");
}

async function runSync(): Promise<SyncResult> {
  if (typeof window === "undefined" || typeof indexedDB === "undefined") {
    return { ok: false, reason: "unsupported" };
  }
  // Nothing in the cache pipeline may compete with playback.
  if (playing()) return { ok: false, reason: "playing" };
  if (navigator.onLine === false) return { ok: false, reason: "offline" };

  const urls = new Set<string>();
  const people = new Set<number>();
  let titles = 0;

  try {
    const home = await api.home();
    await writeCached<HomePayload>(cacheKeys.home, home);
    if (home.featured) collectItemAssets([home.featured], urls);
    for (const row of home.rows) collectItemAssets(row.items, urls);

    // One flat list backs the library grids and search offline.
    const all = await api.items({ limit: 2000 });
    await writeCached(cacheKeys.allItems, all);
    collectItemAssets(all.items, urls);

    const targets = all.items
      .filter((item) => item.kind === "movie" || item.kind === "series" || item.kind === "episode")
      .slice(0, DETAIL_LIMIT);

    await mapWithConcurrency(targets, DETAIL_CONCURRENCY, async (item) => {
      if (playing()) return;
      const key = item.publicId || String(item.id);
      try {
        const detail = await api.title(key);
        await writeCached(cacheKeys.title(key), detail);
        if (String(item.id) !== key) await writeCached(cacheKeys.title(item.id), detail);
        for (const id of collectDetailAssets(detail, urls)) people.add(id);
        titles += 1;
      } catch {
        /* a single missing title must not abort the pull */
      }
    });

    let cachedPeople = 0;
    for (const personId of [...people].slice(0, PERSON_LIMIT)) {
      if (playing()) break;
      try {
        const detail = await api.person(personId);
        await writeCached(cacheKeys.person(personId), detail);
        addArtwork(urls, detail.person.photo);
        collectItemAssets(detail.items, urls);
        cachedPeople += 1;
      } catch {
        /* person pages that fail are simply not offline-ready yet */
      }
    }

    cacheAssetUrls([...urls]);
    markSynced();
    return { ok: true, titles, people: cachedPeople, assets: urls.size };
  } catch (error) {
    return {
      ok: false,
      reason: "failed",
      message: error instanceof Error ? error.message : String(error),
    };
  }
}

async function mapWithConcurrency<T>(
  items: T[],
  limit: number,
  worker: (item: T) => Promise<void>,
): Promise<void> {
  let index = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (index < items.length) {
      const next = items[index]!;
      index += 1;
      await worker(next);
    }
  });
  await Promise.all(workers);
}

// --- offline reads -----------------------------------------------------------

/** Filter and sort the cached catalog for an offline library grid. */
export function filterCachedItems(
  items: ItemCard[],
  query: { kind?: "movie" | "series"; libraryId?: number; sort?: string; unwatched?: boolean; q?: string },
): ItemCard[] {
  let result = items;
  if (query.kind) result = result.filter((item) => item.kind === query.kind);
  if (query.unwatched) result = result.filter((item) => !item.watch?.played);
  const text = query.q?.trim().toLowerCase();
  if (text) result = result.filter((item) => item.name.toLowerCase().includes(text));

  const sort = query.sort ?? "name";
  const sorted = [...result];
  if (sort === "year") sorted.sort((a, b) => (b.year ?? 0) - (a.year ?? 0));
  else if (sort === "rating") sorted.sort((a, b) => (b.rating ?? 0) - (a.rating ?? 0));
  else if (sort === "name") sorted.sort((a, b) => a.name.localeCompare(b.name));
  // "added" keeps the server's cached order.
  return sorted;
}

/** Offline search over the cached catalog. */
export function searchCachedItems(
  items: ItemCard[],
  text: string,
): { titles: ItemCard[]; episodes: ItemCard[] } {
  const needle = text.trim().toLowerCase();
  if (!needle) return { titles: [], episodes: [] };
  const matches = items.filter((item) =>
    item.name.toLowerCase().includes(needle) ||
    (item.parentTitle ?? "").toLowerCase().includes(needle),
  );
  return {
    titles: matches.filter((item) => item.kind !== "episode"),
    episodes: matches.filter((item) => item.kind === "episode"),
  };
}
