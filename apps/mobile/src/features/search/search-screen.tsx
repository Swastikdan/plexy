import React,{ useState } from "react";
import {
Pressable,
ScrollView,
StyleSheet,
Text,
TextInput,
useWindowDimensions,
View,
} from "react-native";
import { useClient } from "../../core/client/client-provider";
import type { ItemCard } from "../../core/library/catalog-api";
import { useResource } from "../../core/resources/use-resource";
import { colors,fonts } from "../../shared/theme";
import { Search as SearchIcon,X } from "../../shared/ui/icons";
import { Loading } from "../../shared/ui/loading";
import { Notice } from "../../shared/ui/notice";
import { PageHeader } from "../../shared/ui/page-header";
import { CatalogRow } from "../catalog/components/catalog-row";
import { OpenTitle } from "../catalog/types";
import { SearchGrid } from "./components/search-grid";

export function SearchScreen({
  open,
  play,
}: {
  open: OpenTitle;
  play?: (fileId: number) => void;
}) {
  const { api } = useClient();
  const { width } = useWindowDimensions();
  const [query, setQuery] = useState("");
  const [debounced, setDebounced] = useState("");
  const [, focused] = useState<number | null>(null);
  const [inputFocus, setInputFocus] = useState(false);
  React.useEffect(() => {
    const timer = setTimeout(() => setDebounced(query.trim()), 300);
    return () => clearTimeout(timer);
  }, [query]);
  const homeData = useResource(
    (signal) => (!debounced ? api.home(signal) : Promise.resolve(null)),
    [api, debounced],
  );
  const data = useResource(
    (signal) =>
      debounced
        ? api.search(debounced, signal)
        : Promise.resolve({ titles: [], episodes: [] }),
    [api, debounced],
  );
  const handlePlay = React.useCallback(
    (item: ItemCard) => {
      if (item.fileId && play) {
        play(item.fileId);
        return;
      }
      void api
        .detail(item.publicId)
        .then((d) => {
          const fid =
            d.file?.fileId ||
            d.episodes?.find((e) => e.fileId && !e.watch?.played)?.fileId ||
            d.episodes?.find((e) => e.fileId)?.fileId;
          if (fid && play) {
            play(fid);
          } else {
            open(item.publicId);
          }
        })
        .catch(() => open(item.publicId));
    },
    [api, play, open],
  );
  // Grid config (responsive cols for search results)
  const available = width - 0 - 40;
  const columns = 2;
  const cardWidth = Math.floor(available / columns) - 10;
  return (
    <ScrollView
      keyboardShouldPersistTaps="handled"
      contentContainerStyle={styles.searchContainer}
      showsVerticalScrollIndicator={false}
    >
      <PageHeader title="Search" />

      {/* Compact search field with an explicit search affordance */}
      <View
        style={[
          styles.searchInputWrap,
          inputFocus && styles.searchInputWrapFocused,
        ]}
      >
        <SearchIcon
          size={18}
          color={inputFocus ? "#ffffff" : colors.muted}
          strokeWidth={2.1}
        />
        <TextInput
          style={[styles.searchInput]}
          value={query}
          onChangeText={setQuery}
          placeholder="Movies, shows and episodes"
          placeholderTextColor={colors.muted}
          returnKeyType="search"
          autoCorrect={false}
          onFocus={() => setInputFocus(true)}
          onBlur={() => setInputFocus(false)}
        />
        {!!query && (
          <Pressable
            onPress={() => setQuery("")}
            accessibilityRole="button"
            accessibilityLabel="Clear search"
            hitSlop={10}
            style={({ pressed }) => [
              styles.searchClear,
              pressed && { opacity: 0.6 },
            ]}
          >
            <X size={15} color={colors.muted} strokeWidth={2.4} />
          </Pressable>
        )}
      </View>

      {/* States */}
      {debounced && data.loading ? (
        <Loading />
      ) : debounced && data.error ? (
        <Notice message={data.error} retry={data.retry} />
      ) : !debounced ? (
        homeData.loading ? (
          <Loading />
        ) : (
          <>
            {homeData.value?.rows.map((row) => {
              const isContinue = row.key === "continue";
              if (isContinue) {
                return (
                  <CatalogRow
                    key={row.key}
                    title={row.title}
                    items={row.items.filter(
                      (i) => i.watch?.position && !i.watch?.played,
                    )}
                    open={open}
                    onPlay={handlePlay}
                    isContinueWatching={true}
                    focused={focused}
                  />
                );
              }
              return (
                <SearchGrid
                  key={row.key}
                  title={row.title}
                  items={row.items}
                  open={open}
                  focused={focused}
                  cardWidth={cardWidth}
                  columns={columns}
                />
              );
            })}
            {!homeData.value?.rows.length && (
              <Text style={styles.searchHint}>
                Find a title or an episode in your library.
              </Text>
            )}
          </>
        )
      ) : !data.value?.titles.length && !data.value?.episodes.length ? (
        <Notice message="No results. Try another title." />
      ) : (
        <>
          {!!data.value?.titles.length && (
            <SearchGrid
              title="Movies & Shows"
              items={data.value.titles}
              open={open}
              focused={focused}
              cardWidth={cardWidth}
              columns={columns}
            />
          )}
          {!!data.value?.episodes.length && (
            <SearchGrid
              title="Episodes"
              items={data.value.episodes}
              open={open}
              focused={focused}
              cardWidth={cardWidth}
              columns={columns}
            />
          )}
        </>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
searchContainer: {
    paddingBottom: 32,
    gap: 14,
  },
searchInputWrap: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    marginHorizontal: 20,
    minHeight: 46,
    backgroundColor: colors.surface,
    borderRadius: 12,
    paddingHorizontal: 14,
    borderWidth: 1,
    borderColor: colors.line,
  },
searchInputWrapFocused: {
    borderColor: "rgba(255,255,255,0.36)",
    backgroundColor: colors.elevated,
  },
searchInput: {
    flex: 1,
    fontFamily: fonts.regular,
    fontSize: 15,
    color: colors.ink,
    paddingVertical: 10,
  },
searchClear: {
    width: 24,
    height: 24,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(255,255,255,0.08)",
  },
searchHint: {
    fontFamily: fonts.regular,
    fontSize: 14,
    color: colors.muted,
    paddingHorizontal: 20,
  }
});
