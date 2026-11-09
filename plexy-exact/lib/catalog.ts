import { childPath, parseName } from './parse';
export type SQLValue = string | number | bigint | null | Uint8Array;
export interface Database {
  execute(sql: string, params?: SQLValue[]): Promise<unknown>;
  query(sql: string, params?: SQLValue[]): Promise<{ columns: string[]; rows: SQLValue[][] }>;
  transaction(commands: { sql: string; params?: SQLValue[] }[]): Promise<unknown>;
}
export interface Files {
  readdir(path: string): Promise<string[]>;
  lstat(path: string): Promise<{ isDirectory: boolean; isFile: boolean; size: number; modifiedMs: number; isSymbolicLink?: boolean }>;
}
export interface CastMember { id: string; name: string; character: string; photo: string }
export interface Card { addedAt: number; audioChoice: number; subtitleChoice: number; playerSettings?: string; backdrop: string; rating: number; genres: string; cast: CastMember[]; metadata?: string; titleId: string; id: string; name: string; kind: string; year: number; poster: string; overview: string; position: number; duration: number; status: string; path: string; season: number; episode: number }
export async function rows<T>(db: Database, sql: string, params: SQLValue[] = []): Promise<T[]> {
  const result = await db.query(sql, params);
  return result.rows.map(row => Object.fromEntries(result.columns.map((key, i) => [key, typeof row[i] === 'bigint' ? Number(row[i]) : row[i]])) as T);
}
export class Catalog {
  private scanInFlight: Promise<number> | null = null;
  constructor(readonly db: Database, public now = 0) {}
  async initialize(schema: string) {
    // Exact executes one statement per call. No user data or literals containing semicolons in this schema.
    for (const sql of schema.split(';').map(s => s.replace(/--[^\n]*/g, '').trim()).filter(Boolean)) {
      // Exact owns these connection settings; app-side PRAGMA is denied by its authorizer.
      if (/^PRAGMA (journal_mode|foreign_keys)/i.test(sql)) continue;
      await this.db.execute(sql);
    }
    await this.db.execute("INSERT INTO schema_meta(key,value) VALUES('version','1') ON CONFLICT(key) DO NOTHING");
    const version = await rows<{ value: string }>(this.db, "SELECT value FROM schema_meta WHERE key='version'");
    if (version[0]?.value !== '1') throw new Error('Unsupported catalog version; library was preserved');
    await this.db.execute("UPDATE jobs SET state='interrupted',error='Application closed during work' WHERE state IN ('running','verifying')");
  }
  async cards(query = ''): Promise<Card[]> {
    const cards = await rows<Card>(this.db, `SELECT m.added_at addedAt,m.title_id titleId,m.id,t.name,t.kind,COALESCE(t.year,0) year,COALESCE(t.poster_path,'') poster,
      COALESCE(ps.value,'{}') playerSettings,COALESCE(t.overview,'') overview,COALESCE(t.backdrop_path,'') backdrop,COALESCE(t.metadata_json,'{}') metadata,COALESCE(p.position,0) position,COALESCE(NULLIF(m.duration,0),p.duration,0) duration,
      m.status,m.path,COALESCE(m.season,0) season,COALESCE(m.episode,0) episode FROM media m JOIN titles t ON t.id=m.title_id
      LEFT JOIN progress p ON p.media_id=m.id LEFT JOIN settings ps ON ps.key=('player:' || m.id) WHERE t.name LIKE ? ORDER BY t.sort_name,m.season,m.episode`, [`%${query}%`]);
    return cards.map(card => {
      const data = JSON.parse(card.metadata || '{}');
      const player = JSON.parse(card.playerSettings || '{}');
      const { metadata: _metadata, playerSettings: _playerSettings, ...publicCard } = card;
      return { ...publicCard, audioChoice: player.audio ?? -2, subtitleChoice: player.subtitle ?? -3, cast: data.localCast || [], rating: data.vote_average || 0, genres: (data.genres || []).map((g: {name:string}) => g.name).join(' · ') };
    });
  }
  async progress(id: string, position: number, duration: number) {
    if (!Number.isFinite(position) || !Number.isFinite(duration) || duration <= 0) return;
    const p = Math.max(0, Math.min(position, duration));
    await this.db.execute(`INSERT INTO progress(media_id,position,duration,watched,updated_at) VALUES(?,?,?,?,?)
      ON CONFLICT(media_id) DO UPDATE SET position=excluded.position,duration=excluded.duration,watched=excluded.watched,updated_at=excluded.updated_at`,
    [id, p, duration, p / duration >= .9 ? 1 : 0, this.now]);
  }
  scan(fs: Files, root: string, platform: string): Promise<number> {
    if (this.scanInFlight) return this.scanInFlight;
    this.scanInFlight = this.walk(fs, root, platform).finally(() => { this.scanInFlight = null; });
    return this.scanInFlight;
  }
  private async walk(fs: Files, root: string, platform: string) {
    const pending = [root];
    const files: { path: string; size: number; mtime: number }[] = [];
    // Walk completely before writing: permission errors never mark cached records missing.
    while (pending.length) {
      const directory = pending.pop()!;
      for (const name of await fs.readdir(directory)) {
        const path = childPath(directory, name);
        const stat = await fs.lstat(path);
        if (stat.isSymbolicLink) continue;
        if (stat.isDirectory && !/^(extras?|samples?|trailers?)$/i.test(name)) pending.push(path);
        else if (stat.isFile && /\.(mkv|mp4|m4v|mov|webm|avi|ts)$/i.test(name)) files.push({ path, size: stat.size, mtime: stat.modifiedMs });
      }
    }
    const commands: { sql: string; params?: SQLValue[] }[] = [];
    const now = this.now;
    const existing = await rows<{ id: string; path: string; original_path: string; identity: string }>(this.db, "SELECT m.id,m.path,m.original_path,COALESCE(s.value,'{}') identity FROM media m LEFT JOIN settings s ON s.key=('jobIdentity:' || m.id)");
    const takenIds = new Set(existing.map(file => file.id));
    const seen = new Set(files.map(f => f.path));
    for (const file of files) {
      const replacement = existing.find(row => row.original_path === file.path && seen.has(row.path));
      if (replacement) {
        const identity = JSON.parse(replacement.identity);
        if (identity.input?.size === file.size && identity.sourceModifiedMs === file.mtime) continue;
      }
      const parsed = parseName(file.path.slice(root.length + 1));
      const titleId = JSON.stringify([parsed.title.toLowerCase(), parsed.year, parsed.season === null ? 'movie' : 'show']);
      // A virtual path is a stable, collision-free identifier; it never leaves the device.
      let id = existing.find(row => row.path === file.path)?.id;
      if (!id) {
        id = file.path; let ordinal = 1;
        while (takenIds.has(id)) id = `${file.path}#${++ordinal}`;
        takenIds.add(id);
      }
      commands.push({ sql: `INSERT INTO titles(id,kind,name,sort_name,year,tmdb_id,added_at,updated_at) VALUES(?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET tmdb_id=COALESCE(titles.tmdb_id,excluded.tmdb_id)`,
        params: [titleId, parsed.season === null ? 'movie' : 'show', parsed.title, parsed.title.toLowerCase(), parsed.year, parsed.explicitId, now, now] });
      commands.push({ sql: `INSERT INTO media(id,title_id,season,episode,path,container,size,mtime,status,added_at,updated_at)
        VALUES(?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(path) DO UPDATE SET size=excluded.size,mtime=excluded.mtime,
        status=CASE WHEN media.status='missing' THEN excluded.status ELSE media.status END,updated_at=excluded.updated_at`,
      params: [id, titleId, parsed.season, parsed.episode, file.path, file.path.split('.').at(-1)!.toLowerCase(), file.size, file.mtime,
        platform === 'macos' && !/\.(mp4|m4v|mov)$/i.test(file.path) ? 'needs_conversion' : 'ready', now, now] });
    }
    for (const file of existing) if (file.path.startsWith(`${root}/`) && !seen.has(file.path)) commands.push({ sql: "UPDATE media SET status='missing' WHERE id=?", params: [file.id] });
    if (commands.length) await this.db.transaction(commands);
    return files.length;
  }
}
