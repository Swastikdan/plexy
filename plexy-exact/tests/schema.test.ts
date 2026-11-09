import { Database } from 'bun:sqlite';
import { expect, test } from 'bun:test';
import schema from '../lib/schema.sql' with { type: 'text' };
test('schema installs idempotently with foreign keys enabled', () => {
  const db = new Database(':memory:');
  try {
    db.exec(schema); db.exec(schema);
    expect(db.query('PRAGMA foreign_keys').get()).toEqual({ foreign_keys: 1 });
    const tables = db.query("SELECT name FROM sqlite_master WHERE type='table'").all() as { name: string }[];
    for (const name of ['titles', 'media', 'streams', 'progress', 'jobs']) expect(tables.map(t => t.name)).toContain(name);
  } finally { db.close(); }
});
