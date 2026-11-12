import { useLocalSearchParams } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";
import { TitleScreen } from "@/features/title/title-screen";
import { useMediaNavigation } from "@/shared/navigation/use-media-navigation";
import { Notice } from "@/shared/ui/notice";
export default function DetailRoute() {
  const { id } = useLocalSearchParams<{
    id: string;
  }>();
  const navigation = useMediaNavigation();
  if (!id || Array.isArray(id)) return <Notice message="Invalid title." />;
  return (
    <SafeAreaView edges={["left", "right", "bottom"]} style={{ flex: 1 }}>
      <TitleScreen id={id} {...navigation} />
    </SafeAreaView>
  );
}
