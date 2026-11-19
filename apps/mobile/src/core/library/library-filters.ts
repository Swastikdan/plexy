import type { ItemCard } from "@plexy/api-client/types";

export interface LibraryFilters {
  genre?: string;
  maxRuntime?: number;
}

export function matchesLibraryFilters(item: ItemCard, filters?: LibraryFilters) {
  if (filters?.genre && !item.genres?.includes(filters.genre)) return false;
  if (!filters?.maxRuntime) return true;
  if (item.kind !== "movie") return false;
  const runtime = item.runtime ?? (item.watch?.duration ? item.watch.duration / 60 : null);
  return runtime != null && runtime > 0 && runtime <= filters.maxRuntime;
}
