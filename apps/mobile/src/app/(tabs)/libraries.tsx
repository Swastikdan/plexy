import { SafeAreaView } from "react-native-safe-area-context";
import { useClient } from "@/core/client/client-provider";
import { LibraryAttention } from "@/features/catalog/components/library-attention";
import { LibraryScreen } from "@/features/library/library-screen";
import { useMediaNavigation } from "@/shared/navigation/use-media-navigation";
import { useColors } from "@/shared/theme";

export default function LibrariesRoute() {
  const navigation = useMediaNavigation();
  const { preferences } = useClient();
  const colors = useColors();
  return (
    <SafeAreaView
      edges={["top", "left", "right"]}
      style={{ flex: 1, backgroundColor: colors.canvas }}
    >
      {preferences.source !== "remote" && <LibraryAttention />}
      <LibraryScreen {...navigation} />
    </SafeAreaView>
  );
}
