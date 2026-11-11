import { useLocalSearchParams, useRouter } from "expo-router";
import { Notice } from "../../components/ui";
import { useMediaNavigation } from "../../navigation/useMediaNavigation";
import { PlayerScreen } from "../../screens/Player";
export default function PlayerRoute() {
  const { fileId } = useLocalSearchParams<{
    fileId: string;
  }>();
  const router = useRouter();
  const { back } = useMediaNavigation();
  const id = Number(fileId);
  if (!Number.isSafeInteger(id) || id <= 0)
    return <Notice message="This video is unavailable." />;
  return (
    <PlayerScreen
      key={id}
      fileId={id}
      back={back}
      next={(next) =>
        router.replace({
          pathname: "/player/[fileId]",
          params: { fileId: String(next) },
        })
      }
    />
  );
}
