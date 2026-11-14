import { db, q, run, type Row } from "./db";
import { log } from "./logger";

export interface User {
  id: number;
  username: string;
  role: "admin" | "user";
  disabled: boolean;
  maxAge: number | null;
  blockUnrated: boolean;
  avatar: string | null;
}
export function userView(row: Row): User {
  return {
    id: Number(row.id),
    username: String(row.username),
    role: row.role as User["role"],
    disabled: Boolean(row.disabled),
    maxAge: row.max_age == null ? null : Number(row.max_age),
    blockUnrated: Boolean(row.block_unrated),
    avatar: row.avatar == null ? null : String(row.avatar),
  };
}
export function getUser(id: number): User | null {
  const row = q<Row>("SELECT * FROM users WHERE id=?").get(id);
  return row ? userView(row) : null;
}
export function hasOwner(): boolean {
  return Boolean(q("SELECT id FROM users LIMIT 1").get());
}
export function setupState() {
  const row = q<Row>("SELECT * FROM server_setup WHERE id=1").get();
  return {
    ownerCreated: hasOwner(),
    setupComplete: Boolean(row?.completed_at),
    step: Number(row?.step ?? 0),
  };
}
export function listUsers(): User[] {
  return q<Row>("SELECT * FROM users ORDER BY id").all().map(userView);
}
export function validateCredentials(
  username: string,
  password: string,
): string | null {
  if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]{2,39}$/.test(username))
    return "Use 3–40 letters, numbers, dots, underscores or hyphens for the username.";
  if (password.length < 12 || password.length > 128)
    return "Use a password between 12 and 128 characters.";
  return null;
}
export async function createUser(
  username: string,
  password: string,
  role: User["role"] = "user",
  first = false,
): Promise<User> {
  const invalid = validateCredentials(username, password);
  if (invalid) throw new Error(invalid);
  const passwordHash = await Bun.password.hash(password, {
    algorithm: "argon2id",
    memoryCost: 65536,
    timeCost: 3,
  });
  return db.transaction(() => {
    if (first && hasOwner())
      throw new Error("The server already has an owner.");
    const row = q<Row>(
      "INSERT INTO users(username,password_hash,role) VALUES(?,?,?) RETURNING *",
    ).get(username, passwordHash, role)!;
    if (first) {
      run(
        "INSERT OR IGNORE INTO watch_state(user_id,item_id,position_seconds,duration_seconds,played,updated_at) SELECT ?,item_id,position_seconds,duration_seconds,played,updated_at FROM legacy_watch_state",
        row.id,
      );
      run("UPDATE server_setup SET step=1 WHERE id=1");
    }
    return userView(row);
  })();
}
// Equal-cost verification for unknown accounts avoids disclosing usernames via timing.
let dummyHash: Promise<string> | undefined;
export async function loginUser(
  username: string,
  password: string,
): Promise<User | null> {
  const row = q<Row>("SELECT * FROM users WHERE username=?").get(username);
  dummyHash ??= Bun.password.hash(crypto.randomUUID(), {
    algorithm: "argon2id",
    memoryCost: 65536,
    timeCost: 3,
  });
  // Older provisioning/import paths bound the encoded hash as a SQLite BLOB.
  // String(Uint8Array) produces comma-separated byte values, not the hash text,
  // and Bun.password.verify then throws UnsupportedAlgorithm (HTTP 500).
  const stored = row?.password_hash;
  const hash = typeof stored === "string"
    ? stored
    : stored instanceof Uint8Array
      ? Buffer.from(stored).toString("utf8")
      : null;
  let valid = false;
  try {
    valid = await Bun.password.verify(password, hash ?? await dummyHash);
  } catch {
    // A damaged/unsupported stored value must fail authentication rather than
    // crash login, pairing-key creation or password confirmation. Never log it.
    log.warn("auth", "Stored password hash could not be verified", { userId: row?.id });
    await Bun.password.verify(password, await dummyHash);
  }
  return valid && row && !row.disabled ? userView(row) : null;
}
export function revokeUserSessions(id: number): void {
  run("UPDATE auth_devices SET revoked=1 WHERE user_id=?", id);
  run("UPDATE auth_pairing SET used=1 WHERE user_id=?", id);
}
