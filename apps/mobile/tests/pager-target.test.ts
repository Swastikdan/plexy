import { expect, test } from "bun:test";
import { pagerTarget } from "@/shared/lib/pager-target";

test("a short flick changes page while a small slow drag snaps back", () => {
  expect(pagerTarget(-400, -12, -500, 400, 4)).toBe(2);
  expect(pagerTarget(-400, -12, -30, 400, 4)).toBe(1);
});

test("reversing a drag before release follows the flick, not the accumulated distance", () => {
  expect(pagerTarget(-400, -140, 600, 400, 4)).toBe(0);
  expect(pagerTarget(-400, 140, -600, 400, 4)).toBe(2);
});

test("slow deliberate drags use distance and stay within one adjacent page", () => {
  expect(pagerTarget(-400, -110, -40, 400, 4)).toBe(2);
  expect(pagerTarget(-400, 110, 40, 400, 4)).toBe(0);
  expect(pagerTarget(-400, -1200, -3000, 400, 5)).toBe(2);
});

test("edges, interrupted settles, and unavailable layout remain bounded", () => {
  expect(pagerTarget(0, 150, 500, 400, 4)).toBe(0);
  expect(pagerTarget(-1200, -150, -500, 400, 4)).toBe(3);
  expect(pagerTarget(-650, 15, 500, 400, 4)).toBe(1);
  expect(pagerTarget(0, -100, -500, 0, 4)).toBe(0);
  expect(pagerTarget(0, -100, -500, 400, 0)).toBe(0);
});
