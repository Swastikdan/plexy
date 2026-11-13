import { expect, test } from "bun:test";
import { isCompleteApk, validateApkDownload } from "../src/features/settings/lib/update-package";

test("only a complete release asset can be reused for installation", () => {
  expect(isCompleteApk(1000, 1000)).toBe(true);
  for (const size of [undefined, 0, 1, 999, 1001])
    expect(isCompleteApk(size, 1000)).toBe(false);
  expect(isCompleteApk(1000, 0)).toBe(false);
});

test("failed responses and truncated downloads never reach the Android installer", () => {
  expect(() => validateApkDownload(200, 1000, 1000)).not.toThrow();
  expect(() => validateApkDownload(404, 1000, 1000)).toThrow("HTTP 404");
  expect(() => validateApkDownload(undefined, 1000, 1000)).toThrow("failed");
  expect(() => validateApkDownload(200, 999, 1000)).toThrow("incomplete");
  expect(() => validateApkDownload(200, 0, 1000)).toThrow("incomplete");
});
