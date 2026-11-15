import { useRouter } from "expo-router";
import { useCallback, useMemo } from "react";
import { useClient } from "@/core/client/client-provider";
import type { ItemCard } from "@/core/library/catalog-api";
import { useResource } from "@/core/resources/use-resource";
import type { OpenTitle } from "@/features/catalog/types";
import { fetchHome, type RemoteTitle } from "./tmdb";
import { useRemoteNavigation } from "./use-remote-navigation";
import {
  parseRemotePublicId,
  titleIndex,
  toItemCard,
} from "./view";

/**
 * Loads the online catalog and adapts it to the local card/row shape so the
 * Home and Search screens can reuse the local components unchanged.
 */
export function useRemoteHome(enabled = true) {
  const { api, preferences } = useClient();
  const router = useRouter();
  const navigation = useRemoteNavigation();
  const data = useResource(
    (signal) =>
      enabled
        ? fetchHome(signal)
        : Promise.resolve({ featured: null, rows: [] }),
    [enabled, preferences.source],
    "remote-home",
  );

  const home = data.value;
  const lookup = useMemo(() => {
    const titles: RemoteTitle[] = home?.rows.flatMap((row) => row.items) ?? [];
    if (home?.featured) titles.unshift(home.featured);
    return titleIndex(titles);
  }, [home]);

  const carousel = useMemo(() => {
    if (!home) return [] as RemoteTitle[];
    const list: RemoteTitle[] = [];
    if (home.featured) list.push(home.featured);
    for (const row of home.rows) {
      for (const title of row.items) {
        if (list.length >= 5) break;
        if (
          list.some(
            (entry) =>
              entry.tmdbId === title.tmdbId &&
              entry.mediaType === title.mediaType,
          )
        )
          continue;
        list.push(title);
      }
      if (list.length >= 5) break;
    }
    return list;
  }, [home]);

  const carouselItems = useMemo(
    () => carousel.map((title) => toItemCard(title)),
    [carousel],
  );

  const rows = useMemo(
    () =>
      (home?.rows ?? []).map((row) => ({
        ...row,
        items: row.items.map((title) => toItemCard(title)),
      })),
    [home],
  );

  const open: OpenTitle = useCallback(
    (id) => {
      const publicId = String(id);
      const title = lookup.get(publicId);
      if (title) {
        const local = api
          .titlesByTmdb()
          .get(`${title.mediaType}:${title.tmdbId}`);
        if (local) {
          router.push({
            pathname: "/item/[id]",
            params: { id: local.publicId },
          });
          return;
        }
        navigation.open(title);
        return;
      }
      const parsed = parseRemotePublicId(publicId);
      if (parsed) {
        navigation.open({
          tmdbId: parsed.tmdbId,
          mediaType: parsed.mediaType,
          title: "",
          year: null,
          poster: null,
          backdrop: null,
          overview: "",
          rating: null,
          genres: [],
        });
      }
    },
    [api, lookup, navigation, router],
  );

  const play = useCallback(
    (item: ItemCard) => {
      const title = lookup.get(item.publicId);
      if (title) navigation.open(title, { play: true });
    },
    [lookup, navigation],
  );

  return { data, home, carouselItems, rows, open, play };
}
