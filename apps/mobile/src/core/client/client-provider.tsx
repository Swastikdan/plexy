import { Uniwind } from "uniwind";
import React, { createContext, useContext, useEffect, useMemo, useRef, useState, } from "react";
import { AppState } from "react-native";
import type { LocalCatalog } from "@/core/library/catalog-api";
import { defaultPreferences, PREFERENCE_KEY, readJson, writeJson, type Preferences, } from "./preferences";
import { ProgressQueue, type Progress } from "./progress-queue";
export interface MobileRuntimeBindings {
    api: LocalCatalog;
    restore(): Promise<void>;
    refresh(): Promise<void>;
    needsSetup(): boolean;
    searchTitles(query: string, kind: "movies" | "tv"): Promise<any[]>;
    pickSubtitle?(fileId: number): Promise<import("@plexy/api-client/types").SubtitleTrack | null>;
    getAttentionCount(): number;
    getAttentionFingerprint(): string;
    subscribe(fn: () => void): () => void;
}
interface ClientContext {
    api: LocalCatalog;
    runtime: MobileRuntimeBindings;
    preferences: Preferences;
    updatePreferences(patch: Partial<Preferences>): void;
    progress: ProgressQueue;
    ready: boolean;
    storageError: string | null;
}
const Context = createContext<ClientContext | null>(null);
export function ClientProvider({ runtime, children, }: React.PropsWithChildren<{
    runtime: MobileRuntimeBindings;
}>) {
    const api = runtime.api;
    const [preferences, setPreferences] = useState(defaultPreferences);
    const [ready, setReady] = useState(false);
    const [storageError, setStorageError] = useState<string | null>(null);
    const preferencesRef = useRef(preferences);
    const progress = useMemo(() => new ProgressQueue({
        load: () => readJson<Progress[]>("plexy.progress.this-device", []),
        save: (values) => writeJson("plexy.progress.this-device", values),
    }), []);
    useEffect(() => {
        let live = true;
        void (async () => {
            const saved = {
                ...defaultPreferences,
                ...(await readJson<Partial<Preferences>>(PREFERENCE_KEY, {})),
            };
            saved.theme = saved.theme === "light" || saved.theme === "dark" ? saved.theme : "system";
            if (![5, 10, 15, 30, 60].includes(saved.seekSeconds)) saved.seekSeconds = 10;
            Uniwind.setTheme(saved.theme);
            preferencesRef.current = saved;
            if (live)
                setPreferences(saved);
            await progress.restore();
            await progress.flush(api);
            if (live)
                setReady(true);
        })().catch(() => {
            if (live)
                setStorageError("Device storage could not be loaded. Restart the app before making changes.");
        });
        const state = AppState.addEventListener("change", () => {
            void progress.flush(api).catch(() => { });
        });
        return () => {
            live = false;
            state.remove();
            void progress.flush(api).catch(() => { });
        };
    }, [api, progress]);
    const updatePreferences = (patch: Partial<Preferences>) => {
        const next = { ...preferencesRef.current, ...patch };
        if (patch.theme) Uniwind.setTheme(patch.theme);
        preferencesRef.current = next;
        setPreferences(next);
        void writeJson(PREFERENCE_KEY, next).catch(() => setStorageError("Could not save preferences. Check available device storage."));
    };
    return (<Context.Provider value={{
            api,
            runtime,
            preferences,
            updatePreferences,
            progress,
            ready,
            storageError,
        }}>
      {children}
    </Context.Provider>);
}
export function useClient() {
    const value = useContext(Context);
    if (!value)
        throw new Error("ClientProvider is missing");
    return value;
}
