import { expect, test } from "bun:test";
import { localNextIsImmediate } from "@/features/remote/lib/episode-sequence";

const current = { nextFileId: 2, seasonNumber: 1, episodeNumber: 10 };

test("the following episode in the same season is immediate", () => {
  expect(
    localNextIsImmediate({
      ...current,
      next: { seasonNumber: 1, episodeNumber: 11 },
    }),
  ).toBe(true);
});

test("a gap in the same season is not immediate", () => {
  expect(
    localNextIsImmediate({
      ...current,
      next: { seasonNumber: 1, episodeNumber: 12 },
    }),
  ).toBe(false);
});

test("the first episode of the next season is immediate", () => {
  expect(
    localNextIsImmediate({
      ...current,
      next: { seasonNumber: 2, episodeNumber: 1 },
    }),
  ).toBe(true);
});

test("a later episode after a season jump is not immediate", () => {
  expect(
    localNextIsImmediate({
      ...current,
      next: { seasonNumber: 2, episodeNumber: 2 },
    }),
  ).toBe(false);
  expect(
    localNextIsImmediate({
      ...current,
      next: { seasonNumber: 3, episodeNumber: 1 },
    }),
  ).toBe(false);
});

test("no local next file always asks the online source", () => {
  expect(
    localNextIsImmediate({
      ...current,
      nextFileId: null,
      next: null,
    }),
  ).toBe(false);
});
