import * as SQLite from "expo-sqlite";

/**
 * Persistent cache for the online (TMDB) catalog. SQLite keeps the last known
 * home rows, title details, season episodes and movie collections on the
 * device, so screens open from a local read instead of waiting on the network.
 * A cached entry is always the last complete response; refreshes replace it
 * after the new response has been mapped to the UI shape.
 */

export type RemoteCacheKind =
  | "home"
  | "detail"
  | "season"
  | "recommendations"
  | "collection";

export interface RemoteCacheEntry<T> {
  value: T;
  updatedAt: number;
}

let databasePromise: Promise<SQLite.SQLiteDatabase> | null = null;

function database() {
  if (!databasePromise) {
    databasePromise = SQLite.openDatabaseAsync("plexy-remote.db").then(
      async (db) => {
        await db.execAsync(`PRAGMA journal_mode = WAL;
          CREATE TABLE IF NOT EXISTS remote_cache (
            kind TEXT NOT NULL,
            key TEXT NOT NULL,
            value TEXT NOT NULL,
            updated_at INTEGER NOT NULL,
            PRIMARY KEY (kind, key)
          );`);
        return db;
      },
    );
    // A failed open must not poison every later call. The next read retries.
    databasePromise.catch(() => {
      databasePromise = null;
    });
  }
  return databasePromise;
}

export async function readRemoteCache<T>(
  kind: RemoteCacheKind,
  key: string,
): Promise<RemoteCacheEntry<T> | null> {
  try {
    const db = await database();
    const row = await db.getFirstAsync<{ value: string; updated_at: number }>(
      "SELECT value, updated_at FROM remote_cache WHERE kind = ? AND key = ?",
      kind,
      key,
    );
    if (!row) return null;
    return {
      value: JSON.parse(row.value) as T,
      updatedAt: row.updated_at,
    };
  } catch {
    return null;
  }
}

export async function writeRemoteCache(
  kind: RemoteCacheKind,
  key: string,
  value: unknown,
): Promise<number> {
  const updatedAt = Date.now();
  try {
    const db = await database();
    await db.runAsync(
      "INSERT OR REPLACE INTO remote_cache (kind, key, value, updated_at) VALUES (?, ?, ?, ?)",
      kind,
      key,
      JSON.stringify(value),
      updatedAt,
    );
  } catch {
    // Caching is an optimization. A failed write must never fail a screen.
  }
  return updatedAt;
}

// The cache only ever grows as titles are browsed. Keep the most recently
// refreshed entries of each kind and drop anything untouched for 60 days, so a
// long-lived install stays at a few tens of MB.
const KIND_LIMITS: Record<Exclude<RemoteCacheKind, "home">, number> = {
  detail: 800,
  season: 800,
  recommendations: 300,
  collection: 200,
};
const MAX_AGE_MS = 60 * 24 * 60 * 60_000;

export async function pruneRemoteCache(): Promise<void> {
  try {
    const db = await database();
    await db.runAsync(
      "DELETE FROM remote_cache WHERE kind != 'home' AND updated_at < ?",
      Date.now() - MAX_AGE_MS,
    );
    for (const [kind, limit] of Object.entries(KIND_LIMITS)) {
      await db.runAsync(
        `DELETE FROM remote_cache WHERE kind = ? AND key NOT IN (
           SELECT key FROM remote_cache WHERE kind = ? ORDER BY updated_at DESC LIMIT ?
         )`,
        kind,
        kind,
        limit,
      );
    }
    // Give the freed pages back to the file system.
    await db.execAsync("PRAGMA wal_checkpoint(TRUNCATE); VACUUM;");
  } catch {
    // Maintenance is best effort; the next launch tries again.
  }
}
