import { useCollectionAction } from "@/features/collections/use-collection-action";
import { useCallback } from "react";
import type { ItemCard } from "@/core/library/catalog-api";
import { triggerHaptic } from "@/shared/lib/haptics";
import { useAppDialog } from "@/shared/ui/app-dialog";
import { hiddenTitleAction } from "@/shared/ui/hidden-title-action";
import { useRemote } from "../remote-provider";
import {
  isRemotePlayed,
  markRemotePlayed,
} from "../lib/remote-progress";
import { fetchDetail, type RemoteTitle } from "../lib/tmdb";
import { parseRemotePublicId } from "../lib/view";

export function remoteTitleFromCard(item: ItemCard): RemoteTitle | null {
  const parsed = parseRemotePublicId(item.publicId);
  if (!parsed) return null;
  return {
    tmdbId: parsed.tmdbId,
    mediaType: parsed.mediaType,
    title: item.name,
    year: item.year,
    poster: item.poster,
    backdrop: item.backdrop,
    overview: item.overview ?? "",
    rating: item.rating,
    genres: item.genres,
    releaseDate: item.releaseDate ?? null,
    certification: item.certification ?? null,
  };
}

/**
 * The online counterpart of useTitleActions. It keeps the same sheet order —
 * continue, finished, library — and never offers file deletion.
 */
export function useRemoteTitleActions() {
  const showDialog = useAppDialog();
  const addToCollection = useCollectionAction();
  const { save, isSaved } = useRemote();
  return useCallback(
    (
      item: ItemCard,
      options: {
        play?: () => void;
        onChanged?: () => void;
      } = {},
    ) => {
      const title = remoteTitleFromCard(item);
      if (!title) return;
      triggerHaptic("medium");
      const watched = isRemotePlayed(title.mediaType, title.tmdbId);
      const saved = isSaved(title);
      showDialog(item.name, "Title actions", [
        ...(options.play
          ? [{ text: "Continue watching", onPress: options.play }]
          : []),
        {
          text: watched ? "Mark as unwatched" : "Mark as finished",
          onPress: () =>
            void (async () => {
              let seasons:
                | { season: number; episodes: number[] }[]
                | undefined;
              if (title.mediaType === "tv") {
                try {
                  const detail = await fetchDetail(
                    title.mediaType,
                    title.tmdbId,
                  );
                  seasons = detail.seasons.map((entry) => ({
                    season: entry.number,
                    episodes: Array.from(
                      { length: entry.episodes },
                      (_, index) => index + 1,
                    ),
                  }));
                } catch {
                  // Keep the title-level state when the catalog is unreachable.
                }
              }
              await markRemotePlayed(
                title.mediaType,
                title.tmdbId,
                !watched,
                seasons,
              );
              options.onChanged?.();
            })(),
        },
        {
          text: saved ? "Remove from library" : "Add to library",
          onPress: () =>
            void save(title).then(() => options.onChanged?.()),
        },
        { text: "Add to collection", onPress: () => {
          if (saved) addToCollection(item.publicId);
          else void save(title).then(() => addToCollection(item.publicId)).catch(() =>
            showDialog("Couldn’t save title", "Try adding the title again.", []));
        } },
        hiddenTitleAction(showDialog, item, options.onChanged),
      ]);
    },
    [addToCollection, isSaved, save, showDialog],
  );
}
