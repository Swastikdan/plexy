/// Playback contracts: play manifests, tracks, trickplay, file facts.
import type { ItemCard } from "./catalog";

export interface AudioTrack {
  codec: string;
  channels: number;
  language: string;
  isDefault: boolean;
}

export interface PlayerAudioTrack extends AudioTrack {
  index: number;
  /** False when selecting this language requires a short one-time remux. */
  prepared?: boolean;
}

export interface OptimizationState {
  status: "none" | "queued" | "running" | "done" | "failed" | "skipped" | string;
  mode: "remux" | "transcode" | null;
  progress: number | null;
  size: number | null;
  error: string | null;
  /** FFmpeg's clock ratio while preparing (e.g. 1.4 = 1.4 s of media/second). */
  speed?: number | null;
  /** Seconds remaining, derived from progress and speed. */
  etaSeconds?: number | null;
  /** 1-based place in the preparation queue while `status` is `queued`. */
  queuePosition?: number | null;
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
  directPlayOnly?: boolean;
  path: PlayPath;
  reason: string;
  fileId: number;
  itemId: number | null;
  /** Native (mpv) playback details. Present only for `?native=1` manifests. */
  native?: {
    /** Server-relative URL for the untouched original file. */
    streamUrl: string;
    preferredAudioLanguage: string;
  };
  /** Item to open back from the player: the series for episodes, self for movies. */
  parentItemId?: number | null;
  parentPublicId?: string | null;
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
  episodes?: ItemCard[];
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

export interface BrowserCaps {
  avc: boolean;
  hevc: boolean;
  vp9: boolean;
  av1: boolean;
  aac: boolean;
  opus: boolean;
}
