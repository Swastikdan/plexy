/// Database access.
///
/// Wraps a single `bun:sqlite` handle in WAL mode and runs numbered SQL
/// migrations from `src/server/migrations/` inside a transaction. The `q`
/// helper returns Bun statement methods with loosen parameter types so call
/// sites stay terse; correctness of the SQL itself is runtime-checked by
/// SQLite's strict mode typing and exercised by the scan tests.
import { Database, type Statement } from "bun:sqlite";
import { mkdirSync, existsSync } from "node:fs";
import { readdir, readFile } from "node:fs/promises";
import { join, dirname } from "node:path";
import { resolveDataDir } from "./paths";

// The data dir must exist before SQLite opens its file (first boot on a fresh
// machine has neither).
mkdirSync(resolveDataDir(), { recursive: true });

export const db = new Database(join(resolveDataDir(), "library.sqlite"), { create: true });

db.run("PRAGMA journal_mode = WAL");
db.run("PRAGMA foreign_keys = ON");
// Medium is a good WAL trade-off for a laptop that can lose power.
db.run("PRAGMA synchronous = NORMAL");
// Keep more of the hot catalog in memory and avoid temp-file churn for the
// many small GROUP BY / ORDER BY queries the catalog screens issue.
db.run("PRAGMA cache_size = -65536");      // 64 MiB page cache
db.run("PRAGMA mmap_size = 268435456");    // 256 MiB memory-mapped reads
db.run("PRAGMA temp_store = MEMORY");
db.run("PRAGMA busy_timeout = 5000");

{
  // Bun's `Database.run` is not variadic (`run(sql, bindings[])`), but writing
  // `db.run(sql, a, b, c)` reads far better across the codebase. Wrap once so
  // every call site can use varargs or a named-parameters object.
  const originalRun = db.run.bind(db) as (sql: string, ...rest: unknown[]) => void;
  (db as { run: (sql: string, ...rest: unknown[]) => void }).run = (sql: string, ...rest: unknown[]) => {
    if (rest.length === 1 && rest[0] !== null && typeof rest[0] === "object"
      && !Array.isArray(rest[0])) {
      return originalRun(sql, rest[0]); // named parameters object
    }
    return originalRun(sql, rest);
  };
}

/** Loosely-typed row: keys are column names, values are what SQLite returned. */
export type Row = Record<string, unknown>;

/**
 * Prepared-statement cache. `db.query()` parses and prepares the SQL each time
 * it is called; the scanner and catalog reuse the same handful of statements
 * thousands of times, so keeping them is a measurable win. Dynamic SQL (the
 * `IN (?,?,…)` lists in the catalog) is bounded to keep memory flat.
 */
const statementCache = new Map<string, Statement>();
const STATEMENT_CACHE_LIMIT = 512;

function prepare(sql: string): Statement {
  const cached = statementCache.get(sql);
  if (cached) return cached;
  const stmt = db.query(sql) as unknown as Statement;
  if (statementCache.size >= STATEMENT_CACHE_LIMIT) statementCache.clear();
  statementCache.set(sql, stmt);
  return stmt;
}

/** Called after migrations so cached statements never point at an old schema. */
export function clearStatementCache(): void {
  statementCache.clear();
}

/**
 * Prepare a statement once and expose `.get` / `.all` / `.run`.
 * Parameters are `any` at the type level (SQLite accepts null-and-boolean
 * mixes) while the row shape stays typed at each call site.
 */
export function q<A = Row, _P = never[]>(
  sql: string,
): {
  get: (...params: any[]) => A | undefined;
  all: (...params: any[]) => A[];
  run: (...params: any[]) => void;
} {
  const stmt = prepare(sql);
  return {
    get: stmt.get.bind(stmt) as never,
    all: stmt.all.bind(stmt) as never,
    run: stmt.run.bind(stmt) as never,
  };
}

/** Prepare + run for one-off writes; varargs or named-parameter object. */
export function run(sql: string, ...params: unknown[]): void {
  if (params.length === 1 && params[0] !== null && typeof params[0] === "object"
    && !Array.isArray(params[0])) {
    db.run(sql, params[0] as never);
    return;
  }
  db.run(sql, ...(params as never[]));
}

function resolveMigrationsDir(): string {
  const exeDir = process.argv[1] ? dirname(process.argv[1]) : "";
  const candidates = [
    join(exeDir, "migrations"),
    join(exeDir, "..", "Resources", "migrations"),
    new URL("./migrations", import.meta.url).pathname,
    join(process.cwd(), "apps", "server", "src", "migrations"),
    join(process.cwd(), "dist", "migrations"),
    join(import.meta.dir, "..", "apps", "server", "src", "migrations"),
    join(import.meta.dir, "migrations"),
  ];
  for (const c of candidates) {
    if (existsSync(c)) return c;
  }
  return candidates[0];
}

/**
 * Apply migrations that have not run yet, oldest first. Each numbered file is
 * applied exactly once inside a transaction; `schema_migrations` is created
 * defensively for empty databases.
 */
export async function runMigrations(): Promise<string[]> {
  run(
    `CREATE TABLE IF NOT EXISTS schema_migrations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      file TEXT NOT NULL UNIQUE,
      applied TEXT NOT NULL DEFAULT (datetime('now'))
    )`,
  );
  const dir = resolveMigrationsDir();
  const files = (await readdir(dir)).filter((f) => /^\d+.*\.sql$/.test(f)).sort();
  const applied = new Set(
    q<{ file: string }>("SELECT file FROM schema_migrations").all().map((r) => String(r.file)),
  );
  for (const file of files) {
    if (applied.has(file)) continue;
    const sql = await readFile(join(dir, file), "utf8");
    db.transaction(() => {
      db.exec(sql);
      run("INSERT OR IGNORE INTO schema_migrations (file) VALUES (?)", file);
    })();
  }
  clearStatementCache();
  return files;
}
