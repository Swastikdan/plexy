/// Path resolution for Plexy's writable state.
///
/// Runtime state never touches media folders. Locations follow PRD sections 4
/// and 7: a data directory for database/config/cached artwork and a log
/// directory that follows the host platform's conventions.
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { cp, mkdir, rename, rm, stat } from "node:fs/promises";

/** True when running in dev/test or outside the packaged standalone binary. */
export const isDev =
  Bun.env.NODE_ENV !== "production" ||
  (Bun.main ?? import.meta.path).includes("/apps/server/") ||
  (Bun.main ?? import.meta.path).includes("/tests/");

type PlatformEnvironment = Record<string, string | undefined>;

/** Data directory for a packaged server, before any environment override. */
export function dataDirFor(
  platform: NodeJS.Platform,
  env: PlatformEnvironment,
  home: string,
): string {
  if (platform === "darwin")
    return join(home, "Library", "Application Support", "Plexy");
  if (platform === "win32")
    return join(env.APPDATA ?? join(home, "AppData", "Roaming"), "Plexy");
  return join(env.XDG_DATA_HOME ?? join(home, ".local", "share"), "plexy");
}

/** Log directory for a packaged server, before any environment override. */
export function logDirFor(
  platform: NodeJS.Platform,
  env: PlatformEnvironment,
  home: string,
): string {
  if (platform === "darwin") return join(home, "Library", "Logs", "Plexy");
  if (platform === "win32")
    return join(env.LOCALAPPDATA ?? join(home, "AppData", "Local"), "Plexy", "logs");
  return join(
    env.XDG_STATE_HOME ?? join(home, ".local", "state"),
    "plexy",
    "logs",
  );
}

/**
 * Data directory resolution order (PRD 8):
 *  1. `PLEXY_DATA_DIR` env override — used by tests and by the owner's config.
 *  2. In test/dev mode: `/tmp/plexy-test` or `/tmp/plexy-dev` (fully writable in sandboxed environments).
 *  3. Packaged production: the platform data directory, such as
 *     `~/Library/Application Support/Plexy` on macOS.
 */
export function resolveDataDir(): string {
  if (Bun.env.PLEXY_DATA_DIR) return Bun.env.PLEXY_DATA_DIR;
  if (Bun.env.NODE_ENV === "test") return "/tmp/plexy-test";
  if (isDev) return "/tmp/plexy-dev";
  return dataDirFor(process.platform, Bun.env, homedir());
}

/**
 * Move data from the old packaged-app development default on first launch.
 * If both locations exist, the newer database wins and the previous
 * Application Support folder is retained as a timestamped backup.
 */
export async function migrateLegacyPackagedData(): Promise<void> {
  if (isDev || Bun.env.PLEXY_DATA_DIR) return;

  const destination = resolveDataDir();
  const legacy = "/tmp/plexy-dev";
  let destinationExists = false;
  try {
    await stat(destination);
    destinationExists = true;
  } catch {
    // First launch in the permanent data location.
  }

  try {
    const legacyDb = await stat(join(legacy, "library.sqlite"));
    const legacyWal = await stat(join(legacy, "library.sqlite-wal")).catch(() => null);
    const legacyMtime = Math.max(legacyDb.mtimeMs, legacyWal?.mtimeMs ?? 0);
    if (destinationExists) {
      try {
        const destinationDb = await stat(join(destination, "library.sqlite"));
        const destinationWal = await stat(join(destination, "library.sqlite-wal")).catch(() => null);
        const destinationMtime = Math.max(destinationDb.mtimeMs, destinationWal?.mtimeMs ?? 0);
        if (destinationMtime >= legacyMtime) return;
      } catch {
        // The legacy database is the only complete database.
      }
    }
  } catch {
    return;
  }

  await mkdir(dirname(destination), { recursive: true });
  const backup = destinationExists ? `${destination}.backup-${Date.now()}` : null;
  if (backup) await rename(destination, backup);

  try {
    await rename(legacy, destination);
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code !== "EXDEV") {
      if (backup) await rename(backup, destination);
      throw error;
    }

    try {
      await cp(legacy, destination, { recursive: true, force: false, errorOnExist: true });
    } catch (copyError) {
      await rm(destination, { recursive: true, force: true });
      if (backup) await rename(backup, destination);
      throw copyError;
    }
  }
}

/**
 * Log directory resolution order (PRD 6):
 *  1. `PLEXY_LOG_DIR` env override.
 *  2. Development: `/tmp/plexy-dev/logs` keeps logs next to the database.
 *  3. Packaged: the platform log directory, such as
 *     `~/Library/Logs/Plexy` on macOS.
 */
export function resolveLogDir(): string {
  if (Bun.env.PLEXY_LOG_DIR) return Bun.env.PLEXY_LOG_DIR;
  if (Bun.env.NODE_ENV === "test") return "/tmp/plexy-test/logs";
  if (isDev) return "/tmp/plexy-dev/logs";
  return logDirFor(process.platform, Bun.env, homedir());
}

/** Local artwork storage root (originals + derived), never in media folders. */
export function resolveArtworkDir(): string {
  return join(resolveDataDir(), "artwork");
}

/** Highest-resolution original downloads, deduplicated by content hash. */
export function resolveOriginalsDir(): string {
  return join(resolveArtworkDir(), "originals");
}

/** Display-sized WebP derivatives generated by Bun.Image. */
export function resolveDerivedDir(): string {
  return join(resolveArtworkDir(), "derived");
}

/**
 * Default prepared-playback cache: fast-start MP4 copies and extracted WebVTT
 * tracks. When the owner enables `optimizeStorage: "media"`, copies live in a
 * hidden `.plexy/optimized` folder beside each source instead.
 */
export function resolveOptimizedDir(): string {
  return join(resolveDataDir(), "optimized");
}

export function resolveSubtitleCacheDir(): string {
  return join(resolveOptimizedDir(), "subtitles");
}

/**
 * Trickplay (scrub preview) frames. One folder per file *and* source mtime so a
 * changed file can never serve stale thumbnails. Safe to delete while stopped.
 */
export function resolveTrickplayDir(): string {
  return join(resolveDataDir(), "trickplay");
}
