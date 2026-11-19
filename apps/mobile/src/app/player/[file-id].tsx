import { useLocalSearchParams,useRouter } from "expo-router";
import { PlayerScreen } from "@/features/player/player-screen";
import { useMediaNavigation } from "@/shared/navigation/use-media-navigation";
import { Notice } from "@/shared/ui/notice";
export default function PlayerRoute() {
  const { "file-id": fileId, offline } = useLocalSearchParams<{
    "file-id": string;
    offline?: string;
  }>();
  const { setParams } = useRouter();
  const { back } = useMediaNavigation();
  const id = Number(fileId);
  if (!Number.isSafeInteger(id) || id <= 0)
    return <Notice message="This video is unavailable." />;
  return (
    <PlayerScreen
      fileId={id}
      offlineOnly={offline === "1"}
      back={back}
      next={(next) =>
        setParams({ "file-id": String(next) })
      }
    />
  );
}
