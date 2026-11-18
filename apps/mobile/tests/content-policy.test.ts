import { expect, test } from "bun:test";
import {
  certificationAge,
  familyAllows,
  familyCertificateList,
  familyMaxAge,
} from "@/core/content/audience";
import { isReleased, releaseLabel } from "@/core/content/release";

test("release dates hide only known future titles", () => {
  expect(isReleased("2000-01-01")).toBe(true);
  expect(isReleased(null)).toBe(true);
  expect(isReleased("")).toBe(true);
  expect(isReleased("2999-01-01")).toBe(false);
  expect(isReleased("not-a-date")).toBe(true);
  expect(releaseLabel("2026-12-18")).toBeTruthy();
});

test("certification ages cover TV and movie labels", () => {
  expect(certificationAge("TV-14")).toBe(14);
  expect(certificationAge("PG-13")).toBe(13);
  expect(certificationAge("U/A 16+")).toBe(16);
  expect(certificationAge("TV-MA")).toBe(18);
  expect(certificationAge("unknown")).toBeNull();
});

test("the teens level blocks 18+ and unrated titles", () => {
  expect(familyMaxAge("teen")).toBe(14);
  expect(familyMaxAge("little")).toBe(7);
  expect(familyAllows("TV-Y7", "little", true)).toBe(true);
  expect(familyAllows("PG", "little", true)).toBe(false);
  expect(familyAllows("PG-13", "teen", true)).toBe(true);
  expect(familyAllows("TV-14", "teen", true)).toBe(true);
  expect(familyAllows("R", "teen", true)).toBe(false);
  expect(familyAllows("NC-17", "teen", true)).toBe(false);
  expect(familyAllows("TV-MA", "teen", true)).toBe(false);
  expect(familyAllows(null, "teen", true)).toBe(false);
  expect(familyAllows(null, "teen", false)).toBe(true);
  expect(familyAllows("R", "off", true)).toBe(true);
});

test("family discover lists stay inside the selected rating", () => {
  const list = familyCertificateList("US", 14, false);
  expect(list).toContain("PG-13");
  expect(list).not.toContain("R");
  expect(familyCertificateList("US", 10, true)).not.toContain("TV-14");
});
