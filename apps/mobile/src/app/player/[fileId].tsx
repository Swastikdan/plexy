import React from "react";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useDownloads } from "../../../../../packages/native-client/src/context";
import { PlayerScreen } from "../../screens/Player";
import { Notice } from "../../components/ui";
import { useMediaNavigation } from "../../navigation/useMediaNavigation";
export default function PlayerRoute() {
  const { fileId, downloadId } = useLocalSearchParams<{ fileId: string; downloadId?: string }>();
  const entries = useDownloads();
  const router = useRouter();
  const { back } = useMediaNavigation();
  const id = Number(fileId);
  const offline = downloadId ? entries.find(entry => entry.id === downloadId) : undefined;
  if (!Number.isSafeInteger(id) || id <= 0 || (downloadId && !offline)) return <Notice message="This video is unavailable." />;
  return <PlayerScreen key={`${id}:${downloadId ?? ""}`} fileId={id} offline={offline} back={back}
    next={next => router.replace({ pathname: "/player/[fileId]", params: { fileId: String(next) } })} />;
}
