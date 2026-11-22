import { expect, test } from "bun:test";
import {
  clampZoom,
  doubleTapSeek,
  pinchZoom,
  seekLanded,
  SEEK_LANDED_TOLERANCE_SECONDS,
  SEEK_SECONDS,
} from "@/features/player/lib/player-interactions";

test("double taps resolve one seek step on their own side of the video", () => {
  expect(SEEK_SECONDS).toBe(10);
  expect(
    doubleTapSeek({ side: "left", time: 1000 }, { side: "left", time: 1200 }),
  ).toBe(-10);
  expect(
    doubleTapSeek({ side: "right", time: 1000 }, { side: "right", time: 1200 }),
  ).toBe(10);
  expect(
    doubleTapSeek({ side: "left", time: 1200 }, { side: "left", time: 1000 }),
  ).toBeNull();
  expect(
    doubleTapSeek({ side: "right", time: 1000 }, { side: "right", time: 1300 }),
  ).toBe(10);
  expect(doubleTapSeek(null, { side: "right", time: 1000 })).toBeNull();
  expect(
    doubleTapSeek({ side: "left", time: 1000 }, { side: "right", time: 1200 }),
  ).toBeNull();
  expect(
    doubleTapSeek({ side: "right", time: 1000 }, { side: "right", time: 1400 }),
  ).toBeNull();
});
test("a new pinch starts from the viewer's current manual zoom and stays within bounds", () => {
  expect(pinchZoom(1.5, 100, 120)).toBe(1.8);
  expect(pinchZoom(1.8, 100, 110)).toBe(1.98);
  expect(pinchZoom(1.5, 0, 100)).toBe(1.5);
  expect(clampZoom(0.2)).toBe(0.75);
  expect(clampZoom(4)).toBe(3);
  expect(clampZoom(1.05 + 0.05)).toBe(1.1);
});

test("seek checks accept keyframe snapping but detect a restart from zero", () => {
  expect(SEEK_LANDED_TOLERANCE_SECONDS).toBe(5);
  expect(seekLanded(1200, 1202)).toBe(true);
  expect(seekLanded(1200, 1197)).toBe(true);
  // An unseekable file snaps back to its first frame instead.
  expect(seekLanded(1200, 0)).toBe(false);
  expect(seekLanded(1200, 600)).toBe(false);
});

test("only the initial open uses a blocking spinner; seeking keeps controls", async () => {
  const { shouldShowPlayerLoading } =
    await import("@/features/player/lib/player-interactions");
  expect(shouldShowPlayerLoading("loading", false, false)).toBe(true);
  expect(shouldShowPlayerLoading("loading", true, false)).toBe(false);
  expect(shouldShowPlayerLoading("loading", true, true)).toBe(false);
  expect(shouldShowPlayerLoading("loading", false, true)).toBe(false);
  expect(shouldShowPlayerLoading("readyToPlay", true, false)).toBe(false);
});


test("both seek directions honor every available interval", () => {
  for (const seconds of [5, 10, 15, 30, 60]) {
    expect(doubleTapSeek({ side: "right", time: 0 }, { side: "right", time: 100 }, seconds)).toBe(seconds);
    expect(doubleTapSeek({ side: "left", time: 0 }, { side: "left", time: 100 }, seconds)).toBe(-seconds);
  }
});
