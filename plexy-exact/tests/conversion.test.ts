import { describe, expect, test } from 'bun:test';
import { buildFfmpegArgs, commitConversion, planConversion, requiredSpace, verifyOutput, type Probe } from '../lib/conversion';
const input: Probe = { duration: 30, size: 1000, streams: [
  { index: 0, kind: 'video', codec: 'h264', pixelFormat: 'yuv420p' },
  { index: 1, kind: 'audio', codec: 'aac' }, { index: 2, kind: 'audio', codec: 'dts' },
  { index: 3, kind: 'subtitle', codec: 'ass' }, { index: 4, kind: 'subtitle', codec: 'hdmv_pgs_subtitle' },
] };
const plan = planConversion(input);
const output: Probe = { ...input, streams: input.streams.slice(0, 4).map(s => s.index === 2 ? { ...s, codec: 'aac' } : s) };
test('preserves every audio track, converts unsupported audio, omits image subtitles', () => {
  expect(plan.audio).toEqual([{ index: 1, codec: 'copy' }, { index: 2, codec: 'aac' }]);
  expect(plan.subtitles).toEqual([3]);
  expect(requiredSpace(input, plan)).toBe(2 * 1024 ** 3);
  const args = buildFfmpegArgs(plan, '/media/a $(touch nope).mkv', '/media/a.partial');
  expect(args).toContain('/media/a $(touch nope).mkv');
  expect(args).toContain('-n');
  expect(args.slice(-3)).toEqual(['-f', 'mp4', '/media/a.partial']);
});
test('HEVC uses the Apple-compatible hvc1 tag', () => {
  const p = planConversion({ ...input, streams: [{ index: 0, kind: 'video', codec: 'hevc', pixelFormat: 'yuv420p10le' }] });
  expect(p.video).toBe('copy'); expect(p.videoTag).toBe('hvc1');
});
test('HDR is tone mapped and unknown H264 profiles transcode', () => {
  expect(planConversion({ ...input, streams: [{ ...input.streams[0]!, hdr: true }] }).toneMap).toBe(true);
  expect(planConversion({ ...input, streams: [{ ...input.streams[0]!, pixelFormat: 'yuv444p' }] }).video).toBe('h264');
});
test('truncation, missing tracks, invalid duration and empty output fail verification', () => {
  for (const bad of [{ ...output, duration: 2 }, { ...output, size: 0 }, { ...output, duration: NaN }, { ...output, streams: output.streams.slice(0, 2) }]) {
    expect(() => verifyOutput(input, bad, plan)).toThrow();
  }
});
describe('source deletion safety', () => {
  for (const failure of ['probe', 'publish', 'catalog', 'none']) test(`failure at ${failure}`, async () => {
    const events: string[] = [];
    async function step(name: string) { events.push(name); if (failure === name) throw new Error(name); }
    const operation = commitConversion({
      async probe() { await step('probe'); return output; },
      async publishExclusive() { await step('publish'); },
      async commitCatalog() { await step('catalog'); },
      async deleteSource() { await step('delete'); },
    }, input, plan, 'source', 'partial', 'destination', true);
    if (failure === 'none') { await operation; expect(events).toEqual(['probe', 'publish', 'catalog', 'delete']); }
    else { await expect(operation).rejects.toThrow(); expect(events).not.toContain('delete'); }
  });
});
