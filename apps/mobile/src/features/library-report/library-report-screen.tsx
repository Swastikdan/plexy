import { Image } from "expo-image";
import { useEffect,useState } from "react";
import {
Alert,
FlatList,
Modal,
Pressable,
StyleSheet,
Text,
View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import type { ItemCard } from "../../../../../packages/api-client/src/types";
import type { LocalRoot } from "../../../../../packages/local-library/src/library";
import { localLibrary } from "../../core/library/local-runtime";
import { colors,control,fonts } from "../../shared/theme";
import { Icon } from "../../shared/ui/icon";
import { Notice } from "../../shared/ui/notice";
import { addLocalFiles } from "../library/lib/import-local-files";
import { IdentifyTitle } from "./components/identify-title";
import { ReportAction } from "./components/report-action";

export function LibraryReportScreen({ back }: { back: () => void }) {
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
              <ReportAction
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
                  <ReportAction
                    label="Identify / edit"
                    subtle
                    onPress={() => setEditing(item)}
                  />
                </View>
                <ReportAction
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
    borderRadius: control.radius,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.line,
  },
selected: { backgroundColor: colors.strong, borderColor: colors.brand },
chipText: { fontSize: 13, fontFamily: fonts.medium, color: colors.ink }
});
