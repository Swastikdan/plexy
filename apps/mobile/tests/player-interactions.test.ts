import { expect,test } from "bun:test";
import {
clampZoom,
doubleTapSeek,
pinchZoom,
SEEK_SECONDS,
} from "@/features/player/lib/player-interactions";

test("double taps seek 30 seconds on their own side of the video", () => {
  expect(SEEK_SECONDS).toBe(30);
  expect(
    doubleTapSeek({ side: "left", time: 1000 }, { side: "left", time: 1200 }),
  ).toBe(-30);
  expect(
    doubleTapSeek({ side: "right", time: 1000 }, { side: "right", time: 1200 }),
  ).toBe(30);
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

test("custom player controls stay enabled and native controls stay off", async () => {
  const ts = await import("typescript");
  const source = await Bun.file(
    new URL("../src/features/player/playback-screen.tsx", import.meta.url),
  ).text();
  const file = ts.createSourceFile(
    "playback-screen.tsx",
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX,
  );
  let videoViews = 0;
  let customControls = 0;
  const visit = (node: import("typescript").Node) => {
    if (ts.isJsxSelfClosingElement(node) || ts.isJsxOpeningElement(node)) {
      const tag = node.tagName.getText(file);
      const attributes = node.attributes.properties.filter(ts.isJsxAttribute);
      if (tag === "VideoView") {
        videoViews++;
        const controls = attributes.find(
          (attribute) => attribute.name.getText(file) === "nativeControls",
        );
        expect(
          controls?.initializer &&
            ts.isJsxExpression(controls.initializer) &&
            controls.initializer.expression?.kind,
        ).toBe(ts.SyntaxKind.FalseKeyword);
      }
      if (tag === "PlayerControl") {
        customControls++;
        const disabled = attributes.find(
          (attribute) => attribute.name.getText(file) === "disabled",
        );
        expect(disabled).toBeUndefined();
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(file);
  expect(videoViews).toBe(1);
  expect(customControls).toBeGreaterThan(0);
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
