import AsyncStorage from "@react-native-async-storage/async-storage";
import NetInfo from "@react-native-community/netinfo";
import {
  DownloadTask,
  File,
  type DownloadPauseState,
  type DownloadProgress,
} from "expo-file-system";
import { createStore } from "@/features/remote/lib/remote-state";
import { importCompletedDownload, incompleteRoot } from "./library-import";
import {
  nativeDownloads,
  type NativeDownloadJob,
} from "./native-downloads";
import type {
  MovyDownloadRecord,
  NativeDownloadProgress,
  NativeDownloadResult,
  NativeDownloadState,
} from "./types";

const DOWNLOADS_KEY = "plexy.movy.downloads";
const URLS_KEY = "plexy.movy.urls";

export const downloadsStore = createStore<MovyDownloadRecord[]>([]);

export interface DownloadRuntime {
  background: boolean;
  multiStream: boolean;
  wifiOnly: boolean;
}

let runtime: DownloadRuntime = {
  background: true,
  multiStream: true,
  wifiOnly: true,
};

export function configureDownloads(next: Partial<DownloadRuntime>) {
  runtime = { ...runtime, ...next };
}

let writes: Promise<void> = Promise.resolve();
function persist(records: MovyDownloadRecord[]) {
  downloadsStore.set(records);
  writes = writes
    .catch(() => {})
    .then(() => AsyncStorage.setItem(DOWNLOADS_KEY, JSON.stringify(records)))
    .catch(() => {});
  return writes;
}

export async function loadDownloads(): Promise<MovyDownloadRecord[]> {
  try {
    const raw = await AsyncStorage.getItem(DOWNLOADS_KEY);
    const parsed = raw ? (JSON.parse(raw) as unknown) : [];
    const valid = Array.isArray(parsed)
      ? parsed.filter(
          (entry): entry is MovyDownloadRecord =>
            Boolean(entry) &&
            typeof entry === "object" &&
            typeof (entry as MovyDownloadRecord).id === "string" &&
            typeof (entry as MovyDownloadRecord).tmdbId === "number",
        )
      : [];
    const repaired = valid.map((entry) =>
      entry.status === "downloading" || entry.status === "verifying"
        ? {
            ...entry,
            status: "paused" as const,
            error: "The download was interrupted. Resume it to continue.",
          }
        : entry,
    );
    downloadsStore.set(repaired);
    return repaired;
  } catch {
    downloadsStore.set([]);
    return [];
  }
}

export async function replaceDownloads(records: MovyDownloadRecord[]) {
  await persist(records);
}

export async function patchDownload(
  id: string,
  patch: Partial<MovyDownloadRecord>,
  persistChange = true,
) {
  const next = downloadsStore.get().map((record) =>
    record.id === id ? { ...record, ...patch } : record,
  );
  if (persistChange) await persist(next);
  else downloadsStore.set(next);
}

export async function removeDownload(id: string) {
  const next = downloadsStore.get().filter((record) => record.id !== id);
  await persist(next);
}

export function findDownload(
  mediaType: MovyDownloadRecord["mediaType"],
  tmdbId: number,
  season?: number | null,
  episode?: number | null,
) {
  return downloadsStore
    .get()
    .filter(
      (record) =>
        record.mediaType === mediaType &&
        record.tmdbId === tmdbId &&
        (record.season ?? null) === (season ?? null) &&
        (record.episode ?? null) === (episode ?? null),
    )
    .sort((a, b) => b.createdAt - a.createdAt)[0];
}

export function findDownloadById(id: string) {
  return downloadsStore.get().find((record) => record.id === id);
}

export interface CachedUrl {
  url: string;
  filename: string;
  quality: string;
  expiresAt: number;
}

let urlCache = new Map<string, CachedUrl>();
let urlCacheLoaded = false;

export async function loadUrlCache() {
  if (urlCacheLoaded) return;
  urlCacheLoaded = true;
  try {
    const raw = await AsyncStorage.getItem(URLS_KEY);
    const parsed = raw ? (JSON.parse(raw) as Record<string, CachedUrl>) : {};
    const now = Date.now();
    for (const [key, value] of Object.entries(parsed)) {
      if (value?.url && value.expiresAt > now) urlCache.set(key, value);
    }
  } catch {
    // A broken cache only costs one extra credit.
  }
}

export function cachedUrl(key: string) {
  const value = urlCache.get(key);
  if (!value) return null;
  if (value.expiresAt <= Date.now()) {
    urlCache.delete(key);
    return null;
  }
  return value;
}

export function cacheUrl(key: string, value: Omit<CachedUrl, "expiresAt">, resetAt: string | null) {
  const reset = resetAt ? Date.parse(resetAt) : Number.NaN;
  const fallback = Date.now() + 6 * 60 * 60_000;
  urlCache.set(key, {
    ...value,
    expiresAt:
      Number.isFinite(reset) && reset > Date.now() ? reset : fallback,
  });
  const payload: Record<string, CachedUrl> = {};
  for (const [entryKey, entry] of urlCache) payload[entryKey] = entry;
  void AsyncStorage.setItem(URLS_KEY, JSON.stringify(payload)).catch(() => {});
}

export function clearUrlCache() {
  urlCache = new Map();
  void AsyncStorage.removeItem(URLS_KEY).catch(() => {});
}

export function downloadUrlKey(record: MovyDownloadRecord) {
  return [
    record.mediaType,
    record.tmdbId,
    record.season ?? 0,
    record.episode ?? 0,
    record.quality,
  ].join(":");
}

export function tempFileFor(record: MovyDownloadRecord) {
  const filename = `${record.id.replace(/[^a-zA-Z0-9._-]/g, "-")}.part`;
  return new File(incompleteRoot(), filename);
}

const foreground = new Map<string, DownloadTask>();
const finishing = new Set<string>();
const waitingForWifi = (message: string) => /wi-?fi|connect to wi/i.test(message);

function progressPatch(
  record: MovyDownloadRecord,
  bytes: number,
  expectedBytes: number | null,
) {
  const total = expectedBytes ?? record.expectedBytes;
  const progress = total && total > 0 ? Math.min(0.999, bytes / total) : 0;
  return { bytes, progress };
}

function updateFromForeground(record: MovyDownloadRecord, event: DownloadProgress) {
  const expected = event.totalBytes > 0 ? event.totalBytes : record.expectedBytes;
  void patchDownload(
    record.id,
    {
      ...progressPatch(record, event.bytesWritten, expected),
      expectedBytes: expected,
    },
    false,
  );
}

async function finish(record: MovyDownloadRecord, result: { fileUri: string; bytes: number }) {
  if (record.status === "completed" || finishing.has(record.id)) return;
  finishing.add(record.id);
  await patchDownload(record.id, {
    status: "verifying",
    bytes: result.bytes,
    progress: 1,
    error: null,
  });
  try {
    // The provider's size label is rounded; the final byte count is exact.
    const imported = await importCompletedDownload(
      { ...record, expectedBytes: result.bytes },
      new File(result.fileUri),
    );
    await patchDownload(record.id, {
      status: "completed",
      progress: 1,
      completedAt: Date.now(),
      libraryUri: imported.uri,
      libraryFileId: imported.fileId,
      error: null,
    });
    // A completed file no longer needs its signed URL.
    urlCache.delete(downloadUrlKey(record));
    const payload: Record<string, CachedUrl> = {};
    for (const [key, value] of urlCache) payload[key] = value;
    void AsyncStorage.setItem(URLS_KEY, JSON.stringify(payload)).catch(() => {});
  } catch (error) {
    await patchDownload(record.id, {
      status: "failed",
      error: error instanceof Error ? error.message : "Could not add the download to the library.",
    });
  } finally {
    finishing.delete(record.id);
    void startQueue();
  }
}

async function runForeground(record: MovyDownloadRecord) {
  if (runtime.wifiOnly) {
    const state = await NetInfo.fetch();
    if (
      !state.isConnected ||
      (state.type !== "wifi" && state.type !== "ethernet")
    ) {
      throw new Error("Connect to Wi-Fi and retry the download.");
    }
  }
  if (!record.url) {
    await patchDownload(record.id, {
      status: "failed",
      error: "The download link is missing. Try again from the title.",
    });
    return;
  }
  const file = tempFileFor(record);
  if (!record.resumeData) {
    file.create({ intermediates: true, overwrite: true });
  }
  const options = {
    onProgress: (event: DownloadProgress) => updateFromForeground(record, event),
  };
  let task: DownloadTask;
  try {
    task = record.resumeData
      ? DownloadTask.fromSavable(
          JSON.parse(record.resumeData) as DownloadPauseState,
          options,
        )
      : new DownloadTask(record.url, file, options);
  } catch (error) {
    await patchDownload(record.id, {
      status: "failed",
      error: error instanceof Error ? error.message : "Could not start the download.",
    });
    return;
  }
  foreground.set(record.id, task);
  await patchDownload(record.id, {
    status: "downloading",
    error: null,
    strategy: "resume",
  });
  try {
    const completed = record.resumeData
      ? await task.resumeAsync()
      : await task.downloadAsync();
    foreground.delete(record.id);
    if (!completed) return; // paused
    const info = completed.info();
    await finish(record, {
      fileUri: completed.uri,
      bytes: info.size ?? completed.size,
    });
  } catch (error) {
    foreground.delete(record.id);
    const message =
      error instanceof Error ? error.message : "The download failed.";
    const waiting = waitingForWifi(message);
    await patchDownload(record.id, {
      status: waiting ? "paused" : "failed",
      error: message,
    });
    if (!waiting) void startQueue();
  }
}

async function startRecord(record: MovyDownloadRecord) {
  if (!record.url) {
    await patchDownload(record.id, {
      status: "failed",
      error: "The download link is missing. Try again from the title.",
    });
    return;
  }
  if (runtime.background && nativeDownloads) {
    const file = tempFileFor(record);
    const job: NativeDownloadJob = {
      id: record.id,
      url: record.url,
      destination: file.uri,
      expectedBytes: record.expectedBytes,
      etag: record.etag,
      title: record.title,
      display: record.display,
      accountUsername: record.accountUsername,
      multiStream: runtime.multiStream,
      wifiOnly: runtime.wifiOnly,
    };
    await patchDownload(record.id, {
      status: "downloading",
      error: null,
      strategy: runtime.multiStream ? "multi" : "resume",
    });
    try {
      await nativeDownloads.start(JSON.stringify(job));
    } catch (error) {
      await patchDownload(record.id, {
        status: "failed",
        error:
          error instanceof Error
            ? error.message
            : "Could not start the background download.",
      });
    }
    return;
  }
  try {
    await runForeground(record);
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "The download could not start.";
    const waiting = waitingForWifi(message);
    await patchDownload(record.id, {
      status: waiting ? "paused" : "failed",
      error: message,
    });
    if (!waiting) void startQueue();
  }
}

export async function startQueue() {
  const records = downloadsStore.get();
  if (
    records.some(
      (record) =>
        record.status === "downloading" || record.status === "verifying",
    )
  )
    return;
  const next = records
    .filter((record) => record.status === "queued")
    .sort((a, b) => a.createdAt - b.createdAt)[0];
  if (!next) return;
  await startRecord(next);
}

export async function pauseDownload(id: string) {
  const record = findDownloadById(id);
  if (!record) return;
  if (nativeDownloads && runtime.background) {
    await nativeDownloads.pause(id).catch(() => {});
  } else {
    const task = foreground.get(id);
    if (task) {
      await task.pauseAsync().catch(() => {});
      try {
        const saved = task.savable();
        await patchDownload(id, {
          resumeData: JSON.stringify(saved),
          status: "paused",
        });
      } catch {
        await patchDownload(id, { status: "paused" });
      }
      foreground.delete(id);
    }
  }
  await patchDownload(id, { status: "paused" });
}

export async function resumeDownload(id: string) {
  const record = findDownloadById(id);
  if (!record) return;
  // Re-enter through the queue. `startRecord` starts the native job with the
  // same id and the native service resumes its persisted chunks/file.
  await patchDownload(id, { status: "queued", error: null });
  await startQueue();
}

export async function cancelDownload(id: string, deleteFile = true) {
  const record = findDownloadById(id);
  if (!record) return;
  if (nativeDownloads && runtime.background) {
    await nativeDownloads.cancel(id).catch(() => {});
  }
  foreground.get(id)?.cancel();
  foreground.delete(id);
  if (deleteFile) {
    try {
      const file = tempFileFor(record);
      if (file.exists) file.delete();
    } catch {
      // The import or a previous cancel may already have moved it.
    }
  }
  await removeDownload(id);
}

export async function retryDownload(id: string) {
  const record = findDownloadById(id);
  if (!record) return;
  const file = tempFileFor(record);
  try {
    if (file.exists) file.delete();
  } catch {
    // Keep the record; the next attempt can start clean.
  }
  await patchDownload(id, {
    status: "queued",
    bytes: 0,
    progress: 0,
    resumeData: null,
    chunks: null,
    error: null,
  });
  await startQueue();
}

let nativeListenersInstalled = false;

export function initDownloadManager() {
  if (!nativeDownloads || nativeListenersInstalled) return;
  nativeListenersInstalled = true;
  nativeDownloads.addListener("onProgress", (event: NativeDownloadProgress) => {
    const record = findDownloadById(event.id);
    if (!record) return;
    void patchDownload(
      event.id,
      {
        bytes: event.bytes,
        expectedBytes: event.expectedBytes ?? record.expectedBytes,
        progress: Math.min(0.999, event.progress),
      },
      false,
    );
  });
  nativeDownloads.addListener("onCompleted", (event: NativeDownloadResult) => {
    const record = findDownloadById(event.id);
    if (!record) return;
    void (async () => {
      await finish(record, { fileUri: event.fileUri, bytes: event.bytes });
      await nativeDownloads?.clearCompleted(event.id).catch(() => {});
    })();
  });
  nativeDownloads.addListener("onFailed", (event: { id: string; error: string }) => {
    const record = findDownloadById(event.id);
    if (!record || record.status === "completed") return;
    const waiting = waitingForWifi(event.error);
    void patchDownload(event.id, {
      status: waiting ? "paused" : "failed",
      error: event.error,
    });
    if (!waiting) void startQueue();
  });
}

let syncTimer: ReturnType<typeof setTimeout> | null = null;

export async function syncNativeDownloads() {
  if (!nativeDownloads) return;
  try {
    const states: NativeDownloadState[] = await nativeDownloads.state();
    if (
      states.some((state) => state.status === "downloading") &&
      !syncTimer
    ) {
      syncTimer = setTimeout(() => {
        syncTimer = null;
        void syncNativeDownloads();
      }, 20_000);
    }
    for (const state of states) {
      const record = findDownloadById(state.id);
      if (!record || record.status === "completed") continue;
      if (state.status === "completed") continue;
      const stale =
        state.status === "downloading" &&
        (!state.updatedAt || Date.now() - state.updatedAt > 15_000);
      const wifiWait = waitingForWifi(state.error ?? "");
      await patchDownload(state.id, {
        status:
          stale || wifiWait
            ? "paused"
            : state.status === "paused"
              ? "paused"
              : state.status === "failed"
                ? "failed"
                : "downloading",
        bytes: state.bytes,
        expectedBytes: state.expectedBytes ?? record.expectedBytes,
        progress: Math.min(0.999, state.progress),
        error: stale
          ? "The background download was interrupted. Resume it to continue."
          : state.error || null,
      });
    }
    const completed = await nativeDownloads.completed();
    for (const result of completed) {
      const record = findDownloadById(result.id);
      if (!record) continue;
      await finish(record, { fileUri: result.fileUri, bytes: result.bytes });
      await nativeDownloads.clearCompleted(result.id).catch(() => {});
    }
  } catch {
    // The native service is optional; the foreground path still works.
  }
}
