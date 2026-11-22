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

/** Credits are assumed to fill this share of an episode when IntroDB has no marker. */
const CREDITS_FALLBACK_RATIO = 0.18;
const CREDITS_FALLBACK_MIN_SECONDS = 90;
const CREDITS_FALLBACK_MAX_SECONDS = 5 * 60;

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

/**
 * When the player should offer the next episode.
 *
 * A community end-credits marker is exact, so it wins. Episodes without one
 * (IntroDB has no outro for plenty of shows) fall back to the last 18% of the
 * runtime, capped at five minutes. The previous fixed 90-second tail only
 * caught the very end: a 29:36 episode whose credits begin at 25:00 surfaced
 * the button at 28:06, well after the credits had started.
 */
export function creditsStart(
  markers: SkipSegments,
  duration: number | null | undefined,
): number | null {
  if (markers?.outro) return markers.outro.start;
  if (duration == null || !Number.isFinite(duration) || duration <= 0) return null;
  const tail = Math.min(
    CREDITS_FALLBACK_MAX_SECONDS,
    Math.max(CREDITS_FALLBACK_MIN_SECONDS, duration * CREDITS_FALLBACK_RATIO),
  );
  return Math.max(0, duration - tail);
}

export function skipLabel(kind: SkipSegmentKind): string {
  return kind === "outro" ? "Skip ending" : `Skip ${kind}`;
}
