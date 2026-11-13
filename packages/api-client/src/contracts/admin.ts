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
  queued: number;
  current: { fileId: number; progress: number } | null;
  counts: Record<string, number>;
  cacheBytes: number;
  cacheDir?: string;
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
  probeConcurrency: number;
  hasTmdbToken: boolean;
  tokenSource: string;
  note: string;
  version: string;

  // Offline-cache settings
  prefetchMaxConcurrent: number;
  prefetchMaxCacheMb: number;
}

/** The three library kinds the setup and admin screens can create. */

export type LibraryType = "movies" | "tv" | "anime";

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
