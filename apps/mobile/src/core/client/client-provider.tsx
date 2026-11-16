import { restoredMode } from "./watching-mode";
import { catalogForMode } from "./mode-catalog";
import { Uniwind } from "uniwind";
import React, { createContext, useContext, useEffect, useMemo, useRef, useState, } from "react";
import { AppState } from "react-native";
import type { LocalCatalog } from "@/core/library/catalog-api";
import { defaultPreferences, modePreferences, PREFERENCE_KEY, readJson, writeJson, type Preferences, } from "./preferences";
import { ProgressQueue, type Progress } from "./progress-queue";
export interface TitleSearchResult {
    id: number;
    title?: string;
    name?: string;
    poster_path?: string | null;
    release_date?: string;
    first_air_date?: string;
    overview?: string;
}
export interface MobileRuntimeBindings {
    api: LocalCatalog;
    restore(): Promise<void>;
    refresh(): Promise<void>;
    needsSetup(): boolean;
    searchTitles(query: string, kind: "movies" | "tv"): Promise<TitleSearchResult[]>;
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
    const [preferences, setPreferences] = useState(defaultPreferences);
    const api = useMemo(() => catalogForMode(runtime.api, preferences.mode), [runtime.api, preferences.mode]);
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
            const stored = await readJson<Partial<Preferences>>(PREFERENCE_KEY, {});
            const saved = {
                ...defaultPreferences,
                ...stored,
            };
            saved.theme = saved.theme === "light" || saved.theme === "dark" ? saved.theme : "system";
            Object.assign(saved, restoredMode(stored, !runtime.needsSetup()));
            if (saved.mode !== "hybrid") Object.assign(saved, modePreferences(saved.mode));
            if (saved.source !== "remote") saved.source = "local";
            if (![5, 10, 15, 20, 30, 60].includes(saved.seekSeconds)) saved.seekSeconds = 10;
            if (typeof saved.onlineAutoplay !== "boolean") saved.onlineAutoplay = true;
            if (typeof saved.onlineEpisodeSelector !== "boolean") saved.onlineEpisodeSelector = true;
            if (typeof saved.onlineDisclaimerSeen !== "boolean") saved.onlineDisclaimerSeen = false;
            Uniwind.setTheme(saved.theme);
            preferencesRef.current = saved;
            if (live)
                setPreferences(saved);
            await progress.restore();
            await progress.flush(runtime.api);
            if (live)
                setReady(true);
        })().catch(() => {
            if (live)
                setStorageError("Device storage could not be loaded. Restart the app before making changes.");
        });
        const state = AppState.addEventListener("change", () => {
            void progress.flush(runtime.api).catch(() => { });
        });
        return () => {
            live = false;
            state.remove();
            void progress.flushLocal().catch(() => { });
            void progress.flush(runtime.api).catch(() => { });
        };
    }, [runtime, progress]);
    const updatePreferences = (patch: Partial<Preferences>) => {
        const next = { ...preferencesRef.current, ...patch };
        if (patch.mode && patch.mode !== "hybrid") Object.assign(next, modePreferences(patch.mode));
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
