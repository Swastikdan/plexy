import { describe, expect, test } from "bun:test";
import { isPreparedHlsAsset, rewritePreparedPlaylist } from "../src/hls-preparation";
import { chooseHardwareEncoder } from "../src/hls-encoder";

describe("prepared HLS asset names", () => {
  test("accepts numeric and labelled variants", () => {
    expect(isPreparedHlsAsset("master.m3u8")).toBe(true);
    expect(isPreparedHlsAsset("variant_0.m3u8")).toBe(true);
    expect(isPreparedHlsAsset("variant_1080p.m3u8")).toBe(true);
    expect(isPreparedHlsAsset("variant_4k.m3u8")).toBe(true);
  });

  test("accepts numeric and labelled segments", () => {
    expect(isPreparedHlsAsset("segment_0_00000.ts")).toBe(true);
    expect(isPreparedHlsAsset("segment_1080p_00042.ts")).toBe(true);
    expect(isPreparedHlsAsset("segment_4k_00001.ts")).toBe(true);
  });

  test("rejects anything outside the prepared cache", () => {
    expect(isPreparedHlsAsset("../../config.json")).toBe(false);
    expect(isPreparedHlsAsset("variant_evil.m3u8")).toBe(false);
    expect(isPreparedHlsAsset("segment_0.ts")).toBe(false);
    expect(isPreparedHlsAsset("master.m3u8/extra")).toBe(false);
  });

  test("routes labelled playlist entries back through the audio-aware endpoint", () => {
    const playlist = [
      "#EXTM3U",
      "#EXTINF:6,",
      "segment_1080p_00000.ts",
      "#EXT-X-STREAM-INF:RESOLUTION=1920x1080",
      "variant_1080p.m3u8",
    ].join("\n");
    expect(rewritePreparedPlaylist(playlist, 42, "http://localhost:8765", 1))
      .toContain("http://localhost:8765/api/stream/42/hls/segment_1080p_00000.ts?audio=1");
    expect(rewritePreparedPlaylist(playlist, 42, "http://localhost:8765", 1))
      .toContain("http://localhost:8765/api/stream/42/hls/variant_1080p.m3u8?audio=1");
  });
});

describe("hardware encoder selection", () => {
  test("uses VideoToolbox on macOS when available", () => {
    expect(chooseHardwareEncoder(new Set(["h264_videotoolbox"]), "darwin"))
      .toBe("h264_videotoolbox");
  });

  test("does not use VideoToolbox on Linux", () => {
    expect(chooseHardwareEncoder(new Set(["h264_videotoolbox"]), "linux")).toBeNull();
  });

  test("prefers NVENC over AMF on Windows", () => {
    expect(chooseHardwareEncoder(new Set(["h264_amf", "h264_nvenc"]), "win32"))
      .toBe("h264_nvenc");
  });

  test("falls back to software when no hardware encoder exists", () => {
    expect(chooseHardwareEncoder(new Set(["libx264"]), "darwin")).toBeNull();
  });
});
