import { useRouter } from "expo-router";
import { useAppDialog } from "@/shared/ui/app-dialog";
import { editCollections, useCollections } from "./collections-store";

export function useCollectionAction() {
  const collections = useCollections();
  const show = useAppDialog();
  const router = useRouter();
  return (id: string) => {
    const create = { text: "Create collection", onPress: () => router.push({ pathname: "/custom-collections", params: { add: id } }) };
    show("Add to collection", "Choose where to save this title.", [
      ...collections.map(({ id: collectionId, name, titleIds }) => ({
        text: titleIds.includes(id) ? `${name} · Added` : name,
        onPress: () => void editCollections((current) => current.map((collection) =>
          collection.id === collectionId && !collection.titleIds.includes(id)
            ? { ...collection, titleIds: [...collection.titleIds, id] } : collection,
        )).catch(() => show("Couldn’t save collection", "Check device storage and try again.", [])),
      })),
      create,
    ]);
  };
}
