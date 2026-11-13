import { expect, test } from "bun:test";
import { createPlayerTapController } from "@/features/player/lib/player-taps";

function player(visible = true) {
  let now = 1000;
  let nextId = 0;
  let toggles = 0;
  const seeks: number[] = [];
  const timers = new Map<number, { at: number; callback: () => void }>();
  const controller = createPlayerTapController({
    toggleControls: () => { visible = !visible; toggles++; },
    seekBy: (seconds) => seeks.push(seconds),
    schedule: (callback, delay) => {
      const id = ++nextId;
      timers.set(id, { at: now + delay, callback });
      return id;
    },
    cancel: (timer) => { timers.delete(timer as number); },
  });
  return {
    controller, seeks,
    get visible() { return visible; },
    get toggles() { return toggles; },
    tap: (side: "left" | "right") => controller.tap({ time: now, side }, visible),
    advance(ms: number) {
      now += ms;
      for (const [id, timer] of [...timers]) {
        if (timer.at <= now) { timers.delete(id); timer.callback(); }
      }
    },
  };
}

test("a tap reveals hidden controls immediately, then a later tap reliably hides them", () => {
  const p = player(false);
  p.tap("left");
  expect(p.visible).toBe(true);
  p.advance(350);
  expect(p.toggles).toBe(1);
  p.tap("right");
  p.advance(350);
  expect(p.visible).toBe(false);
  p.tap("left");
  expect(p.visible).toBe(true);
});

test("double taps seek without a delayed controls toggle, whether initially shown or hidden", () => {
  for (const visible of [true, false]) {
    const p = player(visible);
    p.tap("right");
    p.advance(100);
    p.tap("right");
    p.advance(500);
    expect(p.seeks).toEqual([30]);
    expect(p.visible).toBe(true);
    expect(p.toggles).toBe(visible ? 0 : 1);
  }
});

test("opposite-side taps preserve both single taps instead of discarding the first", () => {
  const p = player();
  p.tap("left");
  p.advance(100);
  p.tap("right");
  expect(p.toggles).toBe(1);
  p.advance(350);
  expect(p.toggles).toBe(2);
  expect(p.seeks).toEqual([]);
});

test("opening a modal or starting a gesture cancels pending taps and double-tap history", () => {
  const p = player();
  p.tap("left");
  p.advance(100);
  p.controller.reset();
  p.advance(400);
  expect(p.toggles).toBe(0);
  p.tap("left");
  p.advance(350);
  expect(p.seeks).toEqual([]);
  expect(p.visible).toBe(false);
});


test("each additional tap in a seek burst advances again without toggling controls", () => {
  const p = player();
  p.tap("right");
  for (let i = 0; i < 5; i++) { p.advance(100); p.tap("right"); }
  expect(p.seeks).toEqual([30, 30, 30, 30, 30]);
  expect(p.toggles).toBe(0);
  p.advance(350);
  p.tap("left");
  p.advance(100);
  p.tap("left");
  expect(p.seeks.at(-1)).toBe(-30);
});
