import type { FamilyLevel } from "@/core/content/audience";
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
export interface ShowTrackPreferences {
  audioLanguage?: string;
  /** Null explicitly turns subtitles off for the show. */
  subtitleLanguage?: string | null;
}

export interface Preferences {
  mode: AppMode;
  onboardingCompleted: boolean;
  theme: "light" | "dark" | "system";
  /** Which catalog the app browses. Local is the on-device library. */
  source: "local" | "remote";
  audioLanguage: string;
  autoSubtitles: boolean;
  subtitleLanguage: string;
  showTrackPreferences: Record<string, ShowTrackPreferences>;
  subtitleOffset: number;
  subtitlePosition: "bottom" | "top";
  subtitleSize: number;
  autoSkip: boolean;
  autoNext: boolean;
  /** Keep audio playing with a media notification when the app leaves the screen. */
  backgroundPlay: boolean;
  /** Start the Vidy embed automatically. */
  onlineAutoplay: boolean;
  /** Show Vidy's season/episode picker. */
  onlineEpisodeSelector: boolean;
  /** The user has acknowledged the online catalog disclaimer. */
  onlineDisclaimerSeen: boolean;
  seekSeconds: 5 | 10 | 15 | 20 | 30 | 60;
  playbackRate: number;
  /** Kids & Family mode. `off` disables every maturity filter. */
  familyLevel: FamilyLevel;
  /** Hide titles without a usable age rating while Kids & Family mode is on. */
  familyBlockUnrated: boolean;
  /** TMDB certification region used by the online catalog. */
  familyRegion: string;
  /** SHA-256 hash of the 4-digit PIN; empty until the mode is first enabled. */
  familyPinHash: string;
}
export const defaultPreferences: Preferences = {
  mode: "hybrid",
  onboardingCompleted: false,
  theme: "system",
  source: "local",
  audioLanguage: "",
  autoSubtitles: true,
  subtitleLanguage: "en",
  showTrackPreferences: {},
  subtitleOffset: 0,
  subtitlePosition: "bottom",
  subtitleSize: 22,
  autoSkip: false,
  autoNext: true,
  backgroundPlay: false,
  onlineAutoplay: true,
  onlineEpisodeSelector: true,
  onlineDisclaimerSeen: false,
  seekSeconds: 10,
  playbackRate: 1,
  familyLevel: "off",
  familyBlockUnrated: true,
  familyRegion: "US",
  familyPinHash: "",
};
// Preserve the installed app's storage key when removing the old scope encoder.
export const PREFERENCE_KEY = "plexy.preferences.74_68_69_73_2d_64_65_76_69_63_65";
