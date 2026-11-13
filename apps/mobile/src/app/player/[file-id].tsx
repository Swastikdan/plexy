import { useLocalSearchParams,useRouter } from "expo-router";
import { PlayerScreen } from "@/features/player/player-screen";
import { useMediaNavigation } from "@/shared/navigation/use-media-navigation";
import { Notice } from "@/shared/ui/notice";
export default function PlayerRoute() {
  const { "file-id": fileId } = useLocalSearchParams<{
    "file-id": string;
  }>();
  const router = useRouter();
  const { back } = useMediaNavigation();
  const id = Number(fileId);
  if (!Number.isSafeInteger(id) || id <= 0)
    return <Notice message="This video is unavailable." />;
  return (
    <PlayerScreen
      fileId={id}
      back={back}
      next={(next) =>
        router.setParams({ "file-id": String(next) })
      }
    />
  );
}
