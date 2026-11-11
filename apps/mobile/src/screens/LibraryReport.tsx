import { Image } from "expo-image";
import { useEffect, useState } from "react";
import {
  Alert,
  FlatList,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import type { ItemCard } from "../../../../packages/api-client/src/types";
import type { LocalRoot } from "../../../../packages/local-library/src/library";
import { Icon, Notice } from "../components/ui";
import { localLibrary, searchTitles } from "../lib/local";
import { colors, fonts } from "../ui/theme";
import { addLocalFiles } from "./LocalSettings";
function Action({
  label,
  onPress,
  disabled = false,
  subtle = false,
}: {
  label: string;
  onPress: () => void;
  disabled?: boolean;
  subtle?: boolean;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [
        s.action,
        subtle && s.subtle,
        disabled && { opacity: 0.45 },
        pressed && { opacity: 0.7 },
      ]}
    >
      <Text style={[s.actionText, subtle && { color: colors.ink }]}>
        {label}
      </Text>
    </Pressable>
  );
}
export function LibraryReport({ back }: { back: () => void }) {
  const [, update] = useState(0);
  const [filter, setFilter] = useState<"all" | "review" | "files">("all");
  const [editing, setEditing] = useState<ItemCard | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  useEffect(() => localLibrary.subscribe(() => update((n) => n + 1)), []);
  const all = localLibrary.cards();
  const items =
    filter === "files"
      ? localLibrary.state.records.map((r) => r.card)
      : filter === "review"
        ? all.filter(
            (c) =>
              c.matchStatus !== "matched" ||
              localLibrary.state.records.some(
                (r) =>
                  (r.id === c.id || r.card.parentId === c.id) &&
                  r.metadataError,
              ),
          )
        : all;
  async function add(kind: LocalRoot["kind"]) {
    setBusy(true);
    setMessage("");
    try {
      await addLocalFiles(kind);
    } catch (e) {
      setMessage(String(e));
    } finally {
      setBusy(false);
    }
  }
  async function remove(item: ItemCard) {
    try {
      await localLibrary.removeTitle(item.id);
    } catch (e) {
      setMessage(String(e));
    }
  }
  return (
    <View style={{ flex: 1, backgroundColor: colors.canvas }}>
      <FlatList
        data={items}
        keyExtractor={(item) => String(item.id)}
        contentContainerStyle={{ padding: 20, paddingBottom: 30, gap: 12 }}
        keyboardShouldPersistTaps="handled"
        ListHeaderComponent={
          <View style={{ gap: 14, marginBottom: 8 }}>
            <Pressable
              accessibilityLabel="Back to Settings"
              onPress={back}
              style={{ paddingVertical: 8 }}
            >
              <Text style={s.back}>‹ Settings</Text>
            </Pressable>
            <View
              style={{
                flexDirection: "row",
                justifyContent: "space-between",
                alignItems: "center",
              }}
            >
              <Text style={s.title}>Library report</Text>
              <Action
                label={busy ? "Adding…" : "+ Add"}
                disabled={busy}
                onPress={() =>
                  Alert.alert(
                    "Add local videos",
                    "Choose the type of title to add.",
                    [
                      { text: "Movies", onPress: () => void add("movies") },
                      { text: "TV shows", onPress: () => void add("tv") },
                      { text: "Anime", onPress: () => void add("anime") },
                      { text: "Cancel", style: "cancel" },
                    ],
                  )
                }
              />
            </View>
            <Text style={s.description}>
              Add videos, correct a match, or remove a title. Your original
              files stay untouched.
            </Text>
            <View style={{ flexDirection: "row", gap: 8 }}>
              {(["all", "review", "files"] as const).map((f) => (
                <Pressable
                  key={f}
                  onPress={() => setFilter(f)}
                  style={[s.chip, filter === f && s.selected]}
                >
                  <Text style={s.chipText}>
                    {f === "all"
                      ? `All titles (${all.length})`
                      : f === "files"
                        ? "Files"
                        : "Needs attention"}
                  </Text>
                </Pressable>
              ))}
            </View>
            {!!message && <Notice message={message} />}
          </View>
        }
        ListEmptyComponent={
          <Text style={s.description}>
            {filter === "review"
              ? "No titles need attention."
              : "No titles yet. Add a video here, or connect a folder in Settings."}
          </Text>
        }
        renderItem={({ item }) => {
          const record = localLibrary.state.records.find(
            (r) => r.id === item.id || r.card.parentId === item.id,
          );
          return (
            <View style={s.card}>
              <View style={{ flexDirection: "row", gap: 14 }}>
                {item.poster ? (
                  <Image
                    source={item.poster}
                    style={s.poster}
                    contentFit="cover"
                  />
                ) : (
                  <View
                    style={[
                      s.poster,
                      { alignItems: "center", justifyContent: "center" },
                    ]}
                  >
                    <Icon
                      name={item.kind === "series" ? "tv" : "film"}
                      size={24}
                      color={colors.quiet}
                    />
                  </View>
                )}
                <View style={{ flex: 1, gap: 6 }}>
                  <Text style={s.name} numberOfLines={2}>
                    {item.name}
                  </Text>
                  <Text style={s.caption}>
                    {item.kind === "series"
                      ? "TV show"
                      : item.kind === "episode"
                        ? "TV episode"
                        : "Movie"}
                    {item.year ? ` · ${item.year}` : ""}
                  </Text>
                  <Text
                    style={[
                      s.caption,
                      item.matchStatus !== "matched" && { color: colors.amber },
                    ]}
                  >
                    {item.matchStatus === "matched"
                      ? "Identified with TMDB"
                      : "Choose the correct title"}
                  </Text>
                  <Text style={s.file} numberOfLines={1}>
                    {record?.file.name}
                  </Text>
                </View>
              </View>
              {!!record?.metadataError && (
                <Text style={[s.caption, { color: colors.amber }]}>
                  {record.metadataError}
                </Text>
              )}
              <View style={{ flexDirection: "row", gap: 8 }}>
                <View style={{ flex: 1 }}>
                  <Action
                    label="Identify / edit"
                    subtle
                    onPress={() => setEditing(item)}
                  />
                </View>
                <Action
                  label="Remove"
                  subtle
                  onPress={() =>
                    Alert.alert(
                      "Remove this title?",
                      "It will stay excluded from folder scans. The video file will stay untouched.",
                      [
                        { text: "Cancel" },
                        {
                          text: "Remove",
                          style: "destructive",
                          onPress: () => void remove(item),
                        },
                      ],
                    )
                  }
                />
              </View>
            </View>
          );
        }}
      />
      <Modal
        visible={!!editing}
        animationType="slide"
        onRequestClose={() => setEditing(null)}
      >
        <SafeAreaView style={{ flex: 1, backgroundColor: colors.canvas }}>
          {editing && (
            <IdentifyTitle
              key={editing.id}
              item={editing}
              close={() => setEditing(null)}
            />
          )}
        </SafeAreaView>
      </Modal>
    </View>
  );
}
function IdentifyTitle({ item, close }: { item: ItemCard; close: () => void }) {
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
    if (!query.trim()) {
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
  }, [query, kind]);
  async function choose(result?: any) {
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
          <Action
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
  file: { fontSize: 11, color: colors.quiet },
  chip: {
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 20,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.line,
  },
  selected: { backgroundColor: colors.strong, borderColor: colors.brand },
  chipText: { fontSize: 13, fontFamily: fonts.medium, color: colors.ink },
  action: {
    minHeight: 44,
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderRadius: 9,
    backgroundColor: colors.brand,
    alignItems: "center",
    justifyContent: "center",
  },
  subtle: { backgroundColor: colors.elevated },
  actionText: { fontSize: 13, fontFamily: fonts.medium, color: colors.ink },
  input: {
    color: colors.ink,
    fontSize: 16,
    fontFamily: fonts.regular,
    backgroundColor: colors.surface,
    padding: 14,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: colors.line,
  },
});
