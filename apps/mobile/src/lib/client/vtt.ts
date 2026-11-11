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
