import { expect, test } from "bun:test";
import { isAndroidBundleCurrent, needsMobileApk, otaMessage, readMobileDeliveryState } from "./mobile-delivery-state";

const baseline = {
  nativeFingerprint: "a".repeat(64),
  runtimeVersion: `android-${"b".repeat(64)}`,
  bundleHash: "c".repeat(64),
  policyHash: "d".repeat(64),
};

test("Android needs a new APK for bootstrap, native changes, and APK policy changes", () => {
  expect(readMobileDeliveryState(undefined)).toBeUndefined();
  expect(readMobileDeliveryState(baseline)).toEqual(baseline);
  expect(() => readMobileDeliveryState({ ...baseline, runtimeVersion: "wrong" })).toThrow();
  expect(needsMobileApk(undefined, baseline)).toBe(true);
  expect(needsMobileApk(baseline, baseline)).toBe(false);
  expect(needsMobileApk(baseline, { ...baseline, nativeFingerprint: "e".repeat(64) })).toBe(true);
  expect(needsMobileApk(baseline, { ...baseline, policyHash: "e".repeat(64) })).toBe(true);
});

test("Android publishes a new bundle once and can publish a deliberate revert", () => {
  const candidate = "e".repeat(64);
  const published = { message: `"${otaMessage(candidate)}" (just now by plexy)`, isRollBackToEmbedded: false };
  const rollback = { message: "Roll back", isRollBackToEmbedded: true };
  expect(isAndroidBundleCurrent(baseline.bundleHash, baseline.bundleHash, [])).toBe(true);
  expect(isAndroidBundleCurrent(candidate, baseline.bundleHash, [])).toBe(false);
  expect(isAndroidBundleCurrent(candidate, baseline.bundleHash, [published])).toBe(true);
  expect(isAndroidBundleCurrent(baseline.bundleHash, baseline.bundleHash, [published])).toBe(false);
  expect(isAndroidBundleCurrent(candidate, baseline.bundleHash, [rollback, published])).toBe(true);
  expect(isAndroidBundleCurrent(baseline.bundleHash, baseline.bundleHash, [rollback, published])).toBe(true);
});
