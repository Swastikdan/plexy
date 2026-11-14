import { expect, test } from "bun:test";
import {
  cleanSubtitleName,
  subtitleLanguageName,
  subtitleTrackDisplay,
} from "../src/features/player/lib/subtitles";

test("subtitle language codes become readable names", () => {
  expect(subtitleLanguageName("eng")).toBe("English");
  expect(subtitleLanguageName("gre")).toBe("Greek");
  expect(subtitleLanguageName("en-US")).toBe("English");
  expect(subtitleLanguageName("und")).toBeNull();
  expect(subtitleLanguageName(null)).toBeNull();
});

test("technical subtitle suffixes are removed from the visible name", () => {
  expect(cleanSubtitleName("MoviesMod.org (subrip, Default)")).toBe("MoviesMod.org");
  expect(cleanSubtitleName("Episode 2 (Director Commentary)")).toBe(
    "Episode 2 (Director Commentary)",
  );
});

test("subtitle rows keep both the name and its language", () => {
  expect(
    subtitleTrackDisplay({
      title: "MoviesMod.org (subrip, Default)",
      language: "gre",
      isDefault: true,
    }),
  ).toEqual({ label: "MoviesMod.org", eyebrow: "Greek · Default" });
  expect(
    subtitleTrackDisplay({ title: "English", language: "en" }),
  ).toEqual({ label: "English", eyebrow: undefined });
});
