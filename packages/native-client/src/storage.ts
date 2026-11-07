import AsyncStorage from "@react-native-async-storage/async-storage";
import * as SecureStore from "expo-secure-store";
import type { Profile, Session } from "./api";
const profilesKey = "plexy.native.profiles.v1";
const activeKey = "plexy.native.active.v1";
export const scopeKey = (scope: string) =>
  Array.from(scope)
    .map((c) => c.codePointAt(0)!.toString(16))
    .join("_");
const tokenKey = (id: string) => `plexy.session.${scopeKey(id)}`;
export const sessionStore = {
  async profiles(): Promise<Profile[]> {
    return readJson<Profile[]>(profilesKey, []);
  },
  async load(id?: string): Promise<Session | null> {
    const active = id || (await AsyncStorage.getItem(activeKey));
    const profile = (await this.profiles()).find((p) => p.id === active);
    if (!profile) return null;
    const token = await SecureStore.getItemAsync(tokenKey(profile.id));
    return token ? { profile, token } : null;
  },
  async save(session: Session) {
    const profiles = await this.profiles();
    await SecureStore.setItemAsync(tokenKey(session.profile.id), session.token);
    await AsyncStorage.setItem(
      profilesKey,
      JSON.stringify([
        ...profiles.filter((p) => p.id !== session.profile.id),
        session.profile,
      ]),
    );
    await AsyncStorage.setItem(activeKey, session.profile.id);
  },
  async remove(id: string) {
    await SecureStore.deleteItemAsync(tokenKey(id));
    await AsyncStorage.setItem(
      profilesKey,
      JSON.stringify((await this.profiles()).filter((p) => p.id !== id)),
    );
    if ((await AsyncStorage.getItem(activeKey)) === id)
      await AsyncStorage.removeItem(activeKey);
  },
};
export async function readJson<T>(key: string, fallback: T): Promise<T> {
  try {
    const text = await AsyncStorage.getItem(key);
    return text ? (JSON.parse(text) as T) : fallback;
  } catch {
    return fallback;
  }
}
export const writeJson = (key: string, value: unknown) =>
  AsyncStorage.setItem(key, JSON.stringify(value));
export interface Preferences {
  autoSubtitles: boolean;
  subtitleLanguage: string;
  subtitleOffset: number;
  subtitlePosition: "bottom" | "top";
  subtitleSize: number;
  autoSkip: boolean;
  autoNext: boolean;
  wifiOnly: boolean;
  downloadCapGb: number;
  defaultDownloadHeight: number;
  playbackRate: number;
}
export const defaultPreferences: Preferences = {
  autoSubtitles: true,
  subtitleLanguage: "en",
  subtitleOffset: 0,
  subtitlePosition: "bottom",
  subtitleSize: 22,
  autoSkip: false,
  autoNext: true,
  wifiOnly: true,
  downloadCapGb: 20,
  defaultDownloadHeight: 0,
  playbackRate: 1,
};
export const preferenceKey = (scope: string) =>
  `plexy.preferences.${scopeKey(scope)}`;

export function catalogCache(scope: string): import("./api").CatalogCache {
  const prefix = `plexy.catalog.${scope}.`;
  let writes = Promise.resolve();
  return {
    async get<T>(path: string): Promise<T | null> {
      return readJson<T | null>(prefix + path, null);
    },
    put(path, value) {
      writes = writes
        .catch(() => {})
        .then(async () => {
          const indexKey = prefix + "index";
          const keys = await readJson<string[]>(indexKey, []);
          const next = [...keys.filter((k) => k !== path), path];
          await writeJson(prefix + path, value);
          while (next.length > 30)
            await AsyncStorage.removeItem(prefix + next.shift()!);
          await writeJson(indexKey, next);
        });
      return writes;
    },
  };
}
