export type AppMode = "local" | "hybrid" | "online";
export const modeLabels: Record<AppMode, string> = { local: "Local only", hybrid: "Hybrid", online: "Fully online" };

export function modePreferences(mode: AppMode) {
  return { mode, source: mode === "online" ? "online" as const : mode === "hybrid" ? "all" as const : "device" as const };
}

export function restoredMode(stored: { mode?: unknown; onboardingCompleted?: unknown; source?: unknown }, hasMedia: boolean) {
  const mode: AppMode = stored.mode === "local" || stored.mode === "online" ? stored.mode : "hybrid";
  return {
    mode,
    onboardingCompleted: typeof stored.onboardingCompleted === "boolean"
      ? stored.onboardingCompleted : stored.source === "remote" || stored.source === "online" || stored.source === "server" || stored.source === "all" || hasMedia,
  };
}

export function canFinishOnboarding(mode: AppMode, folderCount: number) {
  return mode !== "local" || folderCount > 0;
}

export type LibrarySource = "device" | "server" | "all" | "online";

/** Migrates the old local/remote source values and applies mode rules. */
export function normalizeSource(value: unknown, mode: AppMode): LibrarySource {
  if (value === "local") return "device";
  if (value === "remote") return mode === "local" ? "device" : "online";
  if (value === "device" || value === "server" || value === "all" || value === "online") {
    if (mode === "local" && value === "online") return "device";
    return value;
  }
  return mode === "online" ? "online" : mode === "hybrid" ? "all" : "device";
}
