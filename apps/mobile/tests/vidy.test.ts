import { expect, test } from "bun:test";
import {
  parseVidyBridgeMessage,
  vidyColor,
  vidyEmbedHtml,
  vidyEmbedUrl,
} from "@/features/remote/lib/vidy";

test("movies open the embed route directly without download or account APIs", () => {
  const url = new URL(vidyEmbedUrl({ mediaType: "movie", tmdbId: 315162 }));
  expect(url.origin).toBe("https://www.vidy.st");
  expect(url.pathname).toBe("/movie/315162");
  expect(url.searchParams.get("autoplay")).toBe("true");
  expect(url.searchParams.has("episodeSelector")).toBe(false);
});
test("TV passes the selected episode and autoplay preference", () => {
  const url = new URL(
    vidyEmbedUrl({ mediaType: "tv", tmdbId: 1396, season: 2, episode: 3 }, true),
  );
  expect(url.pathname).toBe("/tv/1396/2/3");
  expect(url.searchParams.get("episodeSelector")).toBe("true");
  expect(url.searchParams.get("autoplayNextEpisode")).toBe("true");
  expect(
    new URL(vidyEmbedUrl({ mediaType: "tv", tmdbId: 1396 })).searchParams.get(
      "autoplayNextEpisode",
    ),
  ).toBe("false");
});
test("invalid identifiers are rejected and episode defaults are valid", () => {
  expect(() => vidyEmbedUrl({ mediaType: "movie", tmdbId: NaN })).toThrow();
  expect(
    new URL(vidyEmbedUrl({ mediaType: "tv", tmdbId: 1, season: -1, episode: 0 }))
      .pathname,
  ).toBe("/tv/1/1/1");
});
test("iframe delegates autoplay and fullscreen and escapes attribute content", () => {
  const html = vidyEmbedHtml('https://www.vidy.st/movie/1?x="<');
  expect(html).toContain('allow="encrypted-media; autoplay *; fullscreen *"');
  expect(html).toContain('allowfullscreen');
  expect(html).toContain('&quot;&lt;');
});
test("every Vidy flag comes from the caller", () => {
  const url = new URL(
    vidyEmbedUrl(
      { mediaType: "tv", tmdbId: 1396, season: 1, episode: 4 },
      {
        autoNext: false,
        autoplay: false,
        episodeSelector: false,
        nextEpisode: false,
        progress: 123.9,
        color: "#00aaFF",
      },
    ),
  );
  expect(url.searchParams.get("autoplay")).toBe("false");
  expect(url.searchParams.get("color")).toBe("00AAFF");
  expect(url.searchParams.get("nextEpisode")).toBe("false");
  expect(url.searchParams.get("episodeSelector")).toBe("false");
  expect(url.searchParams.get("autoplayNextEpisode")).toBe("false");
  expect(url.searchParams.get("progress")).toBe("123");
});
test("progress is omitted when there is nothing to resume", () => {
  const url = new URL(vidyEmbedUrl({ mediaType: "movie", tmdbId: 1 }));
  expect(url.searchParams.has("progress")).toBe(false);
  expect(vidyColor("rgb(220, 38, 38)")).toBe("DC2626");
  expect(vidyColor("not-a-color")).toBe("DC2626");
});
test("player events are parsed without trusting the provider payload", () => {
  const event = parseVidyBridgeMessage(
    JSON.stringify({
      type: "PLAYER_EVENT",
      data: {
        event: "timeupdate",
        currentTime: 148.5,
        duration: 2700,
        id: 1396,
        mediaType: "tv",
        season: 2,
        episode: 3,
      },
    }),
  );
  expect(event).toEqual({
    type: "PLAYER_EVENT",
    event: "timeupdate",
    currentTime: 148.5,
    duration: 2700,
    tmdbId: 1396,
    mediaType: "tv",
    season: 2,
    episode: 3,
  });
  expect(parseVidyBridgeMessage("not json")).toBeNull();
  expect(
    parseVidyBridgeMessage(
      JSON.stringify({ type: "PLAYER_EVENT", data: { id: -1 } }),
    ),
  ).toBeNull();
  expect(parseVidyBridgeMessage(JSON.stringify({ type: "FULLSCREEN", active: true }))).toEqual({
    type: "FULLSCREEN",
    active: true,
  });
});
