import AsyncStorage from "@react-native-async-storage/async-storage";
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
  playbackRate: 1,
};
// Preserve the installed app's storage key when removing the old scope encoder.
export const PREFERENCE_KEY = "plexy.preferences.74_68_69_73_2d_64_65_76_69_63_65";
