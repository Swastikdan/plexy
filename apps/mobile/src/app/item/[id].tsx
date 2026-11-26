import { useLocalSearchParams, useRouter } from "expo-router";
import { SafeAreaView } from "@/shared/ui/safe-area-view";
import { TitleScreen } from "@/features/title/title-screen";
import { useMediaNavigation } from "@/shared/navigation/use-media-navigation";
import { Notice } from "@/shared/ui/notice";
export default function DetailRoute() {
  const { id, offline } = useLocalSearchParams<{
    id: string;
    offline?: string;
  }>();
  const navigation = useMediaNavigation();
  const { push } = useRouter();
  const offlineOnly = offline === "1";
  if (!id || Array.isArray(id)) return <Notice message="Invalid title." />;
  return (
    <SafeAreaView edges={["left", "right", "bottom"]} className="flex-1">
      <TitleScreen
        input={{ source: "local", id }}
        offlineOnly={offlineOnly}
        back={navigation.back}
        play={offlineOnly
          ? (fileId) => push({
              pathname: "/player/[file-id]",
              params: { "file-id": String(fileId), offline: "1" },
            })
          : navigation.play}
      />
    </SafeAreaView>
  );
}
