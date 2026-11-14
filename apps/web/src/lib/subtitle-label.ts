/// Human labels for subtitle tracks. Browser-native caption menus (and the
/// in-player settings menu, which reads `<track label>`) only receive one
/// string, so both the track name and its language have to fit in it.
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

export function subtitleLanguageName(language: string | null | undefined): string | null {
  const raw = language?.trim();
  if (!raw) return null;
  const base = raw.toLowerCase().split(/[-_]/)[0] ?? "";
  if (LANGUAGE_NAMES[base]) return LANGUAGE_NAMES[base]!;
  if (base === "und" || base === "mul" || base === "zxx") return null;
  return /^[a-z]{2,3}$/.test(base)
    ? null
    : raw.charAt(0).toUpperCase() + raw.slice(1);
}

const TECHNICAL_TOKENS = new Set([
  "subrip", "srt", "vtt", "webvtt", "ass", "ssa", "mov_text", "text",
  "default", "forced", "sdh", "cc", "embedded", "sidecar", "external",
]);

/** Remove technical clutter such as `(subrip, Default)` from display labels. */
export function cleanSubtitleName(title: string | null | undefined): string {
  return (title ?? "")
    .replace(/\s*\(([^)]*)\)/g, (whole, inner: string) => {
      const tokens = inner.split(",").map((token) => token.trim().toLowerCase()).filter(Boolean);
      return tokens.length > 0 && tokens.every((token) => TECHNICAL_TOKENS.has(token))
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
  const language = subtitleLanguageName(track.language);
  const name = cleanSubtitleName(track.title);
  const titleIsCode = Boolean(name) && name.toLowerCase() === (track.language ?? "").toLowerCase();
  const displayName = name && !titleIsCode ? name : language ?? name ?? "Subtitle";
  if (!language || language.toLowerCase() === displayName.toLowerCase()) return displayName;
  return `${displayName} · ${language}`;
}
