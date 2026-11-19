import { expect, test } from "bun:test";
import {
  cleanSubtitleName,
  preferredSubtitleTrack,
  subtitleLanguageName,
  subtitleTrackDisplay,
} from "../src/features/player/lib/subtitles";
import { findLanguageTrack, subtitleFilenameLanguage } from "../src/shared/lib/media-language";

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

test("language preferences match track aliases and prefer exact regional tags", () => {
  const tracks = [
    { language: "eng" },
    { language: "por" },
    { language: "pt-BR" },
  ];
  expect(findLanguageTrack(tracks, "pt_BR")).toBe(tracks[2]!);
  expect(findLanguageTrack(tracks, "English")).toBe(tracks[0]!);
  expect(findLanguageTrack(tracks, "ja", "en")).toBe(tracks[0]!);
  expect(findLanguageTrack(tracks, "")).toBeUndefined();
});

test("subtitle overrides, app defaults and file defaults work across track sources", () => {
  const tracks = [
    { key: "sidecar", language: "jpn", isDefault: true },
    { key: "native:1", language: "eng" },
  ];
  expect(preferredSubtitleTrack(tracks, undefined, true, "en")).toBe("native:1");
  expect(preferredSubtitleTrack(tracks, "ja", false, "en")).toBe("sidecar");
  expect(preferredSubtitleTrack(tracks, "hi", true, "en")).toBe("native:1");
  expect(preferredSubtitleTrack(tracks, undefined, true, "")).toBe("sidecar");
  expect(preferredSubtitleTrack(tracks, "hi", false, "en")).toBeNull();
  expect(preferredSubtitleTrack(tracks, null, true, "en")).toBeNull();
});

test("reads language tags from imported and sidecar subtitle filenames", () => {
  expect(subtitleFilenameLanguage("Movie.pt-BR.sdh.srt")).toBe("pt-br");
  expect(subtitleFilenameLanguage("Movie.eng.forced.vtt")).toBe("eng");
  expect(subtitleFilenameLanguage("Movie.srt")).toBeNull();
});
