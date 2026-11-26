/// Local watchlist: movies and series saved from any title page.
import { FlatList, useWindowDimensions } from "react-native";
import { Screen } from "@/shared/ui/screen";
import { useClient } from "@/core/client/client-provider";
import { useResource } from "@/core/resources/use-resource";
import { useMediaNavigation } from "@/shared/navigation/use-media-navigation";
import { Card } from "@/shared/ui/media-card";
import { PageState } from "@/shared/ui/page-state";
import { Reveal } from "@/shared/ui/reveal";
import { LibraryGridSkeleton } from "@/shared/ui/skeleton";
import { ListVideo } from "@/shared/ui/icons";

export function WatchlistScreen() {
  const { width } = useWindowDimensions();
  const { api } = useClient();
  const navigation = useMediaNavigation();
  const watchlist = useResource((signal) => api.watchlist(signal), [api]);
  const items = watchlist.value ?? [];
  const loading = watchlist.loading && !watchlist.value;
  const cardWidth = Math.max(132, Math.floor((width - 40 - 12) / 2));

  return (
    <Screen title="Watchlist">
      <Reveal
        phase={loading ? "loading" : watchlist.error || items.length === 0 ? "state" : "ready"}
      >
        {loading ? (
          <LibraryGridSkeleton />
        ) : watchlist.error ? (
          <PageState
            title="Couldn’t load your watchlist"
            message={watchlist.error}
            onAction={watchlist.retry}
          />
        ) : items.length === 0 ? (
          <PageState
            icon={ListVideo}
            title="Your watchlist is empty"
            message="Open any movie or show and tap the bookmark to keep it here."
          />
        ) : (
          <FlatList
            data={items}
            keyExtractor={(item) => item.publicId}
            numColumns={2}
            contentContainerStyle={{ padding: 20, gap: 14 }}
            columnWrapperStyle={{ gap: 12 }}
            renderItem={({ item }) => (
              <Card
                item={item}
                api={api}
                width={cardWidth}
                onPress={() => navigation.open(item.publicId)}
              />
            )}
          />
        )}
      </Reveal>
    </Screen>
  );
}
