import { serializeRecords } from "./serialize-records";
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

// Serialize saves so an older transaction cannot overwrite newer state.
let pendingSave: Promise<void> = Promise.resolve();
export function saveLibrary(state: LocalState): Promise<void> {
  const operation = pendingSave.then(() => persistLibrary(state));
  pendingSave = operation.catch(() => {});
  return operation;
}

async function persistLibrary(state: LocalState) {
  const db = await database;
  const { records, ...header } = state;
  const headerJson = JSON.stringify(header);
  const nextRecords = await serializeRecords(records);
  const updates = [...nextRecords].filter(([id, json]) => savedRecords.get(id) !== json);
  const deletions = [...savedRecords.keys()].filter(id => !nextRecords.has(id));
  if (headerJson !== savedHeaderJson || updates.length || deletions.length) {
    await db.withExclusiveTransactionAsync(async tx => {
      if (headerJson !== savedHeaderJson)
        await tx.runAsync("INSERT OR REPLACE INTO library_state (id, value) VALUES (1, ?)", headerJson);
      for (const id of deletions) await tx.runAsync("DELETE FROM media WHERE id = ?", id);
      for (const [id, json] of updates)
        await tx.runAsync("INSERT OR REPLACE INTO media (id, value) VALUES (?, ?)", id, json);
    });
    savedHeaderJson = headerJson;
    savedRecords = nextRecords;
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
    const records = rows.map((r) => JSON.parse(r.value) as LocalState["records"][number]);
    // Prime the incremental-save cache so the first save after launch only
    // writes what actually changed. The stored strings are already the exact
    // canonical JSON written by serializeRecords and the header save above, so
    // re-serializing every record here only burns boot time.
    savedHeaderJson = header.value;
    savedRecords = new Map(rows.map((r, index) => [records[index]!.id, r.value]));
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
