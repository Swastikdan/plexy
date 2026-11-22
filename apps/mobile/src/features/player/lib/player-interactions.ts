export const SEEK_SECONDS = 10;
export const MIN_ZOOM = 0.75;
export const MAX_ZOOM = 3;
export const DOUBLE_TAP_MS = 300;
/**
 * How long a seek burst stays open after the last skip. While it is open a
 * single tap on the same side skips again instead of toggling the controls,
 * so users do not need to double tap for every additional step.
 */
export const SEEK_BURST_MS = 1200;
/** How long a touch must stay down before temporary 2x playback starts. */
export const HOLD_TO_BOOST_MS = 250;
export interface PlayerTap {
  time: number;
  side: "left" | "right";
}
/** Resolves the seek direction and step for a recognized double tap. */
export function doubleTapSeek(
  previous: PlayerTap | null,
  current: PlayerTap,
  seconds = SEEK_SECONDS,
): number | null {
  if (
    !previous ||
    previous.side !== current.side ||
    current.time < previous.time ||
    current.time - previous.time > DOUBLE_TAP_MS
  )
    return null;
  return current.side === "left" ? -seconds : seconds;
}
export function clampZoom(scale: number): number {
  return Math.round(Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, scale)) * 100) / 100;
}
export function pinchZoom(
  startZoom: number,
  startDistance: number,
  distance: number,
): number {
  return startDistance > 0
    ? clampZoom((startZoom * distance) / startDistance)
    : startZoom;
}

/**
 * A seek has "landed" when the player is within a few seconds of the request.
 * Codecs and containers snap to keyframes, so an exact match is not expected.
 */
export const SEEK_LANDED_TOLERANCE_SECONDS = 5;

export function seekLanded(target: number, actual: number): boolean {
  return Math.abs(actual - target) <= SEEK_LANDED_TOLERANCE_SECONDS;
}

/** Seeking/rebuffering must never replace controls after the source has opened. */
export function shouldShowPlayerLoading(
  status: string,
  hasLoaded: boolean,
  isScrubbing: boolean,
): boolean {
  return status === "loading" && !hasLoaded && !isScrubbing;
}
