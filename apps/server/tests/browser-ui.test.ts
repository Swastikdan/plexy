import { afterAll, beforeAll, expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { browserUiEnabled, buildApp } from "../src/app";
import { runMigrations } from "../src/db";
import { initConfig } from "../src/config";
let directory: string;
const previous = process.env.PLEXY_WEB_DIR;
beforeAll(async () => {
  await runMigrations();
  await initConfig();
  directory = await mkdtemp(join(tmpdir(), "plexy-ui-"));
  await writeFile(
    join(directory, "index.html"),
    "<!doctype html><title>Plexy UI test</title>",
  );
  await writeFile(join(directory, "app.js"), "console.log('ui test')");
  process.env.PLEXY_WEB_DIR = directory;
});
afterAll(async () => {
  if (previous === undefined) delete process.env.PLEXY_WEB_DIR;
  else process.env.PLEXY_WEB_DIR = previous;
  await rm(directory, { recursive: true, force: true });
});
test("browser UI defaults on; flag and environment can disable it", () => {
  expect(browserUiEnabled([], {})).toBe(true);
  expect(browserUiEnabled(["--no-ui"], {})).toBe(false);
  expect(browserUiEnabled([], { PLEXY_NO_UI: "1" })).toBe(false);
});
test("serves bundled static assets and SPA routes by default", async () => {
  const app = buildApp();
  const response = await app.handle(new Request("http://localhost/library"));
  expect(response.status).toBe(200);
  expect(await response.text()).toContain("Plexy UI test");
  expect(
    await (await app.handle(new Request("http://localhost/app.js"))).text(),
  ).toContain("ui test");
});
test("API-only mode never serves UI routes or assets but keeps status available", async () => {
  const app = buildApp({ ui: false });
  for (const path of ["/", "/library", "/app.js"]) {
    const response = await app.handle(new Request(`http://localhost${path}`));
    expect(response.status).toBe(404);
    expect(await response.text()).not.toContain("ui test");
  }
  expect(
    (await app.handle(new Request("http://localhost/api/server/status")))
      .status,
  ).toBe(200);
});
