/// Human language names for media track menus.
///
/// Matroska and ffprobe report ISO 639-2 codes ("hin", "eng"); Intl expects
/// ISO 639-1, so the common codes are mapped before display.
const ISO_639_1: Record<string, string> = {
  eng: "en", hin: "hi", tam: "ta", tel: "te", kan: "kn", mal: "ml", ben: "bn",
  mar: "mr", guj: "gu", pan: "pa", urd: "ur", san: "sa", spa: "es", fra: "fr",
  fre: "fr", deu: "de", ger: "de", ita: "it", jpn: "ja", kor: "ko", zho: "zh",
  chi: "zh", cmn: "zh", yue: "zh", rus: "ru", ara: "ar", por: "pt", nld: "nl",
  dut: "nl", swe: "sv", nor: "no", dan: "da", fin: "fi", pol: "pl", ces: "cs",
  cze: "cs", slk: "sk", slo: "sk", hun: "hu", ron: "ro", rum: "ro", tur: "tr",
  ell: "el", gre: "el", heb: "he", tha: "th", vie: "vi", ind: "id", msa: "ms",
  may: "ms", fil: "fil", ukr: "uk", fas: "fa", per: "fa",
};

export function canonicalLanguage(code?: string | null): string {
  const base = String(code ?? "").trim().toLowerCase().split(/[-_]/)[0] ?? "";
  return ISO_639_1[base] ?? base;
}

export function languageName(code?: string | null): string {
  const raw = String(code ?? "").trim();
  if (!raw) return "";
  const iso = canonicalLanguage(raw);
  try {
    return new Intl.DisplayNames(["en"], { type: "language" }).of(iso) ?? raw.toUpperCase();
  } catch {
    return raw.toUpperCase();
  }
}
