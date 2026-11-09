// Inspect every packaged native ELF rather than relying on a supplier's alignment claim.
import { resolve } from 'node:path';
const apk = process.argv[2];
if (!apk) throw new Error('Use check-apk.ts <APK>');
const listing = Bun.spawnSync(['unzip', '-Z1', resolve(apk)]);
if (listing.exitCode) throw new Error('Cannot read APK');
const libraries = listing.stdout.toString().split('\n').filter(name => name.startsWith('lib/arm64-v8a/') && name.endsWith('.so'));
if (!libraries.length) throw new Error('APK has no arm64 native libraries');
for (const name of libraries) {
  const extracted = Bun.spawnSync(['unzip', '-p', resolve(apk), name], { maxBuffer: 256 * 1024 * 1024 });
  if (extracted.exitCode) throw new Error(`Cannot inspect ${name}`);
  const b = extracted.stdout;
  const view = new DataView(b.buffer, b.byteOffset, b.byteLength);
  if (view.getUint32(0, true) !== 0x464c457f || view.getUint8(4) !== 2 || view.getUint8(5) !== 1) throw new Error(`Unsupported ELF: ${name}`);
  const table = Number(view.getBigUint64(32, true));
  const entrySize = view.getUint16(54, true), count = view.getUint16(56, true);
  for (let i = 0; i < count; i++) {
    const entry = table + i * entrySize;
    if (view.getUint32(entry, true) === 1 && view.getBigUint64(entry + 48, true) < 16384n) throw new Error(`${name}: LOAD segment is not 16 KB aligned`);
  }
}
console.log(`Verified 16 KB ELF alignment for ${libraries.length} arm64 libraries`);
