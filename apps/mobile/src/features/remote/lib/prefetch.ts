import { Image } from "expo-image";

const requested = new Set<string>();

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
    void Image.prefetch(url).catch(() => {});
  }
}
