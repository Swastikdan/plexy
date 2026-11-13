/// Direct-play guarantees: the standalone apps never convert, and the
/// optimizer only prepares files that cannot play as-is.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { buildApp } from "../src/app";
import { q, run, runMigrations } from "../src/db";
import { initConfig, save } from "../src/config";
import {
  enqueueMissingOptimizations,
  needsPreparation,
  pauseOptimizer,
  stopOptimizer,
} from "../src/optimize";

const previous = process.env.PLEXY_DIRECT_PLAY_ONLY;

describe("standalone direct-play mode", () => {
  beforeAll(async () => {
    process.env.PLEXY_DIRECT_PLAY_ONLY = "1";
    await runMigrations();
    await initConfig();
  });
  afterAll(() => {
    if (previous == null) delete process.env.PLEXY_DIRECT_PLAY_ONLY;
    else process.env.PLEXY_DIRECT_PLAY_ONLY = previous;
  });

  test("rejects conversion routes before any media work starts", async () => {
    const app = buildApp();
    for (const path of ["/stream/1/remux", "/stream/1/transcode"]) {
      const response = await app.handle(new Request(`http://localhost/api${path}`));
      expect(response.status).toBe(409);
      expect((await response.json()).error).toContain("conversion is disabled");
    }
  });

  test("has no adaptive stream route left to serve", async () => {
    const app = buildApp();
    const response = await app.handle(
      new Request("http://localhost/api/stream/1/hls/master.m3u8"),
    );
    expect(response.status).toBe(404);
  });

  test("downloads the original file instead of a quality variant", async () => {
    const app = buildApp();
    // The old quality cap is gone, so this is no longer a conversion request:
    // the route simply looks up the (here missing) file and answers 404.
    const response = await app.handle(
      new Request("http://localhost/api/download/999999?maxHeight=720"),
    );
    expect(response.status).toBe(404);
  });

  test("never queues video preparation", async () => {
    expect(await enqueueMissingOptimizations({ includeFailed: true })).toBe(0);
  });
});

describe("optimizer scope", () => {
  beforeAll(async () => {
    delete process.env.PLEXY_DIRECT_PLAY_ONLY;
    await runMigrations();
    await initConfig();
    await save({ autoOptimize: true });
    run("INSERT OR IGNORE INTO libraries (id, name, type, language) VALUES (1, 'Optimizer Lib', 'movies', 'en-US')");
    run("INSERT OR IGNORE INTO items (id, library_id, kind, name, sort_title) VALUES (1, 1, 'movie', 'Optimizer Movie', 'optimizer movie')");
  });
  afterAll(() => {
    stopOptimizer();
  });

  test("classifies direct files as already playable", () => {
    expect(needsPreparation({
      container: "mp4",
      video_codec: "h264",
      audio_json: JSON.stringify([{ codec: "aac", channels: 2 }]),
    })).toBe(false);
    expect(needsPreparation({
      container: "mkv",
      video_codec: "h264",
      audio_json: JSON.stringify([{ codec: "aac", channels: 2 }]),
    })).toBe(true);
    expect(needsPreparation({
      container: "mp4",
      video_codec: "hevc",
      audio_json: JSON.stringify([{ codec: "aac", channels: 2 }]),
    })).toBe(true);
  });

  test("queues only files that cannot play directly", async () => {
    run(`INSERT OR REPLACE INTO media_files
      (id, library_id, item_id, path, folder_key, size, mtime, container, video_codec,
       audio_json, analysis_status, optimized_status)
      VALUES
      (8901, 1, 1, '/media/direct.mp4', 'direct', 10, 1, 'mp4', 'h264', ?, 'probed', 'none'),
      (8902, 1, 1, '/media/remux.mkv', 'remux', 10, 1, 'mkv', 'h264', ?, 'probed', 'none'),
      (8903, 1, 1, '/media/transcode.mp4', 'transcode', 10, 1, 'mp4', 'hevc', ?, 'probed', 'none')`,
      JSON.stringify([{ codec: "aac", channels: 2 }]),
      JSON.stringify([{ codec: "aac", channels: 2 }]),
      JSON.stringify([{ codec: "aac", channels: 2 }]),
    );

    // Keep the worker idle so statuses stay observable instead of racing to
    // "running"/"failed" for these pathless fixtures.
    pauseOptimizer("test");
    await enqueueMissingOptimizations();

    const statusOf = (id: number) =>
      String(q<{ optimized_status: string }, [number]>(
        "SELECT optimized_status FROM media_files WHERE id = ?",
      ).get(id)?.optimized_status);

    expect(statusOf(8901)).toBe("none");
    expect(statusOf(8902)).toBe("queued");
    expect(statusOf(8903)).toBe("queued");
  });
});
