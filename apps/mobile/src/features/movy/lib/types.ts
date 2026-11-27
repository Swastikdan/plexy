export type MovyMediaType = "movie" | "tv";

export interface MovyQuota {
  limit: number;
  used: number;
  remaining: number;
  resetAt: string | null;
}

export interface MovyQualityOption {
  quality: string;
  size?: string;
  filename?: string;
}

export interface MovyDownload {
  url: string;
  filename: string;
  size?: string | null;
  quality: string;
  limit?: number;
  remaining?: number;
  resetAt?: string | null;
}

export interface MovyAccount {
  username: string;
  token: string;
  deviceId: string;
  /** Present only for accounts the app generated. */
  generatedPassword?: string;
  createdAt: number;
}

export interface MovyAccountRecord extends MovyAccount {
  quota: MovyQuota | null;
  lastUsedAt: number | null;
}

export interface MovyTitleRef {
  title: string;
  mediaType: MovyMediaType;
  year: number | null;
  tmdbId: number;
  imdbId: string | null;
  season?: number | null;
  episode?: number | null;
}

export type DownloadStatus =
  | "queued"
  | "downloading"
  | "paused"
  | "verifying"
  | "completed"
  | "failed";

export interface MovyDownloadRecord {
  id: string;
  mediaType: MovyMediaType;
  tmdbId: number;
  imdbId: string | null;
  year: number | null;
  season: number | null;
  episode: number | null;
  title: string;
  episodeTitle: string | null;
  display: string;
  poster: string | null;
  quality: string;
  filename: string;
  accountUsername: string;
  url: string | null;
  urlExpiresAt: number | null;
  expectedBytes: number | null;
  bytes: number;
  status: DownloadStatus;
  progress: number;
  strategy: "multi" | "resume" | "single" | null;
  chunks: { start: number; end: number; done: boolean }[] | null;
  resumeData: string | null;
  etag: string | null;
  lastModified: string | null;
  error: string | null;
  createdAt: number;
  completedAt: number | null;
  libraryUri: string | null;
  libraryFileId: number | null;
}

export interface NativeDownloadResult {
  id: string;
  fileUri: string;
  bytes: number;
  container: string;
  extension: string;
}

export interface NativeDownloadProgress {
  id: string;
  bytes: number;
  expectedBytes: number | null;
  progress: number;
}

export interface NativeDownloadState {
  id: string;
  status: "downloading" | "paused" | "completed" | "failed";
  bytes: number;
  expectedBytes: number | null;
  progress: number;
  error: string | null;
  updatedAt?: number;
}

export type MovyFailure =
  | "network"
  | "auth"
  | "quota"
  | "not-found"
  | "no-source"
  | "server"
  | "invalid";

export class MovyError extends Error {
  readonly code: MovyFailure;
  readonly status: number | null;
  readonly retryAfterSeconds: number | null;

  constructor(
    code: MovyFailure,
    message: string,
    options: { status?: number | null; retryAfterSeconds?: number | null } = {},
  ) {
    super(message);
    this.name = "MovyError";
    this.code = code;
    this.status = options.status ?? null;
    this.retryAfterSeconds = options.retryAfterSeconds ?? null;
  }
}
