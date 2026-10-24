import { describe, expect, test } from "bun:test";
import {
  cleanName,
  normalizeTitle,
  extractExplicitId,
  parsePath,
  VIDEO_EXTENSIONS,
} from "../src/parse";

describe("Media Parser (PRD 5.3)", () => {
  test("cleans release noise and resolution tags", () => {
    expect(cleanName("Heat.1995.1080p.BluRay.x264-SPARKS")).toBe("Heat 1995");
    expect(cleanName("Avatar.2009.2160p.UHD.HDR.HEVC-GROUP")).toBe("Avatar 2009");
    expect(cleanName("Inception_2010_720p_WEBDL")).toBe("Inception 2010");
  });

  test("normalizes title by removing punctuation and leading articles", () => {
    expect(normalizeTitle("The Dark Knight")).toBe("dark knight");
    expect(normalizeTitle("A Beautiful Mind")).toBe("beautiful mind");
    expect(normalizeTitle("Spider-Man: Across the Spider-Verse")).toBe(
      "spider man across the spider verse",
    );
  });

  test("extracts explicit TMDB IDs from folder or file brackets", () => {
    expect(extractExplicitId("Avatar (2009) [tmdbid-19995].mkv")).toBe(19995);
    expect(extractExplicitId("Movie {tmdb-456}.mp4")).toBe(456);
    expect(extractExplicitId("Heat (1995) [tmdbid=807].mkv")).toBe(807);
    expect(extractExplicitId("NoTag (1995).mkv")).toBeNull();
  });

  test("parses movie paths correctly", () => {
    const root = "/Media/Movies";
    const path = "/Media/Movies/Avatar (2009)/Avatar (2009).mkv";
    const parsed = parsePath(path, "movies", [root]);

    expect(parsed.title).toBe("Avatar");
    expect(parsed.year).toBe(2009);
    expect(parsed.season).toBeNull();
    expect(parsed.episode).toBeNull();
  });

  test("parses TV episode paths with seasons and episode ranges", () => {
    const root = "/Media/Shows";
    const path1 =
      "/Media/Shows/Severance (2022)/Season 01/Severance - S01E01 - Good News About Hell.mkv";
    const parsed1 = parsePath(path1, "tv", [root]);

    expect(parsed1.title).toBe("Severance");
    expect(parsed1.year).toBe(2022);
    expect(parsed1.season).toBe(1);
    expect(parsed1.episode).toBe(1);

    const path2 = "/Media/Shows/Severance (2022)/Season 01/Severance - S01E01-E02.mkv";
    const parsed2 = parsePath(path2, "tv", [root]);
    expect(parsed2.season).toBe(1);
    expect(parsed2.episode).toBe(1);
    expect(parsed2.episodeEnd).toBe(2);
  });

  test("parses TV specials (Season 00)", () => {
    const root = "/Media/Shows";
    const path = "/Media/Shows/Severance (2022)/Season 00/Severance - S00E01.mkv";
    const parsed = parsePath(path, "tv", [root]);

    expect(parsed.isSpecial).toBe(true);
    expect(parsed.season).toBe(0);
    expect(parsed.episode).toBe(1);
  });

  test("verifies supported video extensions", () => {
    expect(VIDEO_EXTENSIONS.has(".mkv")).toBe(true);
    expect(VIDEO_EXTENSIONS.has(".mp4")).toBe(true);
    expect(VIDEO_EXTENSIONS.has(".webm")).toBe(true);
    expect(VIDEO_EXTENSIONS.has(".avi")).toBe(true);
    expect(VIDEO_EXTENSIONS.has(".txt")).toBe(false);
  });
});
