import { useRouter, useIsFocused } from "expo-router";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useClient } from "@/core/client/client-provider";
import { familyMaxAge } from "@/core/content/audience";
import { useHiddenTitles } from "@/core/content/hidden-titles";
import { isReleased } from "@/core/content/release";
import type { ItemCard } from "@/core/library/catalog-api";
import type { OpenTitle } from "@/features/catalog/types";
import { useRemoteProgress, remoteWatch } from "./remote-progress";
import { prefetchDetails, prefetchImages } from "./prefetch";
import {
  fetchDetail,
  fetchHome,
  loadCachedHome,
  peekDetail,
  peekHome,
  remoteOptionsKey,
  type RemoteCatalogOptions,
  type RemoteDetail,
  type RemoteHome,
  type RemoteTitle,
} from "./tmdb";
import { useRemoteNavigation } from "./use-remote-navigation";
import {
  parseRemotePublicId,
  remotePublicId,
  titleIndex,
  toItemCard,
} from "./view";

/**
 * Loads the online catalog and adapts it to the local card/row shape so the
 * Home and Search screens can reuse the local components unchanged. Home is
 * the only online screen that refreshes on open: saved rows paint first, then
 * the network response replaces them.
 */
export function useRemoteHome(enabled = true) {
  const { api, preferences } = useClient();
  const { isHidden } = useHiddenTitles();
  const router = useRouter();
  const navigation = useRemoteNavigation();
  const focused = useIsFocused();
  const remoteProgress = useRemoteProgress(focused);
  const familyOptions = useMemo<RemoteCatalogOptions>(
    () => ({
      maxAge: familyMaxAge(preferences.familyLevel),
      blockUnrated: preferences.familyBlockUnrated,
      region: preferences.familyRegion,
    }),
    [
      preferences.familyBlockUnrated,
      preferences.familyLevel,
      preferences.familyRegion,
    ],
  );
  const familyKey = remoteOptionsKey(familyOptions);
  const [homeValue, setHomeValue] = useState<RemoteHome | null>(() =>
    enabled ? peekHome(familyKey) : null,
  );
  const [loading, setLoading] = useState(
    () => enabled && peekHome(familyKey) == null,
  );
  const [error, setError] = useState<string | null>(null);
  const [revision, setRevision] = useState(0);
  const [previousState, setPreviousState] = useState(
    `${enabled}:${familyKey}`,
  );
  if (previousState !== `${enabled}:${familyKey}`) {
    setPreviousState(`${enabled}:${familyKey}`);
    setHomeValue(enabled ? peekHome(familyKey) : null);
    setLoading(enabled && peekHome(familyKey) == null);
    setError(null);
  }
  // A disabled online source must not leak saved rows into local screens.
  const home = enabled ? homeValue : null;
  const retry = useCallback(() => {
    setError(null);
    setRevision((value) => value + 1);
  }, []);

  useEffect(() => {
    if (!enabled) return;
    let live = true;
    const controller = new AbortController();
    // Saved rows first so a cold launch does not wait on the network.
    void loadCachedHome(familyOptions).then((cached) => {
      if (!live || !cached) return;
      setHomeValue((current) => current ?? cached);
      setLoading(false);
    });
    // Home always refreshes; the title screens never do a blocking refresh.
    void fetchHome(controller.signal, familyOptions)
      .then((fresh) => {
        if (!live) return;
        setHomeValue(fresh);
        setLoading(false);
        setError(null);
      })
      .catch((reason) => {
        if (!live || controller.signal.aborted) return;
        setError(
          reason instanceof Error
            ? reason.message
            : "Could not load online titles.",
        );
        setLoading(false);
      });
    return () => {
      live = false;
      controller.abort();
    };
  }, [enabled, familyKey, familyOptions, preferences.source, revision]);

  const data = useMemo(
    () => ({
      value: home,
      loading: enabled && loading,
      error: enabled ? error : null,
      retry,
    }),
    [enabled, error, home, loading, retry],
  );

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
    prefetchDetails(
      [
        home.featured,
        ...home.rows
          .slice(0, 4)
          .flatMap((row) => row.items.slice(0, 3)),
      ].filter((title): title is RemoteTitle => Boolean(title)),
      8,
    );
  }, [enabled, home]);
  const localByTmdb = api.titlesByTmdb();
  const isLocalTitle = useCallback(
    (title: RemoteTitle) =>
      localByTmdb.has(`${title.mediaType}:${title.tmdbId}`),
    [localByTmdb],
  );
  const visibleTitle = useCallback(
    (title: RemoteTitle) =>
      isReleased(title.releaseDate) &&
      !isHidden(remotePublicId(title.mediaType, title.tmdbId)),
    [isHidden],
  );
  const lookup = useMemo(() => {
    const titles: RemoteTitle[] = home?.rows.flatMap((row) => row.items) ?? [];
    if (home?.featured) titles.unshift(home.featured);
    return titleIndex(titles.filter(visibleTitle));
  }, [home, visibleTitle]);

  const carousel = useMemo(() => {
    if (!home) return [] as RemoteTitle[];
    const list: RemoteTitle[] = [];
    if (home.featured && !isLocalTitle(home.featured) && visibleTitle(home.featured))
      list.push(home.featured);
    for (const row of home.rows) {
      for (const title of row.items) {
        if (list.length >= 5) break;
        if (isLocalTitle(title) || !visibleTitle(title)) continue;
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
  }, [home, isLocalTitle, visibleTitle]);

  // The hero shows TMDB title art (logo) and genres, which are only present on
  // the detail response. Warm every carousel slide and keep the resolved
  // details in state so each slide fills in as soon as its detail arrives.
  const [carouselDetails, setCarouselDetails] = useState(
    () => new Map<string, RemoteDetail>(),
  );
  useEffect(() => {
    if (!enabled || !carousel.length) return;
    let live = true;
    const controller = new AbortController();
    for (const title of carousel) {
      const key = `${title.mediaType}:${title.tmdbId}`;
      void fetchDetail(title.mediaType, title.tmdbId, controller.signal)
        .then((detail) => {
          if (!live) return;
          setCarouselDetails((previous) =>
            previous.get(key) === detail
              ? previous
              : new Map(previous).set(key, detail),
          );
        })
        .catch(() => {});
    }
    return () => {
      live = false;
      controller.abort();
    };
  }, [enabled, carousel]);

  const carouselItems = useMemo(
    () => {
      void remoteProgress;
      return carousel.map((title) => {
        const key = `${title.mediaType}:${title.tmdbId}`;
        const detail =
          carouselDetails.get(key) ??
          peekDetail(title.mediaType, title.tmdbId);
        const card = toItemCard(
          detail?.genres.length
            ? { ...title, genres: detail.genres }
            : title,
          detail?.runtime,
          remoteWatch(title.mediaType, title.tmdbId),
        );
        return detail?.logo ? { ...card, logo: detail.logo } : card;
      });
    },
    [carousel, carouselDetails, remoteProgress],
  );

  const rows = useMemo(
    () => {
      void remoteProgress;
      return (home?.rows ?? [])
        .map((row) => ({
          ...row,
          items: row.items
            .filter((title) => !isLocalTitle(title) && visibleTitle(title))
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
    [home, isLocalTitle, remoteProgress, visibleTitle],
  );

  const open: OpenTitle = useCallback(
    (id) => {
      const publicId = String(id);
      const title = lookup.get(publicId);
      if (title) {
        const local = localByTmdb.get(`${title.mediaType}:${title.tmdbId}`);
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
          releaseDate: null,
          certification: null,
        });
      }
    },
    [localByTmdb, lookup, navigation, router],
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
