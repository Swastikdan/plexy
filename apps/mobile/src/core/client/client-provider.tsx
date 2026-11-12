import React,{
createContext,
useContext,
useEffect,
useMemo,
useRef,
useState,
} from "react";
import { AppState } from "react-native";
import type { LocalCatalog } from "../library/catalog-api";
import {
defaultPreferences,
preferenceKey,
readJson,
writeJson,
type Preferences,
} from "./preferences";
import { ProgressQueue,type Progress } from "./progress-queue";
export interface MobileRuntimeBindings {
  local: {
    api: LocalCatalog;
    restore(): Promise<void>;
    refresh(): Promise<void>;
    needsSetup(): boolean;
    pickSubtitle?(
      fileId: number,
    ): Promise<
      | import("../../../../../packages/api-client/src/types").SubtitleTrack
      | null
    >;
    getAttentionCount?(): number;
    getAttentionFingerprint?(): string;
    subscribe?(fn: () => void): () => void;
  };
}
interface ClientContext {
  api: LocalCatalog;
  platform: MobileRuntimeBindings;
  preferences: Preferences;
  updatePreferences(patch: Partial<Preferences>): void;
  progress: ProgressQueue;
  ready: boolean;
  storageError: string | null;
}
const Context = createContext<ClientContext | null>(null);
export function ClientProvider({
  platform,
  children,
}: React.PropsWithChildren<{
  platform: MobileRuntimeBindings;
}>) {
  const api = platform.local.api;
  const [preferences, setPreferences] = useState(defaultPreferences);
  const [ready, setReady] = useState(false);
  const [storageError, setStorageError] = useState<string | null>(null);
  const preferencesRef = useRef(preferences);
  const progress = useMemo(
    () =>
      new ProgressQueue({
        load: () => readJson<Progress[]>("plexy.progress.this-device", []),
        save: (values) => writeJson("plexy.progress.this-device", values),
      }),
    [],
  );
  useEffect(() => {
    let live = true;
    void (async () => {
      const saved = {
        ...defaultPreferences,
        ...(await readJson<Partial<Preferences>>(
          preferenceKey("this-device"),
          {},
        )),
      };
      preferencesRef.current = saved;
      if (live) setPreferences(saved);
      await progress.restore();
      await progress.flush(api);
      if (live) setReady(true);
    })().catch(() => {
      if (live)
        setStorageError(
          "Device storage could not be loaded. Restart the app before making changes.",
        );
    });
    const state = AppState.addEventListener("change", () => {
      void progress.flush(api).catch(() => {});
    });
    return () => {
      live = false;
      state.remove();
      void progress.flush(api).catch(() => {});
    };
  }, [api, progress]);
  const updatePreferences = (patch: Partial<Preferences>) => {
    const next = { ...preferencesRef.current, ...patch };
    preferencesRef.current = next;
    setPreferences(next);
    void writeJson(preferenceKey("this-device"), next).catch(() =>
      setStorageError(
        "Could not save preferences. Check available device storage.",
      ),
    );
  };
  return (
    <Context.Provider
      value={{
        api,
        platform,
        preferences,
        updatePreferences,
        progress,
        ready,
        storageError,
      }}
    >
      {children}
    </Context.Provider>
  );
}
export function useClient() {
  const value = useContext(Context);
  if (!value) throw new Error("ClientProvider is missing");
  return value;
}
