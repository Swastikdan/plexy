import { describe, expect, test } from "bun:test";
import { classifyPlayability, rangeResponse } from "../src/playback";

describe("Playback Classification (PRD 5.6, 5.8)", () => {
  const browserWithBasicCaps = {
    videoCodecs: ["h264", "vp9"],
    audioCodecs: ["aac", "opus", "mp3"],
  };

  test("classifies compatible MP4 as direct play", () => {
    const verdict = classifyPlayability(
      {
        container: "mp4",
        videoCodec: "h264",
        audioJson: JSON.stringify([{ codec: "aac" }]),
        subtitlesJson: null,
      },
      browserWithBasicCaps,
    );

    expect(verdict.path).toBe("direct");
    expect(verdict.reason).toContain("Plays directly");
  });

  test("classifies compatible MKV as remux", () => {
    const verdict = classifyPlayability(
      {
        container: "mkv",
        videoCodec: "h264",
        audioJson: JSON.stringify([{ codec: "aac" }]),
        subtitlesJson: null,
      },
      browserWithBasicCaps,
    );

    expect(verdict.path).toBe("remux");
    expect(verdict.reason).toContain("repacking to MP4");
  });

  test("classifies unsupported video codec (HEVC) as transcode", () => {
    const verdict = classifyPlayability(
      {
        container: "mp4",
        videoCodec: "hevc",
        audioJson: JSON.stringify([{ codec: "aac" }]),
        subtitlesJson: null,
      },
      browserWithBasicCaps,
    );

    expect(verdict.path).toBe("transcode");
    expect(verdict.reason).toContain("HEVC/H.265");
  });

  test("classifies unsupported audio codec (AC3) as transcode", () => {
    const verdict = classifyPlayability(
      {
        container: "mp4",
        videoCodec: "h264",
        audioJson: JSON.stringify([{ codec: "ac3" }]),
        subtitlesJson: null,
      },
      browserWithBasicCaps,
    );

    expect(verdict.path).toBe("transcode");
    expect(verdict.reason).toContain("Dolby Digital");
  });

  test("classifies missing video track as unsupported", () => {
    const verdict = classifyPlayability(
      {
        container: "mp4",
        videoCodec: null,
        audioJson: JSON.stringify([{ codec: "aac" }]),
        subtitlesJson: null,
      },
      browserWithBasicCaps,
    );

    expect(verdict.path).toBe("unsupported");
    expect(verdict.reason).toContain("No video track");
  });
});

describe("media byte ranges", () => {
  const media = new Blob(["0123456789"]);

  test("serves requested and suffix ranges with correct headers and bytes", async () => {
    const partial = await rangeResponse(new Request("http://localhost/media", {
      headers: { Range: "bytes=3-5" },
    }), media, media.size);
    expect(partial.status).toBe(206);
    expect(partial.headers.get("content-range")).toBe("bytes 3-5/10");
    expect(await partial.text()).toBe("345");

    const suffix = await rangeResponse(new Request("http://localhost/media", {
      headers: { Range: "bytes=-3" },
    }), media, media.size);
    expect(suffix.status).toBe(206);
    expect(suffix.headers.get("content-range")).toBe("bytes 7-9/10");
    expect(await suffix.text()).toBe("789");
  });

  test("rejects unsatisfiable and multipart ranges", async () => {
    for (const range of ["bytes=10-", "bytes=1-2,5-6"]) {
      const response = await rangeResponse(new Request("http://localhost/media", {
        headers: { Range: range },
      }), media, media.size);
      expect(response.status).toBe(416);
      expect(response.headers.get("content-range")).toBe("bytes */10");
    }
  });
});
