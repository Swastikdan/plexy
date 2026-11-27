import type { MovyQualityOption } from "./types";

/**
 * The provider returns free-form labels such as
 * `"1080p BluRay HEVC · 2.54 GB"` or
 * `"2160p WEB-DL HDR DV HEVC · 18.43 GB"`.
 *
 * We only trust two numbers from that string: the height and the file size.
 * Height decides eligibility against the user's ceiling; size breaks ties
 * inside one height so we start the smallest file that still meets it.
 */

export interface RankedQuality<T extends MovyQualityOption> {
  option: T;
  height: number;
  bytes: number | null;
}

const HEIGHTS = [2160, 1440, 1080, 720, 480, 360, 240] as const;

/** Height encoded in a quality label, or 0 when the label has no resolution. */
export function heightOf(label: string): number {
  const text = label.toLowerCase();
  if (/\b(4k|uhd)\b/.test(text)) return 2160;
  for (const height of HEIGHTS) {
    if (new RegExp(`\\b${height}p\\b`).test(text)) return height;
  }
  return 0;
}

/** Bytes encoded in a size label such as `2.54 GB`. */
export function bytesOf(size: string | undefined): number | null {
  if (!size) return null;
  const match = size.match(/([\d.]+)\s*(tb|gb|mb|kb)/i);
  if (!match) return null;
  const value = Number(match[1]);
  if (!Number.isFinite(value)) return null;
  const unit = match[2].toLowerCase();
  const scale =
    unit === "tb"
      ? 1024 ** 4
      : unit === "gb"
        ? 1024 ** 3
        : unit === "mb"
          ? 1024 ** 2
          : 1024;
  return Math.round(value * scale);
}

export function rankQualities<T extends MovyQualityOption>(
  options: readonly T[],
): RankedQuality<T>[] {
  const ranked: RankedQuality<T>[] = [];
  for (const option of options) {
    const height = heightOf(option.quality);
    if (!height) continue;
    ranked.push({
      option,
      height,
      bytes: bytesOf(option.size) ?? bytesOf(option.quality),
    });
  }
  return ranked;
}

/**
 * Pick the best source at or below `maxHeight`, then the smallest file at that
 * height. When the provider only offers something above the ceiling we still
 * play the lowest option it has — the caller never sees an empty list just
 * because the ceiling was optimistic.
 */
export function pickQuality<T extends MovyQualityOption>(
  options: readonly T[],
  maxHeight: number,
): RankedQuality<T> | null {
  const ranked = rankQualities(options);
  if (!ranked.length) return null;
  const within = ranked.filter((entry) => entry.height <= maxHeight);
  const pool = within.length ? within : ranked;
  const targetHeight = within.length
    ? Math.max(...pool.map((entry) => entry.height))
    : Math.min(...pool.map((entry) => entry.height));
  const atHeight = pool.filter((entry) => entry.height === targetHeight);
  return atHeight.reduce(
    (best, entry) => {
      if (!best) return entry;
      const bestBytes = best.bytes ?? Number.MAX_SAFE_INTEGER;
      const entryBytes = entry.bytes ?? Number.MAX_SAFE_INTEGER;
      return entryBytes < bestBytes ? entry : best;
    },
    null as RankedQuality<T> | null,
  );
}

/** Sort high-to-low for the picker, biggest resolution first. */
export function sortQualities<T extends MovyQualityOption>(
  options: readonly T[],
): T[] {
  return [...options].sort((a, b) => {
    const byHeight = heightOf(b.quality) - heightOf(a.quality);
    if (byHeight !== 0) return byHeight;
    return (bytesOf(a.size) ?? 0) - (bytesOf(b.size) ?? 0);
  });
}
