import { expect, test } from "bun:test";
import {
  mergeEpisodes,
  mergeSeasons,
} from "@/features/remote/lib/hybrid-episodes";

test("hybrid seasons keep local seasons and add online-only ones", () => {
  const seasons = mergeSeasons(
    [
      { number: 1, name: "Season 1" },
      { number: 0, name: "Specials" },
    ],
    [
      { number: 1, name: "Season 1", episodes: 8, poster: null },
      { number: 2, name: "Season 2", episodes: 8, poster: null },
    ],
  );
  expect(seasons.map((season) => season.number)).toEqual([0, 1, 2]);
  expect(seasons[0]!.label).toBe("Specials");
  expect(seasons[2]!.label).toBe("Season 2");
});

test("downloaded episodes win and missing episodes come from TMDB", () => {
  const episodes = mergeEpisodes({
    local: [
      {
        id: 10,
        episodeNumber: 1,
        name: "S01E01 Local",
        overview: "Local copy",
        runtime: 45,
        backdrop: "file://local/e1.jpg",
      },
    ],
    remote: [
      {
        number: 1,
        season: 1,
        title: "Online one",
        overview: "",
        still: "https://image/one.jpg",
        runtime: 44,
        airDate: "2024-01-01",
      },
      {
        number: 2,
        season: 1,
        title: "Online two",
        overview: "Missing locally",
        still: "https://image/two.jpg",
        runtime: 43,
        airDate: "2024-01-08",
      },
    ],
    season: 1,
    fallbackArtwork: "file://local/poster.jpg",
  });
  expect(episodes.map((episode) => episode.number)).toEqual([1, 2]);
  expect(episodes[0]!.local?.id).toBe(10);
  expect(episodes[0]!.remote).toBeNull();
  expect(episodes[0]!.title).toBe("Local");
  expect(episodes[1]!.local).toBeNull();
  expect(episodes[1]!.remote?.number).toBe(2);
  expect(episodes[1]!.artwork).toBe("https://image/two.jpg");
});
