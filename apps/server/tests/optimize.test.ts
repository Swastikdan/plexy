import { describe, expect, test } from "bun:test";
import { decideOptimization, type OptimizeFacts } from "../src/optimize";
import {
  cuesToVtt, fmtVttTimestamp, packetToCues, srtToVtt,
} from "../src/subtitles";

const baseFacts: OptimizeFacts = {
  container: "mkv",
  videoCodec: "h264",
  audioJson: JSON.stringify([{ codec: "aac", channels: 2 }]),
  height: 1080,
  bitrate: 8_000_000,
  duration: 3600,
  size: 4_000_000_000,
};

describe("playback preparation decisions", () => {
  test("remuxes a compatible MKV without re-encoding", () => {
    const decision = decideOptimization(baseFacts);
    expect(decision.action).toBe("optimize");
    if (decision.action !== "optimize") return;
    expect(decision.mode).toBe("remux");
    expect(decision.videoCopy).toBe(true);
    expect(decision.audioCopy).toBe(true);
  });

  test("skips a directly playable fast-start MP4", () => {
    const decision = decideOptimization({ ...baseFacts, container: "mp4" });
    expect(decision.action).toBe("skip");
  });

  test("repacks a direct MP4 whose index is at the end", () => {
    const decision = decideOptimization(
      { ...baseFacts, container: "mp4" },
      { needsFastStart: true },
    );
    expect(decision.action).toBe("optimize");
    if (decision.action !== "optimize") return;
    expect(decision.mode).toBe("remux");
  });

  test("transcodes HEVC video but copies AAC audio", () => {
    const decision = decideOptimization({ ...baseFacts, container: "mp4", videoCodec: "hevc" });
    expect(decision.action).toBe("optimize");
    if (decision.action !== "optimize") return;
    expect(decision.mode).toBe("transcode");
    expect(decision.videoCopy).toBe(false);
    expect(decision.audioCopy).toBe(true);
    // Never targets less than the source bitrate (quality is preserved).
    expect(decision.videoBitrate).toBeGreaterThanOrEqual(baseFacts.bitrate!);
    expect(decision.videoBitrate).toBe(12_800_000);
  });

  test("copies H.264 video and converts unsupported audio", () => {
    const decision = decideOptimization({
      ...baseFacts,
      container: "mp4",
      audioJson: JSON.stringify([{ codec: "ac3", channels: 6 }]),
    });
    expect(decision.action).toBe("optimize");
    if (decision.action !== "optimize") return;
    expect(decision.mode).toBe("transcode");
    expect(decision.videoCopy).toBe(true);
    expect(decision.audioCopy).toBe(false);
    expect(decision.audioBitrate).toBe(384_000);
  });

  test("treats a container-only problem as a remux", () => {
    const decision = decideOptimization({ ...baseFacts, container: "avi" });
    expect(decision.action).toBe("optimize");
    if (decision.action !== "optimize") return;
    expect(decision.mode).toBe("remux");
  });

  test("transcodes codecs MP4 cannot portably hold instead of remuxing", () => {
    const decision = decideOptimization({
      ...baseFacts,
      videoCodec: "vp9",
      audioJson: JSON.stringify([{ codec: "opus", channels: 2 }]),
    });
    expect(decision.action).toBe("optimize");
    if (decision.action !== "optimize") return;
    expect(decision.mode).toBe("transcode");
    expect(decision.videoCopy).toBe(false);
    expect(decision.audioCopy).toBe(false);
    expect(decision.videoBitrate).toBeGreaterThanOrEqual(baseFacts.bitrate!);
  });

  test("skips files with no video track", () => {
    const decision = decideOptimization({ ...baseFacts, videoCodec: null });
    expect(decision.action).toBe("skip");
  });
});

describe("subtitle formatting", () => {
  test("formats WebVTT timestamps with a dot and milliseconds", () => {
    expect(fmtVttTimestamp(0)).toBe("00:00:00.000");
    expect(fmtVttTimestamp(3661.5)).toBe("01:01:01.500");
    expect(fmtVttTimestamp(59.9996)).toBe("00:01:00.000");
  });

  test("parses SRT timing out of the packet payload", () => {
    const payload = new TextEncoder().encode(
      "1\r\n00:00:01,000 --> 00:00:02,500\r\nHello there\r\n",
    );
    const cues = packetToCues(payload, "srt", 10, 1);
    expect(cues).toHaveLength(1);
    expect(cues[0]!.start).toBeCloseTo(1, 3);
    expect(cues[0]!.end).toBeCloseTo(2.5, 3);
    expect(cues[0]!.text).toBe("Hello there");
    expect(cues[0]!.text).not.toContain("-->");
  });

  test("uses packet timing when the payload has no timing", () => {
    const cues = packetToCues(new TextEncoder().encode("Just a line"), "ass", 12.25, 2);
    expect(cues[0]!.start).toBe(12.25);
    expect(cues[0]!.end).toBe(14.25);
  });

  test("strips Matroska ASS field prefixes and trailing NULs", () => {
    const payload = new TextEncoder().encode("1,,Default,,0,0,0,,Hello, world\u0000");
    const cues = packetToCues(payload, "ass", 1, 2);
    expect(cues).toHaveLength(1);
    expect(cues[0]!.text).toBe("Hello, world");
  });

  test("serializes valid cue blocks", () => {
    const vtt = cuesToVtt([{ start: 1, end: 2, text: "Hi" }]);
    expect(vtt.startsWith("WEBVTT\n\n")).toBe(true);
    expect(vtt).toContain("00:00:01.000 --> 00:00:02.000");
  });

  test("converts an SRT sidecar to WebVTT", () => {
    const vtt = srtToVtt("1\n00:00:01,000 --> 00:00:02,000\nHi\n");
    expect(vtt.startsWith("WEBVTT\n\n")).toBe(true);
    expect(vtt).toContain("00:00:01.000 --> 00:00:02.000");
  });
});
