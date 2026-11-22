import { useState } from "react";
import { useLocalSearchParams, useRouter } from "expo-router";
import { FlatList, Pressable, Text, TextInput, View } from "react-native";
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
import { PageState } from "@/shared/ui/page-state";
import { useAppDialog } from "@/shared/ui/app-dialog";
import { ChevronRight, Folder, Plus } from "@/shared/ui/icons";
import { useColors } from "@/shared/theme";
import { editCollections, useCollections } from "./collections-store";

export function CollectionsScreen() {
  const { add, create, id: routeId } = useLocalSearchParams<{
    add?: string;
    create?: string;
    id?: string;
  }>();
  const router = useRouter();
  const remoteNavigation = useRemoteNavigation();
  const show = useAppDialog();
  const colors = useColors();
  const { api, preferences } = useClient();
  const { saved } = useRemote();
  const { isHidden } = useHiddenTitles();
  const collections = useCollections();
  const [selected, setSelected] = useState<string | undefined>(routeId);
  const [editing, setEditing] = useState(Boolean(add) || create === "1");
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
  const visible = collection?.titleIds.flatMap((titleId) => {
    const item = cards.get(titleId);
    return item ? [item] : [];
  }) ?? [];
  const fromRoute = Boolean(routeId);

  const report = (cause: unknown) => setError(cause instanceof Error ? cause.message : "Couldn’t save collection.");
  const openCreate = () => {
    setName("");
    setError("");
    setEditing(true);
  };
  const closeForm = () => {
    setEditing(false);
    setName("");
    setError("");
    if (add || create === "1") router.back();
  };

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
      if (add || create === "1") {
        router.setParams({ add: undefined, create: undefined });
      }
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

  const backToList = fromRoute
    ? undefined
    : () => {
        setSelected(undefined);
        setEditing(false);
      };

  const newCollectionButton = (compact = false) => (
    <Pressable
      accessibilityRole="button"
      onPress={openCreate}
      className="flex-row items-center justify-center gap-2 rounded-full border border-border px-4 py-3 active:opacity-70"
    >
      <Plus size={16} color={compact ? colors.muted : colors.ink} strokeWidth={2} />
      <Text className="font-archivo-medium text-[14px] text-foreground">
        New collection
      </Text>
    </Pressable>
  );

  return (
    <SafeAreaView className="flex-1 bg-background">
      <PageHeader
        title={collection?.name ?? "Collections"}
        onBack={backToList}
      />
      <View className="gap-2 px-5 pb-2">
        {error ? <Notice message={error} /> : null}
        {editing ? (
          <>
            <TextInput
              accessibilityLabel="Collection name"
              placeholder="Collection name"
              value={name}
              onChangeText={setName}
              maxLength={80}
              autoFocus
              className="rounded-xl bg-surface px-4 py-3 text-foreground"
            />
            <Button
              label={collection ? "Save name" : "Create"}
              disabled={!name.trim() || busy}
              onPress={() => void saveName()}
            />
            <Button label="Cancel" onPress={closeForm} />
          </>
        ) : collection ? (
          <View className="flex-row flex-wrap gap-2">
            <Button label="Rename" onPress={() => { setName(collection.name); setEditing(true); }} />
            <Button
              label="Delete collection"
              onPress={() => show("Delete collection?", "Your titles will stay in the library.", [{
                text: "Delete collection",
                style: "destructive",
                onPress: () =>
                  void editCollections((current) => current.filter((entry) => entry.id !== collection.id))
                    .then(() => {
                      setSelected(undefined);
                      if (fromRoute) router.back();
                    })
                    .catch(report),
              }])}
            />
          </View>
        ) : null}
      </View>
      {collection ? (
        <FlatList
          data={visible}
          keyExtractor={(item) => item.publicId}
          contentContainerStyle={{ padding: 20, gap: 10 }}
          ListEmptyComponent={
            <View className="items-center py-12">
              <Text className="text-center font-archivo-bold text-[18px] text-foreground">
                No titles in this collection yet
              </Text>
              <Text className="mt-2 max-w-[320px] text-center font-archivo-regular text-[14px] leading-[21px] text-muted">
                Open any title and choose “Add to collection” to put it here.
              </Text>
            </View>
          }
          renderItem={({ item, index }) => (
            <View className="gap-2 rounded-xl bg-surface p-3">
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
            </View>
          )}
        />
      ) : editing ? null : collections.length === 0 ? (
        <PageState
          icon={Folder}
          title="No custom collections yet"
          message="Plexy adds franchise collections from TMDB to your library automatically. Create a custom collection to group titles for a mood or a movie night."
          actionLabel="Create collection"
          onAction={openCreate}
        />
      ) : (
        <FlatList
          data={collections}
          keyExtractor={(item) => item.id}
          contentContainerStyle={{ padding: 20, gap: 10 }}
          ListFooterComponent={<View className="pt-2">{newCollectionButton(true)}</View>}
          renderItem={({ item }) => (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`Open collection ${item.name}`}
              onPress={() => { setEditing(false); setSelected(item.id); }}
              className="flex-row items-center gap-3 rounded-[18px] bg-surface p-3 active:opacity-70"
            >
              <View className="h-[52px] w-[52px] items-center justify-center rounded-[12px] bg-surface-secondary">
                <Folder size={22} color={colors.muted} strokeWidth={1.8} />
              </View>
              <View className="flex-1 gap-0.5">
                <Text className="font-archivo-bold text-[15px] text-foreground" numberOfLines={1}>
                  {item.name}
                </Text>
                <Text className="font-archivo-regular text-[12px] text-muted">
                  {item.titleIds.length === 1 ? "1 title" : `${item.titleIds.length} titles`}
                </Text>
              </View>
              <ChevronRight size={18} color={colors.muted} strokeWidth={2} />
            </Pressable>
          )}
        />
      )}
    </SafeAreaView>
  );
}
