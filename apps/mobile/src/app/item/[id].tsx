import { useLocalSearchParams } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";
import { Notice } from "../../components/ui";
import { useMediaNavigation } from "../../navigation/useMediaNavigation";
import { DetailScreen } from "../../screens/Catalog";
export default function DetailRoute() {
  const { id } = useLocalSearchParams<{
    id: string;
  }>();
  const navigation = useMediaNavigation();
  if (!id || Array.isArray(id)) return <Notice message="Invalid title." />;
  return (
    <SafeAreaView edges={["left", "right", "bottom"]} style={{ flex: 1 }}>
      <DetailScreen id={id} {...navigation} />
    </SafeAreaView>
  );
}
