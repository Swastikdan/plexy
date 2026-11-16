/** Choose at most one adjacent page, using a flick's release direction. */
export function pagerTarget(
  startOffset: number,
  distance: number,
  velocity: number,
  width: number,
  pageCount: number,
): number {
  "worklet";
  if (width <= 0 || pageCount <= 0) return 0;
  const start = Math.max(0, Math.min(pageCount - 1, Math.round(-startOffset / width)));
  const flick = Math.abs(velocity) > 350;
  const commit = flick || Math.abs(distance) > width * 0.25;
  const direction = (flick ? velocity : distance) < 0 ? 1 : -1;
  return Math.max(0, Math.min(pageCount - 1, start + (commit ? direction : 0)));
}
