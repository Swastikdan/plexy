export interface Update { tag: string; url: string; name: string; checksumUrl: string; message: string }
const repository = 'Swastikdan/plexy';
const allowed = new Set(['plexy-exact-macos.zip', 'plexy-exact-android.apk']);
export function releaseAssetURL(url: string): boolean {
  const parsed = new URL(url);
  return parsed.protocol === 'https:' && parsed.hostname === 'github.com'
    && parsed.pathname.startsWith(`/${repository}/releases/download/`);
}
export async function checkUpdate(platform: string): Promise<Update> {
  const response = await fetch(`https://api.github.com/repos/${repository}/releases?per_page=30`, { headers: { Accept: 'application/vnd.github+json' }, signal: AbortSignal.timeout(15000) });
  if (!response.ok) throw new Error(`GitHub updates: ${response.status}`);
  const name = platform === 'macos' ? 'plexy-exact-macos.zip' : 'plexy-exact-android.apk';
  const releases = await response.json();
  for (const release of releases) {
    if (release.draft) continue;
    const asset = release.assets.find((a: any) => a.name === name);
    const checksum = release.assets.find((a: any) => a.name === 'SHA256SUMS');
    if (asset && checksum && releaseAssetURL(asset.browser_download_url) && releaseAssetURL(checksum.browser_download_url))
      return { tag: release.tag_name, name, url: asset.browser_download_url, checksumUrl: checksum.browser_download_url, message: `Available build: ${release.tag_name}` };
  }
  return { tag: '', name: '', url: '', checksumUrl: '', message: 'No Exact build has been published yet.' };
}
export async function downloadUpdate(update: Update, fs: {
  atomicWriteFile(path: string, bytes: Uint8Array): Promise<void>;
  digest(path: string, algorithm: 'SHA-256'): Promise<string>;
  rm(path: string): Promise<void>;
}) {
  if (!allowed.has(update.name) || !releaseAssetURL(update.url) || !releaseAssetURL(update.checksumUrl)) throw new Error('Invalid Exact release');
  const sums = await fetch(update.checksumUrl, { signal: AbortSignal.timeout(15000) });
  if (!sums.ok) throw new Error('Cannot retrieve update checksums');
  const line = (await sums.text()).split('\n').map(l => l.trim().split(/\s+/)).find(parts => parts[1]?.replace(/^\*/, '') === update.name);
  if (!line || !/^[0-9a-f]{64}$/i.test(line[0]!)) throw new Error('Update checksum is missing');
  const response = await fetch(update.url, { signal: AbortSignal.timeout(180000) });
  if (!response.ok) throw new Error(`Update download: ${response.status}`);
  const path = `app:/data/${update.name}`;
  await fs.atomicWriteFile(path, new Uint8Array(await response.arrayBuffer()));
  if ((await fs.digest(path, 'SHA-256')).toLowerCase() !== line[0]!.toLowerCase()) {
    await fs.rm(path); throw new Error('Update checksum mismatch; download removed');
  }
  return path;
}
