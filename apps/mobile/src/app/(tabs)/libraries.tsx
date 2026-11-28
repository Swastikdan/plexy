import { Screen, TAB_EDGES } from "@/shared/ui/screen";
import { useClient } from "@/core/client/client-provider";
import { LibraryAttention } from "@/features/catalog/components/library-attention";
import { LibraryScreen } from "@/features/library/library-screen";
import { useMediaNavigation } from "@/shared/navigation/use-media-navigation";

export default function LibrariesRoute() {
  const navigation = useMediaNavigation();
  const { preferences } = useClient();
  return (
    // Tabs crossfade on switch, so the content entrance stays off here.
    <Screen
      edges={TAB_EDGES}
      animated={false}
      header={preferences.source !== "online" && <LibraryAttention />}
    >
      <LibraryScreen {...navigation} />
    </Screen>
  );
}
