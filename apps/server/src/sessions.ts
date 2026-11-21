/// Playback session tracking for the admin dashboard.
///
/// A session is created when a client asks for a play manifest and refreshed by
/// the progress heartbeat. It is intentionally lightweight: one row per device,
/// not one per request. Admins can stop a live session; the player receives
/// `stop: true` on its next heartbeat and pauses.
import { q, run, type Row } from "./db";
import { requestDevice, requestUser } from "./auth";

const ACTIVE_WINDOW_MINUTES = 3;
const SESSION_TTL_HOURS = 24;
const ENDED_AFTER_MINUTES = 15;

export interface SessionView {
  id: number;
  userId: number;
  username: string;
  deviceId: number | null;
  deviceName: string | null;
  itemId: number | null;
  itemTitle: string | null;
  itemKind: string | null;
  parentTitle: string | null;
  seasonNumber: number | null;
  episodeNumber: number | null;
  fileId: number | null;
  position: number;
  duration: number | null;
  paused: boolean;
  status: string;
  stopRequested: boolean;
  client: string | null;
  ip: string | null;
  startedAt: string;
  updatedAt: string;
  active: boolean;
}

function clientLabel(request: Request): string | null {
  const value = request.headers.get("user-agent");
  if (!value) return null;
  return value.slice(0, 220);
}

function latestForDevice(userId: number, deviceId: number | null, hours = SESSION_TTL_HOURS): Row | undefined {
  return q<Row>(
    `SELECT * FROM playback_sessions
     WHERE user_id = ? AND device_id IS ?
       AND updated_at > datetime('now', ?)
     ORDER BY id DESC LIMIT 1`,
  ).get(userId, deviceId, `-${hours} hours`);
}

/** Start or refresh a session when a play manifest is requested. */
export function beginSession(
  request: Request,
  fileId: number | null,
  itemId: number | null,
  position: number,
  duration: number | null,
): void {
  const user = requestUser(request);
  if (!user) return;
  const device = requestDevice(request);
  const deviceId = device?.id ?? null;
  const active = q<Row>(
    `SELECT id FROM playback_sessions
     WHERE user_id = ? AND device_id IS ? AND status IN ('playing','paused')
       AND updated_at > datetime('now', '-5 minutes')
     ORDER BY id DESC LIMIT 1`,
  ).get(user.id, deviceId);

  if (active) {
    run(
      `UPDATE playback_sessions SET
         file_id = COALESCE(?, file_id),
         item_id = COALESCE(?, item_id),
         position_seconds = ?,
         duration_seconds = COALESCE(?, duration_seconds),
         paused = 0,
         status = 'playing',
         client = COALESCE(?, client),
         ip = COALESCE(?, ip),
         updated_at = datetime('now')
       WHERE id = ?`,
      fileId,
      itemId,
      Math.max(0, position),
      duration,
      clientLabel(request),
      device?.lastIp ?? null,
      Number(active.id),
    );
    return;
  }

  run(
    `INSERT INTO playback_sessions
       (user_id, device_id, item_id, file_id, position_seconds, duration_seconds,
        paused, status, client, ip)
     VALUES (?,?,?,?,?,?,0,'playing',?,?)`,
    user.id,
    deviceId,
    itemId,
    fileId,
    Math.max(0, position),
    duration,
    clientLabel(request),
    device?.lastIp ?? null,
  );
  run(
    "DELETE FROM playback_sessions WHERE updated_at < datetime('now', '-14 days')",
  );
}

/**
 * Refresh a session from `/api/progress`. Returns whether an admin has requested
 * a stop. A stopped session is acknowledged once so the player can pause and a
 * later explicit play can create a fresh session.
 */
export function reportSession(
  request: Request,
  itemId: number | null,
  position: number,
  duration: number | null,
  played: boolean,
  paused: boolean,
): { stop: boolean } {
  const user = requestUser(request);
  if (!user) return { stop: false };
  const device = requestDevice(request);
  const deviceId = device?.id ?? null;
  const row = latestForDevice(user.id, deviceId, 12);

  if (row) {
    if (Number(row.stop_requested) === 1) {
      run(
        `UPDATE playback_sessions SET stop_requested = 0, status = 'stopped',
           updated_at = datetime('now') WHERE id = ?`,
        Number(row.id),
      );
      return { stop: true };
    }
    const status = played ? "ended" : paused ? "paused" : "playing";
    run(
      `UPDATE playback_sessions SET
         item_id = COALESCE(?, item_id),
         position_seconds = ?,
         duration_seconds = COALESCE(?, duration_seconds),
         paused = ?,
         status = ?,
         stop_requested = 0,
         client = COALESCE(?, client),
         ip = COALESCE(?, ip),
         updated_at = datetime('now')
       WHERE id = ?`,
      itemId,
      Math.max(0, position),
      duration,
      paused && !played ? 1 : 0,
      status,
      clientLabel(request),
      device?.lastIp ?? null,
      Number(row.id),
    );
    return { stop: false };
  }

  run(
    `INSERT INTO playback_sessions
       (user_id, device_id, item_id, file_id, position_seconds, duration_seconds,
        paused, status, client, ip)
     VALUES (?,?,?,NULL,?,?,?,?,?,?)`,
    user.id,
    deviceId,
    itemId,
    Math.max(0, position),
    duration,
    paused && !played ? 1 : 0,
    played ? "ended" : paused ? "paused" : "playing",
    clientLabel(request),
    device?.lastIp ?? null,
  );
  return { stop: false };
}

/** Active and recently stopped sessions for the admin dashboard. */
export function listSessions(): { sessions: SessionView[]; active: number } {
  // A heartbeat can be delayed by a seek or background tab. Fifteen minutes of
  // silence is long enough to be a real stop, not a transient stall.
  run(
    `UPDATE playback_sessions SET status = 'ended'
     WHERE status IN ('playing','paused')
       AND updated_at < datetime('now', ?)`,
    `-${ENDED_AFTER_MINUTES} minutes`,
  );
  const rows = q<Row>(
    `SELECT s.*, u.username, d.name AS device_name, d.last_ip,
            i.name AS item_name, i.kind AS item_kind,
            i.parent_id, i.season_number, i.episode_number,
            p.name AS parent_name
     FROM playback_sessions s
     LEFT JOIN users u ON u.id = s.user_id
     LEFT JOIN auth_devices d ON d.id = s.device_id
     LEFT JOIN items i ON i.id = s.item_id
     LEFT JOIN items p ON p.id = i.parent_id
     WHERE s.updated_at > datetime('now', ?)
     ORDER BY s.updated_at DESC, s.id DESC
     LIMIT 100`,
  ).all(`-${SESSION_TTL_HOURS} hours`);

  const now = Date.now();
  const sessions = rows.map((row): SessionView => {
    const updated = Date.parse(String(row.updated_at).replace(" ", "T") + "Z");
    const status = String(row.status ?? "ended");
    const active =
      (status === "playing" || status === "paused") &&
      Number.isFinite(updated) &&
      now - updated < ACTIVE_WINDOW_MINUTES * 60_000;
    return {
      id: Number(row.id),
      userId: Number(row.user_id),
      username: String(row.username ?? "Deleted account"),
      deviceId: row.device_id == null ? null : Number(row.device_id),
      deviceName: row.device_name == null ? null : String(row.device_name),
      itemId: row.item_id == null ? null : Number(row.item_id),
      itemTitle: row.item_name == null ? null : String(row.item_name),
      itemKind: row.item_kind == null ? null : String(row.item_kind),
      parentTitle: row.parent_name == null ? null : String(row.parent_name),
      seasonNumber: row.season_number == null ? null : Number(row.season_number),
      episodeNumber: row.episode_number == null ? null : Number(row.episode_number),
      fileId: row.file_id == null ? null : Number(row.file_id),
      position: Number(row.position_seconds ?? 0),
      duration: row.duration_seconds == null ? null : Number(row.duration_seconds),
      paused: Number(row.paused) === 1,
      status,
      stopRequested: Number(row.stop_requested) === 1,
      client: row.client == null ? null : String(row.client),
      ip: row.ip == null ? (row.last_ip == null ? null : String(row.last_ip)) : String(row.ip),
      startedAt: String(row.started_at ?? ""),
      updatedAt: String(row.updated_at ?? ""),
      active,
    };
  });
  return {
    sessions,
    active: sessions.filter((session) => session.active).length,
  };
}

export function stopSession(id: number): boolean {
  const row = q<{ id: number }, [number]>(
    "SELECT id FROM playback_sessions WHERE id = ? AND status IN ('playing','paused','stopped')",
  ).get(id);
  if (!row) return false;
  run(
    `UPDATE playback_sessions SET status = 'stopped', stop_requested = 1,
       updated_at = datetime('now') WHERE id = ?`,
    id,
  );
  return true;
}

/** Revoking a device must also end whatever it is currently playing. */
export function stopDeviceSessions(deviceId: number): number {
  const rows = q<{ id: number }>(
    `UPDATE playback_sessions SET status = 'stopped', stop_requested = 1,
       updated_at = datetime('now')
     WHERE device_id = ? AND status IN ('playing','paused')
     RETURNING id`,
  ).all(deviceId);
  return rows.length;
}

/** Revoke/disable an account: stop every live session it owns. */
export function stopUserSessions(userId: number): number {
  const rows = q<{ id: number }>(
    `UPDATE playback_sessions SET status = 'stopped', stop_requested = 1,
       updated_at = datetime('now')
     WHERE user_id = ? AND status IN ('playing','paused')
     RETURNING id`,
  ).all(userId);
  return rows.length;
}
