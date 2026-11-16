import { Image } from "expo-image";
import { fetchDetail, type RemoteTitle } from "./tmdb";

const requested = new Set<string>();
const imageQueue: string[] = [];
let imagesInFlight = 0;

// Background shelves must not saturate connections and decode work while a
// title's visible artwork is loading. Limit speculative requests globally.
function drainImages() {
  while (imagesInFlight < 3 && imageQueue.length) {
    const url = imageQueue.shift()!;
    imagesInFlight += 1;
    void Image.prefetch(url, { cachePolicy: "memory-disk" })
      .then(success => { if (!success) requested.delete(url); })
      .catch(() => { requested.delete(url); })
      .finally(() => { imagesInFlight -= 1; drainImages(); });
  }
}

const requestedDetails = new Set<string>();

/**
 * Warm the image cache for the posters/backdrops the user is about to see.
 * The set keeps repeated screen renders from re-requesting the same artwork.
 */
export function prefetchImages(
  urls: (string | null | undefined)[],
  limit = 24,
) {
  let count = 0;
  for (const url of urls) {
    if (!url || requested.has(url)) continue;
    if (count >= limit) break;
    requested.add(url);
    count += 1;
    imageQueue.push(url);
  }
  drainImages();
}

/**
 * Warm the detail cache for cards the user is likely to open next. Failures
 * are removed from the set so a later screen/refresh can retry them.
 */
export function prefetchDetails(
  titles: Pick<RemoteTitle, "mediaType" | "tmdbId">[],
  limit = 8,
) {
  let count = 0;
  for (const title of titles) {
    if (count >= limit) break;
    const key = `${title.mediaType}:${title.tmdbId}`;
    if (requestedDetails.has(key)) continue;
    requestedDetails.add(key);
    count += 1;
    void fetchDetail(title.mediaType, title.tmdbId).catch(() => {
      requestedDetails.delete(key);
    });
  }
}
