export const SEEK_SECONDS = 30;
export const MIN_ZOOM = 0.75;
export const MAX_ZOOM = 3;
export const DOUBLE_TAP_MS = 300;
export interface PlayerTap {
  time: number;
  side: "left" | "right";
}
export function doubleTapSeek(
  previous: PlayerTap | null,
  current: PlayerTap,
): number | null {
  if (
    !previous ||
    previous.side !== current.side ||
    current.time < previous.time ||
    current.time - previous.time > DOUBLE_TAP_MS
  )
    return null;
  return current.side === "left" ? -SEEK_SECONDS : SEEK_SECONDS;
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

/** Seeking/rebuffering must never replace controls after the source has opened. */
export function shouldShowPlayerLoading(
  status: string,
  hasLoaded: boolean,
  isScrubbing: boolean,
): boolean {
  return status === "loading" && !hasLoaded && !isScrubbing;
}
