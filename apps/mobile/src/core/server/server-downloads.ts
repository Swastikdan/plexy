import AsyncStorage from "@react-native-async-storage/async-storage";
import {
  Directory,
  File,
  Paths,
  DownloadTask,
  type DownloadPauseState,
} from "expo-file-system";
import type { ItemCard } from "@/core/library/catalog-api";
import { localLibrary } from "@/core/library/local-runtime";
import { validateContainerBytes } from "@/core/downloads/containers";
import {
  serverAuthHeaders,
  serverJson,
  serverMediaUrl,
  type ServerSession,
} from "./transport";
import { serverSourceId } from "./server-catalog";

const STORAGE_KEY = "plexy.server.downloads.v1";
const DOWNLOADS_NAME = "Plexy Downloads";
const INCOMPLETE_NAME = ".incomplete";

export interface ServerDownloadRecord {
  id: string;
  serverId: string;
  userId: number;
  fileId: number;
  itemId: number;
  name: string;
  title: string;
  seasonNumber: number | null;
  episodeNumber: number | null;
  expectedBytes: number | null;
  status: "queued" | "downloading" | "paused" | "completed" | "failed";
  progress: number;
  error: string | null;
  destination: string | null;
  createdAt: number;
  pauseState?: DownloadPauseState;
}

let records: ServerDownloadRecord[] = [];
let loaded = false;
const listeners = new Set<() => void>();
const tasks = new Map<string, DownloadTask>();

function emit() {
  for (const listener of listeners) listener();
}
function replace(next: ServerDownloadRecord[]) {
  records = next;
  emit();
}
async function persist(next: ServerDownloadRecord[]) {
  replace(next);
  await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(next)).catch(() => {});
}
function patch(id: string, value: Partial<ServerDownloadRecord>, save = true) {
  const next = records.map((record) =>
    record.id === id ? { ...record, ...value } : record,
  );
  if (save) void persist(next);
  else replace(next);
}
export function subscribeServerDownloads(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
export function serverDownloadsSnapshot() {
  return records;
}
export async function loadServerDownloads() {
  if (loaded) return records;
  loaded = true;
  try {
    const raw = await AsyncStorage.getItem(STORAGE_KEY);
    const parsed = raw ? (JSON.parse(raw) as ServerDownloadRecord[]) : [];
    const valid = Array.isArray(parsed)
      ? parsed.filter(
          (entry) =>
            entry &&
            typeof entry.id === "string" &&
            typeof entry.serverId === "string" &&
            Number.isSafeInteger(entry.fileId),
        )
      : [];
    replace(
      valid.map((entry) =>
        entry.status === "downloading" || entry.status === "queued"
          ? {
              ...entry,
              status: "paused" as const,
              error: "The download was interrupted. Resume it to continue.",
            }
          : entry,
      ),
    );
  } catch {
    replace([]);
  }
  return records;
}
export function findServerDownload(id: string) {
  return records.find((record) => record.id === id);
}
export function findServerDownloadFor(fileId: number) {
  return records
    .filter((record) => record.fileId === fileId)
    .sort((a, b) => b.createdAt - a.createdAt)[0];
}
export function serverDownloadId(session: ServerSession, fileId: number) {
  return `${session.serverId}:${session.user.id}:${fileId}`;
}

function safeName(value: string) {
  return value
    .replace(/[\\/:*?"<>|{}]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 120);
}
function pad(value: number) {
  return String(value).padStart(2, "0");
}
function downloadsRoot() {
  return new Directory(Paths.document, DOWNLOADS_NAME);
}
function incompleteRoot() {
  const directory = new Directory(downloadsRoot(), INCOMPLETE_NAME);
  directory.create({ intermediates: true, idempotent: true });
  return directory;
}
function destinationFor(item: ItemCard, extension: string) {
  const root = downloadsRoot();
  root.create({ intermediates: true, idempotent: true });
  const title = safeName(item.parentTitle || item.name) || "Untitled";
  const year = item.year ? ` (${item.year})` : "";
  if (item.kind === "episode") {
    const season = item.seasonNumber ?? 1;
    const episode = item.episodeNumber ?? 1;
    const directory = new Directory(
      root,
      "TV Shows",
      `${title}${year}`,
      `Season ${pad(season)}`,
    );
    directory.create({ intermediates: true, idempotent: true });
    return new File(
      directory,
      `${title} - S${pad(season)}E${pad(episode)}.${extension}`,
    );
  }
  const directory = new Directory(root, "Movies", `${title}${year}`);
  directory.create({ intermediates: true, idempotent: true });
  return new File(directory, `${title}${year}.${extension}`);
}
async function scanDownloads() {
  const root = downloadsRoot();
  if (!localLibrary.state.roots.some((entry) => entry.uri === root.uri)) {
    await localLibrary.addRoot({
      uri: root.uri,
      name: DOWNLOADS_NAME,
      kind: "auto",
    });
  }
  while (localLibrary.scanning) await localLibrary.scan();
  await localLibrary.scan([root.uri]);
}

async function importFile(record: ServerDownloadRecord, file: File) {
  const handle = file.open();
  let bytes: Uint8Array;
  try {
    bytes = handle.readBytes(64);
  } finally {
    handle.close();
  }
  const { extension } = validateContainerBytes(bytes, file.name);
  const item = {
    kind: record.seasonNumber != null ? "episode" : "movie",
    name: record.name,
    parentTitle: record.title,
    year: null,
    seasonNumber: record.seasonNumber,
    episodeNumber: record.episodeNumber,
  } as Pick<
    ItemCard,
    "kind" | "name" | "parentTitle" | "year" | "seasonNumber" | "episodeNumber"
  >;
  let destination = destinationFor(item as ItemCard, extension);
  for (let index = 1; destination.exists && index < 100; index += 1) {
    const dot = destination.name.lastIndexOf(".");
    const stem = dot > 0 ? destination.name.slice(0, dot) : destination.name;
    const suffix = dot > 0 ? destination.name.slice(dot) : "";
    destination = new File(
      destination.parentDirectory,
      `${stem} (${index + 1})${suffix}`,
    );
  }
  await file.move(destination, { overwrite: false });
  await scanDownloads();
  patch(record.id, {
    status: "completed",
    progress: 1,
    expectedBytes: destination.size || record.expectedBytes,
    destination: destination.uri,
    error: null,
  });
}

async function runTask(
  session: ServerSession,
  record: ServerDownloadRecord,
  task: DownloadTask,
) {
  tasks.set(record.id, task);
  patch(record.id, { status: "downloading", error: null });
  try {
    const file = await task.downloadAsync();
    if (!file) {
      const savable = task.state === "paused" ? task.savable() : record.pauseState;
      patch(record.id, { status: "paused", pauseState: savable });
      return;
    }
    await importFile(record, file);
  } catch (error) {
    patch(record.id, {
      status: "failed",
      error: error instanceof Error ? error.message : "Download failed.",
    });
  } finally {
    tasks.delete(record.id);
  }
}

export async function downloadServerItem(
  session: ServerSession,
  item: ItemCard,
) {
  if (item.source !== "server" || item.fileId == null)
    throw new Error("This title is not available from the server.");
  const fileId = serverSourceId(item.fileId);
  const id = serverDownloadId(session, fileId);
  const existing = findServerDownload(id);
  if (existing?.status === "completed") return existing;
  if (existing?.status === "downloading") return existing;
  if (existing?.status === "paused" && existing.pauseState)
    return resumeServerDownload(session, id);

  const info = await serverJson<{ size: number }>(
    session,
    `/api/download/${fileId}/info`,
  );
  const record: ServerDownloadRecord = {
    id,
    serverId: session.serverId,
    userId: session.user.id,
    fileId,
    itemId: serverSourceId(item.id),
    name: item.name,
    title: item.parentTitle || item.name,
    seasonNumber: item.seasonNumber ?? null,
    episodeNumber: item.episodeNumber ?? null,
    expectedBytes: Number(info.size) || null,
    status: "queued",
    progress: 0,
    error: null,
    destination: null,
    createdAt: Date.now(),
  };
  await persist([...records, record]);
  const partial = new File(
    incompleteRoot(),
    `${session.serverId}-${fileId}.part`,
  );
  const task = File.createDownloadTask(
    serverMediaUrl(session, `/api/download/${fileId}`),
    partial,
    {
      headers: serverAuthHeaders(session),
      onProgress: ({ bytesWritten, totalBytes }) => {
        const total = totalBytes > 0 ? totalBytes : record.expectedBytes;
        patch(
          record.id,
          {
            progress: total ? Math.min(0.99, bytesWritten / total) : 0,
          },
          false,
        );
      },
    },
  );
  void runTask(session, record, task);
  return record;
}

export async function pauseServerDownload(id: string) {
  const task = tasks.get(id);
  if (!task) return;
  await task.pauseAsync();
  const record = findServerDownload(id);
  patch(id, {
    status: "paused",
    pauseState: task.state === "paused" ? task.savable() : record?.pauseState,
  });
}

export async function resumeServerDownload(
  session: ServerSession,
  id: string,
) {
  const record = findServerDownload(id);
  if (!record) throw new Error("Download not found.");
  if (!record.pauseState)
    throw new Error("This download has no saved resume state.");
  const task = DownloadTask.fromSavable(record.pauseState, {
    headers: serverAuthHeaders(session),
    onProgress: ({ bytesWritten, totalBytes }) => {
      const total = totalBytes > 0 ? totalBytes : record.expectedBytes;
      patch(
        id,
        { progress: total ? Math.min(0.99, bytesWritten / total) : 0 },
        false,
      );
    },
  });
  void runTask(session, record, task);
  return record;
}

export async function removeServerDownload(id: string) {
  const task = tasks.get(id);
  if (task) {
    task.cancel();
    tasks.delete(id);
  }
  const record = findServerDownload(id);
  if (record?.destination) {
    try {
      const file = new File(record.destination);
      if (file.exists) file.delete();
    } catch {
      /* best effort */
    }
  }
  await persist(records.filter((entry) => entry.id !== id));
}
