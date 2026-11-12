import AsyncStorage from "@react-native-async-storage/async-storage";
import * as SQLite from "expo-sqlite";
import type { LocalState } from "../../../../../packages/local-library/src/library";
const database = SQLite.openDatabaseAsync("plexy-library.db").then(
  async (db) => {
    await db.execAsync(`PRAGMA journal_mode = WAL;
    CREATE TABLE IF NOT EXISTS library_state (id INTEGER PRIMARY KEY CHECK(id = 1), value TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS media (id INTEGER PRIMARY KEY, value TEXT NOT NULL);`);
    return db;
  },
);
export async function saveLibrary(state: LocalState) {
  const db = await database;
  const { records, ...header } = state;
  await db.withExclusiveTransactionAsync(async (tx) => {
    await tx.runAsync(
      "INSERT OR REPLACE INTO library_state (id, value) VALUES (1, ?)",
      JSON.stringify(header),
    );
    await tx.runAsync("DELETE FROM media");
    for (const record of records)
      await tx.runAsync(
        "INSERT INTO media (id, value) VALUES (?, ?)",
        record.id,
        JSON.stringify(record),
      );
  });
}
export async function loadLibrary(): Promise<LocalState | null> {
  const db = await database;
  const header = await db.getFirstAsync<{
    value: string;
  }>("SELECT value FROM library_state WHERE id = 1");
  if (header) {
    const records = await db.getAllAsync<{
      value: string;
    }>("SELECT value FROM media ORDER BY id");
    return {
      ...JSON.parse(header.value),
      records: records.map((r) => JSON.parse(r.value)),
    };
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
