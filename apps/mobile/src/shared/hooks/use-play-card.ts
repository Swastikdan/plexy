import { useClient } from "@/core/client/client-provider";
import type { ItemCard } from "@/core/library/catalog-api";
import { useEventCallback } from "@/shared/hooks/use-event-callback";

/// Cards that already know their file play it immediately. Everything else
/// resolves the title detail first and picks the first unwatched episode, then
/// falls back to opening the detail page. Home and Search both need exactly
/// this behavior, so it lives here instead of in two callbacks.
export function usePlayCard(
  play: ((fileId: number) => void) | undefined,
  open: (publicId: string) => void,
) {
  const { api } = useClient();
  return useEventCallback((item: ItemCard) => {
    if (item.fileId && play) {
      play(item.fileId);
      return;
    }
    void api
      .detail(item.publicId)
      .then((detail) => {
        const fileId =
          detail.file?.fileId ||
          detail.episodes?.find((episode) => episode.fileId && !episode.watch?.played)?.fileId ||
          detail.episodes?.find((episode) => episode.fileId)?.fileId;
        if (fileId && play) play(fileId);
        else open(item.publicId);
      })
      .catch(() => open(item.publicId));
  });
}
