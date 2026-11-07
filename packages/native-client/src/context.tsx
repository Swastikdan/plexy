import React, {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { AppState } from "react-native";
import NetInfo from "@react-native-community/netinfo";
import { PlexyApi, type Session } from "./api";
import {
  catalogCache,
  defaultPreferences,
  preferenceKey,
  readJson,
  writeJson,
  type Preferences,
} from "./storage";
import { DownloadManager } from "./downloads";
import { ProgressQueue, type Progress } from "./progress";
export interface NativePlatform {
  tv: boolean;
  CastControl?: React.ComponentType<import("./cast-types").CastControlProps>;
  RemoteEvents: React.ComponentType<{ onEvent: (event: string) => void }>;
  FocusGroup: React.ComponentType<
    React.PropsWithChildren<{
      style?: import("react-native").StyleProp<
        import("react-native").ViewStyle
      >;
    }>
  >;
}
interface ClientContext {
  session: Session;
  api: PlexyApi;
  platform: NativePlatform;
  preferences: Preferences;
  updatePreferences: (patch: Partial<Preferences>) => void;
  downloads: DownloadManager;
  progress: ProgressQueue;
  ready: boolean;
  storageError: string | null;
  cachedCatalog: boolean;
}
const Context = createContext<ClientContext | null>(null);
export function ClientProvider({
  session,
  platform,
  children,
}: React.PropsWithChildren<{ session: Session; platform: NativePlatform }>) {
  const [preferences, setPreferences] = useState(defaultPreferences);
  const [cachedCatalog, setCachedCatalog] = useState(false);
  const [ready, setReady] = useState(false);
  const [storageError, setStorageError] = useState<string | null>(null);
  const preferencesRef = useRef(preferences);
  preferencesRef.current = preferences;
  const api = useMemo(
    () =>
      new PlexyApi(session.profile.url, session.token, {
        cache: catalogCache(session.profile.id),
        onCacheUsed: () => setCachedCatalog(true),
        onFreshCatalog: () => setCachedCatalog(false),
      }),
    [session],
  );
  const downloads = useMemo(
    () =>
      new DownloadManager(
        session.profile.id,
        api,
        () => preferencesRef.current,
      ),
    [api, session.profile.id],
  );
  const progress = useMemo(() => {
    const key = `plexy.progress.${session.profile.id}`;
    return new ProgressQueue({
      load: () => readJson<Progress[]>(key, []),
      save: (values) => writeJson(key, values),
    });
  }, [session.profile.id]);
  useEffect(() => {
    let live = true;
    const start = async () => {
      const saved = {
        ...defaultPreferences,
        ...(await readJson<Partial<Preferences>>(
          preferenceKey(session.profile.id),
          {},
        )),
      };
      preferencesRef.current = saved;
      if (live) setPreferences(saved);
      await progress.restore();
      if (!live) return;
      await downloads.restore();
      if (live) setReady(true);
      void progress.flush(api).catch(() => {});
    };
    void start().catch(() => {
      if (live)
        setStorageError(
          "Device storage could not be loaded. Restart the app before making changes.",
        );
    });
    const net = NetInfo.addEventListener((s) => {
      if (s.isConnected) void progress.flush(api).catch(() => {});
    });
    const state = AppState.addEventListener("change", (s) => {
      if (s !== "active") void downloads.pauseActive();
      else void progress.flush(api).catch(() => {});
    });
    return () => {
      live = false;
      net();
      state.remove();
      void downloads.dispose();
    };
  }, [api, downloads, progress, session.profile.id]);
  const updatePreferences = (patch: Partial<Preferences>) => {
    const next = { ...preferencesRef.current, ...patch };
    preferencesRef.current = next;
    setPreferences(next);
    void writeJson(preferenceKey(session.profile.id), next).catch(() =>
      setStorageError(
        "Could not save preferences. Check available device storage.",
      ),
    );
  };
  return (
    <Context.Provider
      value={{
        session,
        api,
        platform,
        preferences,
        updatePreferences,
        downloads,
        progress,
        ready,
        storageError,
        cachedCatalog,
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
export function useDownloads() {
  const { downloads } = useClient();
  const [, update] = useState(0);
  useEffect(() => downloads.subscribe(() => update((n) => n + 1)), [downloads]);
  return downloads.entries;
}
