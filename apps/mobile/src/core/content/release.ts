/** Release-date rules shared by the online catalog, cards and title pages. */

export function releaseDay(value: string | null | undefined, now = new Date()) {
  const trimmed = String(value ?? "").trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) return null;
  const date = new Date(`${trimmed}T00:00:00`);
  if (!Number.isFinite(date.getTime())) return null;
  // Compare calendar days, not times: a title released today is watchable.
  const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
  return { value: trimmed, today };
}

/** Unknown dates stay visible: only a known future date hides a title. */
export function isReleased(
  value: string | null | undefined,
  now = new Date(),
) {
  const day = releaseDay(value, now);
  return !day || day.value <= day.today;
}

export function releaseLabel(value: string | null | undefined): string | null {
  const day = releaseDay(value);
  if (!day) return null;
  const date = new Date(`${day.value}T00:00:00`);
  if (!Number.isFinite(date.getTime())) return null;
  return date.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}
