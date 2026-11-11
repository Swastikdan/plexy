import { expect, test } from "bun:test";
import {
  checksumForAsset,
  compareReleaseTags,
  desktopUpdateAssets,
  selectDesktopRelease,
  type Release,
} from "../src/main/release-policy";
const digest = "a".repeat(64);
function release(tag: string, names: string[], withDigest = false): Release {
  return {
    tag_name: tag,
    assets: names.map((name) => ({
      name,
      browser_download_url: `https://example.com/${encodeURIComponent(name)}`,
      digest: withDigest ? `sha256:${digest}` : undefined,
    })),
  };
}
test("the actual 2036 version mismatch is rejected and matching desktop packages are selected", () => {
  const broken = release("v1.0.5-build.2036", [
    "Plexy.Beta-1.0.2-arm64.zip",
    "SHA256SUMS",
  ]);
  const fixed = release("v1.0.5-build.2037", [
    "Plexy.Beta-1.0.5-arm64.zip",
    "SHA256SUMS",
  ]);
  expect(desktopUpdateAssets(broken).verified).toBe(false);
  expect(selectDesktopRelease([broken, fixed])).toBe(fixed);
});
test("newer mobile-only releases cannot mask the latest desktop update", () => {
  const desktop = release("v1.0.5-build.2037", [
    "Plexy.Beta-1.0.5-arm64.zip",
    "SHA256SUMS",
  ]);
  const mobile = release("v1.0.6-build.2038", [
    "Plexy-mobile-v1.0.6-Android.apk",
    "SHA256SUMS",
  ]);
  expect(selectDesktopRelease([mobile, desktop])).toBe(desktop);
  expect(selectDesktopRelease([{ ...desktop, draft: true }])).toBeNull();
});
test("requires an integrity source and accepts GitHub's asset digest", () => {
  expect(
    selectDesktopRelease([
      release("v1.0.5-build.2037", ["Plexy.Beta-1.0.5-arm64.zip"]),
    ]),
  ).toBeNull();
  const signed = release(
    "v1.0.5-build.2037",
    ["Plexy.Beta-1.0.5-arm64.zip"],
    true,
  );
  expect(selectDesktopRelease([signed])).toBe(signed);
});
test("checksum lookup handles local spaces and uploaded dots without using another asset's checksum", () => {
  const sums = `${digest}  Plexy Beta-1.0.5-arm64.zip\r\n${"b".repeat(64)}  Plexy-mobile-v1.0.5-Android.apk`;
  expect(checksumForAsset(sums, "Plexy.Beta-1.0.5-arm64.zip")).toBe(digest);
  expect(
    checksumForAsset(
      `${digest} *Plexy.Beta-1.0.5-arm64.zip`,
      "Plexy Beta-1.0.5-arm64.zip",
    ),
  ).toBe(digest);
  expect(checksumForAsset(sums, "Plexy.Beta-1.0.2-arm64.zip")).toBeUndefined();
});
test("stable versions and numbered builds sort correctly for old installed clients", () => {
  expect(
    compareReleaseTags("v1.0.5-build.2037", "v1.0.1-beta.3-build.26"),
  ).toBeGreaterThan(0);
  expect(
    compareReleaseTags("v1.0.5-build.2037", "v1.0.5-build.2036"),
  ).toBeGreaterThan(0);
  expect(
    compareReleaseTags("v1.0.5", "v1.0.5-beta.3-build.9999"),
  ).toBeGreaterThan(0);
});
