import { View } from "react-native";
import { useClient } from "@/core/client/client-provider";
import { useResource } from "@/core/resources/use-resource";
import { Button } from "@/shared/ui/button";
import { Notice } from "@/shared/ui/notice";
import { PlayerLoading } from "./components/player-loading";
import { PlaybackScreen } from "./playback-screen";

export function PlayerScreen({
  fileId,
  back,
  next,
}: {
  fileId: number;
  back: () => void;
  next: (id: number) => void;
}) {
  const { api, progress } = useClient();
  const resource = useResource(async () => {
    const manifest = await api.play(fileId);
    const pending = manifest.itemId
      ? progress.latest(manifest.itemId)
      : undefined;
    return pending && !pending.synced
      ? {
          ...manifest,
          watch: {
            position: pending.position,
            duration: pending.duration || null,
            played: pending.played,
          },
        }
      : manifest;
  }, [api, fileId]);
  if (resource.loading) {
    return (
      <View
        style={{
          flex: 1,
          backgroundColor: "#000000",
          justifyContent: "center",
          alignItems: "center",
        }}
      >
        <PlayerLoading />
      </View>
    );
  }
  if (resource.error)
    return (
      <View style={{ padding: 24 }}>
        <Button label="Back" onPress={back} />
        <Notice message={resource.error} retry={resource.retry} />
      </View>
    );
  return (
    resource.value && (
      <PlaybackScreen
        key={fileId}
        initial={resource.value}
        back={back}
        next={next}
      />
    )
  );
}
