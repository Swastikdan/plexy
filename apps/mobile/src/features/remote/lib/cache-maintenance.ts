import AsyncStorage from "@react-native-async-storage/async-storage";
import { Directory, Paths } from "expo-file-system";
import { Image } from "expo-image";
import { pruneRemoteCache } from "./remote-cache";

/**
 * Keeps the on-device caches bounded for long-lived installs:
 * - the saved TMDB catalog (SQLite) keeps only recent entries per kind;
 * - the artwork disk cache is cleared once it grows past its budget. Artwork
 *   then loads from TMDB again and refills the cache as titles are viewed.
 * Runs at most once a day, a few seconds after launch, off the first frame.
 */

const LAST_RUN_KEY = "plexy.cache.maintained-at";
const INTERVAL_MS = 24 * 60 * 60_000;
const START_DELAY_MS = 8_000;
export const IMAGE_CACHE_BUDGET_BYTES = 400 * 1024 ** 2;

// Glide (Android) and SDWebImage (iOS) keep their disk caches here.
const IMAGE_CACHE_DIRS = ["image_manager_disk_cache", "com.hackemist.SDImageCache"];

let scheduled = false;

export function imageCacheBytes(): number {
  let total = 0;
  for (const name of IMAGE_CACHE_DIRS) {
    try {
      const info = new Directory(Paths.cache, name).info();
      if (info.exists) total += info.size ?? 0;
    } catch {
      // Not present on this platform.
    }
  }
  return total;
}

export async function runCacheMaintenance(force = false) {
  if (!force) {
    const last = Number(await AsyncStorage.getItem(LAST_RUN_KEY).catch(() => 0)) || 0;
    if (Date.now() - last < INTERVAL_MS) return;
  }
  await AsyncStorage.setItem(LAST_RUN_KEY, String(Date.now())).catch(() => {});
  await pruneRemoteCache();
  if (imageCacheBytes() > IMAGE_CACHE_BUDGET_BYTES)
    await Image.clearDiskCache().catch(() => false);
}

/** Schedule the daily maintenance pass once per app process. */
export function scheduleCacheMaintenance() {
  if (scheduled) return;
  scheduled = true;
  setTimeout(() => void runCacheMaintenance(), START_DELAY_MS);
}
