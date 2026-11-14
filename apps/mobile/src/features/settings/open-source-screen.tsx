import { useEffect, useMemo, useState } from "react";
import { BackHandler, FlatList, Linking, Platform, ScrollView, Text, TextInput, View } from "react-native";
import { applicationId } from "expo-application";
import { startActivityAsync } from "expo-intent-launcher";
import { useColors } from "@/shared/theme";
import { PageHeader } from "@/shared/ui/page-header";
import { Button } from "@/shared/ui/button";
import { Notice } from "@/shared/ui/notice";
import { SettingsRow } from "./components/settings-row";
import licenses from "./data/open-source-licenses.json";

type License = (typeof licenses)[number];

export function OpenSourceScreen() {
  const colors = useColors();
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<License | null>(null);
  const [error, setError] = useState("");
  const filtered = useMemo(() => licenses.filter(entry => `${entry.name} ${entry.license}`.toLowerCase().includes(query.toLowerCase().trim())), [query]);
  useEffect(() => {
    if (!selected) return;
    const subscription = BackHandler.addEventListener("hardwareBackPress", () => { setSelected(null); return true; });
    return () => subscription.remove();
  }, [selected]);
  const openNativeNotices = async () => {
    try {
      setError("");
      await startActivityAsync("android.intent.action.VIEW", {
        packageName: applicationId ?? "app.plexy.mobile",
        className: "com.google.android.gms.oss.licenses.v2.OssLicensesMenuActivity",
      });
    } catch {
      setError("Android library licenses require a new native build of Plexy. Update the app to view them.");
    }
  };
  return (
    <View className="flex-1 bg-background">
      <PageHeader title={selected ? selected.name : "Open Source Licenses"} onBack={selected ? () => setSelected(null) : undefined} />
      {selected ? (
        <ScrollView contentContainerStyle={{ padding: 20, paddingBottom: 40, gap: 18 }}>
          <Text selectable className="font-archivo-medium text-[15px] text-foreground">{selected.name} · {selected.version}{"\n"}{selected.license}</Text>
          <Button label="Project website" onPress={() => void Linking.openURL(selected.url).catch(() => setError("Could not open the project website."))} />
          {selected.modifications ? <Text selectable className="text-[14px] leading-[21px] text-muted">{selected.modifications}</Text> : null}
          {selected.notices.map((notice, index) => (
            <View key={`${notice.file}-${index}`} className="gap-3">
              <Text className="font-archivo-bold text-[14px] text-foreground">{notice.file}</Text>
              <Text selectable className="text-[13px] leading-[20px] text-foreground">{notice.text}</Text>
            </View>
          ))}
          {error ? <Notice message={error} /> : null}
        </ScrollView>
      ) : (
        <FlatList
          data={filtered}
          keyExtractor={entry => `${entry.name}@${entry.version}`}
          keyboardShouldPersistTaps="handled"
          contentContainerStyle={{ paddingBottom: 40 }}
          ListHeaderComponent={<View className="gap-4 px-5 pb-4">
            <Text className="text-[14px] leading-[21px] text-muted">Plexy is built with open source software. Thank you to the developers and communities behind these projects. License and copyright notices are included below, including the fonts used in this app.</Text>
            {Platform.OS === "android" ? <SettingsRow title="Android library licenses" subtitle="Native playback and platform libraries" navigation onPress={() => void openNativeNotices()} /> : null}
            {error ? <Notice message={error} /> : null}
            <TextInput value={query} onChangeText={setQuery} placeholder="Search projects or licenses" placeholderTextColor={colors.muted} accessibilityLabel="Search open source licenses" autoCapitalize="none" autoCorrect={false} className="min-h-12 rounded-xl bg-surface px-4 text-[15px] text-foreground" />
          </View>}
          ListEmptyComponent={<Text className="px-5 text-muted">No matching projects.</Text>}
          renderItem={({ item }) => <SettingsRow title={item.name} subtitle={`${item.version} · ${item.license}`} navigation onPress={() => { setError(""); setSelected(item); }} />}
        />
      )}
    </View>
  );
}
