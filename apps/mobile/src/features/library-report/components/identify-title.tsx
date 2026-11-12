import { Image } from "expo-image";
import { useEffect,useState } from "react";
import {
Pressable,
ScrollView,
StyleSheet,
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
import { colors,control,fonts } from "../../../shared/theme";
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
        style={{ paddingVertical: 10 }}
      >
        <Text style={s.back}>‹ Library report</Text>
      </Pressable>
      <Text style={s.title}>Identify title</Text>
      <Text style={s.description}>
        Search by title, then choose the correct result. Change the type if this
        video was classified incorrectly.
      </Text>
      <View style={{ flexDirection: "row", gap: 8 }}>
        {(["movies", "tv"] as const).map((k) => (
          <Pressable
            key={k}
            disabled={busy}
            onPress={() => setKind(k)}
            style={[s.chip, kind === k && s.selected]}
          >
            <Text style={s.chipText}>
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
        style={s.input}
      />
      {kind === "tv" && item.kind !== "series" && (
        <View style={{ flexDirection: "row", gap: 12 }}>
          <View style={{ flex: 1, gap: 6 }}>
            <Text style={s.caption}>Season</Text>
            <TextInput
              value={season}
              onChangeText={setSeason}
              keyboardType="number-pad"
              accessibilityLabel="Season number"
              style={s.input}
            />
          </View>
          <View style={{ flex: 1, gap: 6 }}>
            <Text style={s.caption}>Episode</Text>
            <TextInput
              value={episode}
              onChangeText={setEpisode}
              keyboardType="number-pad"
              accessibilityLabel="Episode number"
              style={s.input}
            />
          </View>
        </View>
      )}
      {!!error && <Notice message={error} />}
      {busy ? (
        <Text style={s.description}>Saving title and downloading artwork…</Text>
      ) : (
        <>
          <ReportAction
            label="Save title without choosing a match"
            subtle
            disabled={!query.trim()}
            onPress={() => void choose()}
          />
          <Text style={s.caption}>
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
              style={[
                s.card,
                { flexDirection: "row", alignItems: "center", gap: 14 },
              ]}
            >
              {!!result.poster_path && (
                <Image
                  source={`https://image.tmdb.org/t/p/w185${result.poster_path}`}
                  style={s.poster}
                  contentFit="cover"
                />
              )}
              <View style={{ flex: 1, gap: 5 }}>
                <Text style={s.name}>{result.title || result.name}</Text>
                <Text style={s.caption}>
                  {(result.release_date || result.first_air_date || "").slice(
                    0,
                    4,
                  )}
                </Text>
                <Text style={s.caption} numberOfLines={3}>
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

const s = StyleSheet.create({
title: {
    fontSize: 28,
    fontFamily: fonts.bold,
    color: colors.ink,
    letterSpacing: -0.6,
  },
description: {
    fontSize: 14,
    lineHeight: 21,
    fontFamily: fonts.regular,
    color: colors.muted,
  },
back: { fontSize: 15, fontFamily: fonts.medium, color: colors.brandLight },
card: {
    padding: 14,
    gap: 12,
    borderRadius: 12,
    backgroundColor: colors.surface,
  },
poster: {
    width: 60,
    height: 90,
    borderRadius: 6,
    backgroundColor: colors.elevated,
  },
name: { fontSize: 16, fontFamily: fonts.bold, color: colors.ink },
caption: {
    fontSize: 12,
    lineHeight: 18,
    fontFamily: fonts.regular,
    color: colors.muted,
  },
chip: {
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: control.radius,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.line,
  },
selected: { backgroundColor: colors.strong, borderColor: colors.brand },
chipText: { fontSize: 13, fontFamily: fonts.medium, color: colors.ink },
input: {
    color: colors.ink,
    fontSize: 16,
    fontFamily: fonts.regular,
    backgroundColor: colors.surface,
    padding: 14,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: colors.line,
  }
});
