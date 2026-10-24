/// Shared data types for Plexy client and server (PRD 8, 9, 10).

export interface Watch {
  position: number;
  duration: number | null;
  played: boolean;
  percent: number;
}

export interface ItemCard {
  id: number;
  kind: string;
  name: string;
  year: number | null;
  seasonNumber?: number | null;
  episodeNumber?: number | null;
  fileId?: number | null;
  parentId?: number | null;
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

export type PlayPath = "direct" | "remux" | "transcode" | "unsupported";

export interface Playability {
  path: PlayPath;
  reason: string;
  predictedSmoother: boolean;
  fileId: number;
  itemId: number | null;
  watch: { position: number; duration: number | null; played: boolean } | null;
}

export interface SubtitleTrack {
  track: string;
  kind: "embedded" | "sidecar";
  language: string | null;
  title: string;
}

export interface ReviewEntry {
  id: number;
  kind: string;
  parentTitle: string | null;
  name: string;
  year: number | null;
  matchStatus: string;
  score: number | null;
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

export interface ReviewPayload {
  items: Array<
    ReviewEntry & {
      seasonNumber: number | null;
      episodeNumber: number | null;
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
  >;
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
  adminAvailable: boolean;
  uptimeSeconds: number;
  hasTmdbToken?: boolean;
  hasLibraries?: boolean;
  setupComplete?: boolean;
  scan: {
    scanId: number;
    status: string;
    filesSeen: number;
    filesUpdated: number;
    issues: number;
    currentFile: string | null;
  } | null;
  recentScans: Array<{
    id: number;
    status: string;
    files_seen: number | null;
    issues: number | null;
    started_at: string;
    finished_at: string | null;
  }>;
}

export interface LibraryItem {
  id: number;
  name: string;
  type: string;
  language: string;
  paths: string[];
  counts: { items: number; review: number; unmatched: number };
}

export interface ServerSettings {
  port: number;
  bindAddress: string;
  logLevel: string;
  metadataLanguage: string;
  metadataRegion: string;
  imageQuality: string;
  hasTmdbToken: boolean;
  tokenSource: string;
  note: string;
  version: string;
}
