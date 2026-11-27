import { describe, expect, test } from "bun:test";
import {
  bytesOf,
  heightOf,
  pickQuality,
  sortQualities,
} from "@/features/movy/lib/quality";
import {
  episodeRelativePath,
  movieRelativePath,
  safeName,
} from "@/features/movy/lib/paths";
import {
  sniffContainer,
  validateContainerBytes,
} from "@/features/movy/lib/containers";

describe("Movy quality labels", () => {
  test("parses heights and sizes", () => {
    expect(heightOf("1080p BluRay HEVC · 2.54 GB")).toBe(1080);
    expect(heightOf("2160p WEB-DL HDR")).toBe(2160);
    expect(heightOf("4K UHD")).toBe(2160);
    expect(heightOf("Unknown")).toBe(0);
    expect(bytesOf("2.5 GB")).toBe(Math.round(2.5 * 1024 ** 3));
    expect(bytesOf("700 MB")).toBe(Math.round(700 * 1024 ** 2));
  });

  test("picks the best source at or below the ceiling, then the smallest", () => {
    const options = [
      { quality: "2160p WEB-DL · 20 GB", size: "20 GB" },
      { quality: "1080p WEB-DL · 8 GB", size: "8 GB" },
      { quality: "1080p WEB-DL · 4 GB", size: "4 GB" },
      { quality: "720p WEB-DL · 2 GB", size: "2 GB" },
    ];
    const picked = pickQuality(options, 1080);
    expect(picked?.option.quality).toBe("1080p WEB-DL · 4 GB");
    expect(picked?.height).toBe(1080);
  });

  test("falls back to the lowest available when everything is above the ceiling", () => {
    const options = [
      { quality: "2160p WEB-DL · 20 GB", size: "20 GB" },
      { quality: "1440p WEB-DL · 12 GB", size: "12 GB" },
    ];
    expect(pickQuality(options, 720)?.option.quality).toBe(
      "1440p WEB-DL · 12 GB",
    );
  });

  test("sorts high to low", () => {
    expect(
      sortQualities([
        { quality: "720p · 1 GB" },
        { quality: "2160p · 9 GB" },
        { quality: "1080p · 3 GB" },
      ]).map((option) => heightOf(option.quality)),
    ).toEqual([2160, 1080, 720]);
  });
});

describe("Movy library paths", () => {
  test("builds a self-identifying movie path", () => {
    expect(
      movieRelativePath(
        { title: "12 12 12", year: 2026, tmdbId: 254630 },
        "mp4",
      ),
    ).toBe(
      "Movies/12 12 12 (2026) {tmdb-254630}/12 12 12 (2026) {tmdb-254630}.mp4",
    );
  });

  test("builds a season-aware TV path", () => {
    expect(
      episodeRelativePath(
        {
          title: "Show Name",
          year: 2024,
          tmdbId: 1396,
          season: 3,
          episode: 1,
        },
        "mkv",
      ),
    ).toBe(
      "TV Shows/Show Name (2024) {tmdb-1396}/Season 03/Show Name - S03E01.mkv",
    );
  });

  test("strips path and tag characters from titles", () => {
    expect(safeName("Bad/Title: {tmdb-1}")).toBe("Bad Title tmdb-1");
  });
});

describe("Movy container validation", () => {
  const header = (bytes: number[]) => {
    const value = new Uint8Array(64);
    value.set(bytes);
    return value;
  };

  test("recognizes MP4, MKV, AVI and TS", () => {
    expect(sniffContainer(header([0, 0, 0, 0x18, 0x66, 0x74, 0x79, 0x70]))).toBe("mp4");
    expect(sniffContainer(header([0x1a, 0x45, 0xdf, 0xa3]))).toBe("mkv");
    expect(sniffContainer(header([0x52, 0x49, 0x46, 0x46]))).toBe("avi");
    expect(sniffContainer(header([0x47]))).toBe("ts");
  });

  test("rejects HTML error pages and unknown containers", () => {
    expect(sniffContainer(header([...new TextEncoder().encode("<!doctype html>")]))).toBe("html");
    expect(() =>
      validateContainerBytes(
        header([...new TextEncoder().encode("<!doctype html>")]),
        "x.mp4",
      ),
    ).toThrow("error page");
    expect(() => validateContainerBytes(header([1, 2, 3]), "x.mp4")).toThrow(
      "supported video container",
    );
  });

  test("keeps a WebM extension when the provider used one", () => {
    const bytes = header([0x1a, 0x45, 0xdf, 0xa3]);
    expect(validateContainerBytes(bytes, "Show.webm")).toEqual({
      container: "mkv",
      extension: "webm",
    });
  });
});
