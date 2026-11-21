/// Local watchlist: movies and series saved from any title page.
import { FlatList, useWindowDimensions, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useClient } from "@/core/client/client-provider";
import { useResource } from "@/core/resources/use-resource";
import { useMediaNavigation } from "@/shared/navigation/use-media-navigation";
import { Card } from "@/shared/ui/media-card";
import { PageHeader } from "@/shared/ui/page-header";
import { PageState } from "@/shared/ui/page-state";
import { ListVideo } from "@/shared/ui/icons";
import { useColors } from "@/shared/theme";

export function WatchlistScreen() {
  const colors = useColors();
  const { width } = useWindowDimensions();
  const { api } = useClient();
  const navigation = useMediaNavigation();
  const watchlist = useResource((signal) => api.watchlist(signal), [api]);
  const items = watchlist.value ?? [];
  const cardWidth = Math.max(132, Math.floor((width - 40 - 12) / 2));

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.canvas }}>
      <PageHeader title="Watchlist" />
      {watchlist.loading && !watchlist.value ? (
        <View className="flex-1 items-center justify-center">
          <PageState title="Loading your watchlist" message="Reading titles saved on this device." />
        </View>
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
    </SafeAreaView>
  );
}
