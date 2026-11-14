/// Per-language prepared copies: a browser cannot switch audio tracks inside
/// one MP4, so choosing a second language builds a second file and the stream
/// route serves it.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtemp, rm, stat } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { buildApp } from "../src/app";
import { q, run, runMigrations, type Row } from "../src/db";
import { initConfig } from "../src/config";
import { resolveFfmpeg } from "../src/ffmpeg";
import { stopOptimizer } from "../src/optimize";

const FILE_ID = 7901;
const ITEM_ID = 7902;

describe("per-language audio copies", () => {
  let app: ReturnType<typeof buildApp> | null = null;
  let dir = "";

  const get = (path: string) => app!.handle(new Request(`http://localhost:8765${path}`));

  beforeAll(async () => {
    await runMigrations();
    await initConfig();
    dir = await mkdtemp(join(tmpdir(), "plexy-audio-variant-"));
    const ffmpeg = resolveFfmpeg();
    if (!ffmpeg) return;

    const source = join(dir, "dual.mkv");
    const made = Bun.spawn([
      ffmpeg, "-hide_banner", "-loglevel", "error",
      "-f", "lavfi", "-i", "testsrc2=size=320x180:rate=24",
      "-f", "lavfi", "-i", "sine=frequency=440:sample_rate=48000",
      "-f", "lavfi", "-i", "sine=frequency=880:sample_rate=48000",
      "-t", "2",
      "-map", "0:v", "-map", "1:a", "-map", "2:a",
      "-c:v", "libx264", "-preset", "ultrafast", "-c:a", "aac",
      "-metadata:s:a:0", "language=hin", "-metadata:s:a:1", "language=eng",
      "-disposition:a:0", "default", source,
    ], { stdout: "ignore", stderr: "ignore" });
    if ((await made.exited) !== 0) return;

    const info = await stat(source);
    run("INSERT OR IGNORE INTO libraries (id, name, type, language) VALUES (3, 'Audio Lib', 'movies', 'en-US')");
    run("INSERT OR REPLACE INTO items (id, library_id, kind, name, sort_title) VALUES (?, 3, 'movie', 'Dual Audio', 'dual audio')", ITEM_ID);
    run(
      `INSERT OR REPLACE INTO media_files
        (id, library_id, item_id, path, folder_key, size, mtime, container, video_codec,
         audio_json, analysis_status, optimized_status, duration, width, height, bitrate)
       VALUES (?, 3, ?, ?, 'dual', ?, ?, 'matroska', 'h264', ?, 'probed', 'none', 2, 320, 180, 200000)`,
      FILE_ID,
      ITEM_ID,
      source,
      info.size,
      Math.floor(info.mtimeMs),
      JSON.stringify([
        { codec: "aac", channels: 2, language: "hin", isDefault: true },
        { codec: "aac", channels: 2, language: "eng", isDefault: false },
      ]),
    );
    app = buildApp();
  });

  afterAll(async () => {
    await stopOptimizer();
    if (dir) await rm(dir, { recursive: true, force: true });
  });

  test("every language is offered, with a prepared flag", async () => {
    if (!app) return;
    const manifest = await (await get(`/api/play/${FILE_ID}`)).json();
    expect(manifest.selectedAudioIndex).toBe(0);
    expect(manifest.audioTracks).toHaveLength(2);
    expect(manifest.audioTracks[1].language).toBe("eng");
    expect(manifest.audioTracks[1].prepared).toBe(false);
  });

  test("selecting the second language prepares and serves its own copy", async () => {
    if (!app) return;
    const first = await (await get(`/api/play/${FILE_ID}?audio=1`)).json();
    expect(first.selectedAudioIndex).toBe(1);
    if (first.path !== "direct") {
      expect(first.path).toBe("unsupported");
      expect(first.reason).toContain("English");

      let manifest = first;
      for (let attempt = 0; attempt < 100 && manifest.path !== "direct"; attempt++) {
        await new Promise((resolve) => setTimeout(resolve, 100));
        manifest = await (await get(`/api/play/${FILE_ID}?audio=1`)).json();
      }
      expect(manifest.path).toBe("direct");
      expect(manifest.audioTracks[1].prepared).toBe(true);
    }

    const response = await get(`/api/stream/${FILE_ID}?audio=1`);
    expect([200, 206]).toContain(response.status);
    expect(response.headers.get("x-plexy-source")).toBe("audio-variant");

    const variant = q<Row, [number, number]>(
      "SELECT status, path FROM media_audio_variants WHERE file_id = ? AND audio_index = ?",
    ).get(FILE_ID, 1);
    expect(String(variant?.status)).toBe("done");
    expect(String(variant?.path)).toContain("-a1.mp4");
  });

  test("an unprepared language is rejected instead of served from the primary copy", async () => {
    if (!app) return;
    const response = await get(`/api/stream/${FILE_ID}?audio=3`);
    expect(response.status).toBe(409);
  });
});
