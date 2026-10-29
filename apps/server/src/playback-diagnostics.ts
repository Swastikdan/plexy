export type PlaybackDiagnosticKind = "startup" | "rebuffer" | "error";
export type PlaybackPath = "direct" | "hls" | "remux" | "transcode";

export interface PlaybackDiagnostic {
  at: string;
  kind: PlaybackDiagnosticKind;
  path: PlaybackPath | null;
  durationMs: number | null;
  mediaErrorCode: number | null;
}

const MAX_EVENTS = 100;
const events: PlaybackDiagnostic[] = [];

export function recordPlaybackDiagnostic(input: Omit<PlaybackDiagnostic, "at">): void {
  events.push({ ...input, at: new Date().toISOString() });
  if (events.length > MAX_EVENTS) events.splice(0, events.length - MAX_EVENTS);
}

export function recentPlaybackDiagnostics(): PlaybackDiagnostic[] {
  return events.slice(-MAX_EVENTS).reverse();
}
