import { useCallback } from "react";
import { hideTitle } from "@/core/content/hidden-titles";
import type { ItemCard } from "@/core/library/catalog-api";
import { triggerHaptic } from "@/shared/lib/haptics";
import { useAppDialog } from "@/shared/ui/app-dialog";
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
        {
          text: "Remove this title",
          style: "destructive",
          onPress: () =>
            showDialog(
              "Remove this title?",
              "It will be hidden from Home, Search and Library. You can restore it later in Settings → Hidden titles.",
              [
                {
                  text: "Remove",
                  style: "destructive",
                  onPress: () => {
                    void hideTitle(item).then(() => options.onChanged?.());
                  },
                },
              ],
            ),
        },
      ]);
    },
    [isSaved, save, showDialog],
  );
}
