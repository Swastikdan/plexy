// Shared display text for media tracks.
//
// The web player and the Android app both turn ffprobe language codes and
// subtitle titles into the same labels, so the mapping lives here rather than
// in two app-specific copies.

// Media tracks can use ISO 639-1 codes, ISO 639-2 codes, or full names.
const LANGUAGE_NAMES: Record<string, string> = {
  en: "English", eng: "English",
  el: "Greek", gre: "Greek", ell: "Greek",
  hi: "Hindi", hin: "Hindi",
  es: "Spanish", spa: "Spanish",
  fr: "French", fre: "French", fra: "French",
  de: "German", ger: "German", deu: "German",
  it: "Italian", ita: "Italian",
  pt: "Portuguese", por: "Portuguese",
  ja: "Japanese", jpn: "Japanese",
  ko: "Korean", kor: "Korean",
  zh: "Chinese", chi: "Chinese", zho: "Chinese",
  ru: "Russian", rus: "Russian",
  ar: "Arabic", ara: "Arabic",
  tr: "Turkish", tur: "Turkish",
  ta: "Tamil", tam: "Tamil",
  te: "Telugu", tel: "Telugu",
  ml: "Malayalam", mal: "Malayalam",
  kn: "Kannada", kan: "Kannada",
  bn: "Bengali", ben: "Bengali",
  mr: "Marathi", mar: "Marathi",
  gu: "Gujarati", guj: "Gujarati",
  pa: "Punjabi", pan: "Punjabi",
  ur: "Urdu", urd: "Urdu",
  fa: "Persian", per: "Persian", fas: "Persian",
  he: "Hebrew", heb: "Hebrew",
  pl: "Polish", pol: "Polish",
  nl: "Dutch", dut: "Dutch", nld: "Dutch",
  sv: "Swedish", swe: "Swedish",
  no: "Norwegian", nor: "Norwegian",
  da: "Danish", dan: "Danish",
  fi: "Finnish", fin: "Finnish",
  cs: "Czech", cze: "Czech", ces: "Czech",
  hu: "Hungarian", hun: "Hungarian",
  ro: "Romanian", rum: "Romanian", ron: "Romanian",
  uk: "Ukrainian", ukr: "Ukrainian",
  th: "Thai", tha: "Thai",
  vi: "Vietnamese", vie: "Vietnamese",
  id: "Indonesian", ind: "Indonesian",
  ms: "Malay", may: "Malay", msa: "Malay",
  fil: "Filipino", tl: "Filipino", tgl: "Filipino",
};

/** `eng`, `en-US`, or `English` → a reader-friendly language name. */
export function mediaLanguageName(language: string | null | undefined): string | null {
  const raw = language?.trim();
  if (!raw) return null;
  const base = raw.toLowerCase().split(/[-_]/)[0] ?? "";
  if (Object.hasOwn(LANGUAGE_NAMES, base)) return LANGUAGE_NAMES[base]!;
  if (base === "und" || base === "mul" || base === "zxx") return null;
  // Already human-readable, e.g. "Greek" or "Brazilian Portuguese".
  return /^[a-z]{2,3}$/.test(base)
    ? null
    : raw.charAt(0).toUpperCase() + raw.slice(1);
}

const byName = new Map<string, string>();
for (const [code, name] of Object.entries(LANGUAGE_NAMES)) {
  const key = name.toLowerCase();
  if (!byName.has(key)) byName.set(key, code);
}

export const mediaLanguageOptions = [...byName.values()]
  .map((code): [string, string] => [code, LANGUAGE_NAMES[code]!])
  .sort((a, b) => a[1].localeCompare(b[1]));

export function languageTag(value: string | null | undefined): string | undefined {
  const tag = value?.trim().toLowerCase().replaceAll("_", "-");
  if (!tag || ["und", "mul", "zxx", "unknown"].includes(tag.split("-")[0]!)) {
    return undefined;
  }
  return tag;
}

/** Recognize both language tags and demuxers' human-readable language names. */
export function languageIdentity(value: string | null | undefined): string | undefined {
  const tag = languageTag(value);
  if (!tag) return undefined;
  const base = tag.split("-")[0]!;
  if (Object.hasOwn(LANGUAGE_NAMES, base)) {
    return byName.get(LANGUAGE_NAMES[base]!.toLowerCase());
  }
  return byName.get(tag) ?? (/^[a-z]{2,3}$/.test(base) ? base : tag);
}

export function findLanguageTrack<T extends { language?: string | null }>(
  tracks: readonly T[],
  ...preferences: (string | null | undefined)[]
): T | undefined {
  for (const preference of preferences) {
    const tag = languageTag(preference);
    const language = languageIdentity(preference);
    if (!tag || !language) continue;
    const track =
      tracks.find((entry) => languageTag(entry.language) === tag) ??
      tracks.find((entry) => languageIdentity(entry.language) === language);
    if (track) return track;
  }
  return undefined;
}

/** Sidecars commonly end in .en-US.srt, .eng.forced.srt, or .hi.sdh.vtt. */
export function subtitleFilenameLanguage(filename: string): string | null {
  const stem = filename.replace(/\.(srt|vtt)$/i, "");
  const suffix = stem.replace(/(?:\.(?:forced|sdh|cc))+$/i, "").split(".").at(-1);
  if (!suffix || stem === suffix || !/^[a-z]{2,3}(?:[-_][a-z0-9]{2,8})*$/i.test(suffix)) return null;
  const tag = languageTag(suffix);
  return tag && mediaLanguageName(tag) ? tag : null;
}

const TECHNICAL_SUBTITLE_TOKENS = new Set([
  "subrip", "srt", "vtt", "webvtt", "ass", "ssa", "mov_text", "text",
  "default", "forced", "sdh", "cc", "embedded", "sidecar", "external",
]);

/** Remove codec/format clutter such as `(subrip, Default)` from a track title. */
export function cleanSubtitleName(title: string | null | undefined): string {
  return (title ?? "")
    .replace(/\s*\(([^)]*)\)/g, (whole, inner: string) => {
      const tokens = inner.split(",").map((token) => token.trim().toLowerCase()).filter(Boolean);
      return tokens.length > 0 && tokens.every((token) => TECHNICAL_SUBTITLE_TOKENS.has(token))
        ? ""
        : whole;
    })
    .replace(/\s{2,}/g, " ")
    .replace(/\s*[-–—]\s*$/, "")
    .trim();
}

/** `MoviesMod.org (subrip, Default)` + `gre` → `MoviesMod.org · Greek`. */
export function subtitleTrackLabel(track: {
  title?: string | null;
  language?: string | null;
}): string {
  const language = mediaLanguageName(track.language);
  const name = cleanSubtitleName(track.title);
  const titleIsCode = Boolean(name) && name.toLowerCase() === (track.language ?? "").toLowerCase();
  const displayName = name && !titleIsCode ? name : language ?? name ?? "Subtitle";
  if (!language || language.toLowerCase() === displayName.toLowerCase()) return displayName;
  return `${displayName} · ${language}`;
}
