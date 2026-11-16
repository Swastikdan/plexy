import { expect, test } from "bun:test";
import { toItemCard } from "@/features/remote/lib/view";

test("online cards keep TMDB identity and watch state for the shared UI", () => {
  const card = toItemCard(
    {
      tmdbId: 1396,
      mediaType: "tv",
      title: "Breaking Bad",
      year: 2008,
      poster: "https://image/poster.jpg",
      backdrop: "https://image/backdrop.jpg",
      overview: "A chemistry teacher.",
      rating: 8.9,
      genres: ["Drama"],
    },
    47,
    { position: 120, duration: 2700, played: false, percent: 4 },
  );
  expect(card.publicId).toBe("remote:tv:1396");
  expect(card.tmdbId).toBe(1396);
  expect(card.kind).toBe("series");
  expect(card.poster).toBe("https://image/poster.jpg");
  expect(card.watch?.position).toBe(120);
  expect(card.runtime).toBe(47);
});
