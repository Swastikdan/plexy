/// Admin contracts: server status, settings, libraries, folder picking.
export interface ServerStatus {
  version: string;
  /** Stable opaque identifier for the server installation. */
  serverId?: string;
  bun?: string;
  startedAt?: string;
  adminAvailable?: boolean;
  uptimeSeconds?: number;
  bind?: string;
  /** Bind address saved in config; differs from `bind` until a restart applies it. */
  savedBind?: string;
  restartRequired?: boolean;
  /** Reachable `https://<lan-ip>:<lan-port>` URLs while bound to 0.0.0.0. */
  lanUrls?: string[];
  port?: number;
  hasTmdbToken?: boolean;
  hasLibraries?: boolean;
  setupComplete?: boolean;
  ownerCreated?: boolean;
  scan?: {
    scanId: number;
    status: string;
    /** Null during the discovery phase, before the scanner walks a library. */
    libraryId: number | null;
    libraryName: string | null;
    filesSeen: number;
    filesUpdated: number;
    issues: number;
    currentFile: string | null;
  } | null;
  recentScans?: Array<{
    id: number;
    status: string;
    files_seen: number | null;
    issues: number | null;
    started_at: string;
    finished_at: string | null;
  }>;
  optimizer?: OptimizerStatus;
}

export interface OptimizerStatus {
  enabled: boolean;
  running: boolean;
  paused: boolean;
  manuallyPaused?: boolean;
  queued: number;
  current: { fileId: number; progress: number } | null;
  counts: Record<string, number>;
  cacheBytes: number;
  cacheDir?: string;
  storage?: "data" | "media";
  files?: Array<{
    id: number;
    path: string;
    optimizedPath: string | null;
    size: number;
    optimizedSize: number;
    mtime: number | null;
    title?: string;
  }>;
}

export interface ServerSettings {
  localOnly?: boolean;
  directPlayOnly?: boolean;
  port: number;
  bindAddress: string;
  logLevel: string;
  metadataLanguage: string;
  preferredAudioLanguage: string;
  metadataRegion: string;
  imageQuality: string;
  autoOptimize: boolean;
  skipSegmentsEnabled: boolean;
  optimizeMaxCacheGb: number;
  /** `data` keeps prepared copies in the Plexy data folder; `media` puts them beside each original. */
  optimizeStorage: "data" | "media";
  /** Replace the source file with the prepared MP4 after a successful preparation. */
  replaceOriginal: boolean;
  /** Send removed originals to the system Trash instead of deleting permanently. */
  moveOriginalsToTrash: boolean;
  probeConcurrency: number;
  hasTmdbToken: boolean;
  tokenSource: string;
  note: string;
  version: string;

  // Offline-cache settings
  prefetchMaxConcurrent: number;
  prefetchMaxCacheMb: number;
}

/** One paired device, used by the sessions/devices admin view. */
export interface AuthDeviceInfo {
  id: number;
  userId: number;
  deviceId: string | null;
  name: string;
  createdAt: string;
  lastSeen: string | null;
  lastIp: string | null;
  revoked: boolean;
  username?: string;
}

/** One playback session refreshed by the progress heartbeat. */
export interface PlaybackSessionInfo {
  id: number;
  userId: number;
  username: string;
  deviceId: number | null;
  deviceName: string | null;
  itemId: number | null;
  itemTitle: string | null;
  itemKind: string | null;
  parentTitle: string | null;
  seasonNumber: number | null;
  episodeNumber: number | null;
  fileId: number | null;
  position: number;
  duration: number | null;
  paused: boolean;
  status: string;
  stopRequested: boolean;
  client: string | null;
  ip: string | null;
  startedAt: string;
  updatedAt: string;
  active: boolean;
}

export interface SessionsResponse {
  sessions: PlaybackSessionInfo[];
  active: number;
}

/** Background trickplay (scrub thumbnail) coverage. */
export interface TrickplayStatus {
  running: boolean;
  queued: number;
  activeFileId: number | null;
  total: number;
  ready: number;
  failed: number;
  ffmpegAvailable: boolean;
}

/** The library kinds the setup and admin screens can create. */

export type LibraryType = "movies" | "tv";

/** `GET /api/settings` */

export interface SettingsResponse {
  settings: ServerSettings;
  logLevel: string;
}

/** One TMDB search hit used by fix-match. */

export interface LocalFolderEntry {
  name: string;
  path: string;
  isDirectory: boolean;
  hasVideos: boolean;
}

/** `GET /api/local-folders` */

export interface LocalFoldersResponse {
  path: string;
  parent: string | null;
  entries: LocalFolderEntry[];
}

/** `GET /api/logs` */
