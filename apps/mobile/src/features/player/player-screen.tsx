import { usePlayerOrientation, markPlayerHandoff } from "./hooks/use-player-orientation";
import { View } from "react-native";
import { useRouter } from "expo-router";
import { useClient } from "@/core/client/client-provider";
import { useResource } from "@/core/resources/use-resource";
import { Button } from "@/shared/ui/button";
import { Notice } from "@/shared/ui/notice";
import { localNextIsImmediate } from "@/features/remote/lib/episode-sequence";
import { findNextOnlineEpisode } from "@/features/remote/lib/next-online";
import { PlayerLoading } from "./components/player-loading";
import { PlaybackScreen } from "./playback-screen";

export function PlayerScreen({
  fileId,
  offlineOnly = false,
  back,
  next,
}: {
  fileId: number;
  offlineOnly?: boolean;
  back: () => void;
  next: (id: number) => void;
}) {
  usePlayerOrientation(() => {});
  const router = useRouter();
  const { api, progress, preferences } = useClient();
  const onlineMode = !offlineOnly && preferences.source === "remote";
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
  const manifest = resource.value;
  const onlineNext = useResource(
    (signal) => {
      if (
        !manifest ||
        !onlineMode ||
        manifest.mediaType !== "tv" ||
        manifest.tmdbId == null ||
        manifest.seasonNumber == null ||
        manifest.episodeNumber == null ||
        localNextIsImmediate(manifest)
      ) {
        return Promise.resolve(null);
      }
      return findNextOnlineEpisode(
        manifest.tmdbId,
        manifest.seasonNumber,
        manifest.episodeNumber,
        signal,
      ).then((next) => (next ? { ...next, fileId: manifest.fileId } : null));
    },
    [
      manifest?.fileId,
      manifest?.mediaType,
      manifest?.nextFileId,
      manifest?.next?.episodeNumber,
      manifest?.next?.seasonNumber,
      manifest?.seasonNumber,
      manifest?.episodeNumber,
      manifest?.tmdbId,
      onlineMode,
    ],
    "online-next",
  );
  const nextOnline =
    manifest && onlineNext.value?.fileId === manifest.fileId
      ? onlineNext.value
      : null;
  if (resource.loading || (resource.value && resource.value.fileId !== fileId)) {
    return (
      <View
        style={{
          flex: 1,
          backgroundColor: "#000",
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
      <View style={{ flex: 1, backgroundColor: "#000", padding: 24 }}>
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
        onlineNext={nextOnline}
        onNextOnline={() => {
          if (
            !manifest ||
            !nextOnline ||
            manifest.tmdbId == null ||
            !manifest.mediaType
          ) {
            return;
          }
          markPlayerHandoff();
          router.replace({
            pathname: "/player/remote",
            params: {
              mediaType: manifest.mediaType,
              tmdbId: String(manifest.tmdbId),
              season: String(nextOnline.season),
              episode: String(nextOnline.episode),
              title: manifest.title || nextOnline.title,
              display: `${manifest.title || nextOnline.title} · S${nextOnline.season}E${nextOnline.episode}`,
            },
          });
        }}
      />
    )
  );
}
