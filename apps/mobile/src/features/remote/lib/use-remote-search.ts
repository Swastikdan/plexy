import { useMemo } from "react";
import { useClient } from "@/core/client/client-provider";
import { familyMaxAge } from "@/core/content/audience";
import { useHiddenTitles } from "@/core/content/hidden-titles";
import { isReleased } from "@/core/content/release";
import { useResource } from "@/core/resources/use-resource";
import {
  remoteOptionsKey,
  searchTitles,
  type RemoteCatalogOptions,
} from "./tmdb";
import { remotePublicId } from "./view";

export function useRemoteSearch(query: string, enabled = true) {
  const { preferences } = useClient();
  const { isHidden } = useHiddenTitles();
  const options = useMemo<RemoteCatalogOptions>(
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
  const optionsKey = remoteOptionsKey(options);
  return useResource(
    async (signal) => {
      if (!enabled || !query) return [];
      const titles = await searchTitles(query, signal, options);
      return titles.filter(
        (title) =>
          isReleased(title.releaseDate) &&
          !isHidden(remotePublicId(title.mediaType, title.tmdbId)),
      );
    },
    [enabled, query, optionsKey],
    "remote-search",
  );
}
