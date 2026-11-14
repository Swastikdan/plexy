export interface ElectronAPI {
  isElectron: boolean;
  localOnly?: boolean;
  discoverServers: () => Promise<
    Array<{ id: string; name: string; url: string }>
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
  resumeSeconds?: number;
  autoSubtitles?: boolean;
  subtitleLanguage?: string;
}

export interface NativePlayResult {
  sessionId: string;
  fileId: number;
  title: string | null;
}

export interface NativeCommandRequest {
  sessionId: string;
  action: "pause" | "resume" | "seek" | "stop" | "set-audio";
  value?: number;
}

export interface NativeAudioTrack {
  id: number;
  title: string | null;
  language: string | null;
  default: boolean;
  selected: boolean;
}

export interface NativePlaybackEvent {
  sessionId: string;
  fileId: number;
  type: "ready" | "time" | "duration" | "pause" | "buffering" | "ended" | "error" | "closed" | "audio";
  position?: number;
  duration?: number;
  paused?: boolean;
  buffering?: boolean;
  message?: string;
  audioTracks?: NativeAudioTrack[];
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
