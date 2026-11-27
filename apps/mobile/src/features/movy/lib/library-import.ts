import { Directory, File, FileMode, Paths } from "expo-file-system";
import { invalidateLocalResources } from "@/core/resources/use-resource";
import { localApi, localLibrary } from "@/core/library/local-runtime";
import { removeSaved } from "@/features/remote/lib/remote-state";
import {
  getRemoteProgress,
  getRemoteTitleProgress,
} from "@/features/remote/lib/remote-progress";
import { validateContainerBytes } from "./containers";
import {
  episodeRelativePath,
  movieRelativePath,
} from "./paths";
import type { MovyDownloadRecord } from "./types";

const DOWNLOADS_NAME = "Plexy Downloads";
const INCOMPLETE_NAME = ".incomplete";

export { episodeRelativePath, movieRelativePath } from "./paths";

export function downloadsRoot(): Directory {
  return new Directory(Paths.document, DOWNLOADS_NAME);
}

export function incompleteRoot(): Directory {
  const directory = new Directory(downloadsRoot(), INCOMPLETE_NAME);
  directory.create({ intermediates: true, idempotent: true });
  return directory;
}

export function localCopy(
  record: Pick<
    MovyDownloadRecord,
    "tmdbId" | "mediaType" | "season" | "episode"
  >,
) {
  return (
    localLibrary.state.records.find((entry) => {
      if (entry.tmdbId !== record.tmdbId) return false;
      if (record.mediaType === "movie") return entry.card.kind === "movie";
      return (
        entry.card.seasonNumber === record.season &&
        entry.card.episodeNumber === record.episode
      );
    }) ?? null
  );
}

function validateFile(file: File, expectedBytes: number | null) {
  if (!file.exists || !file.size) {
    throw new Error("The downloaded file is empty.");
  }
  if (expectedBytes && file.size !== expectedBytes) {
    throw new Error(
      `The download is incomplete (${file.size} of ${expectedBytes} bytes).`,
    );
  }
  const handle = file.open(FileMode.ReadOnly);
  let bytes: Uint8Array;
  try {
    bytes = handle.readBytes(64);
  } finally {
    handle.close();
  }
  return validateContainerBytes(bytes, file.name).extension;
}

function uniqueDestination(root: Directory, relative: string) {
  const segments = relative.split("/");
  const filename = segments.pop()!;
  const directory = new Directory(root, ...segments);
  directory.create({ intermediates: true, idempotent: true });
  const dot = filename.lastIndexOf(".");
  const stem = dot > 0 ? filename.slice(0, dot) : filename;
  const extension = dot > 0 ? filename.slice(dot) : "";
  for (let index = 0; index < 100; index += 1) {
    const candidate = new File(
      directory,
      index === 0 ? filename : `${stem} (${index + 1})${extension}`,
    );
    if (!candidate.exists) return candidate;
  }
  throw new Error("Could not find an unused filename for this download.");
}

export async function ensureDownloadsRoot(): Promise<Directory> {
  const root = downloadsRoot();
  root.create({ intermediates: true, idempotent: true });
  if (!localLibrary.state.roots.some((entry) => entry.uri === root.uri)) {
    await localLibrary.addRoot({
      uri: root.uri,
      name: DOWNLOADS_NAME,
      kind: "auto",
    });
  }
  return root;
}

async function scanDownloads(root: Directory) {
  // `scan()` returns the active scan instead of starting a second one.
  while (localLibrary.scanning) await localLibrary.scan();
  await localLibrary.scan([root.uri]);
}

function remoteResume(record: MovyDownloadRecord) {
  if (record.mediaType === "tv" && record.season != null && record.episode != null) {
    return getRemoteProgress(
      record.mediaType,
      record.tmdbId,
      record.season,
      record.episode,
    );
  }
  return getRemoteTitleProgress(record.mediaType, record.tmdbId);
}

/**
 * Validate, rename, move into the library folder, scan, remove the online
 * bookmark, and carry the online resume point to the local file.
 */
export async function importCompletedDownload(
  record: MovyDownloadRecord,
  completed: File,
): Promise<{ fileId: number; uri: string }> {
  const extension = validateFile(completed, record.expectedBytes);
  const root = await ensureDownloadsRoot();
  const relative =
    record.mediaType === "movie"
      ? movieRelativePath(record, extension)
      : episodeRelativePath(record, extension);
  const destination = uniqueDestination(root, relative);
  await completed.move(destination, { overwrite: false });
  await scanDownloads(root);

  const local = localLibrary.state.records.find(
    (entry) => entry.file.uri === destination.uri,
  );
  if (!local) {
    throw new Error("The downloaded file was not added to the library.");
  }

  await removeSaved(record.mediaType, record.tmdbId).catch(() => {});
  invalidateLocalResources();

  const remote = remoteResume(record);
  if (remote && (remote.position > 0 || remote.played)) {
    const duration = remote.duration;
    const position =
      duration && duration > 0
        ? Math.min(remote.position, Math.max(0, duration * 0.95))
        : remote.position;
    await localApi
      .progress(local.id, position, duration ?? undefined, remote.played)
      .catch(() => {});
  }

  return { fileId: local.id, uri: destination.uri };
}
