import { useClient } from "@/core/client/client-provider";
import type { ItemCard, LocalCatalog } from "@/core/library/catalog-api";
import { prefetchLocalDetails } from "@/core/library/title-prefetch";
import { prefetchDetails, prefetchImages } from "@/features/remote/lib/prefetch";
import { parseRemotePublicId } from "@/features/remote/lib/view";
import { useEventCallback } from "@/shared/hooks/use-event-callback";

/**
 * Warm the title page for cards as they enter the viewport. Local details are
 * read from the on-device index; online titles use the shared TMDB cache. The
 * work is queued and deduplicated so a whole grid mounting at once does not
 * run every read on the same frame.
 */
export function prefetchTitleCards(items: ItemCard[], api: LocalCatalog) {
  const localIds: string[] = [];
  const remote: { mediaType: "movie" | "tv"; tmdbId: number }[] = [];
  for (const item of items) {
    if (!item || item.kind === "episode") continue;
    prefetchImages([item.poster, item.backdrop], 2);
    const remoteId = parseRemotePublicId(item.publicId);
    if (remoteId) remote.push(remoteId);
    else localIds.push(item.publicId);
  }
  if (localIds.length) prefetchLocalDetails(api, localIds);
  if (remote.length) prefetchDetails(remote, 4, true);
}

type ViewToken = { item?: ItemCard | null };

const VIEWABILITY = {
  itemVisiblePercentThreshold: 30,
  minimumViewTime: 120,
};

/**
 * A stable `onViewableItemsChanged`/`viewabilityConfig` pair for FlatLists.
 * FlatList requires both to keep their identity for the life of the list.
 */
export function useTitlePrefetch() {
  const { api } = useClient();
  const onViewableItemsChanged = useEventCallback(
    ({ viewableItems }: { viewableItems: ViewToken[] }) => {
      const items: ItemCard[] = [];
      for (const token of viewableItems) {
        if (token.item) items.push(token.item);
      }
      if (items.length) prefetchTitleCards(items, api);
    },
  );
  return {
    onViewableItemsChanged,
    viewabilityConfig: VIEWABILITY,
  };
}
