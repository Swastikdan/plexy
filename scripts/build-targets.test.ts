import { expect, test } from "bun:test";
import { buildTargets } from "./build-targets";
const selected = (files: string[], target = "") =>
  Object.entries(buildTargets(files, target))
    .filter(([, value]) => value)
    .map(([key]) => key);
test("mobile-only changes never build desktop or server", () => {
  for (const file of [
    "apps/mobile/src/app/_layout.tsx",
    "packages/local-library/src/library.ts",
    "scripts/native/build-preview.ts",
    "licenses/mobile-supplemental.json",
  ])
    expect(selected([file])).toEqual(["mobile"]);
});
test("backend and UI changes rebuild both embedded consumers", () => {
  for (const file of [
    "apps/server/src/auth.ts",
    "apps/web/src/routes/index.tsx",
    "scripts/install-macos-ffmpeg.mjs",
    "scripts/install-ffmpeg.mjs",
    "scripts/find-ffmpeg.ts",
    ".github/actions/package-server/action.yml",
    "scripts/publish-release.sh",
  ])
    expect(selected([file])).toEqual(["desktop", "server"]);
  expect(selected(["packages/api-client/src/types.ts"])).toEqual([
    "desktop",
    "server",
    "mobile",
  ]);
  for (const file of [
    "apps/desktop/src/main/index.ts",
    "scripts/bundle-mpv.ts",
    "scripts/bundle-libmpv.ts",
    "scripts/after-pack-mpv.cjs",
    "scripts/mpv-manifest.json",
    ".github/actions/package-macos/action.yml",
  ])
    expect(selected([file])).toEqual(["desktop"]);
});
test("manual targets, shared inputs and documentation", () => {
  expect(selected([], "backend")).toEqual(["server"]);
  expect(selected([], "mobile")).toEqual(["mobile"]);
  expect(selected(["README.md", "docs/API.md"])).toEqual([]);
  for (const file of ["bun.lock", "turbo.json"])
    expect(selected([file])).toEqual(["desktop", "server", "mobile"]);
  expect(selected(["packages/tsconfig/base.json"])).toEqual([
    "desktop",
    "server",
    "mobile",
  ]);
  expect(selected([], "all")).toHaveLength(3);
  expect(() => selected([], "tv")).toThrow();
  expect(() => selected([], "web")).toThrow();
});
