import * as FS from "expo-file-system/legacy";

const CACHE_DIR = `${FS.documentDirectory || FS.cacheDirectory || ""}image_cache/`;
let initialized = false;
const inMemoryCache = new Map<string, string>();
const activeDownloads = new Map<string, Promise<string | null>>();

function uriToFilename(uri: string): string {
  let hash = 0;
  for (let i = 0; i < uri.length; i++) {
    hash = (hash << 5) - hash + uri.charCodeAt(i);
    hash |= 0;
  }
  const clean = uri.replace(/[^a-zA-Z0-9]/g, "_").slice(-32);
  return `cached_${Math.abs(hash)}_${clean}.jpg`;
}

export async function ensureImageCacheDir(): Promise<void> {
  if (initialized) return;
  try {
    const info = await FS.getInfoAsync(CACHE_DIR);
    if (!info.exists) {
      await FS.makeDirectoryAsync(CACHE_DIR, { intermediates: true });
    }
    initialized = true;
  } catch {
    // Non-fatal if device file-system is temporarily locked
  }
}

export function getCachedImageSync(uri?: string | null): string | null {
  if (!uri) return null;
  if (uri.startsWith("file://")) return uri;
  return inMemoryCache.get(uri) || null;
}

export async function resolveCachedImage(
  uri: string,
  headers?: Record<string, string>,
): Promise<string> {
  if (!uri || uri.startsWith("file://")) return uri;

  const existingMem = inMemoryCache.get(uri);
  if (existingMem) return existingMem;

  await ensureImageCacheDir();
  const filename = uriToFilename(uri);
  const localFile = `${CACHE_DIR}${filename}`;

  try {
    const info = await FS.getInfoAsync(localFile);
    if (info.exists && info.size && info.size > 0) {
      inMemoryCache.set(uri, localFile);
      return localFile;
    }
  } catch {}

  // Download in background if it is a remote HTTP/HTTPS URL
  if (uri.startsWith("http://") || uri.startsWith("https://")) {
    if (!activeDownloads.has(uri)) {
      const task = FS.downloadAsync(uri, localFile, { headers })
        .then((res) => {
          if (res.status === 200) {
            inMemoryCache.set(uri, localFile);
            return localFile;
          }
          return null;
        })
        .catch(() => null)
        .finally(() => {
          activeDownloads.delete(uri);
        });
      activeDownloads.set(uri, task);
    }
  }

  return uri;
}

/** Pre-cache an array of image URLs in the background */
export function prefetchImages(
  urls: Array<string | null | undefined>,
  headers?: Record<string, string>,
): void {
  for (const url of urls) {
    if (url && (url.startsWith("http://") || url.startsWith("https://"))) {
      void resolveCachedImage(url, headers);
    }
  }
}
