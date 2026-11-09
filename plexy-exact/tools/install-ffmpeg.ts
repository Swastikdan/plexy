import { mkdir, chmod } from 'node:fs/promises';
import { createHash } from 'node:crypto';
const pins = {
  ffmpeg: ['https://www.osxexperts.net/ffmpeg902arm.zip', '762f16b2913b8d3b8fdb8092df12b691053b035b13ae9b88205513c55cb8e71e'],
  ffprobe: ['https://www.osxexperts.net/ffprobe902arm.zip', 'e9d3ad989b11d1ff4e3b0d140df170a6b38f194f83ac77f0e05a127a0f3a0ae4'],
};
const directory = new URL('./ffmpeg/bin/', import.meta.url);
await mkdir(directory, { recursive: true });
for (const [name, [url, hash]] of Object.entries(pins)) {
  const target = new URL(name, directory);
  if (await Bun.file(target).exists() && createHash('sha256').update(await Bun.file(target).bytes()).digest('hex') === hash) continue;
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Download ${name}: ${response.status}`);
  const archive = new URL(`../../.build/exact-${name}.zip`, import.meta.url);
  await Bun.write(archive, await response.arrayBuffer());
  const result = Bun.spawnSync(['unzip', '-p', archive.pathname, name], { maxBuffer: 100 * 1024 * 1024 });
  if (result.exitCode || createHash('sha256').update(result.stdout).digest('hex') !== hash) throw new Error(`${name} checksum mismatch`);
  await Bun.write(target, result.stdout); await chmod(target, 0o755);
}
