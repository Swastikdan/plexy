import type { AppMode } from "./watching-mode";
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
export { modeLabels, modePreferences, type AppMode } from "./watching-mode";
export interface Preferences {
  mode: AppMode;
  onboardingCompleted: boolean;
  theme: "light" | "dark" | "system";
  /** Which catalog the app browses. Local is the on-device library. */
  source: "local" | "remote";
  autoSubtitles: boolean;
  subtitleLanguage: string;
  subtitleOffset: number;
  subtitlePosition: "bottom" | "top";
  subtitleSize: number;
  autoSkip: boolean;
  autoNext: boolean;
  /** Start the Vidy embed automatically. */
  onlineAutoplay: boolean;
  /** Show Vidy's season/episode picker. */
  onlineEpisodeSelector: boolean;
  /** The user has acknowledged the online catalog disclaimer. */
  onlineDisclaimerSeen: boolean;
  seekSeconds: 5 | 10 | 15 | 20 | 30 | 60;
  playbackRate: number;
}
export const defaultPreferences: Preferences = {
  mode: "hybrid",
  onboardingCompleted: false,
  theme: "system",
  source: "local",
  autoSubtitles: true,
  subtitleLanguage: "en",
  subtitleOffset: 0,
  subtitlePosition: "bottom",
  subtitleSize: 22,
  autoSkip: false,
  autoNext: true,
  onlineAutoplay: true,
  onlineEpisodeSelector: true,
  onlineDisclaimerSeen: false,
  seekSeconds: 10,
  playbackRate: 1,
};
// Preserve the installed app's storage key when removing the old scope encoder.
export const PREFERENCE_KEY = "plexy.preferences.74_68_69_73_2d_64_65_76_69_63_65";
