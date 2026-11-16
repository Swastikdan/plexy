import { expect, test } from "bun:test";
import { defaultSeasonNumber } from "@/features/title/lib/default-season";

function season(
  number: number,
  totalEpisodes: number,
  watched: number[],
) {
  return {
    number,
    totalEpisodes,
    isEpisodeWatched: (episode: number) => watched.includes(episode),
  };
}

test("a fully watched season advances to the next season", () => {
  expect(
    defaultSeasonNumber([
      season(1, 10, [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]),
      season(2, 8, []),
    ]),
  ).toBe(2);
});

test("a partially watched season stays selected", () => {
  expect(
    defaultSeasonNumber([
      season(1, 10, [1, 2, 3]),
      season(2, 8, []),
    ]),
  ).toBe(1);
});

test("all seasons watched keeps the first season", () => {
  expect(
    defaultSeasonNumber([
      season(1, 2, [1, 2]),
      season(2, 2, [1, 2]),
    ]),
  ).toBe(1);
});

test("empty seasons are skipped and an empty list returns null", () => {
  expect(
    defaultSeasonNumber([
      season(1, 0, []),
      season(2, 4, []),
    ]),
  ).toBe(2);
  expect(defaultSeasonNumber([])).toBeNull();
});
