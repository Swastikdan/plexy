import { useMemo, useState, useSyncExternalStore } from "react";
import { SectionList, Pressable, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { displayName, localLibrary } from "@/core/library/local-runtime";
import { CheckboxIndicator } from "@/shared/ui/checkbox-indicator";
import { Film, Folder, HardDrive, Trash2 } from "@/shared/ui/icons";
import { useColors } from "@/shared/theme";
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
  const colors = useColors();
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
  const sections = useMemo(() => {
    const roots = new Map(localLibrary.state.roots.map((root) => [root.uri, root]));
    const folders = new Map<string, { key: string; title: string; bytes: number; data: typeof sorted }>();
    for (const record of sorted) {
      const root = roots.get(record.root);
      const parent = record.file.relativePath.split("/").slice(0, -1).join("/");
      const key = root?.singleFile ? "standalone" : `${record.root}|${parent}`;
      let folder = folders.get(key);
      if (!folder) {
        const rootName = root?.name || displayName(record.root);
        const title = root?.singleFile ? "Individual imports" : [rootName, parent].filter(Boolean).join(" / ");
        folder = { key, title, bytes: 0, data: [] };
        folders.set(key, folder);
      }
      folder.bytes += record.file.size;
      folder.data.push(record);
    }
    return [...folders.values()].sort((a, b) => b.bytes - a.bytes || a.title.localeCompare(b.title));
  }, [sorted]);
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
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.canvas }}>
      <PageHeader title="Storage" />
      <View className="mx-5 mb-2 flex-row items-center gap-4 rounded-2xl bg-surface px-4 py-3">
        <HardDrive size={24} color={colors.muted} />
        <View className="flex-1">
          <Text className="font-archivo-bold text-[22px] text-foreground">{formatSize(total)}</Text>
          <Text className="text-muted">Library video storage</Text>
        </View>
      </View>
      {message ? <View className="px-5 pb-2"><Notice message={message} /></View> : null}
      <View className="self-start px-5 pb-1">
        <Pressable accessibilityRole="checkbox" accessibilityState={{ checked: watchedOnly, disabled: busy }} disabled={busy}
          className="min-h-11 flex-row items-center gap-2 py-1"
          onPress={() => { setWatchedOnly(!watchedOnly); setSelected(new Set()); }}>
          <CheckboxIndicator checked={watchedOnly} />
          <Text className="font-archivo-medium text-foreground">Watched videos only</Text>
        </Pressable>
      </View>
      <SectionList
        style={{ flex: 1 }}
        sections={sections}
        keyExtractor={(record) => String(record.id)}
        stickySectionHeadersEnabled={false}
        contentContainerStyle={{ paddingHorizontal: 20, paddingTop: 6, paddingBottom: 28 }}
        ListEmptyComponent={<Text className="py-4 text-muted">{watchedOnly ? "No watched videos." : "No videos in your library."}</Text>}
        renderSectionHeader={({ section }) => (
          <View className="flex-row items-center gap-2 pb-2 pt-4">
            <Folder size={19} color={colors.muted} />
            <Text className="flex-1 font-archivo-bold text-foreground">{section.title}</Text>
            <Text className="text-muted">{formatSize(section.bytes)}</Text>
          </View>
        )}
        renderItem={({ item }) => (
          <Pressable
            accessibilityRole="checkbox" accessibilityState={{ checked: selected.has(item.id), disabled: busy }}
            disabled={busy}
            className="mb-2 flex-row items-center gap-3 rounded-xl border border-border bg-surface px-4 py-3 active:opacity-70"
            onPress={() => setSelected((current) => {
              const next = new Set(current);
              if (next.has(item.id)) next.delete(item.id);
              else next.add(item.id);
              return next;
            })}
          >
            <Film size={19} color={colors.muted} />
            <View className="flex-1">
              <Text className="font-archivo-medium text-foreground" numberOfLines={2}>{item.file.name}</Text>
              <Text className="text-muted">{formatSize(item.file.size)}{item.card.watch?.played ? " · Watched" : ""}</Text>
            </View>
            <CheckboxIndicator checked={selected.has(item.id)} />
          </Pressable>
        )}
      />
      {selection.length > 0 || busy ? (
        <View className="border-t border-border bg-background px-5 pb-4 pt-3">
          <View className="mb-2 flex-row items-center gap-2">
            <Trash2 size={17} color={colors.muted} />
            <Text className="font-archivo-medium text-muted">{selection.length} selected · {formatSize(size)}</Text>
          </View>
          <Button primary label={busy ? "Deleting…" : "Review deletion"} disabled={busy} onPress={confirm} />
        </View>
      ) : null}
    </SafeAreaView>
  );
}
