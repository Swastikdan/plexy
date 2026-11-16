import React, { createContext, useCallback, useContext, useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { AppState } from "react-native";
import { flushRemoteProgress, loadRemoteProgress } from "./lib/remote-progress";
import { libraryStore, loadLibrary, toggleSaved, type SavedTitle } from "./lib/remote-state";
import type { RemoteTitle } from "./lib/tmdb";

interface RemoteContext {
  ready: boolean;
  saved: SavedTitle[];
  save(title: RemoteTitle): Promise<boolean>;
  isSaved(title: Pick<RemoteTitle, "mediaType" | "tmdbId">): boolean;
}
const Context = createContext<RemoteContext | null>(null);
export function RemoteProvider({ children }: React.PropsWithChildren) {
  const saved = useSyncExternalStore(libraryStore.subscribe, libraryStore.get, libraryStore.get);
  const [ready, setReady] = useState(false);
  useEffect(() => {
    let live = true;
    void Promise.all([loadLibrary(), loadRemoteProgress()])
      .finally(() => {
        if (live) setReady(true);
      })
      .catch(() => {});
    return () => {
      live = false;
      void flushRemoteProgress().catch(() => {});
    };
  }, []);
  useEffect(() => {
    const subscription = AppState.addEventListener("change", (state) => {
      if (state !== "active") void flushRemoteProgress().catch(() => {});
    });
    return () => subscription.remove();
  }, []);
  const save = useCallback((title: RemoteTitle) => toggleSaved(title), []);
  const value = useMemo<RemoteContext>(() => ({
    ready, saved, save,
    isSaved: (title) => saved.some((entry) => entry.title.mediaType === title.mediaType && entry.title.tmdbId === title.tmdbId),
  }), [ready, saved, save]);
  return <Context.Provider value={value}>{children}</Context.Provider>;
}
export function useRemote() {
  const value = useContext(Context);
  if (!value) throw new Error("RemoteProvider is missing");
  return value;
}
