import { Image } from "expo-image";
import {
  fetchDetail,
  fetchSeason,
  peekDetail,
  peekSeason,
  type RemoteMediaType,
  type RemoteTitle,
} from "./tmdb";

const requested = new Set<string>();
const imageQueue: string[] = [];
let imagesInFlight = 0;

// These sets only exist to skip speculative duplicate work. Long browsing
// sessions can touch thousands of URLs, so keep them bounded instead of
// retaining every title/artwork key for the lifetime of the process.
const REQUEST_MEMORY_LIMIT = 512;
function rememberRequest(set: Set<string>, value: string) {
  if (set.has(value)) return;
  set.add(value);
  if (set.size > REQUEST_MEMORY_LIMIT)
    set.delete(set.values().next().value!);
}

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
const requestedSeasons = new Set<string>();
const detailQueue: { mediaType: RemoteMediaType; tmdbId: number; season: boolean }[] = [];
let detailsInFlight = 0;

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
    rememberRequest(requested, url);
    count += 1;
    imageQueue.push(url);
  }
  drainImages();
}

function drainDetails() {
  while (detailsInFlight < 2 && detailQueue.length) {
    const next = detailQueue.shift()!;
    const key = `${next.mediaType}:${next.tmdbId}`;
    detailsInFlight += 1;
    void fetchDetail(next.mediaType, next.tmdbId)
      .then((detail) => {
        prefetchImages(
          [detail.poster, detail.backdrop, detail.logo],
          3,
        );
        if (!detail.seasons.length) return;
        const season = next.season ? 1 : null;
        if (season == null) return;
        const seasonKey = `${next.mediaType}:${next.tmdbId}:${season}`;
        if (peekSeason(next.tmdbId, season)) {
          prefetchImages(
            (peekSeason(next.tmdbId, season) ?? [])
              .slice(0, 8)
              .map((episode) => episode.still),
            8,
          );
          return;
        }
        void fetchSeason(next.tmdbId, season)
          .then((episodes) =>
            prefetchImages(
              episodes.slice(0, 8).map((episode) => episode.still),
              8,
            ),
          )
          .catch(() => requestedSeasons.delete(seasonKey));
      })
      .catch(() => {
        requestedDetails.delete(key);
        requestedSeasons.delete(`${key}:1`);
      })
      .finally(() => {
        detailsInFlight -= 1;
        drainDetails();
      });
  }
}

/**
 * Warm the detail cache for cards the user is likely to open next. Failures
 * are removed from the set so a later screen/refresh can retry them. Season
 * episodes are only fetched for cards the user is actually looking at.
 */
export function prefetchDetails(
  titles: Pick<RemoteTitle, "mediaType" | "tmdbId">[],
  limit = 8,
  withSeason = false,
) {
  let count = 0;
  for (const title of titles) {
    if (count >= limit) break;
    const key = `${title.mediaType}:${title.tmdbId}`;
    const cached = peekDetail(title.mediaType, title.tmdbId);
    if (!cached && requestedDetails.has(key)) continue;
    if (!cached) {
      rememberRequest(requestedDetails, key);
      count += 1;
    }
    if (cached && !withSeason) continue;
    const seasonKey = `${key}:1`;
    if (withSeason && requestedSeasons.has(seasonKey)) continue;
    detailQueue.push({
      mediaType: title.mediaType,
      tmdbId: title.tmdbId,
      season: withSeason,
    });
    if (withSeason) rememberRequest(requestedSeasons, seasonKey);
  }
  drainDetails();
}
