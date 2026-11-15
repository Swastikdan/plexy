import { useLocalSearchParams } from "expo-router";
import { RemotePlayerScreen, type RemotePlayerInput } from "@/features/remote/remote-player-screen";
import type { RemoteMediaType } from "@/features/remote/lib/tmdb";
import { Notice } from "@/shared/ui/notice";

function numberOrNull(value: string | undefined) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

export default function RemotePlayerRoute() {
  const params = useLocalSearchParams<{
    mediaType: string;
    tmdbId: string;
    season?: string;
    episode?: string;
    title?: string;
    display?: string;
  }>();

  const mediaType: RemoteMediaType | null =
    params.mediaType === "movie" || params.mediaType === "tv" ? params.mediaType : null;
  const tmdbId = Number(params.tmdbId);
  if (!mediaType || !Number.isSafeInteger(tmdbId) || tmdbId <= 0) {
    return <Notice message="This online video is unavailable." />;
  }

  const input: RemotePlayerInput = {
    mediaType,
    tmdbId,
    season: numberOrNull(params.season),
    episode: numberOrNull(params.episode),
    title: params.title?.trim() || "Untitled",
    display: params.display?.trim() || params.title?.trim() || "Untitled",
  };

  return <RemotePlayerScreen input={input} />;
}
