import { useRef, useState } from "react";
import { useLocalSearchParams, useRouter } from "expo-router";
import { Text } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useResource } from "@/core/resources/use-resource";
import { useClient } from "@/core/client/client-provider";
import { familyAllows } from "@/core/content/audience";
import { localLibrary } from "@/core/library/local-runtime";
import { nativeMedia, type ExternalVideo } from "@/core/native-media/bridge";
import { PageHeader } from "@/shared/ui/page-header";
import { useAppDialog } from "@/shared/ui/app-dialog";
import { PlaybackScreen } from "./playback-screen";
import { usePlayerOrientation } from "./hooks/use-player-orientation";

export function ExternalPlayerRoute() {
  const { preferences } = useClient();
  const { id } = useLocalSearchParams<{ id?: string }>();
  const request = useResource(
    () => id && nativeMedia ? nativeMedia.takeVideo(id) : Promise.resolve(null),
    [id],
  );
  const video = request.value;
  const router = useRouter();
  const back = () => router.canGoBack() ? router.back() : router.replace("/");
  const allowed = familyAllows(null, preferences.familyLevel, preferences.familyBlockUnrated);
  if (!video || !allowed) return <SafeAreaView className="flex-1 bg-background">
    <PageHeader title="Open with Plexy" />
    <Text className="px-5 text-muted">{allowed ? request.error ?? (request.loading ? "Opening video…" : "Open a video from Android Files to play it here.") : "Kids & family settings block unrated videos."}</Text>
  </SafeAreaView>;
  return <ExternalPlayback key={id} video={video} back={back} />;
}

function ExternalPlayback({ video, back }: { video: ExternalVideo; back: () => void }) {
  const show = useAppDialog();
  const importing = useRef(false);
  const [imported, setImported] = useState(false);
  usePlayerOrientation(() => {});
  const add = () => show("Add to library?", "Plexy will save a copy of this video on your device.", [{
    text: "Copy video",
    onPress: () => {
      const bridge = nativeMedia;
      if (!bridge || importing.current) return;
      importing.current = true;
      void bridge.importVideo(video.uri, video.name)
        .then((uri) => localLibrary.addRoot({ uri, name: video.name, kind: "auto", singleFile: true }))
        .then(() => {
          setImported(true);
          show("Added to library", "Your video is available in Libraries.", []);
        })
        .catch((error) => show("Couldn’t add video", error instanceof Error ? error.message : "Try again.", []))
        .finally(() => { importing.current = false; });
    },
  }]);
  return <PlaybackScreen initial={{ path: "direct", reason: "Opened from Android", fileId: -1, itemId: null, title: video.name, watch: null }}
    externalSource={video.uri} back={back} next={back} addExternalToLibrary={imported ? undefined : add} />;
}
