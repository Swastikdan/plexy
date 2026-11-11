import { expect, test } from "bun:test";
import { matchesTargetAsset, selectUpdate } from "../src/update-policy";
import type { GitHubRelease } from "../src/updater";

const release = (
  build: string,
  asset = "Plexy-mobile-1.0.1-beta.3-build.29.apk",
): GitHubRelease => ({
  id: 1,
  tag_name: `v1.0.1-${build}`,
  name: "Release",
  body: "",
  published_at: "",
  prerelease: true,
  assets: [{ name: asset, size: 100, browser_download_url: "https://example.com/app.apk" }],
});

test("versioned and legacy preview asset names match their platform", () => {
  expect(matchesTargetAsset("Plexy-mobile-1.0.1-beta.3-build.29.apk", "mobile")).toBe(true);
  expect(matchesTargetAsset("plexy-mobile-preview.apk", "mobile")).toBe(true);
  expect(matchesTargetAsset("Plexy-TV-1.0.1-beta.3-build.29.apk", "tv")).toBe(true);
  expect(matchesTargetAsset("plexy-tv-preview.apk", "tv")).toBe(true);
  expect(matchesTargetAsset("Plexy-TV-1.0.1-build.29.apk", "mobile")).toBe(false);
  expect(matchesTargetAsset("Plexy-mobile-1.0.1-build.29.apk", "tv")).toBe(false);
});

test("installed release is never offered again; older and unknown builds are skipped", () => {
  expect(selectUpdate([release("build.28"), release("build.26"), release("latest")], "mobile", 28)).toBeNull();
});

test("selects highest newer mobile build independently of API ordering and TV releases", () => {
  expect(
    selectUpdate(
      [
        release("build.29"),
        release("build.35", "Plexy-TV-1.0.1-build.35.apk"),
        release("build.31"),
      ],
      "mobile",
      28,
    )?.buildNumber,
  ).toBe(31);
});

test("still selects legacy-preview releases for users upgrading from old builds", () => {
  expect(
    selectUpdate([release("build.32", "plexy-mobile-preview.apk")], "mobile", 31)?.apkName,
  ).toBe("plexy-mobile-preview.apk");
});
