import { useMemo, useState, useSyncExternalStore } from "react";
import { FlatList, Pressable, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { localLibrary } from "@/core/library/local-runtime";
import { Button } from "@/shared/ui/button";
import { Notice } from "@/shared/ui/notice";
import { PageHeader } from "@/shared/ui/page-header";
import { useAppDialog } from "@/shared/ui/app-dialog";

const subscribe = (listener: () => void) => localLibrary.subscribe(listener);
const version = () => localLibrary.version;
function formatSize(bytes: number) {
  if (bytes >= 1024 ** 3) return `${(bytes / 1024 ** 3).toFixed(2)} GB`;
  return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
}

export function StorageScreen() {
  const revision = useSyncExternalStore(subscribe, version);
  const show = useAppDialog();
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [watchedOnly, setWatchedOnly] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const records = localLibrary.state.records;
  const sorted = useMemo(() => {
    void revision;
    return records.filter((record) => !watchedOnly || record.card.watch?.played)
      .sort((a, b) => b.file.size - a.file.size);
  }, [records, watchedOnly, revision]);
  const selection = sorted.filter((record) => selected.has(record.id));
  const total = records.reduce((sum, record) => sum + record.file.size, 0);
  const size = selection.reduce((sum, record) => sum + record.file.size, 0);
  const confirm = () => show(
    "Delete selected videos?",
    `Permanently delete ${selection.length} ${selection.length === 1 ? "video" : "videos"} using about ${formatSize(size)}.\n\n${selection.slice(0, 6).map((record) => record.file.name).join("\n")}${selection.length > 6 ? `\nAnd ${selection.length - 6} more` : ""}`,
    [{ text: "Delete videos", style: "destructive", onPress: () => {
      setBusy(true);
      setMessage("");
      void localLibrary.deleteFiles(selection.map((record) => record.id)).then((result) => {
        setMessage(`Deleted ${result.deleted}. Freed about ${formatSize(result.bytes)}.${result.failed ? ` ${result.failed} couldn’t be deleted and are still in the library.` : ""}`);
        const remaining = new Set(localLibrary.state.records.map((record) => record.id));
        setSelected((current) => new Set([...current].filter((id) => remaining.has(id))));
      }).catch(() => setMessage("Couldn’t delete the selected videos.")).finally(() => setBusy(false));
    } }],
  );
  return (
    <SafeAreaView className="flex-1 bg-background">
      <PageHeader title="Storage" subtitle={`${formatSize(total)} in indexed video files`} />
      <View className="gap-2 px-5 pb-2">
        <Button label={watchedOnly ? "Show all videos" : "Show watched only"} selected={watchedOnly} disabled={busy}
          onPress={() => { setWatchedOnly(!watchedOnly); setSelected(new Set()); }} />
        {message ? <Notice message={message} /> : null}
      </View>
      <FlatList data={sorted} keyExtractor={(record) => String(record.id)}
        contentContainerStyle={{ padding: 20, gap: 8 }}
        ListEmptyComponent={<Text className="text-muted">No videos to review.</Text>}
        renderItem={({ item }) => <Pressable
          accessibilityRole="checkbox" accessibilityState={{ checked: selected.has(item.id), disabled: busy }} disabled={busy}
          className={selected.has(item.id) ? "rounded-xl border border-foreground bg-surface px-4 py-3" : "rounded-xl border border-border bg-surface px-4 py-3"}
          onPress={() => setSelected((current) => {
            const next = new Set(current);
            if (next.has(item.id)) next.delete(item.id);
            else next.add(item.id);
            return next;
          })}>
          <Text className="font-archivo-medium text-foreground">{item.file.name}</Text>
          <Text className="text-muted">{formatSize(item.file.size)}{item.card.watch?.played ? " · Watched" : ""}</Text>
        </Pressable>} />
      <View className="px-5 pb-3">
        <Button primary label={busy ? "Deleting…" : `Review ${selection.length} selected · ${formatSize(size)}`}
          disabled={!selection.length || busy} onPress={confirm} />
      </View>
    </SafeAreaView>
  );
}
