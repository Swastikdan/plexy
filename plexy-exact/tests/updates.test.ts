import { expect, test } from 'bun:test';
import { downloadUpdate, releaseAssetURL, type Update } from '../lib/updates';
const base = 'https://github.com/Swastikdan/plexy/releases/download/exact-build.1/';
const update: Update = { tag: 'exact-build.1', name: 'plexy-exact-android.apk', url: base + 'plexy-exact-android.apk', checksumUrl: base + 'SHA256SUMS', message: '' };
test('updates only accept release URLs for this repository', () => {
  expect(releaseAssetURL(update.url)).toBe(true);
  for (const url of ['https://evil.test/plexy.apk', 'http://github.com/Swastikdan/plexy/releases/download/a/a.apk', 'https://github.com/another/repo/releases/download/a/a.apk']) expect(releaseAssetURL(url)).toBe(false);
});
test('mismatched update checksum removes the downloaded file', async () => {
  const original = globalThis.fetch;
  const saved: string[] = []; const removed: string[] = [];
  globalThis.fetch = (async (url: string | URL | Request) => new Response(String(url).endsWith('SHA256SUMS') ? `${'a'.repeat(64)}  ${update.name}` : 'binary')) as typeof fetch;
  try {
    await expect(downloadUpdate(update, {
      async atomicWriteFile(path) { saved.push(path); }, async digest() { return 'b'.repeat(64); }, async rm(path) { removed.push(path); },
    })).rejects.toThrow('checksum mismatch');
    expect(removed).toEqual(saved); expect(saved).toHaveLength(1);
  } finally { globalThis.fetch = original; }
});
test('legacy app filenames never become Exact updates', async () => {
  await expect(downloadUpdate({ ...update, name: 'plexy-mobile-preview.apk' }, { async atomicWriteFile() {}, async digest() { return ''; }, async rm() {} })).rejects.toThrow('Invalid Exact release');
});
