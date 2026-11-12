import { expect,test } from "bun:test";
import {
ProgressQueue,
type Progress,
} from "@/core/client/progress-queue";
import { parseVtt,subtitleText } from "@/features/player/lib/subtitles";

test("a write arriving during a local progress flush is never lost", async () => {
  let stored: Progress[] = [];
  const queue = new ProgressQueue({
    load: async () => stored,
    save: async (values) => {
      stored = values;
    },
  });
  await queue.restore();
  await queue.record({ itemId: 1, position: 30, played: false, updatedAt: 1 });
  let release!: () => void;
  const blocked = new Promise<void>((resolve) => {
    release = resolve;
  });
  const first = queue.flush({ progress: async () => blocked } as never);
  await queue.record({ itemId: 1, position: 10, played: false, updatedAt: 2 });
  release();
  await first;
  expect(queue.latest(1)?.position).toBe(10);
  const writes: number[] = [];
  await queue.flush({
    progress: async (_id: number, position: number) => {
      writes.push(position);
    },
  } as never);
  expect(writes).toEqual([10]);
  expect(stored[0]?.synced).toBe(true);
});
test("imported SRT/VTT subtitles support timestamps, offsets and markup", () => {
  const cues = parseVtt(
    "1\n00:00:01,000 --> 00:00:03,000\n<b>Hello</b>\n\n2\n00:00:04.000 --> 00:00:05.000\nWorld",
  );
  expect(cues).toHaveLength(2);
  expect(subtitleText(cues, 2, 0)).toBe("Hello");
  expect(subtitleText(cues, 0, 0)).toBe("");
});
