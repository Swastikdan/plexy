import type { Answer, Sources, Storage } from './app.contract.d.ts';
import { openUpdate } from '@plexy/native';
import { checkUpdate, downloadUpdate } from './lib/updates';
import { convert, cancelConversion, reconcileConversions } from './lib/conversion-runner';
import { rows } from './lib/catalog';
import { processStatus } from '@exact/child-process';
import schema from './lib/schema';
import { Catalog } from './lib/catalog';
import { matchLibrary, tmdb } from './lib/metadata';

export const grants = `
fs.read app:/data
fs.write app:/data
fs.read app:/cache
fs.write app:/cache
fs.read app:/tmp
fs.write app:/tmp
fs.read app:/data/media
fs.write app:/data/media
sqlite.open app:/data/library.db
fs.read home:/Plexy
fs.write home:/Plexy
fs.read doc:/
fs.write doc:/
doc.keep
net.fetch https://api.themoviedb.org
net.fetch https://image.tmdb.org
net.fetch https://api.github.com
net.fetch https://github.com
net.fetch https://release-assets.githubusercontent.com
secret.keep tmdb
process.spawn bundle:/Resources/ffmpeg/bin/ffmpeg
process.spawn bundle:/Resources/ffmpeg/bin/ffprobe
`;
const platform = () => processStatus().available ? 'macos' : 'android';
const root = () => platform() === 'macos' ? 'home:/Plexy' : 'app:/data/media';
const databases = new WeakMap<Storage, Promise<Catalog>>();
async function mkdir(storage: Storage, path: string) {
  try { await storage.fs.mkdir(path); } catch (e) { if ((e as { code: string }).code !== 'EEXIST') throw e; }
}
async function catalog(storage: Storage) {
  let pending = databases.get(storage);
  if (!pending) {
    pending = (async () => {
      for (const directory of ['app:/data', 'app:/cache', 'app:/cache/artwork', root(), `${root()}/Movies`, `${root()}/TV`, `${root()}/Unsorted`]) await mkdir(storage, directory);
      const library = new Catalog(await storage.sqlite.open('app:/data/library.db'));
      await library.initialize(schema);
      await reconcileConversions(library, storage);
      return library;
    })();
    databases.set(storage, pending);
    pending.catch(() => databases.delete(storage));
  }
  return pending;
}
async function reply(work: () => Promise<string>) {
  try { return { ok: true, message: await work() }; }
  catch (e) { return { ok: false, message: e instanceof Error ? e.message : String(e) }; }
}
const sources: Sources = {
  library: async (_args, _store, storage) => Promise.all((await (await catalog(storage)).cards()).map(async card => ({ ...card, playPath: platform() === 'macos' ? card.status === 'ready' ? await storage.fs.realpath(card.path).catch(() => '') : '' : card.path }))),
  titles: async ([order, kind, genre], _store, storage) => {
    const cards = await (await catalog(storage)).cards();
    const titles = cards.filter((card, index) => cards.findIndex(c => c.titleId === card.titleId) === index && (kind === 'all' || card.kind === kind) && (!genre || card.genres.split(' · ').includes(genre)));
    titles.sort((a, b) => order === 'recent' ? b.addedAt - a.addedAt : order === 'year' ? b.year - a.year : a.name.localeCompare(b.name));
    return titles.map(card => ({ ...card, playPath: '' }));
  },
  home: async (_args, _store, storage) => {
    const cards = (await (await catalog(storage)).cards()).map(card => ({ ...card, playPath: '' }));
    const titles = cards.filter((card, index) => cards.findIndex(c => c.titleId === card.titleId) === index);
    return {
      genres: [...new Set(titles.flatMap(card => card.genres ? card.genres.split(' · ') : []))].sort(),
      recent: [...titles].sort((a, b) => b.addedAt - a.addedAt).slice(0, 20),
      movies: titles.filter(card => card.kind === 'movie'), shows: titles.filter(card => card.kind === 'show'),
      continuing: cards.filter(card => card.status === 'ready' && card.position > 0 && card.duration > 0 && card.position < card.duration * .9),
    };
  },
  suggestions: async ([query], store) => {
    const token = store.get('tmdb');
    if (!token || query.trim().length < 3) return { items: [], message: '' };
    try {
      const data = await tmdb(`/search/multi?query=${encodeURIComponent(query.trim())}&include_adult=false`, token);
      return { items: data.results.filter((item: any) => item.media_type === 'movie' || item.media_type === 'tv').slice(0, 8).map((item: any) => ({
        id: String(item.id), name: String(item.title || item.name), overview: String(item.overview || ''), url: `https://www.themoviedb.org/${item.media_type}/${item.id}`,
      })), message: '' };
    } catch { return { items: [], message: 'TMDB suggestions are unavailable offline. Your local library is still searchable.' }; }
  },
  scan: async ([now, automatic, remove, allowBattery, quality], store, storage) => reply(async () => {
    const library = await catalog(storage);
    library.now = now;
    let count = await library.scan(storage.fs, root(), platform());
    const folders = await rows<{ value: string }>(library.db, "SELECT value FROM settings WHERE key='folders'");
    for (const folder of JSON.parse(folders[0]?.value || '[]')) count += await library.scan(storage.fs, folder, platform());
    if (automatic && platform() === 'macos') {
      const files = await rows<{id:string}>(library.db, "SELECT id FROM media WHERE status='needs_conversion' AND id NOT IN (SELECT media_id FROM jobs WHERE media_id IS NOT NULL)");
      for (const file of files) await library.db.transaction([
        { sql: "INSERT INTO jobs(id,media_id,kind,state,updated_at) VALUES(?,?,'convert','queued',?)", params: [file.id, file.id, now] },
        { sql: "INSERT INTO settings(key,value) VALUES(?,?) ON CONFLICT(key) DO NOTHING", params: [`conversion:${file.id}`, JSON.stringify({ remove, allowBattery, quality })] },
      ]);
    }
    await matchLibrary(library, storage.fs, store.get('tmdb') || '');
    return `${count} files checked`;
  }),
  saveToken: async ([token], store) => reply(async () => {
    await tmdb('/configuration', token.trim()); store.set('tmdb', token.trim()); return 'TMDB token saved';
  }),
  saveProgress: async ([id, payload, now], _store, storage) => {
    const event = JSON.parse(payload);
    const library = await catalog(storage); library.now = now;
    await library.progress(id, event.position, event.duration);
    if (Number.isInteger(event.audioChoice) && Number.isInteger(event.subtitleChoice))
      await library.db.execute("INSERT INTO settings(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value", [`player:${id}`, JSON.stringify({ audio: event.audioChoice, subtitle: event.subtitleChoice })]);
    return { position: Number(event.position) || 0, duration: Number(event.duration) || 0,
      audio: (event.audio || []).map((name: string, index: number) => ({ id: `audio-${index}`, name: String(name), index })), subtitles: (event.subtitles || []).map((name: string, index: number) => ({ id: `subtitle-${index}`, name: String(name), index })), error: String(event.error || '') };
  },
  nextEpisode: async ([id], _store, storage) => {
    const cards = await (await catalog(storage)).cards();
    const current = cards.find(card => card.id === id);
    const next = current?.kind === 'show' ? cards.find(card => card.titleId === current.titleId && card.status === 'ready'
      && (card.season > current.season || card.season === current.season && card.episode > current.episode)) : null;
    return { id: next?.id || '' };
  },
  fixMatch: async ([id, text], store, storage) => reply(async () => {
    const tmdbId = Number(text);
    if (!Number.isSafeInteger(tmdbId) || tmdbId <= 0) throw new Error('Enter a valid TMDB title ID');
    const token = store.get('tmdb');
    if (!token) throw new Error('Save your TMDB token in Settings first');
    await matchLibrary(await catalog(storage), storage.fs, token, id, tmdbId);
    return 'Match updated';
  }),
  addFolder: async ([path], _store, storage) => reply(async () => {
    if (!path.startsWith('doc:/')) throw new Error('Choose a folder using Import Folder');
    await storage.fs.readdir(path);
    const library = await catalog(storage);
    const saved = await rows<{ value: string }>(library.db, "SELECT value FROM settings WHERE key='folders'");
    const folders: string[] = JSON.parse(saved[0]?.value || '[]');
    if (!folders.includes(path)) folders.push(path);
    await library.db.execute("INSERT INTO settings(key,value) VALUES('folders',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value", [JSON.stringify(folders)]);
    return 'Folder access saved';
  }),
  jobs: async (_args, _store, storage) => {
    const library = await catalog(storage);
    const jobs = await rows<{id:string; state:string; error:string; progress:number; duration:number}>(library.db, "SELECT j.id,j.state,COALESCE(j.error,'') error,j.progress,COALESCE(m.duration,0) duration FROM jobs j LEFT JOIN media m ON m.id=j.media_id ORDER BY j.updated_at DESC");
    if (jobs.some(job => job.state === 'running')) {
      const bytes = await storage.fs.readFile('app:/data/conversion.progress').catch(() => null);
      const times = bytes ? [...new TextDecoder().decode(bytes).matchAll(/out_time_us=(\d+)/g)] : [];
      const seconds = Number(times.at(-1)?.[1] || 0) / 1000000;
      for (const job of jobs) if (job.state === 'running' && job.duration > 0) job.progress = Math.min(.99, seconds / job.duration);
    }
    return jobs.map(({ duration: _duration, ...job }) => job);
  },
  queueConversion: async ([id, remove, allowBattery, quality, now], _store, storage) => reply(async () => {
    const library = await catalog(storage);
    await library.db.transaction([
      { sql: "INSERT INTO jobs(id,media_id,kind,state,updated_at) VALUES(?,?,'convert','queued',?) ON CONFLICT(id) DO UPDATE SET state='queued',updated_at=excluded.updated_at WHERE jobs.state NOT IN ('running','verifying')", params: [id, id, now] },
      { sql: "INSERT INTO settings(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value", params: [`conversion:${id}`, JSON.stringify({ remove, allowBattery, quality })] },
    ]);
    return 'Conversion queued';
  }),
  runNextJob: async ([now], _store, storage) => reply(async () => {
    const library = await catalog(storage); library.now = now;
    const job = (await rows<{id:string}>(library.db, "SELECT id FROM jobs WHERE state='queued' ORDER BY updated_at LIMIT 1"))[0];
    if (!job) return '';
    const setting = (await rows<{value:string}>(library.db, "SELECT value FROM settings WHERE key=?", [`conversion:${job.id}`]))[0];
    const options = JSON.parse(setting?.value || '{}');
    try { await convert(library, storage, job.id, options.remove === true, options.allowBattery === true, options.quality || 'balanced'); }
    catch (error) { await library.db.execute("UPDATE jobs SET state='failed',error=? WHERE id=? AND state='queued'", [String(error), job.id]); throw error; }
    return 'Conversion verified and committed';
  }),
  cancel: async ([id], _store, storage) => {
    cancelConversion(id);
    await (await catalog(storage)).db.execute("UPDATE jobs SET state='canceled' WHERE id=? AND state='queued'", [id]);
    return { ok: true, message: 'Cancellation requested' };
  },
  updates: async () => checkUpdate(platform()).catch(error => ({ tag: '', name: '', url: '', checksumUrl: '', message: `Updates unavailable: ${String(error)}` })),
  downloadUpdate: async (_args, _store, storage) => reply(async () => {
    const path = await downloadUpdate(await checkUpdate(platform()), storage.fs);
    const library = await catalog(storage);
    await library.db.execute("INSERT INTO settings(key,value) VALUES('verifiedUpdate',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value", [JSON.stringify({ path, digest: await storage.fs.digest(path, 'SHA-256') })]);
    return 'Update verified. Tap Install downloaded build to continue.';
  }),
  installUpdate: async (_args, _store, storage) => reply(async () => {
    const library = await catalog(storage);
    const entry = (await rows<{value:string}>(library.db, "SELECT value FROM settings WHERE key='verifiedUpdate'"))[0];
    if (!entry) throw new Error('Download and verify a build first');
    const { path, digest } = JSON.parse(entry.value);
    if (await storage.fs.digest(path, 'SHA-256') !== digest) throw new Error('Update changed after verification. Download it again.');
    const result = await openUpdate({ path });
    if (!result.ok) throw new Error(result.message);
    return result.message;
  }),
  folders: async (_args, _store, storage) => {
    const library = await catalog(storage);
    const row = (await rows<{value:string}>(library.db, "SELECT value FROM settings WHERE key='folders'"))[0];
    return (JSON.parse(row?.value || '[]') as string[]).map(path => ({ path, name: path.split('/').at(-1) || path }));
  },
  removeFolder: async ([path], _store, storage) => reply(async () => {
    const library = await catalog(storage);
    const saved = (await rows<{value:string}>(library.db, "SELECT value FROM settings WHERE key='folders'"))[0];
    const folders = (JSON.parse(saved?.value || '[]') as string[]).filter(folder => folder !== path);
    const media = await rows<{id:string;path:string}>(library.db, 'SELECT id,path FROM media');
    await library.db.transaction([
      { sql: "UPDATE settings SET value=? WHERE key='folders'", params: [JSON.stringify(folders)] },
      ...media.filter(file => file.path.startsWith(`${path}/`)).map(file => ({ sql: 'DELETE FROM media WHERE id=?', params: [file.id] })),
    ]);
    await storage.fs.forgetDocument(path);
    return 'Folder removed from the library. Original videos were kept.';
  }),
  settings: async (_args, _store, storage) => {
    const library = await catalog(storage);
    const data = (await rows<{bytes:number; count:number}>(library.db, "SELECT COALESCE(SUM(size),0) bytes,COUNT(*) count FROM media WHERE status!='missing'"))[0]!;
    return { root: root(), platform: platform(), usage: `${(data.bytes / 1024 ** 3).toFixed(2)} GB · ${data.count} videos` };
  },
};
export const answer: Answer = (source, args, store, storage, native) => sources[source](args, store, storage, native);
