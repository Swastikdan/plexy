import AsyncStorage from "@react-native-async-storage/async-storage";
import { useCallback, useSyncExternalStore } from "react";
import type { ItemCard } from "@/core/library/catalog-api";
import { invalidateLocalResources } from "@/core/resources/use-resource";

/**
 * Titles the viewer removed from browsing. This is a visibility list only:
 * local video files, playback progress and saved online titles stay intact.
 */

const HIDDEN_KEY = "plexy.hidden.titles";

export interface HiddenTitle {
  publicId: string;
  name: string;
  year: number | null;
  kind: string;
  poster: string | null;
  hiddenAt: number;
}

type Listener = () => void;
let hidden: HiddenTitle[] = [];
let version = 0;
const listeners = new Set<Listener>();

function emit() {
  version += 1;
  for (const listener of listeners) listener();
}

export const hiddenTitlesStore = {
  get: () => hidden,
  version: () => version,
  subscribe(listener: Listener) {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  },
};

export function isTitleHidden(publicId: string | null | undefined) {
  if (!publicId) return false;
  return hidden.some((entry) => entry.publicId === publicId);
}

export function hiddenTitleVersion() {
  return version;
}

export async function loadHiddenTitles(): Promise<HiddenTitle[]> {
  try {
    const raw = await AsyncStorage.getItem(HIDDEN_KEY);
    const parsed = raw ? (JSON.parse(raw) as HiddenTitle[]) : [];
    hidden = Array.isArray(parsed)
      ? parsed.filter((entry) => entry && typeof entry.publicId === "string")
      : [];
  } catch {
    hidden = [];
  }
  emit();
  return hidden;
}

async function write(next: HiddenTitle[]) {
  hidden = next;
  emit();
  // Every mounted catalog resource is now stale. Refreshing here keeps Home,
  // Search and Library consistent even when the action came from a title page.
  invalidateLocalResources();
  try {
    await AsyncStorage.setItem(HIDDEN_KEY, JSON.stringify(next));
  } catch {
    // Visibility still applies for this session if device storage fails.
  }
}

export async function hideTitle(
  item: Pick<ItemCard, "publicId" | "name" | "year" | "kind" | "poster">,
) {
  if (!item.publicId || isTitleHidden(item.publicId)) return;
  const next: HiddenTitle[] = [
    {
      publicId: item.publicId,
      name: item.name,
      year: item.year ?? null,
      kind: item.kind,
      poster: item.poster ?? null,
      hiddenAt: Date.now(),
    },
    ...hidden,
  ];
  await write(next);
}

export async function restoreHiddenTitle(publicId: string) {
  await write(hidden.filter((entry) => entry.publicId !== publicId));
}

export async function restoreAllHiddenTitles() {
  await write([]);
}

export function useHiddenTitles() {
  const entries = useSyncExternalStore(
    hiddenTitlesStore.subscribe,
    hiddenTitlesStore.get,
    hiddenTitlesStore.get,
  );
  const isHidden = useCallback(
    (publicId: string | null | undefined) =>
      entries.some((entry) => entry.publicId === publicId),
    [entries],
  );
  return {
    hidden: entries,
    isHidden,
    hide: hideTitle,
    restore: restoreHiddenTitle,
    restoreAll: restoreAllHiddenTitles,
  };
}
