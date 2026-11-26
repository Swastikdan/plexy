/// Intro/recap/credits markers are read by both the browser watch route and
/// the desktop native player. Matching and labels are pure, so they live here.

export type SkipSegmentKind = "intro" | "recap" | "outro";

export type SkipMarker = { start: number; end: number } | null | undefined;

export type SkipSegments =
  | {
      intro?: SkipMarker;
      recap?: SkipMarker;
      outro?: SkipMarker;
    }
  | undefined;

const SKIP_SEGMENT_KINDS = ["intro", "recap", "outro"] as const;

/** The segment covering `time`, preferring intro, then recap, then credits. */
export function segmentAt(
  markers: SkipSegments,
  time: number,
): SkipSegmentKind | null {
  if (!markers) return null;
  for (const kind of SKIP_SEGMENT_KINDS) {
    const marker = markers[kind];
    if (marker && time >= marker.start && time < marker.end) return kind;
  }
  return null;
}

export function skipLabel(kind: SkipSegmentKind): string {
  return kind === "outro" ? "Skip ending" : `Skip ${kind}`;
}
