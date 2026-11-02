import { describe, it, expect, beforeAll, afterAll } from "bun:test";
import { unlink } from "node:fs/promises";
import { spawn } from "node:child_process";
import { resolveFfmpeg } from "../src/ffmpeg";
import { probeFile } from "../src/media-worker";
import { extractEmbeddedVtt } from "../src/subtitles";

describe("FFmpeg / ffprobe Media Probing (replacing Mediabunny)", () => {
  const mp4Path = "/tmp/plexy_probe_test.mp4";
  const mkvPath = "/tmp/plexy_probe_test.mkv";
  const srtPath = "/tmp/plexy_probe_test.srt";
  const ffmpeg = resolveFfmpeg();

  beforeAll(async () => {
    if (!ffmpeg) return;

    // Create a 1-second test MP4 with video and audio
    await new Promise((resolve, reject) => {
      const proc = spawn(ffmpeg, [
        "-y",
        "-f", "lavfi", "-i", "testsrc=duration=1:size=640x360:rate=24",
        "-f", "lavfi", "-i", "sine=duration=1:frequency=440",
        "-c:v", "libx264",
        "-c:a", "aac",
        mp4Path,
      ], { stdio: "ignore" });
      proc.on("close", resolve);
      proc.on("error", reject);
    });

    // Create an SRT subtitle file
    await Bun.write(
      srtPath,
      "1\n00:00:00,100 --> 00:00:00,900\nHello from Plexy Subtitle Test\n\n",
    );

    // Create a 1-second test MKV with embedded subtitle
    await new Promise((resolve, reject) => {
      const proc = spawn(ffmpeg, [
        "-y",
        "-f", "lavfi", "-i", "testsrc=duration=1:size=640x360:rate=24",
        "-i", srtPath,
        "-c:v", "libx264",
        "-c:s", "srt",
        mkvPath,
      ], { stdio: "ignore" });
      proc.on("close", resolve);
      proc.on("error", reject);
    });
  });

  afterAll(async () => {
    await unlink(mp4Path).catch(() => {});
    await unlink(mkvPath).catch(() => {});
    await unlink(srtPath).catch(() => {});
  });

  it("probes video and audio streams from an MP4 file accurately", async () => {
    if (!ffmpeg) return;

    const result = await probeFile(mp4Path);
    expect(result).toBeDefined();
    expect(result.duration).toBeGreaterThan(0.8);
    expect(result.duration).toBeLessThan(1.5);
    expect(result.video).toBeDefined();
    expect(result.video?.width).toBe(640);
    expect(result.video?.height).toBe(360);
    expect(result.video?.codec).toBe("h264");
    expect(result.video?.fps).toBe(24);
    expect(result.audio.length).toBeGreaterThanOrEqual(1);
    expect(result.audio[0].codec).toBe("aac");
  });

  it("probes container, video and subtitle streams from an MKV file", async () => {
    if (!ffmpeg) return;

    const result = await probeFile(mkvPath);
    expect(result).toBeDefined();
    expect(result.container).toContain("matroska");
    expect(result.video).toBeDefined();
    expect(result.video?.width).toBe(640);
    expect(result.video?.height).toBe(360);
    expect(result.subtitles.length).toBeGreaterThanOrEqual(1);
    expect(result.subtitles[0].codec).toBe("subrip");
  });

  it("extracts embedded subtitles into WebVTT format using ffmpeg", async () => {
    if (!ffmpeg) return;

    const vtt = await extractEmbeddedVtt(mkvPath, 0);
    expect(vtt).toBeDefined();
    expect(vtt).toContain("WEBVTT");
    expect(vtt).toContain("Hello from Plexy Subtitle Test");
  });
});
