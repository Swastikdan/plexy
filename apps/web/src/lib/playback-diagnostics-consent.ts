const STORAGE_KEY = "plexy.playback-diagnostics.enabled";

export function isPlaybackDiagnosticsEnabled(): boolean {
  try {
    return localStorage.getItem(STORAGE_KEY) === "true";
  } catch {
    return false;
  }
}

export function setPlaybackDiagnosticsEnabled(enabled: boolean): void {
  try {
    if (enabled) localStorage.setItem(STORAGE_KEY, "true");
    else localStorage.removeItem(STORAGE_KEY);
  } catch {
    // If storage is unavailable, telemetry stays disabled by default.
  }
}
