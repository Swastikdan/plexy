import { Screen, TAB_EDGES } from "@/shared/ui/screen";
import { useClient } from "@/core/client/client-provider";
import { LibraryAttention } from "@/features/catalog/components/library-attention";
import { SearchScreen } from "@/features/search/search-screen";
import { useMediaNavigation } from "@/shared/navigation/use-media-navigation";

export default function SearchRoute() {
  const navigation = useMediaNavigation();
  const { preferences } = useClient();
  return (
    // Tabs crossfade on switch, so the content entrance stays off here.
    <Screen
      edges={TAB_EDGES}
      animated={false}
      header={preferences.source !== "online" && <LibraryAttention />}
    >
      <SearchScreen {...navigation} />
    </Screen>
  );
}
