import { Image } from "expo-image";
import { useEffect,useState } from "react";
import {
Alert,
FlatList,
Modal,
Pressable,
Text,
View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import type { ItemCard } from "@plexy/api-client/types";
import type { LocalRoot } from "@plexy/local-library/library";
import { useClient } from "@/core/client/client-provider";
import { cn } from "@/shared/lib/cn";
import { useColors } from "@/shared/theme";
import { Film, Tv } from "@/shared/ui/icons";
import { Notice } from "@/shared/ui/notice";
import { addLocalFiles } from "@/features/library/lib/import-local-files";
import { IdentifyTitle } from "./components/identify-title";
import { ReportAction } from "./components/report-action";

export function LibraryReportScreen() {
  const colors = useColors();
  const { api, runtime } = useClient();
  const [, update] = useState(0);
  const [filter, setFilter] = useState<"all" | "review" | "files">("all");
  const [editing, setEditing] = useState<ItemCard | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  useEffect(() => runtime.subscribe(() => update((n) => n + 1)), [runtime]);
  const all = api.report("all");
  const items = api.report(filter);
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
      await api.removeTitle(item.id);
    } catch (e) {
      setMessage(String(e));
    }
  }
  return (
    <View className="flex-1 bg-background">
      <FlatList
        data={items}
        keyExtractor={(item) => String(item.id)}
        contentContainerStyle={{ padding: 20, paddingBottom: 30, gap: 12 }}
        keyboardShouldPersistTaps="handled"
        ListHeaderComponent={
          <View className="mb-2 gap-3.5">
            <View className="flex-row items-center justify-between">
              <Text className="text-[28px] font-archivo-bold text-foreground tracking-[-0.6px]">
                Library report
              </Text>
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
            <Text className="text-[14px] leading-[21px] font-archivo-regular text-muted">
              Add videos, correct a match, or remove a title. Your original
              files stay untouched.
            </Text>
            <View className="flex-row gap-2">
              {(["all", "review", "files"] as const).map((f) => (
                <Pressable
                  key={f}
                  onPress={() => setFilter(f)}
                  className={cn(
                    "rounded-full border px-4 py-2.5",
                    filter === f
                      ? "border-accent bg-accent/20"
                      : "border-border bg-surface",
                  )}
                >
                  <Text className="text-[13px] font-archivo-medium text-foreground">
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
          <Text className="text-[14px] leading-[21px] font-archivo-regular text-muted">
            {filter === "review"
              ? "No titles need attention."
              : "No titles yet. Add a video here, or connect a folder in Settings."}
          </Text>
        }
        renderItem={({ item }) => {
          const record = api.titleFile(item.id);
          return (
            <View className="gap-3 rounded-[12px] bg-surface p-3.5">
              <View className="flex-row gap-3.5">
                {item.poster ? (
                  <Image
                    source={item.poster}
                    className="h-[90px] w-[60px] rounded-[6px] bg-surface-secondary"
                    contentFit="cover"
                  />
                ) : (
                  <View className="h-[90px] w-[60px] items-center justify-center rounded-[6px] bg-surface-secondary">
                    {item.kind === "series" ? <Tv size={24} color={colors.quiet} /> : <Film size={24} color={colors.quiet} />}
                  </View>
                )}
                <View className="flex-1 gap-1.5">
                  <Text
                    className="text-[16px] font-archivo-bold text-foreground"
                    numberOfLines={2}
                  >
                    {item.name}
                  </Text>
                  <Text className="text-[12px] leading-[18px] font-archivo-regular text-muted">
                    {item.kind === "series"
                      ? "TV show"
                      : item.kind === "episode"
                        ? "TV episode"
                        : "Movie"}
                    {item.year ? ` · ${item.year}` : ""}
                  </Text>
                  <Text
                    className={cn(
                      "text-[12px] leading-[18px] font-archivo-regular",
                      // Warning only after identification has finished
                      // without a match or failed outright. While a hydrate
                      // is still running (metadataAt untouched) show a
                      // neutral progress line instead of yellow text.
                      item.matchStatus !== "matched" && record?.metadataAt
                        ? "text-warning"
                        : "text-muted",
                    )}
                  >
                    {item.matchStatus === "matched"
                      ? "Identified with TMDB"
                      : record && !record.metadataAt && !record.metadataError
                        ? "Identifying…"
                        : "Choose the correct title"}
                  </Text>
                  <Text
                    className="text-[11px] text-muted"
                    numberOfLines={1}
                  >
                    {record?.name}
                  </Text>
                </View>
              </View>
              {!!record?.metadataError && (
                <Text className="text-[12px] leading-[18px] font-archivo-regular text-warning">
                  {record.metadataError}
                </Text>
              )}
              <View className="flex-row gap-2">
                <View className="flex-1">
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
