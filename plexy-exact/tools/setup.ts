import { resolve } from 'node:path';
import { existsSync } from 'node:fs';
import lock from '../runtime.lock.json';

const root = resolve(import.meta.dir, '../..');
const runtime = resolve(root, '.build/exact-runtime');
function run(args: string[], cwd = root) {
  const result = Bun.spawnSync(args, { cwd, stdout: 'inherit', stderr: 'inherit' });
  if (result.exitCode !== 0) throw new Error(`${args[0]} failed (${result.exitCode})`);
}
if (!existsSync(resolve(runtime, '.git'))) {
  run(['git', 'clone', '--no-checkout', lock.repository, runtime]);
  run(['git', 'checkout', '--detach', lock.commit], runtime);
}
const head = Bun.spawnSync(['git', 'rev-parse', 'HEAD'], { cwd: runtime }).stdout.toString().trim();
if (head !== lock.commit) throw new Error(`Exact revision mismatch: ${head}; expected ${lock.commit}. Keep local changes and use a fresh pinned checkout.`);
const dirty = Bun.spawnSync(['git', 'status', '--porcelain'], { cwd: runtime }).stdout.toString().trim();
const patch = resolve(root, 'plexy-exact/patches/runtime.patch');
const expected = await Bun.file(patch).text();
if (dirty) {
  const actual = Bun.spawnSync(['git', 'diff', '--binary'], { cwd: runtime }).stdout.toString();
  if (actual !== expected || dirty.split('\n').some(line => line.startsWith('??'))) throw new Error('Exact checkout has changes beyond the reviewed runtime patch.');
} else run(['git', 'apply', patch], runtime);
if (Bun.version !== lock.bun) throw new Error(`Exact requires Bun ${lock.bun}; current version is ${Bun.version}. Run this script with the pinned Bun.`);
run(['bun', 'install', '--frozen-lockfile'], runtime);
run(['bun', resolve(runtime, 'scripts/exact.mjs'), 'new', resolve(root, 'plexy-exact'), '--update']);
