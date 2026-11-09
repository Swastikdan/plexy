import { Catalog, rows } from './catalog';
interface ArtworkFS { stat(path: string): Promise<{ size: number }>; atomicWriteFile(path: string, bytes: Uint8Array): Promise<void> }
const requests = new Map<string, Promise<any>>();
const normalized = (s: string) => s.toLowerCase().replace(/[^\p{L}\p{N}]/gu, '');
export function tmdb(path: string, token: string): Promise<any> {
  const key = `${token}:${path}`;
  const existing = requests.get(key);
  if (existing) return existing;
  const pending = (async () => {
    const response = await fetch(`https://api.themoviedb.org/3${path}`, { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(10000) });
    if (!response.ok) throw new Error(`TMDB: ${response.status}`);
    return response.json();
  })();
  if (requests.size >= 500) requests.delete(requests.keys().next().value!);
  requests.set(key, pending); pending.catch(() => requests.delete(key));
  return pending;
}
export async function matchLibrary(catalog: Catalog, fs: ArtworkFS, token: string, target?: string, overrideId?: number) {
  if (!token) return;
  const titles = await rows<{ id: string; name: string; year: number; kind: string; tmdb_id: number | null; metadata_json: string; updated_at: number }>(catalog.db, 'SELECT id,name,year,kind,tmdb_id,metadata_json,updated_at FROM titles');
  async function cache(path: string, key: string, size: string) {
    if (!path || !/^\/[\w.-]+$/.test(path)) return '';
    const destination = `app:/cache/artwork/${key}.jpg`;
    if (!(await fs.stat(destination).catch(() => null))?.size) {
      const response = await fetch(`https://image.tmdb.org/t/p/${size}${path}`, { signal: AbortSignal.timeout(15000) });
      if (!response.ok) throw new Error('Artwork fetch failed');
      await fs.atomicWriteFile(destination, new Uint8Array(await response.arrayBuffer()));
    }
    return destination;
  }
  for (const title of titles.filter(title => !target || title.id === target)) {
    if (!target && title.metadata_json && catalog.now - title.updated_at < 7 * 86400000) continue;
    const kind = title.kind === 'show' ? 'tv' : 'movie';
    const search = await tmdb(`/search/${kind}?query=${encodeURIComponent(title.name)}&include_adult=false`, token);
    const matches = search.results.filter((r: any) => normalized(r.title || r.name || '') === normalized(title.name)
      && (!title.year || Math.abs(Number((r.release_date || r.first_air_date || '').slice(0, 4)) - title.year) <= 1));
    const id = overrideId || title.tmdb_id || (matches.length === 1 ? matches[0].id : null);
    if (!id) continue;
    const data = await tmdb(`/${kind}/${id}?append_to_response=credits,external_ids`, token);
    const poster = await cache(data.poster_path, `${kind}-${id}-poster`, 'w500');
    const backdrop = await cache(data.backdrop_path, `${kind}-${id}-backdrop`, 'w1280');
    data.localCast = [];
    for (const person of (data.credits?.cast || []).slice(0, 12)) data.localCast.push({
      id: String(person.id), name: person.name, character: person.character || '',
      photo: await cache(person.profile_path, `person-${person.id}`, 'w185'),
    });
    await catalog.db.execute(`UPDATE titles SET name=?,overview=?,poster_path=?,backdrop_path=?,tmdb_id=?,imdb_id=?,metadata_json=?,updated_at=? WHERE id=?`,
      [data.title || data.name, data.overview || '', poster, backdrop, id, data.external_ids?.imdb_id || null, JSON.stringify(data), catalog.now, title.id]);
  }
}
