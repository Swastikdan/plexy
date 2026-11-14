/// Native playback endpoints: the desktop mpv window reads original bytes and
/// must never wait for (or trigger) browser preparation.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtemp, rm, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { buildApp } from "../src/app";
import { q, run, runMigrations, type Row } from "../src/db";
import { initConfig } from "../src/config";
import { createUser } from "../src/accounts";
import { createDevice } from "../src/auth";

const FILE_ID = 7801;
const ITEM_ID = 7701;
const ORIGINAL = Buffer.from("MATROSKA-ORIGINAL-BYTES");
const OPTIMIZED = Buffer.from("OPTIMIZED-MP4-BYTES");

describe("native playback endpoints", () => {
  let app: ReturnType<typeof buildApp>;
  let dir = "";
  let adminToken = "";
  let viewerToken = "";

  const request = (path: string, token = adminToken, init: RequestInit = {}) => {
    const headers = new Headers(init.headers);
    headers.set("Authorization", `Bearer ${token}`);
    return app.handle(new Request(`http://localhost:8765${path}`, { ...init, headers }));
  };

  beforeAll(async () => {
    await runMigrations();
    await initConfig();
    dir = await mkdtemp(join(tmpdir(), "plexy-native-"));
    const originalPath = join(dir, "movie.mkv");
    const optimizedPath = join(dir, "movie-optimized.mp4");
    await writeFile(originalPath, ORIGINAL);
    await writeFile(optimizedPath, OPTIMIZED);
    const info = await stat(originalPath);

    run("INSERT OR IGNORE INTO libraries (id, name, type, language) VALUES (2, 'Native Lib', 'movies', 'en-US')");
    run("INSERT OR REPLACE INTO items (id, library_id, kind, name, sort_title) VALUES (?, 2, 'movie', 'Native Movie', 'native movie')", ITEM_ID);
    run(
      `INSERT OR REPLACE INTO media_files
        (id, library_id, item_id, path, folder_key, size, mtime, container, video_codec,
         audio_json, analysis_status, optimized_status, optimized_path, optimized_mtime, optimized_mode)
       VALUES (?, 2, ?, ?, 'native', ?, ?, 'matroska', 'h264', ?, 'probed', 'done', ?, ?, 'remux')`,
      FILE_ID,
      ITEM_ID,
      originalPath,
      info.size,
      Math.floor(info.mtimeMs),
      JSON.stringify([{ codec: "aac", channels: 2, language: "en", isDefault: true }]),
      optimizedPath,
      Math.floor(info.mtimeMs),
    );

    const nonce = Math.random().toString(36).slice(2, 8);
    const admin = await createUser(`native-admin-${nonce}`, "native-test-password-long", "admin");
    adminToken = createDevice("Native admin", null, null, admin.id).token;
    const viewer = await createUser(`native-viewer-${nonce}`, "native-test-password-long-2", "user");
    viewerToken = createDevice("Native viewer", null, null, viewer.id).token;
    app = buildApp({ requireAuth: true });
  });

  afterAll(async () => {
    if (dir) await rm(dir, { recursive: true, force: true });
  });

  test("native manifest points at the original file and never queues preparation", async () => {
    run("UPDATE media_files SET optimized_status = 'done' WHERE id = ?", FILE_ID);
    const response = await request(`/api/play/${FILE_ID}?native=1`);
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.path).toBe("direct");
    expect(body.directPlayOnly).toBe(false);
    expect(body.native?.streamUrl).toBe(`/api/stream/${FILE_ID}/original`);
    expect(body.native?.preferredAudioLanguage).toBe("en");
    expect(body.audioTracks?.[0]?.codec).toBe("aac");
    // A browser request for the same MKV would enqueue a remux; native must not.
    expect(body.optimization?.status).toBe("done");
  });

  test("native manifest does not enqueue an unprepared file", async () => {
    run("UPDATE media_files SET optimized_status = 'none', optimized_path = NULL WHERE id = ?", FILE_ID);
    const response = await request(`/api/play/${FILE_ID}?native=1`);
    expect(response.status).toBe(200);
    const status = q<Row, [number]>("SELECT optimized_status FROM media_files WHERE id = ?")
      .get(FILE_ID)?.optimized_status;
    expect(String(status)).toBe("none");
  });

  test("original endpoint serves the MKV even when a prepared MP4 exists", async () => {
    run(
      "UPDATE media_files SET optimized_status = 'done', optimized_path = ? WHERE id = ?",
      join(dir, "movie-optimized.mp4"),
      FILE_ID,
    );
    const response = await request(`/api/stream/${FILE_ID}/original`);
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("video/x-matroska");
    expect(response.headers.get("x-plexy-source")).toBe("original");
    expect(Buffer.from(await response.arrayBuffer()).toString()).toBe(ORIGINAL.toString());
  });

  test("original endpoint honours HTTP ranges", async () => {
    const response = await request(`/api/stream/${FILE_ID}/original`, adminToken, {
      headers: { Range: "bytes=0-7" },
    });
    expect(response.status).toBe(206);
    expect(response.headers.get("content-range")).toBe(`bytes 0-7/${ORIGINAL.length}`);
    expect(await response.text()).toBe("MATROSKA");
  });

  test("original endpoint rejects unsatisfiable ranges", async () => {
    const response = await request(`/api/stream/${FILE_ID}/original`, adminToken, {
      headers: { Range: `bytes=${ORIGINAL.length + 50}-` },
    });
    expect(response.status).toBe(416);
  });

  test("viewers without access cannot read the original file", async () => {
    for (const path of [`/api/stream/${FILE_ID}/original`, `/api/play/${FILE_ID}?native=1`]) {
      const response = await request(path, viewerToken);
      expect(response.status).toBe(404);
    }
  });

  test("unknown files and unauthenticated requests are rejected", async () => {
    expect((await request("/api/stream/999999/original")).status).toBe(404);
    const anonymous = await app.handle(
      new Request("http://localhost:8765/api/stream/7801/original"),
    );
    expect([401, 404]).toContain(anonymous.status);
  });
});
