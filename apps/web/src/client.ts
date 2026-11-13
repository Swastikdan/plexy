/// Plexy API singleton for the web/desktop UI (PRD 9, 10).
///
/// All transport policy lives in `@plexy/api-client`'s `createPlexyClient`:
/// URL building, retry, deadlines, credentials, and error normalization. This
/// module only supplies the runtime base URL and the app-level hooks, then
/// flattens the grouped client into the `api.*` surface the screens use.
import {
  ApiError,
  createPlexyClient,
  probeBrowserCaps,
  type BrowserCaps,
  type CrashesResponse,
  type FileFacts,
  type HomePayload,
  type ItemCard,
  type LibraryItem,
  type LibraryType,
  type LogsResponse,
  type OptimizerStatus,
  type PersonDetail,
  type Playability,
  type PlayPath,
  type PlaybackDiagnostic,
  type ReviewEntry,
  type ReviewPayload,
  type ServerSettings,
  type ServerStatus,
  type SettingsResponse,
  type SkipSegments,
  type SubtitleTrack,
  type TitleDetail,
  type TmdbMatchSearchResponse,
  type Watch,
} from "@plexy/api-client";
import { getApiBase } from "./server-config";
import { reportConnectionHealth } from "./lib/connection-health";

export { ApiError };

/** Let the connection gate replace the UI with the pairing screen. */
function notifyUnauthorized(): void {
  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent("plexy:unauthorized"));
  }
}

// The base URL is resolved per call: a hosted web build lets the viewer pick
// their server at runtime, and the desktop app can fall back to a remote one.
const client = createPlexyClient({
  baseUrl: getApiBase,
  credentials: "include",
  onUnauthorized: notifyUnauthorized,
  onHealth: reportConnectionHealth,
});

export const api = {
  ...client.status,
  ...client.catalog,
  ...client.watch,
  ...client.playback,
  ...client.admin,
  ...client.matching,
  ...client.diagnostics,
  ...client.urls,
};

// Re-export browser probe and shared types for convenience
export { probeBrowserCaps };
export const browserCaps = (video: HTMLVideoElement) => probeBrowserCaps(video);

export type {
  BrowserCaps,
  CrashesResponse,
  FileFacts,
  HomePayload,
  ItemCard,
  LibraryItem,
  LibraryType,
  LogsResponse,
  OptimizerStatus,
  PersonDetail,
  Playability,
  PlayPath,
  PlaybackDiagnostic,
  ReviewEntry,
  ReviewPayload,
  ServerSettings,
  ServerStatus,
  SettingsResponse,
  SkipSegments,
  SubtitleTrack,
  TitleDetail,
  TmdbMatchSearchResponse,
  Watch,
};
