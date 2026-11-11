import { expect, test } from "bun:test";
import { buildTargets } from "./build-targets";
const selected = (files: string[], target = "") => Object.entries(buildTargets(files, target)).filter(([, value]) => value).map(([key]) => key);
test("isolates native targets and follows embedded dependencies", () => {
  expect(selected(["apps/mobile/src/app/_layout.tsx"])).toEqual(["mobile"]);
  expect(selected(["packages/local-library/src/library.ts"])).toEqual(["mobile"]);
  expect(selected(["apps/tv/app.config.ts"])).toEqual(["tv"]);
  expect(selected(["apps/tv/src/screens/Connect.tsx"])).toEqual(["tv"]);
  expect(selected(["packages/native-client/src/api.ts"])).toEqual(["mobile", "tv"]);
  expect(selected(["apps/server/src/auth.ts"])).toEqual(["desktop", "server"]);
  expect(selected(["apps/web/src/auth.ts"])).toEqual(["web", "desktop"]);
  expect(selected(["packages/api-client/src/index.ts"])).toEqual(["web", "desktop", "mobile", "tv"]);
  expect(selected(["apps/desktop/src/main/index.ts"])).toEqual(["desktop"]);
  expect(selected(["README.md"])).toEqual([]);
});
test("manual backend builds include desktop; shared inputs rebuild consumers", () => {
  expect(selected([], "backend")).toEqual(["desktop", "server"]);
  expect(selected([], "mobile")).toEqual(["mobile"]);
  expect(selected(["scripts/native/build-preview.ts"])).toEqual(["mobile", "tv"]);
  expect(selected(["scripts/build-server.ts"])).toEqual(["desktop", "server"]);
  expect(selected(["bun.lock"])).toHaveLength(5);
  expect(selected([], "all")).toHaveLength(5);
});
