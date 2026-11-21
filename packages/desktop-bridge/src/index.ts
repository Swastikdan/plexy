/// The contract between the Electron main process, the preload bridge, and the
/// browser UI it hosts. All three used to declare these shapes separately, so a
/// field added in one place silently diverged from the other two.

export interface ElectronAPI {
  isElectron: boolean;
  localOnly?: boolean;
  discoverServers: () => Promise<
    Array<{
      id: string;
      name: string;
      url: string;
      reachable?: boolean;
      latencyMs?: number | null;
    }>
  >;
  platform: string;
  selectFolder: () => Promise<string | null>;
  openLogs: () => Promise<void>;
  openDataDir: () => Promise<void>;
  getVersion: () => Promise<string>;
  checkForUpdates: () => Promise<UpdateStatus>;
  installUpdate: () => Promise<void>;
  onUpdateProgress: (
    callback: (progress: UpdateProgress) => void,
  ) => () => void;
  getSystemUsage: () => Promise<DesktopSystemUsage>;
  getLocalServerEnabled: () => Promise<boolean>;
  setLocalServerEnabled: (enabled: boolean) => Promise<void>;
  probeServer: (
    url: string,
  ) => Promise<{ version: string; setupComplete: boolean }>;
  getServerUrl: () => Promise<string>;
  setServerUrl: (url: string) => Promise<void>;
  onNavigate: (callback: (route: string) => void) => () => void;
  isFullScreen?: () => Promise<boolean>;
  setFullScreen?: (value: boolean) => Promise<boolean>;
  onFullScreenChange?: (
    callback: (isFullScreen: boolean) => void,
  ) => () => void;
  /** Native mpv playback: absent in browsers and on unsupported platforms. */
  nativePlayer?: NativePlayerBridge;
}

export interface NativePlaybackInfo {
  available: boolean;
  platform: string;
  engine: "bundled" | "system" | null;
  version: string | null;
  reason?: string;
}

export interface NativePlayRequest {
  fileId: number;
  serverUrl: string;
  /** Origin of the trusted renderer frame; the server must belong to it. */
  serverOrigin?: string;
  /** Local proxy to retry through when a direct remote manifest fails. */
  fallbackServerUrl?: string;
  resumeSeconds?: number;
  autoSubtitles?: boolean;
  subtitleLanguage?: string;
}

export type NativePlayerAction =
  | "pause"
  | "resume"
  | "seek"
  | "stop"
  | "set-audio"
  | "set-subtitle"
  | "set-volume"
  | "set-mute"
  | "set-speed";

export interface NativeCommandRequest {
  sessionId: string;
  action: NativePlayerAction;
  value?: number;
}

/**
 * A language track as mpv sees it. Audio and subtitle tracks share the shape so
 * the Plexy player can render the same menu for both.
 */
export interface NativeAudioTrack {
  id: number;
  title: string | null;
  language: string | null;
  default: boolean;
  selected: boolean;
  /** External (sidecar) track rather than one embedded in the container. */
  external?: boolean;
}

export interface NativePlaybackEvent {
  sessionId: string;
  fileId: number;
  type:
    | "ready"
    | "time"
    | "duration"
    | "pause"
    | "buffering"
    | "ended"
    | "error"
    | "closed"
    | "audio"
    | "tracks"
    | "volume"
    | "speed"
    | "fullscreen";
  position?: number;
  duration?: number;
  paused?: boolean;
  buffering?: boolean;
  message?: string;
  audioTracks?: NativeAudioTrack[];
  subtitleTracks?: NativeAudioTrack[];
  /** Seconds of media mpv has cached ahead of the playhead. */
  cachedSeconds?: number;
  /** 0–100, mpv's own volume scale. */
  volume?: number;
  muted?: boolean;
  speed?: number;
  fullscreen?: boolean;
}

export interface NativePlayResult {
  sessionId: string;
  fileId: number;
  title: string | null;
}

export interface NativePlayerBridge {
  info: () => Promise<NativePlaybackInfo>;
  play: (request: NativePlayRequest) => Promise<NativePlayResult>;
  command: (request: NativeCommandRequest) => Promise<{ ok: true }>;
  stop: (request?: { sessionId?: string }) => Promise<{ ok: true }>;
  onEvent: (callback: (event: NativePlaybackEvent) => void) => () => void;
}

export interface DesktopSystemUsage {
  cpuPercent: number;
  appMemoryBytes: number;
  appGpuMemoryBytes: number;
  systemMemoryTotalBytes: number;
  systemMemoryFreeBytes: number;
}

export interface UpdateStatus {
  supported: boolean;
  currentVersion: string;
  currentTag: string;
  latestVersion?: string;
  latestTag?: string;
  updateAvailable: boolean;
  currentIsNewer: boolean;
  canInstall: boolean;
  requiresAdministrator: boolean;
  error?: string;
}

export interface UpdateProgress {
  phase: "downloading" | "verifying" | "waiting-for-approval" | "installing";
  downloadedBytes: number;
  totalBytes: number | null;
}
