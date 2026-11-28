import { restoredMode } from "./watching-mode";
import { catalogForMode } from "./mode-catalog";
import { MergedCatalog } from "@/core/server/merged-catalog";
import { useServer } from "@/core/server/server-provider";
import { Uniwind } from "uniwind";
import React, { createContext, useContext, useEffect, useMemo, useRef, useState, } from "react";
import { AppState } from "react-native";
import {
    setAudiencePolicy,
    type FamilyLevel,
} from "@/core/content/audience";
import { loadHiddenTitles } from "@/core/content/hidden-titles";
import type { LocalCatalog } from "@/core/library/catalog-api";
import { invalidateLocalResources } from "@/core/resources/use-resource";
import { defaultPreferences, modePreferences, PREFERENCE_KEY, readJson, writeJson, type Preferences, } from "./preferences";
import { ProgressCoordinator, ProgressQueue, type Progress } from "./progress-queue";
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
    saveSubtitle?(fileId: number, name: string, language: string, text: string): Promise<import("@plexy/api-client/types").SubtitleTrack>;
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
    progress: ProgressCoordinator;
    ready: boolean;
    storageError: string | null;
}
const Context = createContext<ClientContext | null>(null);
export function ClientProvider({ runtime, children, }: React.PropsWithChildren<{
    runtime: MobileRuntimeBindings;
}>) {
    const { catalog: serverCatalog, session: serverSession } = useServer();
    const [preferences, setPreferences] = useState(defaultPreferences);
    const mergedApi = useMemo(() => serverCatalog ? new MergedCatalog(runtime.api, serverCatalog) : runtime.api, [runtime.api, serverCatalog]);
    const api = useMemo(() => {
        if (preferences.source === "online") return catalogForMode(runtime.api, "online");
        if (preferences.source === "server") return serverCatalog ?? catalogForMode(runtime.api, "online");
        if (preferences.source === "device") return runtime.api;
        return mergedApi;
    }, [mergedApi, preferences.source, runtime.api, serverCatalog]);
    const apiRef = useRef(api);
    useEffect(() => {
        apiRef.current = api;
    }, [api]);
    const [ready, setReady] = useState(false);
    const [storageError, setStorageError] = useState<string | null>(null);
    const preferencesRef = useRef(preferences);
    const deviceProgress = useMemo(() => new ProgressQueue({
        load: () => readJson<Progress[]>("plexy.progress.this-device", []),
        save: (values) => writeJson("plexy.progress.this-device", values),
    }), []);
    const serverProgressKey = serverSession
        ? `plexy.progress.server.${serverSession.serverId}.${serverSession.user.id}`
        : null;
    const serverProgress = useMemo(() => serverProgressKey
        ? new ProgressQueue({
            load: () => readJson<Progress[]>(serverProgressKey, []),
            save: (values) => writeJson(serverProgressKey, values),
        })
        : null, [serverProgressKey]);
    const progress = useMemo(
        () => new ProgressCoordinator(deviceProgress, serverProgress),
        [deviceProgress, serverProgress],
    );
    useEffect(() => {
        let live = true;
        let loaded = false;
        const scanConnectedFolders = () => {
            const current = preferencesRef.current;
            if (loaded && current.onboardingCompleted && current.mode !== "online" && !runtime.needsSetup()) {
                void runtime.refresh().catch(() => {});
            }
        };
        void (async () => {
            const stored = await readJson<Partial<Preferences>>(PREFERENCE_KEY, {});
            const saved = {
                ...defaultPreferences,
                ...stored,
            };
            saved.theme = saved.theme === "light" || saved.theme === "dark" ? saved.theme : "system";
            Object.assign(saved, restoredMode(stored, !runtime.needsSetup()));
            // Migrate the two-value source from earlier builds.
            if ((stored.source as string | undefined) === "local") saved.source = "device";
            if ((stored.source as string | undefined) === "remote") saved.source = "online";
            if (!["device", "server", "all", "online"].includes(saved.source)) saved.source = "device";
            if (saved.mode === "local" && saved.source === "online") saved.source = "device";
            if (![5, 10, 15, 20, 30, 60].includes(saved.seekSeconds)) saved.seekSeconds = 10;
            if (typeof saved.onlineAutoplay !== "boolean") saved.onlineAutoplay = true;
            if (typeof saved.onlineEpisodeSelector !== "boolean") saved.onlineEpisodeSelector = true;
            if (typeof saved.onlineDisclaimerSeen !== "boolean") saved.onlineDisclaimerSeen = false;
            if (![2160, 1080, 720, 480].includes(saved.movyMaxHeight)) saved.movyMaxHeight = 1080;
            if (typeof saved.movyWifiOnly !== "boolean") saved.movyWifiOnly = true;
            if (typeof saved.movyMultiStream !== "boolean") saved.movyMultiStream = true;
            if (typeof saved.movyBackgroundDownloads !== "boolean") saved.movyBackgroundDownloads = true;
            if (typeof saved.movyNotifications !== "boolean") saved.movyNotifications = true;
            if (typeof saved.movyAutoCreateAccount !== "boolean") saved.movyAutoCreateAccount = false;
            if (![1, 2, 3].includes(saved.movyAccountCap)) saved.movyAccountCap = 2;
            const familyLevels: FamilyLevel[] = ["off", "little", "older", "teen"];
            if (!familyLevels.includes(saved.familyLevel)) saved.familyLevel = "off";
            if (typeof saved.familyBlockUnrated !== "boolean") saved.familyBlockUnrated = true;
            if (!saved.familyRegion) saved.familyRegion = "US";
            if (typeof saved.familyPinHash !== "string") saved.familyPinHash = "";
            Uniwind.setTheme(saved.theme);
            setAudiencePolicy(saved.familyLevel, saved.familyBlockUnrated);
            preferencesRef.current = saved;
            if (live)
                setPreferences(saved);
            await Promise.all([progress.restore(), loadHiddenTitles()]);
            await progress.flush(apiRef.current);
            if (live) {
                loaded = true;
                setReady(true);
                scanConnectedFolders();
            }
        })().catch(() => {
            if (live)
                setStorageError("Device storage could not be loaded. Restart the app before making changes.");
        });
        let wasBackgrounded = AppState.currentState === "background";
        const state = AppState.addEventListener("change", (nextState) => {
            if (nextState === "background") wasBackgrounded = true;
            if (nextState === "active" && wasBackgrounded) {
                wasBackgrounded = false;
                scanConnectedFolders();
            }
            void progress.flush(apiRef.current).catch(() => { });
        });
        return () => {
            live = false;
            state.remove();
            void progress.flushLocal().catch(() => { });
            void progress.flush(apiRef.current).catch(() => { });
        };
    }, [runtime, progress]);
    const updatePreferences = (patch: Partial<Preferences>) => {
        const next = { ...preferencesRef.current, ...patch };
        if (patch.mode && patch.mode !== "hybrid") Object.assign(next, modePreferences(patch.mode));
        if (patch.theme) Uniwind.setTheme(patch.theme);
        const familyChanged =
            patch.familyLevel !== undefined ||
            patch.familyBlockUnrated !== undefined;
        if (familyChanged) {
            setAudiencePolicy(next.familyLevel, next.familyBlockUnrated);
            invalidateLocalResources();
        }
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
