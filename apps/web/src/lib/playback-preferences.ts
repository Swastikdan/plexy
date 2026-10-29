const KEY = "plexy:playback-preferences:v1";

export type PlaybackPreferences = {
  autoSubtitles: boolean;
  subtitleLanguage: string;
};

const DEFAULTS: PlaybackPreferences = { autoSubtitles: true, subtitleLanguage: "en" };

export function getPlaybackPreferences(): PlaybackPreferences {
  if (typeof localStorage === "undefined") return DEFAULTS;
  try {
    const value = JSON.parse(localStorage.getItem(KEY) ?? "{}") as Partial<PlaybackPreferences>;
    return {
      autoSubtitles: typeof value.autoSubtitles === "boolean" ? value.autoSubtitles : DEFAULTS.autoSubtitles,
      subtitleLanguage: typeof value.subtitleLanguage === "string" ? value.subtitleLanguage : DEFAULTS.subtitleLanguage,
    };
  } catch {
    return DEFAULTS;
  }
}

export function savePlaybackPreferences(patch: Partial<PlaybackPreferences>): PlaybackPreferences {
  const next = { ...getPlaybackPreferences(), ...patch };
  localStorage.setItem(KEY, JSON.stringify(next));
  return next;
}
