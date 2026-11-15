import { useResource } from "@/core/resources/use-resource";
import { searchTitles } from "./tmdb";

export function useRemoteSearch(query: string, enabled = true) {
  return useResource(
    (signal) =>
      enabled && query ? searchTitles(query, signal) : Promise.resolve([]),
    [enabled, query],
    "remote-search",
  );
}
