/// Shared data types for Plexy client and server (PRD 8, 9, 10).

export interface Watch {
  position: number;
  duration: number | null;
  played: boolean;
  percent: number;
}

export interface ItemCard {
  id: number;
  publicId: string;
  kind: string;
  name: string;
  year: number | null;
  seasonNumber?: number | null;
  episodeNumber?: number | null;
  fileId?: number | null;
  parentId?: number | null;
  parentPublicId?: string | null;
  parentTitle?: string | null;
  poster: string | null;
  backdrop: string | null;
  overview: string | null;
  rating: number | null;
  runtime: number | null;
  genres: string[];
  matchStatus: string;
  watch: Watch | null;
}

export interface HomeRow {
  key: string;
  title: string;
  items: ItemCard[];
}

export interface HomePayload {
  featured: ItemCard | null;
  rows: HomeRow[];
}

export interface AudioTrack {
  codec: string;
  channels: number;
  language: string;
  isDefault: boolean;
}

export interface PlayerAudioTrack extends AudioTrack {
  index: number;
}

export interface OptimizationState {
  status: "none" | "queued" | "running" | "done" | "failed" | "skipped" | string;
  mode: "remux" | "transcode" | null;
  progress: number | null;
  size: number | null;
  error: string | null;
}

export interface FileFacts {
  fileId: number;
  itemId: number | null;
  size: number;
  container: string | null;
  duration: number | null;
  width: number | null;
  height: number | null;
  videoCodec: string | null;
  videoProfile: string | null;
  fps: number | null;
  hdr: string | null;
  audio: AudioTrack[];
  subtitleCount: number;
  analysisStatus: string;
  analysisError: string | null;
  likelyPlayPath: string;
  likelyPlayReason: string;
  optimization?: OptimizationState;
}

export interface TitleDetail {
  item: ItemCard;
  logo: string | null;
  metadata: {
    overview: string | null;
    tagline: string | null;
    runtime: number | null;
    rating: number | null;
    certification: string | null;
    genres: string[];
  } | null;
  cast: Array<{ name: string; character: string | null; photo: string | null }>;
  trailer: { provider: string; key: string; name: string } | null;
  seasons: Array<{ id: number; number: number; name?: string; poster?: string | null }> | null;
  episodes: ItemCard[] | null;
  file: FileFacts | null;
  tmdbType: string | null;
  unmatched: boolean;
  matchReason: string | null;
}

export type PlayPath = "direct" | "remux" | "transcode" | "hls" | "unsupported";

/** Scrub-preview state for one file. `trackUrl` is a WebVTT metadata track. */
export interface Trickplay {
  ready: boolean;
  status: "none" | "queued" | "running" | "done" | "failed" | string;
  trackUrl: string | null;
  sprites?: string[];
  interval: number;
  width: number;
  height: number;
  frameCount: number | null;
  error: string | null;
}

/** The episode that follows the one currently playing. */
export interface NextEpisode {
  fileId: number;
  itemId: number;
  title: string;
  subtitle: string;
  poster: string | null;
  seasonNumber: number | null;
  episodeNumber: number | null;
}

export interface Playability {
  path: PlayPath;
  reason: string;
  fileId: number;
  itemId: number | null;
  audioTracks?: PlayerAudioTrack[];
  selectedAudioIndex?: number;
  versions?: Array<{
    fileId: number;
    height: number | null;
    codec: string | null;
    hdr: string | null;
    size: number;
    label: string;
  }>;
  title?: string;
  subtitle?: string | null;
  seasonNumber?: number | null;
  episodeNumber?: number | null;
  duration?: number | null;
  nextFileId?: number | null;
  next?: NextEpisode | null;
  tracks?: SubtitleTrack[];
  trickplay?: Trickplay;
  optimization?: OptimizationState;
  watch: { position: number; duration: number | null; played: boolean } | null;
}

export interface SkipSegments {
  intro: { start: number; end: number } | null;
  recap: { start: number; end: number } | null;
  outro: { start: number; end: number } | null;
}

export interface SubtitleTrack {
  track: string;
  kind: "embedded" | "sidecar";
  language: string | null;
  title: string;
  isDefault?: boolean;
}

export interface ReviewEntry {
  id: number;
  kind: string;
  parentTitle: string | null;
  name: string;
  year: number | null;
  seasonNumber?: number | null;
  episodeNumber?: number | null;
  matchStatus: string;
  score: number | null;
  matchedBy: string | null;
  tmdbId: number | null;
  fileName: string | null;
  originalName: string | null;
  poster: string | null;
  reason: string | null;
  candidates: Array<{
    tmdbId: number;
    tmdbType: string;
    title: string;
    year: number | null;
    score: number;
    reason: string;
    poster: string | null;
  }>;
}

export interface ReviewCounts {
  all: number;
  attention: number;
  matched: number;
  review: number;
  unmatched: number;
}

export interface ReviewPayload {
  items: ReviewEntry[];
  counts: ReviewCounts;
  filter: string;
  query: string;
}

export interface BrowserCaps {
  avc: boolean;
  hevc: boolean;
  vp9: boolean;
  av1: boolean;
  aac: boolean;
  opus: boolean;
}

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
  /** Reachable `http://<lan-ip>:<port>` URLs while bound to 0.0.0.0. */
  lanUrls?: string[];
  port?: number;
  hasTmdbToken?: boolean;
  hasLibraries?: boolean;
  setupComplete?: boolean;
  scan?: {
    scanId: number;
    status: string;
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

export interface PlaybackDiagnostic {
  at: string;
  kind: "startup" | "rebuffer" | "error";
  path: "direct" | "hls" | "remux" | "transcode" | null;
  durationMs: number | null;
  mediaErrorCode: number | null;
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

export interface LibraryItem {
  id: number;
  name: string;
  type: "movies" | "tv" | "anime" | string;
  language: string;
  paths: string[];
  counts: { items: number; review: number; unmatched: number };
}

export interface ServerSettings {
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

  // Prefetch settings
  prefetchAggressiveLocal: boolean;
  prefetchMaxConcurrent: number;
  prefetchMaxCacheMb: number;
  prefetchOnHover: boolean;
  prefetchOnScroll: boolean;
  prefetchNextCount: number;
}
