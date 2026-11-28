import AsyncStorage from "@react-native-async-storage/async-storage";
import { useCallback, useSyncExternalStore } from "react";

/**
 * Titles the viewer marked as "online playback unavailable" — the online
 * source has nothing playable for them. Such a title only plays from a local
 * or downloaded file; without one, the title page shows no play action.
 * Keys are `<movie|tv>:<tmdbId>` so the mark follows the title across the
 * local and online catalogs.
 */

const STORAGE_KEY = "plexy.online.unavailable";

type Listener = () => void;
let keys: readonly string[] = [];
let loaded: Promise<void> | null = null;
const listeners = new Set<Listener>();

function emit() {
  for (const listener of listeners) listener();
}

const store = {
  get: () => keys,
  subscribe(listener: Listener) {
    listeners.add(listener);
    void loadOnlineUnavailable();
    return () => {
      listeners.delete(listener);
    };
  },
};

export function onlineUnavailableKey(mediaType: string, tmdbId: number) {
  return `${mediaType}:${tmdbId}`;
}

export function loadOnlineUnavailable() {
  if (!loaded) {
    loaded = AsyncStorage.getItem(STORAGE_KEY)
      .then((raw) => {
        const parsed = raw ? (JSON.parse(raw) as unknown) : [];
        keys = Array.isArray(parsed)
          ? parsed.filter((entry): entry is string => typeof entry === "string")
          : [];
        emit();
      })
      .catch(() => {});
  }
  return loaded;
}

export async function setOnlineUnavailable(key: string, unavailable: boolean) {
  await loadOnlineUnavailable();
  const next = keys.filter((entry) => entry !== key);
  if (unavailable) next.unshift(key);
  keys = next;
  emit();
  await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(next)).catch(() => {});
}

export function useOnlineUnavailable() {
  const entries = useSyncExternalStore(store.subscribe, store.get, store.get);
  const isUnavailable = useCallback(
    (mediaType: string | null | undefined, tmdbId: number | null | undefined) =>
      mediaType != null &&
      tmdbId != null &&
      entries.includes(onlineUnavailableKey(mediaType, tmdbId)),
    [entries],
  );
  return { isUnavailable, set: setOnlineUnavailable };
}
