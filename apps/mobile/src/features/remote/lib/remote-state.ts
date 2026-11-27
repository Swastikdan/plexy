import AsyncStorage from "@react-native-async-storage/async-storage";
import type { RemoteTitle } from "./tmdb";

const LIBRARY_KEY = "plexy.remote.library";

export function createStore<T>(initial: T) {
  let value = initial;
  const listeners = new Set<() => void>();
  return {
    get: () => value,
    set(next: T) {
      value = next;
      for (const listener of listeners) listener();
    },
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}

export interface SavedTitle {
  title: RemoteTitle;
  addedAt: number;
}

export const libraryStore = createStore<SavedTitle[]>([]);

export async function loadLibrary(): Promise<SavedTitle[]> {
  try {
    const raw = await AsyncStorage.getItem(LIBRARY_KEY);
    const parsed = raw ? (JSON.parse(raw) as SavedTitle[]) : [];
    const valid = Array.isArray(parsed) ? parsed.filter((entry) => entry?.title?.tmdbId) : [];
    libraryStore.set(valid);
    return valid;
  } catch {
    libraryStore.set([]);
    return [];
  }
}

async function writeLibrary(next: SavedTitle[]) {
  libraryStore.set(next);
  await AsyncStorage.setItem(LIBRARY_KEY, JSON.stringify(next)).catch(() => {});
}

export function savedKey(title: Pick<RemoteTitle, "mediaType" | "tmdbId">) {
  return `${title.mediaType}:${title.tmdbId}`;
}

export async function toggleSaved(title: RemoteTitle): Promise<boolean> {
  const current = libraryStore.get();
  const key = savedKey(title);
  const exists = current.some((entry) => savedKey(entry.title) === key);
  const next = exists
    ? current.filter((entry) => savedKey(entry.title) !== key)
    : [{ title, addedAt: Date.now() }, ...current];
  await writeLibrary(next);
  return !exists;
}

/** Drop the online bookmark after a downloaded copy joins the library. */
export async function removeSaved(
  mediaType: RemoteTitle["mediaType"],
  tmdbId: number,
) {
  const current = libraryStore.get();
  const next = current.filter(
    (entry) =>
      !(
        entry.title.mediaType === mediaType &&
        entry.title.tmdbId === tmdbId
      ),
  );
  if (next.length !== current.length) await writeLibrary(next);
}

export function isSaved(title: Pick<RemoteTitle, "mediaType" | "tmdbId">) {
  const key = savedKey(title);
  return libraryStore.get().some((entry) => savedKey(entry.title) === key);
}

