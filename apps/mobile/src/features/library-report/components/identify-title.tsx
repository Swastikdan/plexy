import { Image } from "expo-image";
import { useEffect,useState } from "react";
import {
Pressable,
ScrollView,
Text,
TextInput,
View,
} from "react-native";
import type { ItemCard } from "../../../../../../packages/api-client/src/types";
import {
localLibrary,
searchTitles,
} from "../../../core/library/local-runtime";
import { useOnline } from "../../../shared/hooks/use-online";
import { cn } from "../../../shared/lib/cn";
import { colors } from "../../../shared/theme";
import { Notice } from "../../../shared/ui/notice";
import { ReportAction } from "./report-action";

export function IdentifyTitle({
  item,
  close,
}: {
  item: ItemCard;
  close: () => void;
}) {
  const online = useOnline();
  const record = localLibrary.state.records.find(
    (r) => r.id === item.id || r.card.parentId === item.id,
  )!;
  const [kind, setKind] = useState<"movies" | "tv">(
    item.kind === "series" || item.kind === "episode" ? "tv" : "movies",
  );
  const [query, setQuery] = useState(
    item.kind === "episode" ? item.parentTitle || item.name : item.name,
  );
  const [season, setSeason] = useState(String(record.card.seasonNumber ?? 1));
  const [episode, setEpisode] = useState(
    String(record.card.episodeNumber ?? 1),
  );
  const [results, setResults] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    let live = true;
    setResults([]);
    setError("");
    if (!online || !query.trim()) {
      setLoading(false);
      return;
    }
    setLoading(true);
    const timer = setTimeout(
      () =>
        void searchTitles(query.trim(), kind)
          .then((rows) => {
            if (live) setResults(rows);
          })
          .catch((e) => {
            if (live) setError(String(e));
          })
          .finally(() => {
            if (live) setLoading(false);
          }),
      350,
    );
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [query, kind, online]);
  async function choose(result?: any) {
    if (result && !online) return;
    setBusy(true);
    setError("");
    try {
      if (
        kind === "tv" &&
        (!/^\d+$/.test(season) || !/^[1-9]\d*$/.test(episode))
      )
        throw new Error(
          "Enter a season number (0 for specials) and an episode number.",
        );
      await localLibrary.identify(item.id, {
        kind,
        title: result?.title || result?.name || query,
        tmdbId: result?.id,
        season: Number(season),
        episode: Number(episode),
      });
      close();
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <ScrollView
      keyboardShouldPersistTaps="handled"
      contentContainerStyle={{ padding: 20, gap: 16, paddingBottom: 40 }}
    >
      <Pressable
        onPress={close}
        disabled={busy}
        className="py-2.5"
      >
        <Text className="text-[15px] font-archivo-medium text-accent">
          ‹ Library report
        </Text>
      </Pressable>
      <Text className="text-[28px] font-archivo-bold text-foreground tracking-[-0.6px]">
        Identify title
      </Text>
      <Text className="text-[14px] leading-[21px] font-archivo-regular text-muted">
        Search by title, then choose the correct result. Change the type if this
        video was classified incorrectly.
      </Text>
      <View className="flex-row gap-2">
        {(["movies", "tv"] as const).map((k) => (
          <Pressable
            key={k}
            disabled={busy}
            onPress={() => setKind(k)}
            className={cn(
              "rounded-full border px-4 py-2.5",
              kind === k
                ? "border-accent bg-accent/20"
                : "border-border bg-surface",
            )}
          >
            <Text className="text-[13px] font-archivo-medium text-foreground">
              {k === "movies" ? "Movie" : "TV show"}
            </Text>
          </Pressable>
        ))}
      </View>
      <TextInput
        value={query}
        onChangeText={setQuery}
        editable={!busy}
        placeholder="Movie or show title"
        placeholderTextColor={colors.quiet}
        accessibilityLabel="Title to identify"
        className="rounded-[10px] border border-border bg-surface p-3.5 text-[16px] font-archivo-regular text-foreground"
      />
      {kind === "tv" && item.kind !== "series" && (
        <View className="flex-row gap-3">
          <View className="flex-1 gap-1.5">
            <Text className="text-[12px] leading-[18px] font-archivo-regular text-muted">
              Season
            </Text>
            <TextInput
              value={season}
              onChangeText={setSeason}
              keyboardType="number-pad"
              accessibilityLabel="Season number"
              className="rounded-[10px] border border-border bg-surface p-3.5 text-[16px] font-archivo-regular text-foreground"
            />
          </View>
          <View className="flex-1 gap-1.5">
            <Text className="text-[12px] leading-[18px] font-archivo-regular text-muted">
              Episode
            </Text>
            <TextInput
              value={episode}
              onChangeText={setEpisode}
              keyboardType="number-pad"
              accessibilityLabel="Episode number"
              className="rounded-[10px] border border-border bg-surface p-3.5 text-[16px] font-archivo-regular text-foreground"
            />
          </View>
        </View>
      )}
      {!!error && <Notice message={error} />}
      {busy ? (
        <Text className="text-[14px] leading-[21px] font-archivo-regular text-muted">
          Saving title and downloading artwork…
        </Text>
      ) : (
        <>
          <ReportAction
            label="Save title without choosing a match"
            subtle
            disabled={!query.trim()}
            onPress={() => void choose()}
          />
          <Text className="text-[12px] leading-[18px] font-archivo-regular text-muted">
            {loading
              ? "Searching TMDB…"
              : results.length
                ? "Choose the matching title"
                : "No matches. Try another title."}
          </Text>
          {results.slice(0, 15).map((result) => (
            <Pressable
              key={result.id}
              disabled={!online}
              onPress={() => void choose(result)}
              className="flex-row items-center gap-3.5 rounded-[12px] bg-surface p-3.5"
            >
              {!!result.poster_path && (
                <Image
                  source={`https://image.tmdb.org/t/p/w185${result.poster_path}`}
                  className="h-[90px] w-[60px] rounded-[6px] bg-surface-secondary"
                  contentFit="cover"
                />
              )}
              <View className="flex-1 gap-[5px]">
                <Text className="text-[16px] font-archivo-bold text-foreground">
                  {result.title || result.name}
                </Text>
                <Text className="text-[12px] leading-[18px] font-archivo-regular text-muted">
                  {(result.release_date || result.first_air_date || "").slice(
                    0,
                    4,
                  )}
                </Text>
                <Text
                  className="text-[12px] leading-[18px] font-archivo-regular text-muted"
                  numberOfLines={3}
                >
                  {result.overview}
                </Text>
              </View>
            </Pressable>
          ))}
        </>
      )}
    </ScrollView>
  );
}
