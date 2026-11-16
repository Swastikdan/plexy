import { useRouter } from "expo-router";
import { getRemoteTitleProgress } from "./remote-progress";
import type { RemoteTitle } from "./tmdb";

export function useRemoteNavigation() {
  const router = useRouter();
  const open = (
    title: RemoteTitle,
    options?: {
      play?: boolean;
      season?: number | null;
      episode?: number | null;
    },
  ) => {
    router.push({
      pathname: "/remote/[media-type]/[tmdb-id]",
      params: {
        "media-type": title.mediaType,
        "tmdb-id": String(title.tmdbId),
        name: title.title,
        poster: title.poster ?? "",
        backdrop: title.backdrop ?? "",
        ...(options?.play ? { play: "1" } : {}),
        ...(options?.season != null
          ? { season: String(options.season) }
          : {}),
        ...(options?.episode != null
          ? { episode: String(options.episode) }
          : {}),
      },
    });
  };
  const play = (title: RemoteTitle) => {
    const progress = getRemoteTitleProgress(title.mediaType, title.tmdbId);
    open(title, {
      play: true,
      season: progress && !progress.played ? progress.season : null,
      episode: progress && !progress.played ? progress.episode : null,
    });
  };
  return {
    open,
    play,
    back() {
      if (router.canGoBack()) router.back();
      else router.navigate("/");
    },
  };
}
