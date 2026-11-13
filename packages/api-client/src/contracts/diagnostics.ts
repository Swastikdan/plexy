/// Diagnostics contracts: logs, crash reports, playback events.
export interface PlaybackDiagnostic {
  at: string;
  kind: "startup" | "rebuffer" | "error";
  path: "direct" | "hls" | "remux" | "transcode" | null;
  durationMs: number | null;
  mediaErrorCode: number | null;
}

export interface LogsResponse {
  lines: string[];
}

/** `GET /api/crashes` */

export interface CrashesResponse {
  crashes: Array<{ id: string; ts: string }>;
}
