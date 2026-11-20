/// Server-backed per-user item flags.
///
/// Watchlist, favorites, hidden state, and ratings used to live in localStorage
/// (or not exist at all). This hook keeps an optimistic local copy while the
/// server is the source of truth, and invalidates every catalog surface that
/// depends on the flags.
import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { api, type ItemCard } from "../client";

export interface ItemFlags {
  watchlist: boolean;
  favorite: boolean;
  hidden: boolean;
  rating: number | null;
}

export function itemFlags(item: ItemCard | null | undefined): ItemFlags {
  return {
    watchlist: Boolean(item?.watchlist),
    favorite: Boolean(item?.favorite),
    hidden: Boolean(item?.hidden),
    rating: item?.userRating == null ? null : Number(item.userRating),
  };
}

export function useItemFlags(item: ItemCard | null | undefined) {
  const queryClient = useQueryClient();
  const [flags, setFlags] = useState<ItemFlags>(() => itemFlags(item));
  const itemId = item?.id ?? null;

  useEffect(() => {
    setFlags(itemFlags(item));
  }, [itemId, item?.watchlist, item?.favorite, item?.hidden, item?.userRating]);

  const update = (patch: Partial<ItemFlags>) => {
    if (!itemId) return;
    const previous = flags;
    setFlags((current) => ({ ...current, ...patch }));
    void api
      .setFlags(itemId, patch)
      .then(() => {
        void queryClient.invalidateQueries({ queryKey: ["home"] });
        void queryClient.invalidateQueries({ queryKey: ["items"] });
        void queryClient.invalidateQueries({ queryKey: ["title"] });
        void queryClient.invalidateQueries({ queryKey: ["person"] });
      })
      .catch(() => setFlags(previous));
  };

  return {
    flags,
    setWatchlist: (value: boolean) => update({ watchlist: value }),
    toggleWatchlist: () => update({ watchlist: !flags.watchlist }),
    setFavorite: (value: boolean) => update({ favorite: value }),
    toggleFavorite: () => update({ favorite: !flags.favorite }),
    setHidden: (value: boolean) => update({ hidden: value }),
    setRating: (rating: number | null) => update({ rating }),
  };
}
