import { LibraryScreen } from "@/features/library/library-screen";
import { useMediaNavigation } from "@/shared/navigation/use-media-navigation";

export default function LibrariesRoute() {
  const navigation = useMediaNavigation();
  return <LibraryScreen kind="movie" {...navigation} />;
}
