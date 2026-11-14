import React, { useState } from "react";
import {
  FlatList,
  Pressable,
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
import { Search as SearchIcon, X } from "@/shared/ui/icons";
import { Card } from "@/shared/ui/media-card";
import { Loading } from "@/shared/ui/loading";
import { Notice } from "@/shared/ui/notice";
import { PageHeader } from "@/shared/ui/page-header";
import { CatalogRow } from "@/features/catalog/components/catalog-row";
import { OpenTitle } from "@/features/catalog/types";

type ResultRow =
  | { kind: "header"; key: string; title: string }
  | { kind: "cards"; key: string; items: ItemCard[] };

function buildResultRows(titles: ItemCard[], episodes: ItemCard[]): ResultRow[] {
  const rows: ResultRow[] = [];
  const append = (title: string, items: ItemCard[]) => {
    if (!items.length) return;
    rows.push({ kind: "header", key: `header-${title}`, title });
    for (let index = 0; index < items.length; index += 2) {
      const slice = items.slice(index, index + 2);
      rows.push({
        kind: "cards",
        key: `cards-${title}-${slice.map((item) => item.id).join("-")}`,
        items: slice,
      });
    }
  };
  append("Movies & Shows", titles);
  append("Episodes", episodes);
  return rows;
}

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
  // Responsive grid config for search results.
  const available = width - 40;
  const cardWidth = Math.floor((available - 12) / 2);
  const homeRows = React.useMemo(
    () =>
      (homeData.value?.rows ?? [])
        .map((row) => ({
          ...row,
          items:
            row.key === "continue"
              ? row.items.filter((item) => item.watch?.position && !item.watch?.played)
              : row.items,
        }))
        .filter((row) => row.items.length > 0),
    [homeData.value],
  );
  const resultRows = React.useMemo(
    () => buildResultRows(data.value?.titles ?? [], data.value?.episodes ?? []),
    [data.value],
  );
  const openItem = React.useCallback(
    (item: ItemCard) => {
      if (item.kind === "episode" && item.fileId != null) play(item.fileId);
      else open(item.publicId);
    },
    [play, open],
  );
  return (
    <View className="flex-1 gap-3.5">
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

      {debounced && data.loading ? (
        <Loading />
      ) : debounced && data.error ? (
        <Notice message={data.error} retry={data.retry} />
      ) : !debounced ? (
        homeData.loading ? (
          <Loading />
        ) : homeData.error ? (
          <Notice message={homeData.error} retry={homeData.retry} />
        ) : homeRows.length ? (
          <FlatList
            className="flex-1"
            data={homeRows}
            keyExtractor={(row) => row.key}
            renderItem={({ item: row }) => (
              <CatalogRow
                title={row.title}
                items={row.items}
                open={open}
                onPlay={handlePlay}
                isContinueWatching={row.key === "continue"}
              />
            )}
            contentContainerStyle={{ paddingBottom: 32, gap: 14 }}
            keyboardShouldPersistTaps="handled"
            keyboardDismissMode="on-drag"
            showsVerticalScrollIndicator={false}
          />
        ) : (
          <Text className="font-archivo-regular text-[14px] text-muted px-5">
            Find a title or an episode in your library.
          </Text>
        )
      ) : !resultRows.length ? (
        <View className="flex-1 items-center justify-center px-6">
          <View className="self-center rounded-[18px] border border-border bg-surface px-6 py-5">
            <Text className="text-center text-[14px] font-archivo-medium text-muted">
              No results. Try another one.
            </Text>
          </View>
        </View>
      ) : (
        <FlatList
          className="flex-1"
          data={resultRows}
          keyExtractor={(row) => row.key}
          renderItem={({ item: row }) =>
            row.kind === "header" ? (
              <Text className="px-5 font-archivo-bold text-[16px] text-foreground tracking-[-0.3px]">
                {row.title}
              </Text>
            ) : (
              <View className="flex-row gap-3 px-5">
                {row.items.map((item) => (
                  <Card
                    key={item.id}
                    width={cardWidth}
                    item={item}
                    api={api}
                    onPress={() => openItem(item)}
                  />
                ))}
              </View>
            )
          }
          contentContainerStyle={{ paddingBottom: 32, gap: 14 }}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="on-drag"
          showsVerticalScrollIndicator={false}
        />
      )}
    </View>
  );
}
