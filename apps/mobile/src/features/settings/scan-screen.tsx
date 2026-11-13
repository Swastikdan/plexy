import { useEffect, useState } from "react";
import { Pressable, ScrollView, Text, View } from "react-native";
import { localLibrary } from "@/core/library/local-runtime";
import { useClient } from "@/core/client/client-provider";
import { Button } from "@/shared/ui/button";
import { PageHeader } from "@/shared/ui/page-header";
import { RotateCcw } from "@/shared/ui/icons";
import { useColors } from "@/shared/theme";
import { Notice } from "@/shared/ui/notice";
import { SettingsRow } from "./components/settings-row";

export function ScanScreen() {
  const { runtime } = useClient();
  const [, update] = useState(0);
  const colors = useColors();
  const [activeFolder, setActiveFolder] = useState<string | null>(null);
  const [error, setError] = useState("");
  useEffect(() => runtime.subscribe(() => update(n => n + 1)), [runtime]);
  const roots = localLibrary.state.roots.filter(r => !r.singleFile);
  const progress = localLibrary.scanProgress;
  const scanning = localLibrary.scanning;
  async function scan(uris: string[]) {
    if (localLibrary.scanning) return;
    setError("");
    setActiveFolder(uris.length === 1 ? uris[0]! : null);
    try { await localLibrary.scan(uris); }
    catch (e) { setError(e instanceof Error ? e.message : String(e)); }
    finally { setActiveFolder(null); }
  }
  return <ScrollView className="flex-1 bg-background" contentContainerStyle={{ padding: 20, gap: 16 }}>
    <PageHeader title="Scan library" style={{ paddingHorizontal: 0 }} />
    <Text className="text-muted text-[14px]">Rescan a folder, or scan all folders below.</Text>
    <View className="rounded-[18px] overflow-hidden bg-surface">
      {roots.map(root => <SettingsRow key={root.uri} title={root.name} subtitle={root.kind === "tv" ? "TV shows" : root.kind === "anime" ? "Anime" : "Movies"}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`Rescan ${root.name}`}
          accessibilityState={{ disabled: scanning, busy: scanning && activeFolder === root.uri }}
          disabled={scanning}
          onPress={() => void scan([root.uri])}
          className="h-11 w-11 items-center justify-center rounded-full bg-default active:opacity-65 disabled:opacity-40"
        >
          <RotateCcw size={20} color={colors.ink} />
        </Pressable>
      </SettingsRow>)}
    </View>
    {!roots.length && <Notice message="Connect a media folder in Settings to scan it here." />}
    {(scanning || progress.phase !== "idle") && <View accessibilityLiveRegion="polite" className="rounded-[18px] bg-surface p-4 gap-2">
      <Text className="text-foreground font-archivo-bold">{progress.phase}</Text>
      {!!progress.current && <Text className="text-muted" numberOfLines={2}>{progress.current}</Text>}
      <Text className="text-foreground">{progress.folders} folders scanned. {progress.found} videos found. {progress.added} new.</Text>
    </View>}
    {!!error && <Notice message={error} />}
    {localLibrary.issues.map(issue => <Notice key={issue} message={issue} />)}
    <Button label={scanning ? "Scanning…" : "Scan all"} disabled={scanning || !roots.length} onPress={() => void scan(roots.map(root => root.uri))} />
  </ScrollView>;
}
