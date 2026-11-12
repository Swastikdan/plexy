import AsyncStorage from "@react-native-async-storage/async-storage";
import * as SQLite from "expo-sqlite";
import type { LocalState } from "@plexy/local-library/library";
const database = SQLite.openDatabaseAsync("plexy-library.db").then(
  async (db) => {
    await db.execAsync(`PRAGMA journal_mode = WAL;
    CREATE TABLE IF NOT EXISTS library_state (id INTEGER PRIMARY KEY CHECK(id = 1), value TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS media (id INTEGER PRIMARY KEY, value TEXT NOT NULL);`);
    return db;
  },
);
// Last-saved content, used to skip rewriting unchanged rows.
let savedHeaderJson: string | null = null;
let savedRecords = new Map<number, string>();

function rememberSaved(state: LocalState, headerJson: string) {
  savedHeaderJson = headerJson;
  savedRecords = new Map(state.records.map((r) => [r.id, JSON.stringify(r)]));
}

export async function saveLibrary(state: LocalState) {
  const db = await database;
  const { records, ...header } = state;
  // Media rows are written incrementally: only records whose content changed
  // since the last save are serialized and rewritten. A scan touching a few
  // records must not serialize and rewrite the whole library each time.
  const headerJson = JSON.stringify(header);
  const live = new Set(records.map((r) => r.id));
  const updates: [number, string][] = [];
  for (const record of records) {
    const json = JSON.stringify(record);
    if (savedRecords.get(record.id) !== json) updates.push([record.id, json]);
  }
  const deletions = [...savedRecords.keys()].filter((id) => !live.has(id));
  if (headerJson !== savedHeaderJson || updates.length || deletions.length) {
    await db.withExclusiveTransactionAsync(async (tx) => {
      if (headerJson !== savedHeaderJson) {
        await tx.runAsync(
          "INSERT OR REPLACE INTO library_state (id, value) VALUES (1, ?)",
          headerJson,
        );
      }
      for (const id of deletions)
        await tx.runAsync("DELETE FROM media WHERE id = ?", id);
      for (const [id, json] of updates)
        await tx.runAsync(
          "INSERT OR REPLACE INTO media (id, value) VALUES (?, ?)",
          id,
          json,
        );
    });
    rememberSaved(state, headerJson);
  }
}
export async function loadLibrary(): Promise<LocalState | null> {
  const db = await database;
  const header = await db.getFirstAsync<{ value: string }>(
    "SELECT value FROM library_state WHERE id = 1",
  );
  if (header) {
    const rows = await db.getAllAsync<{ value: string }>(
      "SELECT value FROM media ORDER BY id",
    );
    const headerJson = JSON.stringify(JSON.parse(header.value));
    const records = rows.map((r) => JSON.parse(r.value) as LocalState["records"][number]);
    // Prime the incremental-save cache so the first save after launch only
    // writes what actually changed.
    savedHeaderJson = headerJson;
    savedRecords = new Map(records.map((r) => [r.id, JSON.stringify(r)]));
    return { ...JSON.parse(header.value), records };
  }
  const legacy = await AsyncStorage.getItem("plexy.local-library.v1");
  if (!legacy) return null;
  const state = JSON.parse(legacy) as LocalState;
  if (
    state.version !== 1 ||
    !Array.isArray(state.records) ||
    !Array.isArray(state.roots)
  )
    throw new Error("The saved local library could not be migrated.");
  await saveLibrary(state);
  return state;
}
