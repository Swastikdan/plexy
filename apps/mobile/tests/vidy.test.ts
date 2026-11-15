import { expect, test } from "bun:test";
import { vidyEmbedHtml, vidyEmbedUrl } from "@/features/remote/lib/vidy";

test("movies open the embed route directly without download or account APIs", () => {
  const url = new URL(vidyEmbedUrl({ mediaType: "movie", tmdbId: 315162 }));
  expect(url.origin).toBe("https://www.vidy.st");
  expect(url.pathname).toBe("/movie/315162");
  expect(url.searchParams.get("autoplay")).toBe("true");
  expect(url.searchParams.has("episodeSelector")).toBe(false);
});
test("TV passes the selected episode and autoplay preference", () => {
  const url = new URL(vidyEmbedUrl({ mediaType: "tv", tmdbId: 1396, season: 2, episode: 3 }, true));
  expect(url.pathname).toBe("/tv/1396/2/3");
  expect(url.searchParams.get("episodeSelector")).toBe("true");
  expect(url.searchParams.get("autoplayNextEpisode")).toBe("true");
  expect(new URL(vidyEmbedUrl({ mediaType: "tv", tmdbId: 1396 })).searchParams.get("autoplayNextEpisode")).toBe("false");
});
test("invalid identifiers are rejected and episode defaults are valid", () => {
  expect(() => vidyEmbedUrl({ mediaType: "movie", tmdbId: NaN })).toThrow();
  expect(new URL(vidyEmbedUrl({ mediaType: "tv", tmdbId: 1, season: -1, episode: 0 })).pathname).toBe("/tv/1/1/1");
});
test("iframe delegates autoplay and fullscreen and escapes attribute content", () => {
  const html = vidyEmbedHtml('https://www.vidy.st/movie/1?x="<');
  expect(html).toContain('allow="encrypted-media; autoplay *; fullscreen *"');
  expect(html).toContain('allowfullscreen');
  expect(html).toContain('&quot;&lt;');
});
