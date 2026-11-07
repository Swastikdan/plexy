export interface Cue {
  start: number;
  end: number;
  text: string;
}
export interface Preview extends Cue {
  uri: string;
  x: number;
  y: number;
  width: number;
  height: number;
}
function timestamp(value: string) {
  const parts = value.trim().replace(",", ".").split(":").map(Number);
  return parts.reduce((n, part) => n * 60 + part, 0);
}
export function parseVtt(input: string): Cue[] {
  return input
    .replace(/^\uFEFF/, "")
    .replace(/\r/g, "")
    .split(/\n\s*\n/)
    .flatMap((block) => {
      const lines = block.trim().split("\n");
      const index = lines.findIndex((line) => line.includes("-->"));
      if (index < 0 || lines[0]?.startsWith("NOTE")) return [];
      const [from, to] = lines[index]!.split("-->");
      const start = timestamp(from!);
      const end = timestamp(to!.trim().split(/\s/)[0]!);
      if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start)
        return [];
      return [{ start, end, text: lines.slice(index + 1).join("\n") }];
    });
}
export function subtitleText(cues: Cue[], time: number, offset = 0) {
  return cues
    .filter((cue) => time >= cue.start + offset && time < cue.end + offset)
    .map((cue) =>
      cue.text
        .replace(/<[^>]*>/g, "")
        .replace(/&amp;/g, "&")
        .replace(/&lt;/g, "<")
        .replace(/&gt;/g, ">")
        .replace(/&nbsp;/g, " "),
    )
    .join("\n");
}
export function parsePreviews(input: string, trackUrl: string): Preview[] {
  return parseVtt(input).flatMap((cue) => {
    const [relative, crop] = cue.text.trim().split("#xywh=");
    if (!relative || !crop) return [];
    const [x, y, width, height] = crop.split(",").map(Number);
    if (
      [x, y, width, height].some((v) => v == null || !Number.isFinite(v)) ||
      width! <= 0 ||
      height! <= 0
    )
      return [];
    return [
      {
        ...cue,
        uri: new URL(relative, trackUrl).toString(),
        x: x!,
        y: y!,
        width: width!,
        height: height!,
      },
    ];
  });
}
export function parseHlsVariants(
  input: string,
  masterUrl: string,
): Array<{ label: string; uri: string }> {
  const lines = input.split(/\r?\n/);
  const result: Array<{ label: string; uri: string }> = [];
  lines.forEach((line, index) => {
    if (!line.startsWith("#EXT-X-STREAM-INF:")) return;
    const resolution = /RESOLUTION=\d+x(\d+)/.exec(line);
    const next = lines
      .slice(index + 1)
      .find((v) => v.trim() && !v.startsWith("#"));
    if (next && resolution)
      result.push({
        label: `${resolution[1]}p`,
        uri: new URL(next.trim(), masterUrl).toString(),
      });
  });
  return result;
}
