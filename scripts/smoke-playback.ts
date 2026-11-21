import assert from "node:assert/strict";
import { mkdir, mkdtemp, open, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ItemCard, Playability, TitleDetail } from "@plexy/api-client/types";

const ffmpeg = Bun.which("ffmpeg");
if (!ffmpeg) throw new Error("Install FFmpeg and put ffmpeg on PATH before running this check.");

async function waitFor<T>(description: string, probe: () => Promise<T | undefined>): Promise<T> {
  const deadline = Date.now() + 20_000;
  do {
    const result = await probe();
    if (result !== undefined) return result;
    await Bun.sleep(100);
  } while (Date.now() < deadline);
  throw new Error(`Timed out waiting for ${description}.`);
}

const root = join(import.meta.dir, "..");
const scratch = await mkdtemp(join(tmpdir(), "plexy-playback-"));
const media = join(scratch, "media");
const fixture = join(media, "Plexy Smoke Test (2020).mp4");
const logPath = join(scratch, "server.log");

try {
  await mkdir(media);
  const generated = Bun.spawnSync([
    ffmpeg, "-nostdin", "-hide_banner", "-loglevel", "error",
    "-f", "lavfi", "-i", "testsrc2=size=160x90:rate=24",
    "-t", "2", "-c:v", "libx264", "-threads", "1", "-movflags", "+faststart", fixture,
  ], { stderr: "inherit" });
  assert.equal(generated.exitCode, 0, "FFmpeg could not create the fixture. Check for libx264 support.");

  // Start with no Plexy settings or credentials from the caller or any .env file.
  const output = await open(logPath, "w");
  try {
    const server = Bun.spawn(
      [process.execPath, "--no-env-file", "apps/server/src/main.ts", "--no-ui"],
      {
        cwd: root,
        env: {
          PATH: process.env.PATH,
          PORT: "0",
          PLEXY_DATA_DIR: join(scratch, "data"),
          PLEXY_LOG_DIR: join(scratch, "logs"),
          PLEXY_FFMPEG: ffmpeg,
        },
        stdout: output.fd,
        stderr: output.fd,
        stdin: "ignore",
      },
    );
    try {
      const port = await waitFor("the loopback server", async () => {
        assert.equal(server.exitCode, null, "The server exited during startup.");
        const outputText = await Bun.file(logPath).text();
        return outputText.match(/Plexy v[^\s]+ → http:\/\/localhost:(\d+)/)?.[1];
      });
      const origin = `http://127.0.0.1:${port}`;
      let cookie: string | undefined;

      async function request(path: string, body?: object, headers = new Headers()) {
        if (cookie) headers.set("Cookie", cookie);
        if (body) headers.set("Content-Type", "application/json");
        const response = await fetch(`${origin}/api${path}`, {
          method: body ? "POST" : "GET",
          body: body ? JSON.stringify(body) : undefined,
          headers,
          signal: AbortSignal.timeout(5_000),
        });
        if (!response.ok) throw new Error(`${path} returned HTTP ${response.status}: ${await response.text()}`);
        return response;
      }

      const initial = await (await request("/auth/setup")).json() as { ownerCreated: boolean };
      assert.equal(initial.ownerCreated, false, "The smoke server should start without an owner.");
      const owner = await request("/auth/setup/owner", {
        username: "smoke-owner", password: crypto.randomUUID(),
      });
      cookie = owner.headers.get("Set-Cookie")?.split(";", 1)[0];
      await owner.body?.cancel();
      assert.ok(cookie, "Owner setup should return a browser session cookie.");

      const library = await (await request("/libraries", {
        name: "Smoke movies", type: "movies", paths: [media],
      })).json() as { id: number };
      const item = await waitFor("the fixture to appear in the scanned library", async () => {
        const catalog = await (await request(`/items?libraryId=${library.id}`)).json() as { items: ItemCard[] };
        return catalog.items.find(({ name }) => name === "Plexy Smoke Test");
      });
      const setup = await (await request("/auth/setup/complete", {})).json() as { setupComplete: boolean };
      assert.equal(setup.setupComplete, true);
      const detail = await (await request(`/items/${item.id}`)).json() as TitleDetail;
      assert.ok(detail.file, "The scanned movie should have a playable file.");
      const fileId = detail.file.fileId;
      const manifest = await (await request(`/play/${fileId}`)).json() as Playability;
      assert.equal(manifest.fileId, fileId);
      assert.equal(manifest.path, "direct");

      const stream = await request(`/stream/${fileId}`, undefined, new Headers({ Range: "bytes=0-127" }));
      assert.equal(stream.status, 206);
      assert.match(stream.headers.get("Content-Range") ?? "", /^bytes 0-127\/\d+$/);
      assert.equal(stream.headers.get("Content-Type"), "video/mp4");
      const expected = await Bun.file(fixture).slice(0, 128).arrayBuffer();
      assert.deepEqual(await stream.arrayBuffer(), expected, "Streamed bytes should match the source.");
      console.log("Playback smoke passed (owner setup, library scan, direct play, byte-range stream).");
    } catch (error) {
      console.error(await Bun.file(logPath).text());
      throw error;
    } finally {
      if (server.exitCode === null) server.kill("SIGTERM");
      const deadline = setTimeout(() => server.kill("SIGKILL"), 5_000);
      try {
        await server.exited;
      } finally {
        clearTimeout(deadline);
      }
    }
  } finally {
    await output.close();
  }
} finally {
  await rm(scratch, { recursive: true, force: true });
}
