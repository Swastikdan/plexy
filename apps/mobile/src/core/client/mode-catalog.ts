import type { LocalCatalog } from "@/core/library/catalog-api";
import type { AppMode } from "./preferences";

/** Online-only browsing must not expose retained local media after a mode switch. */
export function catalogForMode(catalog: LocalCatalog, mode: AppMode): LocalCatalog {
  if (mode !== "online") return catalog;
  const empty: Pick<LocalCatalog, "home" | "items" | "search" | "collections" | "collectionItems" | "counts" | "titlesByTmdb"> = {
    home: async () => ({ rows: [], featured: null }),
    items: async () => ({ items: [] }),
    search: async () => ({ titles: [], episodes: [] }),
    collections: () => [],
    collectionItems: () => [],
    counts: () => ({ movie: 0, series: 0 }),
    titlesByTmdb: () => new Map(),
  };
  return new Proxy(catalog, {
    get(target, key) {
      if (key in empty) return empty[key as keyof typeof empty];
      const value = Reflect.get(target, key, target);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
}
