import AsyncStorage from "@react-native-async-storage/async-storage";
import { useSyncExternalStore } from "react";
import type { Watch } from "@plexy/api-client/types";
import { createStore } from "./remote-state";
import type { RemoteMediaType } from "./tmdb";

const PROGRESS_KEY = "plexy.remote.progress";
const WRITE_DELAY = 2_000;
const NO_SUBSCRIBE = () => () => {};
const EMPTY: RemoteProgress[] = [];
const EMPTY_SNAPSHOT = () => EMPTY;

export interface RemoteProgress {
  /** `movie:123`, `tv:123` or `tv:123:s1:e4` */
  key: string;
  mediaType: RemoteMediaType;
  tmdbId: number;
  season: number | null;
  episode: number | null;
  position: number;
  duration: number | null;
  /** On a TV title entry, this means explicit whole-series completion. */
  played: boolean;
  updatedAt: number;
}

export const remoteProgressStore = createStore<RemoteProgress[]>([]);

/**
 * `getRemoteProgress` is called for every episode and card render. A linear
 * scan of the whole progress list made title pages O(episodes × progress)
 * expensive; keep a map for the current store snapshot instead.
 */
let indexedSource: RemoteProgress[] | null = null;
let indexed = new Map<string, RemoteProgress>();

function progressIndex() {
  const entries = remoteProgressStore.get();
  if (entries !== indexedSource) {
    indexedSource = entries;
    indexed = new Map(entries.map((entry) => [entry.key, entry]));
  }
  return indexed;
}

let writeTimer: ReturnType<typeof setTimeout> | null = null;
let writes: Promise<void> = Promise.resolve();

export function remoteTitleKey(
  mediaType: RemoteMediaType,
  tmdbId: number,
) {
  return `${mediaType}:${tmdbId}`;
}

export function remoteEpisodeKey(
  mediaType: RemoteMediaType,
  tmdbId: number,
  season: number,
  episode: number,
) {
  return `${mediaType}:${tmdbId}:s${season}:e${episode}`;
}

export function remoteProgressKey(
  mediaType: RemoteMediaType,
  tmdbId: number,
  season?: number | null,
  episode?: number | null,
) {
  return season != null && episode != null
    ? remoteEpisodeKey(mediaType, tmdbId, season, episode)
    : remoteTitleKey(mediaType, tmdbId);
}

function normalize(entry: RemoteProgress): RemoteProgress {
  const duration =
    entry.duration != null &&
    Number.isFinite(entry.duration) &&
    entry.duration > 0
      ? entry.duration
      : null;
  let position = Number.isFinite(entry.position)
    ? Math.max(0, entry.position)
    : 0;
  if (duration) position = Math.min(position, duration);
  const seriesResume =
    entry.mediaType === "tv" &&
    entry.key === remoteTitleKey(entry.mediaType, entry.tmdbId);
  return {
    ...entry,
    position,
    duration,
    played:
      Boolean(entry.played) ||
      (!seriesResume && Boolean(duration && position >= duration * 0.95)),
  };
}

function writeNow() {
  if (writeTimer) {
    clearTimeout(writeTimer);
    writeTimer = null;
  }
  const values = remoteProgressStore.get();
  writes = writes
    .catch(() => {})
    .then(() => AsyncStorage.setItem(PROGRESS_KEY, JSON.stringify(values)))
    .catch(() => {});
  return writes;
}

function scheduleWrite() {
  if (writeTimer) clearTimeout(writeTimer);
  writeTimer = setTimeout(() => {
    void writeNow();
  }, WRITE_DELAY);
}

export async function loadRemoteProgress(): Promise<RemoteProgress[]> {
  try {
    const raw = await AsyncStorage.getItem(PROGRESS_KEY);
    const parsed = raw ? (JSON.parse(raw) as RemoteProgress[]) : [];
    const valid = Array.isArray(parsed)
      ? parsed.filter(
          (entry) =>
            entry &&
            typeof entry.key === "string" &&
            Number.isSafeInteger(entry.tmdbId) &&
            (entry.mediaType === "movie" || entry.mediaType === "tv"),
        )
      : [];
    remoteProgressStore.set(valid.map(normalize));
    return valid;
  } catch {
    remoteProgressStore.set([]);
    return [];
  }
}

/** Playback can move backward; completion is cleared only by an unwatch action. */
export function recordRemoteProgress(entry: RemoteProgress) {
  const next = normalize(entry);
  const current = remoteProgressStore.get();
  const existing = progressIndex().get(next.key);
  const values = !existing
    ? [...current, next]
    : current.map((value) =>
        value.key === next.key
          ? { ...next, played: value.played || next.played }
          : value,
      );
  remoteProgressStore.set(values);
  scheduleWrite();
}

/** Shared by playback ticks and exit saves so they use the same watch semantics. */
export function recordRemotePlayback(entry: Omit<RemoteProgress, "key">) {
  recordRemoteProgress({
    ...entry,
    key: remoteProgressKey(
      entry.mediaType,
      entry.tmdbId,
      entry.season,
      entry.episode,
    ),
    // TV progress belongs to an episode, never to whole-series completion.
    played:
      entry.mediaType === "tv" &&
      (entry.season == null || entry.episode == null)
        ? false
        : entry.played,
  });
  if (entry.mediaType === "tv") {
    recordRemoteProgress({
      ...entry,
      key: remoteTitleKey(entry.mediaType, entry.tmdbId),
      played: false,
    });
  }
}

export async function flushRemoteProgress() {
  if (writeTimer) clearTimeout(writeTimer);
  await writeNow();
}

export function getRemoteProgress(
  mediaType: RemoteMediaType,
  tmdbId: number,
  season?: number | null,
  episode?: number | null,
) {
  return progressIndex().get(
    remoteProgressKey(mediaType, tmdbId, season, episode),
  );
}

export function getRemoteTitleProgress(
  mediaType: RemoteMediaType,
  tmdbId: number,
) {
  return getRemoteProgress(mediaType, tmdbId);
}

export function isRemotePlayed(
  mediaType: RemoteMediaType,
  tmdbId: number,
  season?: number | null,
  episode?: number | null,
) {
  const title = getRemoteTitleProgress(mediaType, tmdbId);
  if (title?.played) return true;
  if (season == null || episode == null) return Boolean(title?.played);
  return Boolean(
    getRemoteProgress(mediaType, tmdbId, season, episode)?.played,
  );
}

export function remoteWatch(
  mediaType: RemoteMediaType,
  tmdbId: number,
): Watch | null {
  const entry = getRemoteTitleProgress(mediaType, tmdbId);
  if (!entry || (entry.position <= 0 && !entry.played)) return null;
  const percent =
    entry.duration && entry.duration > 0
      ? Math.min(100, Math.round((entry.position / entry.duration) * 100))
      : entry.played
        ? 100
        : 0;
  return {
    position: entry.position,
    duration: entry.duration,
    played: entry.played,
    percent,
  };
}

export function remoteEpisodeWatch(
  mediaType: RemoteMediaType,
  tmdbId: number,
  season: number,
  episode: number,
): Watch | null {
  const entry = getRemoteProgress(mediaType, tmdbId, season, episode);
  if (!entry || (entry.position <= 0 && !entry.played)) return null;
  const percent =
    entry.duration && entry.duration > 0
      ? Math.min(100, Math.round((entry.position / entry.duration) * 100))
      : entry.played
        ? 100
        : 0;
  return {
    position: entry.position,
    duration: entry.duration,
    played: entry.played,
    percent,
  };
}

export async function markRemotePlayed(
  mediaType: RemoteMediaType,
  tmdbId: number,
  played: boolean,
  seasons?: { season: number; episodes: number[] }[],
) {
  const current = remoteProgressStore.get();
  const index = progressIndex();
  const now = Date.now();
  const entries: RemoteProgress[] = [];
  const titleKey = remoteTitleKey(mediaType, tmdbId);
  const title =
    index.get(titleKey) ??
    ({
      key: titleKey,
      mediaType,
      tmdbId,
      season: null,
      episode: null,
      position: played ? 100 : 0,
      duration: null,
      played,
      updatedAt: now,
    } satisfies RemoteProgress);
  entries.push({
    ...title,
    position: played ? (title.duration ?? 100) : 0,
    played,
    updatedAt: now,
  });
  if (!played) {
    for (const entry of current) {
      if (entry.mediaType === mediaType && entry.tmdbId === tmdbId && entry.episode != null) {
        entries.push({ ...entry, position: 0, played: false, updatedAt: now });
      }
    }
  } else if (seasons) {
    for (const group of seasons) {
      for (const episode of group.episodes) {
        const key = remoteEpisodeKey(mediaType, tmdbId, group.season, episode);
        const existing = index.get(key);
        entries.push({
          key,
          mediaType,
          tmdbId,
          season: group.season,
          episode,
          position: played ? (existing?.duration ?? 100) : 0,
          duration: existing?.duration ?? null,
          played,
          updatedAt: now,
        });
      }
    }
  }
  const keys = new Set(entries.map((entry) => entry.key));
  remoteProgressStore.set([
    ...current.filter((entry) => !keys.has(entry.key)),
    ...entries,
  ]);
  await writeNow();
}

/** Episode-level state must not mark the whole series watched. */
export async function markRemoteEpisodePlayed(
  mediaType: RemoteMediaType,
  tmdbId: number,
  season: number,
  episode: number,
  played: boolean,
) {
  const current = remoteProgressStore.get();
  const key = remoteEpisodeKey(mediaType, tmdbId, season, episode);
  const existing = progressIndex().get(key);
  const entry: RemoteProgress = {
    key,
    mediaType,
    tmdbId,
    season,
    episode,
    position: played ? (existing?.duration ?? 100) : 0,
    duration: existing?.duration ?? null,
    played,
    updatedAt: Date.now(),
  };
  const titleKey = remoteTitleKey(mediaType, tmdbId);
  const values = current
    .filter((value) => value.key !== key)
    .map((value) =>
      value.key === titleKey && !played
        ? {
            ...value,
            played: false,
            position:
              value.season === season && value.episode === episode
                ? 0
                : value.position,
          }
        : value,
    );
  remoteProgressStore.set([...values, entry]);
  await writeNow();
}

/** Re-renders consumers when a background progress tick lands. */
export function useRemoteProgress(enabled = true): RemoteProgress[] {
  return useSyncExternalStore(
    enabled ? remoteProgressStore.subscribe : NO_SUBSCRIBE,
    enabled ? remoteProgressStore.get : EMPTY_SNAPSHOT,
    EMPTY_SNAPSHOT,
  );
}
