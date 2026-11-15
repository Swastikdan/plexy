import React from "react";
import { useClient } from "@/core/client/client-provider";
import type { ItemCard } from "@/core/library/catalog-api";

/**
 * Starts a card's next playable file. Movies carry a file directly; a series
 * needs its detail so the next unfinished episode can be chosen. A card with
 * nothing playable falls back to opening the title, matching the home rows.
 */
export function usePlayTitle(
  play?: (fileId: number) => void,
  fallback?: (item: ItemCard) => void,
) {
  const { api } = useClient();
  return React.useCallback(
    (item: ItemCard) => {
      if (!play) {
        fallback?.(item);
        return;
      }
      if (item.fileId) {
        play(item.fileId);
        return;
      }
      void api
        .detail(item.publicId)
        .then((detail) => {
          const fileId =
            detail.file?.fileId ||
            detail.episodes?.find((episode) => episode.fileId && !episode.watch?.played)
              ?.fileId ||
            detail.episodes?.find((episode) => episode.fileId)?.fileId;
          if (fileId) play(fileId);
          else fallback?.(item);
        })
        .catch(() => fallback?.(item));
    },
    [api, fallback, play],
  );
}
