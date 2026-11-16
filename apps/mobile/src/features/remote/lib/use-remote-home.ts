import { useRouter, useIsFocused } from "expo-router";
import { useCallback, useEffect, useMemo } from "react";
import { useClient } from "@/core/client/client-provider";
import type { ItemCard } from "@/core/library/catalog-api";
import { useResource } from "@/core/resources/use-resource";
import type { OpenTitle } from "@/features/catalog/types";
import { useRemoteProgress, remoteWatch } from "./remote-progress";
import { prefetchImages } from "./prefetch";
import { fetchDetail, fetchHome, type RemoteTitle } from "./tmdb";
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
  const focused = useIsFocused();
  const remoteProgress = useRemoteProgress(focused);
  const data = useResource(
    (signal) =>
      enabled
        ? fetchHome(signal)
        : Promise.resolve({ featured: null, rows: [] }),
    [enabled, preferences.source],
    "remote-home",
  );

  const home = data.value;
  const featured = home?.featured ?? null;
  useEffect(() => {
    if (!enabled || !home) return;
    const urls: (string | null | undefined)[] = [
      home.featured?.backdrop,
      home.featured?.poster,
    ];
    for (const row of home.rows.slice(0, 4)) {
      for (const title of row.items.slice(0, 6)) {
        urls.push(title.poster, title.backdrop);
      }
    }
    prefetchImages(urls, 32);
  }, [enabled, home]);
  const featuredDetail = useResource(
    (signal) =>
      enabled && featured
        ? fetchDetail(featured.mediaType, featured.tmdbId, signal)
        : Promise.resolve(null),
    [enabled, featured?.mediaType, featured?.tmdbId],
    "remote-featured-detail",
  );
  useEffect(() => {
    const detail = featuredDetail.value;
    if (!detail) return;
    prefetchImages([detail.poster, detail.backdrop, detail.logo], 3);
  }, [featuredDetail.value]);
  const localByTmdb = api.titlesByTmdb();
  const isLocalTitle = useCallback(
    (title: RemoteTitle) =>
      localByTmdb.has(`${title.mediaType}:${title.tmdbId}`),
    [localByTmdb],
  );
  const lookup = useMemo(() => {
    const titles: RemoteTitle[] = home?.rows.flatMap((row) => row.items) ?? [];
    if (home?.featured) titles.unshift(home.featured);
    return titleIndex(titles);
  }, [home]);

  const carousel = useMemo(() => {
    if (!home) return [] as RemoteTitle[];
    const list: RemoteTitle[] = [];
    if (home.featured && !isLocalTitle(home.featured))
      list.push(home.featured);
    for (const row of home.rows) {
      for (const title of row.items) {
        if (list.length >= 5) break;
        if (isLocalTitle(title)) continue;
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
  }, [home, isLocalTitle]);

  const carouselItems = useMemo(
    () => {
      void remoteProgress;
      const featuredLogo =
        featured &&
        featuredDetail.value?.mediaType === featured.mediaType &&
        featuredDetail.value?.tmdbId === featured.tmdbId
          ? featuredDetail.value.logo
          : null;
      return carousel.map((title, index) =>
        {
          const card = toItemCard(
            title,
            undefined,
            remoteWatch(title.mediaType, title.tmdbId),
          );
          return index === 0 && featuredLogo
            ? { ...card, logo: featuredLogo }
            : card;
        },
      );
    },
    [carousel, featured, featuredDetail.value, remoteProgress],
  );

  const rows = useMemo(
    () => {
      void remoteProgress;
      return (home?.rows ?? [])
        .map((row) => ({
          ...row,
          items: row.items
            .filter((title) => !isLocalTitle(title))
            .map((title) =>
              toItemCard(
                title,
                undefined,
                remoteWatch(title.mediaType, title.tmdbId),
              ),
            ),
        }))
        .filter((row) => row.items.length > 0);
    },
    [home, isLocalTitle, remoteProgress],
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
      if (title) navigation.play(title);
    },
    [lookup, navigation],
  );

  return { data, home, carouselItems, rows, open, play };
}
