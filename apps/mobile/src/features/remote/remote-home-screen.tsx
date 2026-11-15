import { useIsFocused } from "expo-router";
import { HomeScreen } from "@/features/home/home-screen";
import { useMediaNavigation } from "@/shared/navigation/use-media-navigation";
import { clearCatalogCache } from "./lib/tmdb";
import { useRemoteHome } from "./lib/use-remote-home";

/**
 * Online mode is additive: the local library rows stay, then the TMDB rows
 * follow. The local HomeScreen owns the layout so both catalogs share it.
 */
export function RemoteHomeScreen() {
  const active = useIsFocused();
  const navigation = useMediaNavigation();
  const { data, carouselItems, rows, open, play } = useRemoteHome();

  return (
    <HomeScreen
      {...navigation}
      active={active}
      online={{
        rows,
        carouselItems,
        open,
        play,
        loading: data.loading,
        refresh: () => {
          clearCatalogCache();
          data.retry();
        },
      }}
    />
  );
}
