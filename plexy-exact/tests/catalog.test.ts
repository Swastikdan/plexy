import { Database as SQLite } from 'bun:sqlite';
import { expect, test } from 'bun:test';
import { Catalog, type Database, type SQLValue } from '../lib/catalog';
import schema from '../lib/schema';
function setup() {
  const sql = new SQLite(':memory:');
  const adapter: Database = {
    async execute(query, params = []) { sql.run(query, params as any[]); },
    async query(query, params = []) {
      const statement = sql.query(query);
      return { columns: statement.columnNames, rows: statement.values(...params as any[]) as SQLValue[][] };
    },
    async transaction(commands) { sql.transaction(() => { for (const command of commands) sql.run(command.sql, (command.params || []) as any[]); })(); },
  };
  return { sql, catalog: new Catalog(adapter, 1000) };
}
const root = 'home:/Plexy';
const fs = {
  async readdir() { return ['Movie (2020).mkv']; },
  async lstat() { return { isDirectory: false, isFile: true, size: 1000, modifiedMs: 1 }; },
};
test('complete scans preserve identity/progress, failed scans keep cached records', async () => {
  const { catalog, sql } = setup();
  try {
    await catalog.initialize(schema);
    await catalog.scan(fs, root, 'macos');
    const first = (await catalog.cards())[0]!;
    expect(first).not.toHaveProperty('metadata'); expect(first).not.toHaveProperty('playerSettings');
    expect(first.name).toBe('Movie'); expect(first.status).toBe('needs_conversion');
    await catalog.progress(first.id, 15, 30);
    await expect(catalog.scan({ ...fs, readdir: async () => { throw new Error('permission denied'); } }, root, 'macos')).rejects.toThrow();
    expect((await catalog.cards())[0]!.position).toBe(15);
    await catalog.scan(fs, root, 'macos');
    expect((await catalog.cards())[0]!.id).toBe(first.id);
    await catalog.scan({ ...fs, readdir: async () => [] }, root, 'macos');
    expect((await catalog.cards())[0]!.status).toBe('missing');
  } finally { sql.close(); }
});
test('relaunch reconciliation records interrupted work and rejects unknown schema', async () => {
  const { catalog, sql } = setup();
  try {
    await catalog.initialize(schema);
    sql.run("INSERT INTO jobs(id,kind,state) VALUES('1','convert','running')");
    await catalog.initialize(schema);
    expect(sql.query('SELECT state FROM jobs').get()).toEqual({ state: 'interrupted' });
    sql.run("UPDATE schema_meta SET value='99'");
    await expect(catalog.initialize(schema)).rejects.toThrow('Unsupported');
  } finally { sql.close(); }
});
