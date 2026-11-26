import { useLocalSearchParams } from "expo-router";
import { SafeAreaView } from "@/shared/ui/safe-area-view";
import { TitleScreen } from "@/features/title/title-screen";
import type { RemoteMediaType } from "@/features/remote/lib/tmdb";
import { useMediaNavigation } from "@/shared/navigation/use-media-navigation";
import { Notice } from "@/shared/ui/notice";

export default function RemoteTitleRoute() {
  const {
    "media-type": mediaType,
    "tmdb-id": tmdbId,
    name,
    play,
    season,
    episode,
  } = useLocalSearchParams<{
    "media-type": string;
    "tmdb-id": string;
    name?: string;
    play?: string;
    season?: string;
    episode?: string;
  }>();
  const navigation = useMediaNavigation();

  const id = Number(tmdbId);
  const type: RemoteMediaType | null =
    mediaType === "movie" || mediaType === "tv" ? mediaType : null;
  const numberOrNull = (value: string | undefined) => {
    const parsed = Number(value);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
  };

  if (!type || !Number.isSafeInteger(id) || id <= 0) {
    return <Notice message="Invalid online title." />;
  }

  return (
    <SafeAreaView edges={["left", "right", "bottom"]} className="flex-1">
      <TitleScreen
        input={{
          source: "remote",
          mediaType: type,
          tmdbId: id,
          fallbackName: name,
        }}
        autoPlay={play === "1"}
        autoSeason={numberOrNull(season)}
        autoEpisode={numberOrNull(episode)}
        back={navigation.back}
        play={navigation.play}
      />
    </SafeAreaView>
  );
}
