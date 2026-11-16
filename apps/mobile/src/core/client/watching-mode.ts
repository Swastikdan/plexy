export type AppMode = "local" | "hybrid" | "online";
export const modeLabels: Record<AppMode, string> = { local: "Local only", hybrid: "Hybrid", online: "Fully online" };

export function modePreferences(mode: AppMode) {
  return { mode, source: mode === "local" ? "local" as const : "remote" as const };
}

export function restoredMode(stored: { mode?: unknown; onboardingCompleted?: unknown; source?: unknown }, hasMedia: boolean) {
  const mode: AppMode = stored.mode === "local" || stored.mode === "online" ? stored.mode : "hybrid";
  return {
    mode,
    onboardingCompleted: typeof stored.onboardingCompleted === "boolean"
      ? stored.onboardingCompleted : stored.source === "remote" || hasMedia,
  };
}

export function canFinishOnboarding(mode: AppMode, folderCount: number) {
  return mode !== "local" || folderCount > 0;
}
