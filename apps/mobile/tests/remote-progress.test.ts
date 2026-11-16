import { afterEach, beforeEach, expect, test } from "bun:test";
import {
  flushRemoteProgress,
  getRemoteProgress,
  getRemoteTitleProgress,
  isRemotePlayed,
  markRemoteEpisodePlayed,
  markRemotePlayed,
  recordRemotePlayback,
  remoteProgressStore,
  remoteTitleKey,
  remoteWatch,
} from "@/features/remote/lib/remote-progress";
import type { RemoteProgress } from "@/features/remote/lib/remote-progress";

beforeEach(() => {
  remoteProgressStore.set([]);
});

afterEach(async () => {
  await flushRemoteProgress();
});

const entry = (patch: Partial<RemoteProgress> = {}): RemoteProgress => ({
  key: remoteTitleKey("tv", 900),
  mediaType: "tv",
  tmdbId: 900,
  season: null,
  episode: null,
  position: 600,
  duration: 1200,
  played: false,
  updatedAt: 1,
  ...patch,
});

test("a movie resume point is exposed as a card watch state", () => {
  remoteProgressStore.set([
    entry({
      key: "movie:901",
      mediaType: "movie",
      tmdbId: 901,
      duration: 6000,
      position: 1500,
    }),
  ]);
  expect(remoteWatch("movie", 901)).toEqual({
    position: 1500,
    duration: 6000,
    played: false,
    percent: 25,
  });
  expect(remoteWatch("movie", 999)).toBeNull();
});

test("finished episodes do not mark the whole series watched", async () => {
  await markRemoteEpisodePlayed("tv", 902, 2, 3, true);
  expect(isRemotePlayed("tv", 902, 2, 3)).toBe(true);
  expect(isRemotePlayed("tv", 902, 2, 4)).toBe(false);
  expect(isRemotePlayed("tv", 902)).toBe(false);
});

test("marking a series watched covers every episode until one is unwatched", async () => {
  await markRemotePlayed("tv", 903, true, [
    { season: 1, episodes: [1, 2] },
  ]);
  expect(isRemotePlayed("tv", 903)).toBe(true);
  expect(isRemotePlayed("tv", 903, 1, 1)).toBe(true);
  await markRemoteEpisodePlayed("tv", 903, 1, 1, false);
  expect(isRemotePlayed("tv", 903)).toBe(false);
  expect(isRemotePlayed("tv", 903, 1, 1)).toBe(false);
  expect(isRemotePlayed("tv", 903, 1, 2)).toBe(true);
});

test("playback completion and exit saves only complete the current episode", () => {
  const finished = entry({ season: 1, episode: 1, position: 1180 });
  // Both regular ticks and the final exit save use this operation.
  recordRemotePlayback(finished);
  recordRemotePlayback({ ...finished, updatedAt: 2 });
  expect(isRemotePlayed("tv", 900, 1, 1)).toBe(true);
  expect(isRemotePlayed("tv", 900, 1, 2)).toBe(false);
  expect(isRemotePlayed("tv", 900)).toBe(false);
  expect(remoteWatch("tv", 900)?.played).toBe(false);

  // An auto-next tick updates resume state without inheriting E1's completion.
  recordRemotePlayback(entry({ season: 1, episode: 2, position: 30 }));
  expect(getRemoteTitleProgress("tv", 900)).toMatchObject({
    season: 1, episode: 2, position: 30, played: false,
  });
  expect(isRemotePlayed("tv", 900, 1, 1)).toBe(true);
  expect(isRemotePlayed("tv", 900, 1, 2)).toBe(false);
});

test("movie replay and backward seek ticks preserve completion until explicit unwatch", async () => {
  const movie = entry({
    mediaType: "movie", tmdbId: 901, position: 1180,
  });
  recordRemotePlayback(movie);
  expect(isRemotePlayed("movie", 901)).toBe(true);
  recordRemotePlayback({ ...movie, position: 30, played: false });
  expect(getRemoteProgress("movie", 901)).toMatchObject({
    position: 30, played: true,
  });
  await markRemotePlayed("movie", 901, false);
  recordRemotePlayback({ ...movie, position: 10, played: false });
  expect(isRemotePlayed("movie", 901)).toBe(false);
});

test("episode replay preserves completion until explicit episode unwatch", async () => {
  const episode = entry({ season: 2, episode: 3, position: 1180 });
  recordRemotePlayback(episode);
  recordRemotePlayback({ ...episode, position: 30, played: false });
  expect(getRemoteProgress("tv", 900, 2, 3)).toMatchObject({
    position: 30, played: true,
  });
  expect(isRemotePlayed("tv", 900)).toBe(false);
  await markRemoteEpisodePlayed("tv", 900, 2, 3, false);
  recordRemotePlayback({ ...episode, position: 10, played: false });
  expect(isRemotePlayed("tv", 900, 2, 3)).toBe(false);
});

test("playback preserves explicitly watched series until a manual unwatch", async () => {
  await markRemotePlayed("tv", 900, true);
  const episode = entry({ season: 1, episode: 1, position: 30 });
  recordRemotePlayback(episode);
  expect(isRemotePlayed("tv", 900)).toBe(true);
  expect(isRemotePlayed("tv", 900, 1, 2)).toBe(true);
  await markRemotePlayed("tv", 900, false);
  recordRemotePlayback(episode);
  expect(isRemotePlayed("tv", 900)).toBe(false);
  expect(isRemotePlayed("tv", 900, 1, 2)).toBe(false);
});

test("TV ticks without an episode cannot complete the whole series", () => {
  recordRemotePlayback(entry({ position: 1200, played: true }));
  expect(isRemotePlayed("tv", 900)).toBe(false);
});
