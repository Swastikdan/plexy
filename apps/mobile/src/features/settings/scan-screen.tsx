import { useEffect, useState } from "react";
import { ScrollView, Text, View } from "react-native";
import { localLibrary } from "@/core/library/local-runtime";
import { useClient } from "@/core/client/client-provider";
import { Button } from "@/shared/ui/button";
import { PageHeader } from "@/shared/ui/page-header";
import { ToggleSwitch } from "@/shared/ui/toggle-switch";
import { Notice } from "@/shared/ui/notice";
import { SettingsRow } from "./components/settings-row";

export function ScanScreen() {
  const { runtime } = useClient();
  const [, update] = useState(0);
  const [selected, setSelected] = useState<string[]>([]);
  const [error, setError] = useState("");
  useEffect(() => runtime.subscribe(() => update(n => n + 1)), [runtime]);
  const roots = localLibrary.state.roots.filter(r => !r.singleFile);
  const progress = localLibrary.scanProgress;
  const scanning = localLibrary.scanning;
  async function scan(uris: string[]) {
    setError("");
    try { await localLibrary.scan(uris); }
    catch (e) { setError(e instanceof Error ? e.message : String(e)); }
  }
  return <ScrollView className="flex-1 bg-background" contentContainerStyle={{ padding: 20, gap: 16 }}>
    <PageHeader title="Scan library" style={{ paddingHorizontal: 0 }} />
    <Text className="text-muted text-[14px]">Choose one or more folders, or scan your entire library.</Text>
    <View className="rounded-[18px] overflow-hidden bg-surface">
      {roots.map(root => <SettingsRow key={root.uri} title={root.name} subtitle={root.kind === "tv" ? "TV shows" : root.kind === "anime" ? "Anime" : "Movies"}>
        <ToggleSwitch accessibilityLabel={`Scan ${root.name}`} value={selected.includes(root.uri)} disabled={scanning} onValueChange={checked => setSelected(current => checked ? [...current, root.uri] : current.filter(uri => uri !== root.uri))} />
      </SettingsRow>)}
    </View>
    {!roots.length && <Notice message="Connect a media folder in Settings to scan it here." />}
    <Button label="Scan selected" disabled={scanning || !selected.length} onPress={() => void scan(selected)} />
    <Button label="Scan all folders" disabled={scanning || !roots.length} onPress={() => void scan(roots.map(root => root.uri))} />
    {(scanning || progress.phase !== "idle") && <View accessibilityLiveRegion="polite" className="rounded-[18px] bg-surface p-4 gap-2">
      <Text className="text-foreground font-archivo-bold">{progress.phase}</Text>
      {!!progress.current && <Text className="text-muted" numberOfLines={2}>{progress.current}</Text>}
      <Text className="text-foreground">{progress.folders} folders scanned. {progress.found} videos found. {progress.added} new.</Text>
    </View>}
    {!!error && <Notice message={error} />}
    {localLibrary.issues.map(issue => <Notice key={issue} message={issue} />)}
  </ScrollView>;
}
