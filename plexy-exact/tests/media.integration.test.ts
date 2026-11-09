import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { expect, test } from 'bun:test';
import { buildFfmpegArgs, planConversion, verifyOutput } from '../lib/conversion';
import { readProbe } from '../lib/probe';
const tools = resolve(import.meta.dir, '../tools');
const ffmpeg = `${tools}/ffmpeg/bin/ffmpeg`;
const ffprobe = `${tools}/ffmpeg/bin/ffprobe`;
const fixture = `${tools}/fixtures/multi-audio.mkv`;
test.skipIf(!existsSync(fixture) || !existsSync(ffprobe))('real multi-audio MKV remux verifies with ffprobe', async () => {
  function probe(path: string) {
    const result = Bun.spawnSync([ffprobe, '-v', 'error', '-show_format', '-show_streams', '-of', 'json', path]);
    expect(result.exitCode).toBe(0); return readProbe(result.stdout.toString());
  }
  const input = probe(fixture); const plan = planConversion(input);
  const outputPath = `${tools}/fixtures/verified-${crypto.randomUUID()}.mp4`;
  const result = Bun.spawnSync([ffmpeg, ...buildFfmpegArgs(plan, fixture, outputPath)]);
  expect(result.exitCode).toBe(0);
  const output = probe(outputPath);
  verifyOutput(input, output, plan);
  expect(output.streams.filter(s => s.kind === 'audio')).toHaveLength(2);
  expect(output.streams.find(s => s.kind === 'video')?.codec).toBe('h264');
  await Bun.file(outputPath).delete();
});
