import { expect, test } from "bun:test";
import {
  normalizeProgress,
  ProgressQueue,
  type Progress,
} from "@/core/client/progress-queue";

const base = (patch: Partial<Progress> = {}): Progress => ({
  itemId: 1,
  position: 30,
  duration: 600,
  played: false,
  updatedAt: 1,
  ...patch,
});

test("progress is clamped to a usable position and duration", () => {
  expect(normalizeProgress(base({ position: -12 })).position).toBe(0);
  expect(normalizeProgress(base({ position: 900 })).position).toBe(600);
  expect(normalizeProgress(base({ position: 120, duration: 0 })).duration).toBe(
    undefined,
  );
  expect(normalizeProgress(base({ position: Number.NaN })).position).toBe(0);
  expect(normalizeProgress(base({ position: 590, played: false })).played).toBe(
    true,
  );
});

test("playback ticks coalesce into one device write", async () => {
  let stored: Progress[] = [];
  let writes = 0;
  const queue = new ProgressQueue(
    {
      load: async () => [],
      save: async (values) => {
        writes += 1;
        stored = values;
      },
    },
    { persistDelayMs: 25, maxPersistDelayMs: 80 },
  );
  await queue.record(base({ position: 10 }));
  await queue.record(base({ position: 20 }));
  await queue.record(base({ position: 30 }));
  expect(writes).toBe(0);
  expect(queue.latest(1)?.position).toBe(30);
  await new Promise((resolve) => setTimeout(resolve, 50));
  expect(writes).toBe(1);
  expect(stored[0]?.position).toBe(30);
});

test("a long playback run still reaches disk at the max delay", async () => {
  let writes = 0;
  const queue = new ProgressQueue(
    {
      load: async () => [],
      save: async () => {
        writes += 1;
      },
    },
    { persistDelayMs: 50, maxPersistDelayMs: 90 },
  );
  const ticker = setInterval(() => {
    void queue.record(base({ updatedAt: Date.now() }));
  }, 10);
  await new Promise((resolve) => setTimeout(resolve, 140));
  clearInterval(ticker);
  expect(writes).toBeGreaterThanOrEqual(1);
  await queue.flushLocal();
});

test("flushLocal persists immediately and forget removes the record", async () => {
  let stored: Progress[] = [];
  const queue = new ProgressQueue(
    {
      load: async () => [],
      save: async (values) => {
        stored = values;
      },
    },
    { persistDelayMs: 10_000, maxPersistDelayMs: 10_000 },
  );
  await queue.record(base());
  expect(stored).toEqual([]);
  await queue.flushLocal();
  expect(stored[0]?.itemId).toBe(1);
  await queue.forget(1);
  expect(queue.latest(1)).toBeUndefined();
  expect(stored).toEqual([]);
});

test("concurrent flushes share one network pass", async () => {
  let calls = 0;
  let release!: () => void;
  const blocked = new Promise<void>((resolve) => {
    release = resolve;
  });
  const queue = new ProgressQueue(
    { load: async () => [], save: async () => {} },
    { persistDelayMs: 0, maxPersistDelayMs: 0 },
  );
  await queue.record(base());
  const api = {
    progress: async () => {
      calls += 1;
      await blocked;
      return { ok: true };
    },
  } as never;
  const first = queue.flush(api);
  const second = queue.flush(api);
  expect(second).toBe(first);
  release();
  await first;
  expect(calls).toBe(1);
});
