import { SearchScreen } from "../../features/search/search-screen";
import { useMediaNavigation } from "../../shared/navigation/use-media-navigation";
export default function SearchRoute() {
  return <SearchScreen {...useMediaNavigation()} />;
}
