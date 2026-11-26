import { useRef, useState } from "react";
import { useLocalSearchParams, useRouter } from "expo-router";
import { Text, View } from "react-native";
import { File } from "expo-file-system";
import { Button } from "@/shared/ui/button";
import { SafeAreaView } from "@/shared/ui/safe-area-view";
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
  const [picked, setPicked] = useState<{ id: string | undefined; video: ExternalVideo }>();
  const [selecting, setSelecting] = useState(false);
  const [pickerError, setPickerError] = useState("");
  const video = picked && picked.id === id ? picked.video : request.value;
  const router = useRouter();
  const back = () => router.canGoBack() ? router.back() : router.replace("/");
  const allowed = familyAllows(null, preferences.familyLevel, preferences.familyBlockUnrated);
  async function browse() {
    if (selecting) return;
    setSelecting(true);
    setPickerError("");
    try {
      const result = await File.pickFileAsync({
        mimeTypes: ["video/*", "application/octet-stream", "application/x-matroska", "application/mp4"],
      });
      if (!result.canceled) {
        const { uri, name } = result.result;
        const next = nativeMedia?.openPickedVideo
          ? await nativeMedia.openPickedVideo(uri)
          : { uri, name };
        setPicked({ id, video: next });
      }
    } catch (error) {
      setPickerError(error instanceof Error ? error.message : "Couldn’t open this video.");
    } finally {
      setSelecting(false);
    }
  }
  if (!video || !allowed) return <SafeAreaView className="flex-1 bg-background">
    <PageHeader title="Open a video" />
    <View className="gap-4 px-5">
      <Text className="text-muted">{allowed
        ? pickerError || request.error || (request.loading && id ? "Opening video…" : "Choose a video from Downloads or another folder.")
        : "Kids & family settings block unrated videos."}</Text>
      {allowed ? <Button label="Browse files" disabled={selecting} onPress={() => void browse()} /> : null}
    </View>
  </SafeAreaView>;
  return <ExternalPlayback key={`${id ?? "picker"}:${video.uri}`} video={video} back={back}
    canImport={Boolean(nativeMedia && (id || nativeMedia.openPickedVideo))} />;
}

function ExternalPlayback({ video, back, canImport }: { video: ExternalVideo; back: () => void; canImport: boolean }) {
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
    externalSource={video.uri} back={back} next={back} addExternalToLibrary={!canImport || imported ? undefined : add} />;
}
