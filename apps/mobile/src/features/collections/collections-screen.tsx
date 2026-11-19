import { useState } from "react";
import { useLocalSearchParams, useRouter } from "expo-router";
import { FlatList, Text, TextInput, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useClient } from "@/core/client/client-provider";
import { useResource } from "@/core/resources/use-resource";
import { familyAllows } from "@/core/content/audience";
import { useHiddenTitles } from "@/core/content/hidden-titles";
import { useRemote } from "@/features/remote/remote-provider";
import { certificationFor } from "@/features/remote/lib/tmdb";
import { remotePublicId, toItemCard } from "@/features/remote/lib/view";
import { useRemoteNavigation } from "@/features/remote/lib/use-remote-navigation";
import { isReleased } from "@/core/content/release";
import { Button } from "@/shared/ui/button";
import { Notice } from "@/shared/ui/notice";
import { PageHeader } from "@/shared/ui/page-header";
import { useAppDialog } from "@/shared/ui/app-dialog";
import { editCollections, useCollections } from "./collections-store";

export function CollectionsScreen() {
  const { add } = useLocalSearchParams<{ add?: string }>();
  const router = useRouter();
  const remoteNavigation = useRemoteNavigation();
  const show = useAppDialog();
  const { api, preferences } = useClient();
  const { saved } = useRemote();
  const { isHidden } = useHiddenTitles();
  const collections = useCollections();
  const [selected, setSelected] = useState<string>();
  const [editing, setEditing] = useState(Boolean(add));
  const [name, setName] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const local = useResource((signal) => api.home(signal), [api]);
  const collection = collections.find((entry) => entry.id === selected);
  const localCards = local.value?.rows.find((row) => row.key === "titles")?.items ?? [];
  const remoteTitles = new Map(saved.filter(({ title }) => preferences.source === "remote" &&
    !isHidden(remotePublicId(title.mediaType, title.tmdbId)) && isReleased(title.releaseDate) &&
    familyAllows(certificationFor(title, preferences.familyRegion), preferences.familyLevel, preferences.familyBlockUnrated),
  ).map(({ title }) => [remotePublicId(title.mediaType, title.tmdbId), title]));
  const cards = new Map([...localCards, ...[...remoteTitles.values()].map((title) => toItemCard(title))]
    .map((item) => [item.publicId, item]));
  const visible = collection?.titleIds.flatMap((id) => {
    const item = cards.get(id);
    return item ? [item] : [];
  }) ?? [];

  const report = (cause: unknown) => setError(cause instanceof Error ? cause.message : "Couldn’t save collection.");
  async function saveName() {
    const trimmed = name.trim();
    if (!trimmed || busy) return;
    setBusy(true);
    setError("");
    try {
      const id = collection?.id ?? `collection-${Date.now()}-${Math.random().toString(36).slice(2)}`;
      await editCollections((current) => collection
        ? current.map((entry) => entry.id === id ? { ...entry, name: trimmed } : entry)
        : [...current, { id, name: trimmed, titleIds: add ? [add] : [] }]);
      setSelected(id);
      setEditing(false);
      if (add) router.setParams({ add: undefined });
    } catch (cause) {
      report(cause);
    } finally {
      setBusy(false);
    }
  }
  function changeTitle(id: string, direction?: -1 | 1) {
    if (!collection) return;
    void editCollections((current) => current.map((entry) => {
      if (entry.id !== collection.id) return entry;
      if (!direction) return { ...entry, titleIds: entry.titleIds.filter((value) => value !== id) };
      const neighbor = visible[visible.findIndex((item) => item.publicId === id) + direction];
      if (!neighbor) return entry;
      const titleIds = [...entry.titleIds];
      const from = titleIds.indexOf(id);
      const to = titleIds.indexOf(neighbor.publicId);
      if (from < 0 || to < 0) return entry;
      [titleIds[from], titleIds[to]] = [titleIds[to]!, titleIds[from]!];
      return { ...entry, titleIds };
    })).catch(report);
  }
  return (
    <SafeAreaView className="flex-1 bg-background">
      <PageHeader title={collection?.name ?? "Custom collections"} onBack={collection ? () => {
        setSelected(undefined);
        setEditing(false);
      } : undefined} />
      <View className="gap-2 px-5 pb-2">
        {error ? <Notice message={error} /> : null}
        {editing ? <>
          <TextInput accessibilityLabel="Collection name" placeholder="Collection name" value={name}
            onChangeText={setName} maxLength={80} className="rounded-xl bg-surface px-4 py-3 text-foreground" />
          <Button label={collection ? "Save name" : "Create collection"} disabled={!name.trim() || busy} onPress={() => void saveName()} />
          <Button label="Cancel" onPress={() => { setEditing(false); if (add) router.back(); }} />
        </> : collection ? <View className="flex-row flex-wrap gap-2">
          <Button label="Rename" onPress={() => { setName(collection.name); setEditing(true); }} />
          <Button label="Delete collection" onPress={() => show("Delete collection?", "Your titles will stay in the library.", [{
            text: "Delete collection", style: "destructive", onPress: () =>
              void editCollections((current) => current.filter((entry) => entry.id !== collection.id))
                .then(() => setSelected(undefined)).catch(report),
          }])} />
        </View> : <Button label="Create collection" onPress={() => { setName(""); setEditing(true); }} />}
      </View>
      {collection ? (
        <FlatList data={visible} keyExtractor={(item) => item.publicId} contentContainerStyle={{ padding: 20, gap: 10 }}
          ListEmptyComponent={<Text className="text-muted">Use a title’s menu to add it to this collection.</Text>}
          renderItem={({ item, index }) => <View className="gap-2 rounded-xl bg-surface p-3">
            <Button label={item.name} onPress={() => {
              const remote = remoteTitles.get(item.publicId);
              if (remote) remoteNavigation.open(remote);
              else router.push({ pathname: "/item/[id]", params: { id: item.publicId } });
            }} />
            <View className="flex-row flex-wrap gap-2">
              <Button label="Move up" disabled={index === 0} onPress={() => changeTitle(item.publicId, -1)} />
              <Button label="Move down" disabled={index === visible.length - 1} onPress={() => changeTitle(item.publicId, 1)} />
              <Button label="Remove" onPress={() => changeTitle(item.publicId)} />
            </View>
          </View>} />
      ) : (
        <FlatList data={collections} keyExtractor={(item) => item.id} contentContainerStyle={{ padding: 20, gap: 10 }}
          renderItem={({ item }) => <Button label={item.name} onPress={() => { setEditing(false); setSelected(item.id); }} />} />
      )}
    </SafeAreaView>
  );
}
