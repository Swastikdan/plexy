import React,{ useState } from "react";
import {
Pressable,
ScrollView,
Text,
TextInput,
useWindowDimensions,
View,
} from "react-native";
import { useClient } from "@/core/client/client-provider";
import type { ItemCard } from "@/core/library/catalog-api";
import { useResource } from "@/core/resources/use-resource";
import { useColors } from "@/shared/theme";
import { cn } from "@/shared/lib/cn";
import { Search as SearchIcon,X } from "@/shared/ui/icons";
import { Loading } from "@/shared/ui/loading";
import { Notice } from "@/shared/ui/notice";
import { PageHeader } from "@/shared/ui/page-header";
import { CatalogRow } from "@/features/catalog/components/catalog-row";
import { OpenTitle } from "@/features/catalog/types";
import { SearchGrid } from "./components/search-grid";

export function SearchScreen({
  open,
  play,
}: {
  open: OpenTitle;
  play: (fileId: number) => void;
}) {
  const colors = useColors();
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
      contentContainerStyle={{ paddingBottom: 32, gap: 14 }}
      showsVerticalScrollIndicator={false}
    >
      <PageHeader title="Search" />

      {/* Compact search field with an explicit search affordance */}
      <View
        className={cn(
          "flex-row items-center gap-2.5 mx-5 min-h-[46px] bg-surface rounded-[12px] px-3 border border-border",
          inputFocus && "border-foreground/36 bg-surface-secondary",
        )}
      >
        <SearchIcon
          size={18}
          color={inputFocus ? colors.ink : colors.muted}
          strokeWidth={2.1}
        />
        <TextInput
          className="flex-1 font-archivo-regular text-[15px] text-foreground py-2.5"
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
            className={cn(
              "w-6 h-6 rounded-full items-center justify-center bg-foreground/8",
              "active:opacity-[0.6]",
            )}
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
                  play={play}
                  focused={focused}
                  cardWidth={cardWidth}
                  columns={columns}
                />
              );
            })}
            {!homeData.value?.rows.length && (
              <Text className="font-archivo-regular text-[14px] text-muted px-5">
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
              play={play}
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
              play={play}
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
