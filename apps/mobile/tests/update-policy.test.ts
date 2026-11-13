import { expect,test } from "bun:test";
import type { GitHubRelease } from "@/features/settings/lib/app-updater";
import {
matchesTargetAsset,
selectUpdate,
} from "@/features/settings/lib/update-policy";

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
  assets: [
    {
      name: asset,
      size: 100,
      browser_download_url: "https://example.com/app.apk",
    },
  ],
});

test("versioned and legacy preview asset names match their platform", () => {
  expect(
    matchesTargetAsset("Plexy-mobile-1.0.1-beta.3-build.29.apk", "mobile"),
  ).toBe(true);
  expect(matchesTargetAsset("plexy-mobile-preview.apk", "mobile")).toBe(true);
  expect(matchesTargetAsset("Plexy-TV-1.0.1-build.29.apk", "mobile")).toBe(
    false,
  );
});

test("installed release is never offered again; older and unknown builds are skipped", () => {
  expect(
    selectUpdate(
      [release("build.28"), release("build.26"), release("latest")],
      "mobile",
      28,
    ),
  ).toBeNull();
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
    selectUpdate(
      [release("build.32", "plexy-mobile-preview.apk")],
      "mobile",
      31,
    )?.apkName,
  ).toBe("plexy-mobile-preview.apk");
});

test("detects 2000+ build number when upgrading from 1001 preview build", () => {
  const update = selectUpdate(
    [
      {
        id: 1,
        tag_name: "v1.0.2-build.2032",
        name: "Plexy v1.0.2-build.2032",
        body: "",
        published_at: "",
        prerelease: false,
        assets: [
          {
            name: "Plexy-mobile-v1.0.2-Android.apk",
            size: 100,
            browser_download_url: "https://example.com/app.apk",
          },
        ],
      },
    ],
    "mobile",
    1001,
  );
  expect(update).not.toBeNull();
  expect(update?.buildNumber).toBe(2032);
});

test("detects newer version when installed version is older semver", () => {
  const update = selectUpdate(
    [
      {
        id: 1,
        tag_name: "v1.0.2-build.31",
        name: "Plexy v1.0.2-build.31",
        body: "",
        published_at: "",
        prerelease: false,
        assets: [
          {
            name: "Plexy-mobile-v1.0.2-Android.apk",
            size: 100,
            browser_download_url: "https://example.com/app.apk",
          },
        ],
      },
    ],
    "mobile",
    1001,
    "1.0.1-beta.4",
  );
  expect(update).not.toBeNull();
  expect(update?.tagName).toBe("v1.0.2-build.31");
});


test("installed Android versions retain current and legacy update comparisons", async () => {
  const { encodeVersionCode, decodeVersionCode } = await import("@/shared/lib/build-version");
  expect(decodeVersionCode(1001)).toBe(1001);
  expect(decodeVersionCode(52032)).toBe(2032);
  expect(encodeVersionCode(2033)).toBe(52033);
  expect(selectUpdate([release("build.2033")], "mobile", decodeVersionCode(52032))?.buildNumber).toBe(2033);
  expect(selectUpdate([release("build.2032")], "mobile", decodeVersionCode(52032))).toBeNull();
});

const mobileRelease = (version: string, build: number): GitHubRelease => ({
  ...release(`build.${build}`, `Plexy-mobile-v${version}-Android.apk`),
  tag_name: `v${version}-build.${build}`,
});

test("1.0.5 discovers 1.0.6 and the shipped 1.0.6 build-only checker discovers 1.0.7", () => {
  expect(selectUpdate([mobileRelease("1.0.6", 2045)], "mobile", 2044, "1.0.5")?.tagName)
    .toBe("v1.0.6-build.2045");
  // 1.0.6 passes only its decoded Android build, without a version name.
  expect(selectUpdate([mobileRelease("1.0.7", 2046)], "mobile", 2045, "")?.tagName)
    .toBe("v1.0.7-build.2046");
  expect(selectUpdate([mobileRelease("1.0.8", 2047)], "mobile", 2046, "1.0.7")?.tagName)
    .toBe("v1.0.8-build.2047");
});

test("release version order wins over API ordering and older high-build versions", () => {
  const versions = [mobileRelease("1.0.5", 9000), mobileRelease("1.0.7", 2046), mobileRelease("1.0.6", 2048)];
  expect(selectUpdate(versions, "mobile", 2045, "1.0.6")?.tagName).toBe("v1.0.7-build.2046");
  expect(selectUpdate([mobileRelease("1.0.5", 9000)], "mobile", 2045, "1.0.6")).toBeNull();
});

test("drafts and incomplete APK releases cannot be offered as updates", () => {
  const draft = { ...mobileRelease("1.0.7", 2046), draft: true };
  const empty = mobileRelease("1.0.7", 2047);
  empty.assets[0]!.size = 0;
  expect(selectUpdate([draft, empty], "mobile", 2045, "1.0.6")).toBeNull();
});
