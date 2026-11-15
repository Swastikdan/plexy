import { useRouter } from "expo-router";
import type { RemoteTitle } from "../lib/tmdb";

export function useRemoteNavigation() {
  const router = useRouter();
  return {
    open(title: RemoteTitle, options?: { play?: boolean }) {
      router.push({
        pathname: "/remote/[media-type]/[tmdb-id]",
        params: {
          "media-type": title.mediaType,
          "tmdb-id": String(title.tmdbId),
          name: title.title,
          poster: title.poster ?? "",
          backdrop: title.backdrop ?? "",
          ...(options?.play ? { play: "1" } : {}),
        },
      });
    },
    back() {
      if (router.canGoBack()) router.back();
      else router.replace("/");
    },
  };
}
