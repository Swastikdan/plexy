import { afterAll, expect, test } from "bun:test";
import { mkdir, mkdtemp, open, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { ServerCatalog, serverFileId, serverItemId } from "@/core/server/server-catalog";
import type { ServerSession } from "@/core/server/transport";

const ffmpeg = Bun.which("ffmpeg");
const scratch = await mkdtemp(join(tmpdir(), "plexy-server-catalog-"));
const logPath = join(scratch, "server.log");
let server: ReturnType<typeof Bun.spawn> | null = null;
let log: Awaited<ReturnType<typeof open>> | null = null;

afterAll(async () => {
  if (server?.exitCode === null) server.kill("SIGTERM");
  await server?.exited.catch(() => {});
  await log?.close().catch(() => {});
  await rm(scratch, { recursive: true, force: true });
});

async function waitFor<T>(probe: () => Promise<T | undefined>, timeout = 20_000) {
  const deadline = Date.now() + timeout;
  do {
    const value = await probe();
    if (value !== undefined) return value;
    await Bun.sleep(100);
  } while (Date.now() < deadline);
  throw new Error("Timed out waiting for the test server.");
}

test.skipIf(!ffmpeg)("server catalog maps remote items, playback, and progress", async () => {
  const media = join(scratch, "media");
  await mkdir(media, { recursive: true });
  const fixture = join(media, "Remote Catalog Test (2021).mp4");
  const generated = Bun.spawnSync([
    ffmpeg!,
    "-nostdin",
    "-hide_banner",
    "-loglevel",
    "error",
    "-f",
    "lavfi",
    "-i",
    "testsrc2=size=160x90:rate=24",
    "-t",
    "1",
    "-c:v",
    "libx264",
    "-threads",
    "1",
    "-movflags",
    "+faststart",
    fixture,
  ]);
  expect(generated.exitCode).toBe(0);

  log = await open(logPath, "w");
  server = Bun.spawn(
    [
      process.execPath,
      "--no-env-file",
      resolve(import.meta.dir, "../../server/src/main.ts"),
      "--no-ui",
    ],
    {
      cwd: resolve(import.meta.dir, "../.."),
      env: {
        PATH: process.env.PATH,
        PORT: "0",
        PLEXY_DATA_DIR: join(scratch, "data"),
        PLEXY_LOG_DIR: join(scratch, "logs"),
        PLEXY_FFMPEG: ffmpeg!,
      },
      stdout: log.fd,
      stderr: log.fd,
      stdin: "ignore",
    },
  );
  const port = await waitFor(async () => {
    const text = await Bun.file(logPath).text();
    return text.match(/Plexy v[^\s]+ → http:\/\/localhost:(\d+)/)?.[1];
  });
  const address = `http://127.0.0.1:${port}`;
  const owner = await fetch(`${address}/api/auth/setup/owner`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      username: "catalog-owner",
      password: crypto.randomUUID(),
    }),
  });
  expect(owner.ok).toBe(true);
  const signedIn = (await owner.json()) as {
    token: string;
    serverId: string;
    user: { id: number; username: string; role: string };
    device: { id: string; name: string };
  };
  const library = await fetch(`${address}/api/libraries`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${signedIn.token}`,
    },
    body: JSON.stringify({ name: "Remote movies", type: "movies", paths: [media] }),
  });
  expect(library.ok).toBe(true);
  const libraryBody = (await library.json()) as { id: number };
  const item = await waitFor(async () => {
    const response = await fetch(
      `${address}/api/items?libraryId=${libraryBody.id}`,
      { headers: { Authorization: `Bearer ${signedIn.token}` } },
    );
    const body = (await response.json()) as {
      items: Array<{ id: number; name: string }>;
    };
    return body.items.find((entry) => entry.name === "Remote Catalog Test");
  });

  const session: ServerSession = {
    address,
    serverId: String(signedIn.serverId),
    token: signedIn.token,
    user: signedIn.user,
    device: signedIn.device,
    connectedAt: Date.now(),
  };
  const catalog = new ServerCatalog(session, () => {});
  const home = await catalog.home();
  expect(Array.isArray(home.rows)).toBe(true);
  const items = await catalog.items("all", 0, "name");
  const remote = items.items.find((entry) => entry.publicId != null);
  expect(remote?.source).toBe("server");
  expect(remote?.id).toBeGreaterThanOrEqual(serverItemId(0));

  const detail = await catalog.detail(String(item!.id));
  expect(detail.item.source).toBe("server");
  expect(detail.item.id).toBe(serverItemId(item!.id));
  const fileId = detail.file!.fileId;
  expect(fileId).toBeGreaterThanOrEqual(serverFileId(0));

  const play = await catalog.play(fileId);
  expect(play.fileId).toBe(fileId);
  expect(play.path).toBe("direct");
  expect(play.tracks).toBeDefined();
  expect(catalog.stream(fileId)).toBe(
    `${address}/api/stream/${item!.id}/original`,
  );
  expect(catalog.streamHeaders(fileId)?.Authorization).toContain("Bearer ");

  await catalog.progress(serverItemId(item!.id), 12, 60, false);
  const watched = await catalog.watched(serverItemId(item!.id), true);
  expect(watched.ok).toBe(true);
  const state = await fetch(`${address}/api/items/${item!.id}`, {
    headers: { Authorization: `Bearer ${signedIn.token}` },
  });
  const stateBody = (await state.json()) as {
    item: { watch: { played: boolean } | null };
  };
  expect(stateBody.item.watch?.played).toBe(true);
});
