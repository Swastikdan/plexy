import { mkdir, stat, readdir } from 'node:fs/promises';
import { resolve } from 'node:path';
const root = resolve(import.meta.dir, '..');
const target = process.argv[2];
if (!['macos', 'android'].includes(target || '')) throw new Error('Use build.ts macos|android');
const run = (args: string[]) => {
  const result = Bun.spawnSync(args, { cwd: root, env: process.env, stdout: 'inherit', stderr: 'inherit' });
  if (result.exitCode) throw new Error(`Build failed: ${args[0]} (${result.exitCode})`);
};
if (target === 'macos') run(['bun', 'tools/install-ffmpeg.ts']);
run(['bun', 'exact.mjs', target === 'macos' ? 'mac' : 'android', ...(target === 'macos' ? ['--bundle'] : [])]);
await mkdir(resolve(root, 'dist'), { recursive: true });
async function find(directory: string, name: string): Promise<string[]> {
  const result: string[] = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = resolve(directory, entry.name);
    if (entry.name === name) result.push(path);
    else if (entry.isDirectory()) result.push(...await find(path, name));
  }
  return result;
}
const candidates = await find(resolve(root, 'target'), target === 'macos' ? 'Plexy.app' : 'app-release.apk');
const sorted = await Promise.all(candidates.map(async path => ({ path, mtime: (await stat(path)).mtimeMs })));
sorted.sort((a, b) => b.mtime - a.mtime);
if (!sorted[0]) throw new Error('Native build did not produce an artifact');
if (target === 'macos') run(['ditto', '-c', '-k', '--sequesterRsrc', '--keepParent', sorted[0].path, resolve(root, 'dist/plexy-exact-macos.zip')]);
else {
  run(['bun', 'tools/check-apk.ts', sorted[0].path]);
  await Bun.write(resolve(root, 'dist/plexy-exact-android.apk'), Bun.file(sorted[0].path));
}
