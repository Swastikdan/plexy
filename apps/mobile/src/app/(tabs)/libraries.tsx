import { useMediaNavigation } from "../../navigation/useMediaNavigation";
import { LibraryScreen } from "../../screens/Catalog";
export default function LibrariesRoute() {
  return <LibraryScreen kind="movie" {...useMediaNavigation()} />;
}
