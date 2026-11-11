import { useMediaNavigation } from "../../navigation/useMediaNavigation";
import { SearchScreen } from "../../screens/Catalog";
export default function SearchRoute() {
  return <SearchScreen {...useMediaNavigation()} />;
}
