import { useIsFocused } from "expo-router";
import { useEffect, useMemo } from "react";
import type { ItemCard, LocalCatalog } from "@/core/library/catalog-api";
import { useResource } from "@/core/resources/use-resource";
import { remoteWatch, useRemoteProgress } from "./remote-progress";
import { prefetchImages } from "./prefetch";
import {
  fetchRecommendations,
  type RemoteMediaType,
  type RemoteTitle,
} from "./tmdb";
import { remotePublicId, toItemCard } from "./view";

/**
 * TMDB recommendations for a title. Online mode shows every recommendation;
 * local mode keeps only the ones already in the library. Titles that are
 * local always route locally so the hybrid title page can add online seasons.
 */
export function useRecommendations({
  api,
  mediaType,
  tmdbId,
  online,
  enabled = true,
}: {
  api: LocalCatalog;
  mediaType: RemoteMediaType | null;
  tmdbId: number | null;
  online: boolean;
  /** Defer the network request until the recommendations tab is visible. */
  enabled?: boolean;
}) {
  const source = useResource(
    (signal) =>
      enabled && mediaType && tmdbId
        ? fetchRecommendations(mediaType, tmdbId, signal)
        : Promise.resolve([]),
    [enabled, mediaType, tmdbId],
    "recommendations",
  );
  const focused = useIsFocused();
  const remoteProgress = useRemoteProgress(focused);

  const localByTmdb = api.titlesByTmdb();
  useEffect(() => {
    if (!enabled) return;
    const urls = (source.value ?? []).flatMap((title) => [
      title.poster,
      title.backdrop,
    ]);
    prefetchImages(urls, 24);
  }, [enabled, source.value]);

  return useMemo(() => {
    void remoteProgress;
    const items: ItemCard[] = [];
    const remoteByPublicId = new Map<string, RemoteTitle>();
    const seen = new Set<string>();
    for (const title of source.value ?? []) {
      if (title.tmdbId === tmdbId && title.mediaType === mediaType) continue;
      const local = localByTmdb.get(`${title.mediaType}:${title.tmdbId}`);
      if (local) {
        if (seen.has(local.publicId)) continue;
        seen.add(local.publicId);
        items.push(local);
      } else if (online) {
        const id = remotePublicId(title.mediaType, title.tmdbId);
        if (seen.has(id)) continue;
        seen.add(id);
        items.push(
          toItemCard(
            title,
            undefined,
            remoteWatch(title.mediaType, title.tmdbId),
          ),
        );
        remoteByPublicId.set(id, title);
      }
    }
    return {
      items,
      remoteByPublicId,
      loading: enabled && source.loading && !items.length,
      error: source.error,
      retry: source.retry,
    };
  }, [
    enabled,
    localByTmdb,
    mediaType,
    online,
    remoteProgress,
    source.error,
    source.loading,
    source.retry,
    source.value,
    tmdbId,
  ]);
}
