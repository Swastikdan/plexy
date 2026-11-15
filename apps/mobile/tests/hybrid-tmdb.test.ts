import { expect, test } from "bun:test";
import { LocalLibrary, type LocalFile, type LocalIO, type LocalRoot } from "@plexy/local-library/library";

test("matched local titles expose their TMDB id for hybrid seasons", async () => {
  const file: LocalFile = {
    uri: "content://videos/Riti.B.Series.S01E01.mkv",
    name: "Riti.B.Series.S01E01.mkv",
    relativePath: "Riti B Series/Season 1/S01E01.mkv",
    size: 100,
    modified: 1,
  };
  const io: LocalIO = {
    load: async () => null,
    save: async () => {},
    walk: async () => [file],
    metadata: async (record) => ({
      tmdbId: 1396,
      card: {
        ...record.card,
        matchStatus: "matched",
        seasonNumber: 1,
        episodeNumber: 1,
      },
    }),
  };
  const library = new LocalLibrary(io);
  const root: LocalRoot = { uri: "content://videos", name: "TV", kind: "tv" };
  await library.addRoot(root);
  const series = library.cards()[0]!;
  expect(series.kind).toBe("series");
  expect(series.tmdbId).toBe(1396);
  expect(library.detail(series.id).item.tmdbId).toBe(1396);
});
