import { q, run } from "./db";

/** Stable opaque identity for this server installation, persisted in SQLite. */
export function getServerId(): string {
  let row = q<{ server_id: string }>("SELECT server_id FROM server_identity WHERE id = 1").get();
  if (!row) {
    run("INSERT OR IGNORE INTO server_identity (id, server_id) VALUES (1, ?)", crypto.randomUUID());
    row = q<{ server_id: string }>("SELECT server_id FROM server_identity WHERE id = 1").get();
  }
  if (!row?.server_id) throw new Error("Plexy server identity is unavailable");
  return row.server_id;
}
