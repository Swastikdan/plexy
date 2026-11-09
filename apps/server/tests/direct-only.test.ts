import { beforeAll, afterAll, expect, test } from "bun:test";
import { buildApp } from "../src/app";
import { runMigrations } from "../src/db";
import { initConfig } from "../src/config";
import { enqueueMissingOptimizations, startOptimizer } from "../src/optimize";
import { setTitleStreamQualities, startStreamPreparation } from "../src/hls-preparation";
const previous = process.env.PLEXY_DIRECT_PLAY_ONLY;
beforeAll(async () => {
  process.env.PLEXY_DIRECT_PLAY_ONLY = "1";
  await runMigrations(); await initConfig();
});
afterAll(() => {
  if (previous == null) delete process.env.PLEXY_DIRECT_PLAY_ONLY;
  else process.env.PLEXY_DIRECT_PLAY_ONLY = previous;
});
test("standalone mode rejects every video conversion route before starting media work", async () => {
  const app = buildApp();
  for (const path of ["/stream/1/remux", "/stream/1/transcode", "/stream/1/hls/master.m3u8", "/download/1?maxHeight=720"]) {
    const response = await app.handle(new Request(`http://localhost/api${path}`));
    expect(response.status).toBe(409);
    expect((await response.json()).error).toContain("conversion is disabled");
  }
});
test("standalone mode never resumes or queues video preparation", async () => {
  await startOptimizer(); await startStreamPreparation();
  expect(await enqueueMissingOptimizations({ includeFailed: true })).toBe(0);
  expect(await setTitleStreamQualities(1, [720,1080], true)).toBe(0);
});
