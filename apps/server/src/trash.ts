/// Original-media deletion helpers.
///
/// Plexy never permanently deletes an original unless the owner explicitly
/// chooses `permanent`. The default sends the file to the operating system's
/// Trash/Recycle Bin, so it can be restored. A hidden `.plexy/trash` folder
/// beside the media is the fallback when the desktop trash service is not
/// available (for example on a headless server).
///
/// The system Trash still occupies disk space until it is emptied. The
/// `permanent` policy is the only way to reclaim that space immediately.
import { execFile } from "node:child_process";
import { copyFile, mkdir, rename, stat, unlink } from "node:fs/promises";
import { basename, dirname, extname, join, resolve, sep } from "node:path";
import { promisify } from "node:util";
import { log } from "./logger";
import { resolveOptimizedDir } from "./paths";

const execFileAsync = promisify(execFile);

export const PLEXY_MEDIA_DIR = ".plexy";
export const PLEXY_OPTIMIZED_DIR = "optimized";
export const PLEXY_TRASH_DIR = "trash";

export type DeletePolicy = "system" | "permanent";

export interface DeleteResult {
  /** Where the original can be restored from, when a trash copy was made. */
  trashPath: string | null;
  method: "system" | "local-trash" | "permanent";
}

/** Hidden state folder beside one media file. */
export function plexyMediaDir(sourcePath: string): string {
  return join(dirname(sourcePath), PLEXY_MEDIA_DIR);
}

/** Prepared copies stored beside the original instead of in the data folder. */
export function preparedDirBeside(sourcePath: string): string {
  return join(plexyMediaDir(sourcePath), PLEXY_OPTIMIZED_DIR);
}

/** Recoverable originals removed when the system Trash is unavailable. */
export function localTrashDirBeside(sourcePath: string): string {
  return join(plexyMediaDir(sourcePath), PLEXY_TRASH_DIR);
}

/** True when a path is inside a media folder's `.plexy/optimized` directory. */
export function isMediaPreparedPath(path: string): boolean {
  const parts = resolve(path).split(sep);
  const index = parts.lastIndexOf(PLEXY_MEDIA_DIR);
  return index >= 0 && parts[index + 1] === PLEXY_OPTIMIZED_DIR;
}

/** True when a path is inside the app-data prepared-copy directory. */
export function isAppPreparedPath(path: string): boolean {
  const root = resolve(resolveOptimizedDir());
  const candidate = resolve(path);
  return candidate === root || candidate.startsWith(`${root}${sep}`);
}

/** True for a Plexy-generated MP4/partial file in either supported location. */
export function isPreparedArtifact(path: string): boolean {
  const name = basename(path).toLowerCase();
  if (!name.endsWith(".mp4") && !name.endsWith(".part")) return false;
  return isMediaPreparedPath(path) || isAppPreparedPath(path);
}

async function exists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

/** Append a numeric suffix instead of overwriting an existing file. */
export async function uniquePath(path: string): Promise<string> {
  if (!(await exists(path))) return path;
  const ext = extname(path);
  const stem = path.slice(0, path.length - ext.length);
  for (let index = 1; index < 10_000; index++) {
    const candidate = `${stem} (${index})${ext}`;
    if (!(await exists(candidate))) return candidate;
  }
  throw new Error(`Could not find a free filename for ${path}`);
}

/**
 * Final path for the MP4 that replaces `sourcePath`. The source itself does
 * not count as a collision: it leaves the folder before the final rename, so
 * an in-place MP4 replacement keeps its original name.
 */
export async function replacementTargetFor(sourcePath: string): Promise<string> {
  const ext = extname(sourcePath);
  const stem = basename(sourcePath, ext);
  const target = join(dirname(sourcePath), `${stem}.mp4`);
  if (resolve(target) === resolve(sourcePath)) return target;
  return uniquePath(target);
}

/** Move one file into `.plexy/trash` beside it (fallback trash). */
export async function moveToLocalTrash(sourcePath: string): Promise<string> {
  const dir = localTrashDirBeside(sourcePath);
  await mkdir(dir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const target = await uniquePath(join(dir, `${stamp}-${basename(sourcePath)}`));
  try {
    await rename(sourcePath, target);
  } catch (error) {
    // A media folder on another mount can still be trashed; copy first so the
    // original is only unlinked after the destination is complete.
    if ((error as NodeJS.ErrnoException).code !== "EXDEV") throw error;
    await copyFile(sourcePath, target);
    await unlink(sourcePath);
  }
  return target;
}

/**
 * Ask the desktop's trash service to move one file. macOS uses
 * `NSFileManager.trashItem` through JavaScript for Automation, which behaves
 * like Finder without requiring Finder automation permission. Linux uses the
 * freedesktop `gio trash` command over the same XDG trash directories.
 */
export async function moveToSystemTrash(sourcePath: string): Promise<void> {
  if (process.platform === "darwin") {
    const script = [
      "ObjC.import('Foundation');",
      "function run(argv) {",
      "  const url = $.NSURL.fileURLWithPath(argv[0]);",
      "  const ok = $.NSFileManager.defaultManager",
      "    .trashItemAtURLResultingItemURLError(url, null, null);",
      "  if (!ok) throw new Error('macOS could not move the file to Trash');",
      "}",
    ].join("\n");
    await execFileAsync("/usr/bin/osascript", ["-l", "JavaScript", "-e", script, sourcePath], {
      timeout: 30_000,
    });
    return;
  }

  if (process.platform === "linux") {
    try {
      await execFileAsync("gio", ["trash", "--", sourcePath], { timeout: 30_000 });
      return;
    } catch {
      // Headless images often ship without gio; try the trash-cli name too.
    }
    try {
      await execFileAsync("trash-put", ["--", sourcePath], { timeout: 30_000 });
      return;
    } catch {
      throw new Error("No Linux trash command is available");
    }
  }

  throw new Error(`The system trash is not available on ${process.platform}`);
}

/**
 * Remove one original media file using the owner's policy.
 *
 * `system` prefers the OS Trash and falls back to a local `.plexy/trash`
 * folder so a failed desktop integration never destroys the file. `permanent`
 * unlinks it immediately and is the only mode that reclaims disk space now.
 */
export async function removeOriginal(
  sourcePath: string,
  policy: DeletePolicy,
): Promise<DeleteResult> {
  if (policy === "permanent") {
    await unlink(sourcePath);
    return { trashPath: null, method: "permanent" };
  }
  try {
    await moveToSystemTrash(sourcePath);
    return { trashPath: null, method: "system" };
  } catch (error) {
    log.warn("optimizer", "system trash unavailable; using the media-folder recycle bin", {
      message: error instanceof Error ? error.message : String(error),
      path: sourcePath,
    });
    const trashPath = await moveToLocalTrash(sourcePath);
    return { trashPath, method: "local-trash" };
  }
}

/**
 * Remove one generated file, never an original. Returns true when a file was
 * actually unlinked. Paths outside Plexy's managed prepared directories are
 * ignored, so a stale database row can never delete user media.
 */
export async function removePreparedFile(path: string): Promise<boolean> {
  if (!isPreparedArtifact(path)) return false;
  try {
    await unlink(path);
    return true;
  } catch {
    return false;
  }
}
