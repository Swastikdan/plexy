import { SafeAreaView } from "react-native-safe-area-context";
import { useState, useSyncExternalStore } from "react";
import { Directory, File } from "expo-file-system";
import { SectionList, Text, View } from "react-native";
import { displayName, localLibrary } from "@/core/library/local-runtime";
import { Film, Folder } from "@/shared/ui/icons";
import { useColors } from "@/shared/theme";
import { Button } from "@/shared/ui/button";
import { Notice } from "@/shared/ui/notice";
import { PageHeader } from "@/shared/ui/page-header";

const subscribe = (listener: () => void) => localLibrary.subscribe(listener);
const getVersion = () => localLibrary.version;

async function pickVideo() {
  const result = await File.pickFileAsync({ mimeTypes: ["video/*", "application/octet-stream", "application/x-matroska"] });
  return result.canceled ? null : result.result;
}

export function LibraryRecoveryScreen() {
  const colors = useColors();
  useSyncExternalStore(subscribe, getVersion);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  async function run(action: () => Promise<boolean | void>) {
    setBusy(true);
    setMessage("");
    try {
      if (await action()) setMessage("Reconnected. Your library and watch progress are available again.");
    } catch (error) {
      if (!(error instanceof Error && /cancel/i.test(error.message)))
        setMessage(error instanceof Error ? error.message : "Couldn’t reconnect this location.");
    } finally {
      setBusy(false);
    }
  }
  const roots = localLibrary.state.roots;
  const missing = new Map((localLibrary.state.missingFiles ?? []).map(record => [record.id, record]));
  const unavailable = new Set(roots.filter(root => root.unavailable).map(root => root.uri));
  for (const record of localLibrary.state.records) {
    if (unavailable.has(record.root)) missing.set(record.id, record);
  }

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.canvas }}>
      <PageHeader title="Reconnect media" />
      <SectionList
        sections={[
          ...(missing.size ? [{
            title: "Missing videos",
            data: [...missing.values()].map(record => ({
              key: String(record.id),
              name: record.file.name,
              unavailable: true,
              pick: async () => {
                const file = await pickVideo();
                if (!file) return;
                await localLibrary.reconnectFile(record.id, file.uri, displayName(file.uri));
                return true;
              },
            })),
          }] : []),
          ...(roots.length ? [{
            title: "Library locations",
            data: roots.map(root => ({
              key: root.uri,
              name: root.name,
              unavailable: Boolean(root.unavailable),
              pick: async () => {
                const replacement = root.singleFile ? await pickVideo() : await Directory.pickDirectoryAsync();
                if (!replacement) return;
                await localLibrary.reconnectRoot(root.uri, { uri: replacement.uri, name: displayName(replacement.uri) });
                return true;
              },
            })),
          }] : []),
        ]}
        keyExtractor={item => item.key}
        contentContainerStyle={{ padding: 20, paddingBottom: 28, gap: 8 }}
        ListHeaderComponent={<View className="gap-3 pb-3">
          <Text className="text-muted">Picker access can expire or media can move. Choose the original folder in its new location, or reconnect a missing video individually.</Text>
          <Button label="Check library locations" disabled={busy} onPress={() => void run(() => localLibrary.scan())} />
          {!missing.size && !roots.length ? <Text className="text-muted">No library locations to reconnect.</Text> : null}
          {message ? <Notice message={message} /> : null}
        </View>}
        renderSectionHeader={({ section }) => <Text className="bg-background py-2 font-archivo-bold text-foreground">{section.title}</Text>}
        renderItem={({ item, section }) => <View className="flex-row items-center gap-3 rounded-xl bg-surface p-3">
          {section.title === "Missing videos" ? <Film size={20} color={colors.muted} /> : <Folder size={20} color={colors.muted} />}
          <View className="flex-1">
            <Text className="font-archivo-medium text-foreground" numberOfLines={2}>{item.name}</Text>
            {item.unavailable ? <Text className="text-warning">Unavailable</Text> : null}
          </View>
          <Button label="Reconnect" disabled={busy} onPress={() => void run(item.pick)} />
        </View>}
      />
    </SafeAreaView>
  );
}
