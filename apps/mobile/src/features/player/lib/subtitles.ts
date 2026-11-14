export interface Cue {
  start: number;
  end: number;
  text: string;
}
function parseTimestamp(value: string): number {
  if (!value) return NaN;
  const clean = value.trim().replace(",", ".");
  // Handle HH:MM:SS.mmm or MM:SS.mmm or SS.mmm
  const m = /(?:(?:(\d{1,2}):)?(\d{1,2}):)?(\d{1,2})(?:\.(\d+))?/.exec(clean);
  if (!m) return NaN;
  if (m[1] !== undefined) {
    const h = Number(m[1]);
    const min = Number(m[2]);
    const s = Number(m[3]);
    const ms = Number(`0.${m[4] || "0"}`);
    return h * 3600 + min * 60 + s + ms;
  }
  if (m[2] !== undefined) {
    const min = Number(m[2]);
    const s = Number(m[3]);
    const ms = Number(`0.${m[4] || "0"}`);
    return min * 60 + s + ms;
  }
  const s = Number(m[3]);
  const ms = Number(`0.${m[4] || "0"}`);
  return s + ms;
}
export function parseVtt(input: string): Cue[] {
  if (!input || typeof input !== "string") return [];
  const normalized = input
    .replace(/^\uFEFF/, "")
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n");
  const blocks = normalized.split(/\n\s*\n/);
  const cues: Cue[] = [];
  for (const block of blocks) {
    const lines = block.trim().split("\n");
    const index = lines.findIndex((line) => line.includes("-->"));
    if (
      index < 0 ||
      lines[0]?.startsWith("NOTE") ||
      lines[0]?.startsWith("STYLE")
    )
      continue;
    const arrowLine = lines[index]!;
    const [fromRaw, toRaw] = arrowLine.split("-->");
    if (!fromRaw || !toRaw) continue;
    const start = parseTimestamp(fromRaw);
    const end = parseTimestamp(toRaw.trim().split(/\s+/)[0]!);
    if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start)
      continue;
    const textLines = lines.slice(index + 1);
    if (textLines.length) {
      cues.push({ start, end, text: textLines.join("\n") });
    }
  }
  return cues;
}
export function cleanSubtitleText(raw: string): string {
  return raw
    .replace(/\\N/g, "\n")
    .replace(/\\n/g, "\n")
    .replace(/\{[^}]*\}/g, "") // ASS style tags like {\an8}, {\pos(..)}, {\c&H...&}
    .replace(/<[^>]*>/g, "") // HTML / WebVTT tags like <v Speaker>, <b>, <i>, <c.yellow>
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, " ")
    .trim();
}
export function subtitleText(cues: Cue[], time: number, offset = 0) {
  return cues
    .filter((cue) => time >= cue.start + offset && time < cue.end + offset)
    .map((cue) => cleanSubtitleText(cue.text))
    .filter((text) => text.length > 0)
    .join("\n");
}

/// Language codes arrive as ISO 639-1 (`en`), 639-2 (`eng`), or sometimes a
/// full English name. Menus should always speak the reader's language.
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
export function subtitleLanguageName(language: string | null | undefined): string | null {
  const raw = language?.trim();
  if (!raw) return null;
  const base = raw.toLowerCase().split(/[-_]/)[0] ?? "";
  if (LANGUAGE_NAMES[base]) return LANGUAGE_NAMES[base]!;
  if (base === "und" || base === "mul" || base === "zxx") return null;
  // Already human-readable, e.g. "Greek" or "Brazilian Portuguese".
  return /^[a-z]{2,3}$/.test(base)
    ? null
    : raw.charAt(0).toUpperCase() + raw.slice(1);
}

const TECHNICAL_TOKENS = new Set([
  "subrip", "srt", "vtt", "webvtt", "ass", "ssa", "mov_text", "text",
  "default", "forced", "sdh", "cc", "embedded", "sidecar", "external",
]);

/** Remove codec/format clutter like `(subrip, Default)` from a track title. */
export function cleanSubtitleName(title: string): string {
  return title
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

/** Primary label plus an optional language/default eyebrow for track menus. */
export function subtitleTrackDisplay({
  title,
  language,
  isDefault,
  fallback = "Subtitle track",
}: {
  title?: string | null;
  language?: string | null;
  isDefault?: boolean;
  fallback?: string;
}): { label: string; eyebrow?: string } {
  const languageName = subtitleLanguageName(language);
  const cleaned = cleanSubtitleName(title ?? "");
  const titleIsCode = Boolean(cleaned) && cleaned.toLowerCase() === (language ?? "").toLowerCase();
  const label = cleaned && !titleIsCode ? cleaned : languageName ?? cleaned ?? fallback;
  const eyebrow = [
    languageName && languageName.toLowerCase() !== label.toLowerCase() ? languageName : null,
    isDefault ? "Default" : null,
  ].filter(Boolean).join(" · ");
  return { label, eyebrow: eyebrow || undefined };
}
