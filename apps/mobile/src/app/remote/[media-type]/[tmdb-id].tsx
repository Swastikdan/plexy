import { useLocalSearchParams } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";
import { RemoteTitleScreen } from "@/features/remote/remote-title-screen";
import type { RemoteMediaType } from "@/features/remote/lib/tmdb";
import { Notice } from "@/shared/ui/notice";

export default function RemoteTitleRoute() {
  const { "media-type": mediaType, "tmdb-id": tmdbId, name, play } = useLocalSearchParams<{
    "media-type": string;
    "tmdb-id": string;
    name?: string;
    play?: string;
  }>();

  const id = Number(tmdbId);
  const type: RemoteMediaType | null =
    mediaType === "movie" || mediaType === "tv" ? mediaType : null;

  if (!type || !Number.isSafeInteger(id) || id <= 0) {
    return <Notice message="Invalid online title." />;
  }

  return (
    <SafeAreaView edges={["left", "right", "bottom"]} style={{ flex: 1 }}>
      <RemoteTitleScreen
        mediaType={type}
        tmdbId={id}
        fallbackName={name}
        autoPlay={play === "1"}
      />
    </SafeAreaView>
  );
}
