import { SearchScreen } from "@/features/search/search-screen";
import { useMediaNavigation } from "@/shared/navigation/use-media-navigation";

export default function SearchRoute() {
  const navigation = useMediaNavigation();
  return <SearchScreen {...navigation} />;
}
