import * as FS from "expo-file-system/legacy";
import NetInfo from "@react-native-community/netinfo";
import {
  PlexyApi,
  type ItemCard,
  type Playability,
  type SkipSegments,
} from "./api";
import { scopeKey, type Preferences } from "./storage";
import { parseVtt, type Cue } from "./vtt";
import { validateTransfer } from "./download-policy";
export type DownloadState =
  "queued" | "downloading" | "paused" | "completed" | "failed";
export interface DownloadEntry {
  id: string;
  fileId: number;
  item: ItemCard;
  label: string;
  maxHeight?: number;
  state: DownloadState;
  bytes: number;
  expected: number;
  uri: string;
  resumeData?: string;
  etag?: string;
  error?: string;
  manifest: Playability;
  subtitles?: Record<string, Cue[]>;
  skips?: SkipSegments;
}
export class DownloadManager {
  entries: DownloadEntry[] = [];
  private active?: {
    id: string;
    task: FS.DownloadResumable;
    finished: Promise<void>;
    finish: () => void;
  };
  private stopped = false;
  private writes: Promise<void> = Promise.resolve();
  private listeners = new Set<() => void>();
  private unsubscribe?: () => void;
  private busy = false;
  private directory: string;
  storageError: string | null = null;
  constructor(
    private scope: string,
    private api: PlexyApi,
    private preferences: () => Preferences,
  ) {
    this.directory = `${FS.documentDirectory || ""}downloads/${scopeKey(scope)}/`;
  }
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };
  private publish(persist = true) {
    this.entries = [...this.entries];
    this.listeners.forEach((l) => l());
    if (persist) {
      const snapshot = JSON.stringify(this.entries);
      this.writes = this.writes
        .catch(() => {})
        .then(async () => {
          await FS.makeDirectoryAsync(this.directory, { intermediates: true });
          const index = `${this.directory}index.json`;
          if ((await FS.getInfoAsync(index)).exists)
            await FS.copyAsync({ from: index, to: `${index}.backup` });
          await FS.writeAsStringAsync(index, snapshot);
        });
      void this.writes.catch(() => {
        this.storageError =
          "Could not save the download index. Check available storage before downloading more media.";
        this.publish(false);
      });
    }
  }
  async restore() {
    if (this.stopped) return;
    if (!FS.documentDirectory)
      throw new Error("Device storage is unavailable.");
    let saved: DownloadEntry[] = [];
    for (const file of ["index.json", "index.json.backup"]) {
      if (!(await FS.getInfoAsync(this.directory + file)).exists) continue;
      try {
        saved = JSON.parse(
          await FS.readAsStringAsync(this.directory + file),
        ) as DownloadEntry[];
        break;
      } catch {
        this.storageError =
          "The download index was recovered from a backup, or could not be loaded.";
      }
    }
    this.entries = saved.map((e) =>
      e.state === "downloading"
        ? {
            ...e,
            state: "paused",
            error: e.maxHeight
              ? "Interrupted conversion. Retry starts from the beginning."
              : "Transfer interrupted. Resume or retry to continue.",
          }
        : e,
    );
    for (const e of this.entries) {
      if (e.state === "completed" && !(await FS.getInfoAsync(e.uri)).exists) {
        e.state = "failed";
        e.error = "The saved file is missing. Download it again.";
      }
    }
    if (this.stopped) return;
    this.publish();
    this.unsubscribe = NetInfo.addEventListener((state) => {
      if (
        !state.isConnected ||
        (this.preferences().wifiOnly &&
          state.type !== "wifi" &&
          state.type !== "ethernet")
      )
        void this.pauseActive();
      else void this.pump();
    });
    void this.pump();
  }
  private async persist() {
    this.publish();
    await this.writes;
  }
  async enqueue(
    item: ItemCard,
    manifest: Playability,
    fileId: number,
    label: string,
    maxHeight?: number,
  ) {
    if (!FS.documentDirectory)
      throw new Error("Device storage is unavailable.");
    if (
      this.entries.some((e) => e.fileId === fileId && e.maxHeight === maxHeight)
    )
      throw new Error("This version is already in Downloads.");
    const version = manifest.versions?.find((v) => v.fileId === fileId);
    const expected = version?.size || 0;
    const free = await FS.getFreeDiskStorageAsync();
    const reserved = this.entries
      .filter((e) => e.state !== "completed")
      .reduce((n, e) => n + Math.max(0, e.expected - e.bytes), 0);
    const used = this.entries.reduce(
      (n, e) => n + Math.max(e.bytes, e.expected),
      0,
    );
    if (free - reserved < expected + 256 * 1024 ** 2)
      throw new Error("Not enough free device storage for this download.");
    if (
      this.preferences().downloadCapGb > 0 &&
      used + expected > this.preferences().downloadCapGb * 1024 ** 3
    )
      throw new Error(
        "This download exceeds your storage limit. Remove downloads or change the limit.",
      );
    const dir = `${FS.documentDirectory}downloads/${scopeKey(this.scope)}/`;
    await FS.makeDirectoryAsync(dir, { intermediates: true });
    const id = `${fileId}-${maxHeight || "source"}-${Date.now()}`;
    this.entries.push({
      id,
      fileId,
      item,
      manifest: { ...manifest, fileId },
      label,
      maxHeight,
      state: "queued",
      bytes: 0,
      expected,
      uri: `${dir}${id}.media`,
    });
    await this.persist();
    void this.pump();
  }
  async pauseActive() {
    if (this.active) await this.pause(this.active.id);
  }
  async pause(id: string) {
    const e = this.entries.find((e) => e.id === id);
    if (!e || e.state === "completed") return;
    e.state = "paused";
    if (this.active?.id === id) {
      const active = this.active;
      const { task } = active;
      try {
        const saved = await task.pauseAsync();
        e.resumeData = e.maxHeight ? undefined : saved.resumeData;
      } catch {
        e.error =
          "Paused. If the transfer cannot resume, retry it from the beginning.";
      }
      await active.finished;
    }
    await this.persist();
  }
  async retry(id: string) {
    const e = this.entries.find((e) => e.id === id);
    if (!e || e.state === "completed" || this.active?.id === id) return;
    e.error = undefined;
    e.state = "queued";
    await this.persist();
    void this.pump();
  }
  async remove(id: string) {
    await this.pause(id);
    const e = this.entries.find((e) => e.id === id);
    if (!e) return;
    await FS.deleteAsync(e.uri, { idempotent: true });
    this.entries = this.entries.filter((e) => e.id !== id);
    await this.persist();
  }
  async clear() {
    await this.pauseActive();
    for (const e of [...this.entries]) await this.remove(e.id);
  }
  async dispose() {
    this.stopped = true;
    this.unsubscribe?.();
    await this.pauseActive();
  }
  async pump() {
    if (this.stopped || this.busy) return;
    this.busy = true;
    let transferred = false;
    try {
      const network = await NetInfo.fetch();
      if (
        !network.isConnected ||
        (this.preferences().wifiOnly &&
          network.type !== "wifi" &&
          network.type !== "ethernet")
      )
        return;
      const e = this.entries.find((e) => e.state === "queued");
      if (!e) return;
      transferred = true;
      e.state = "downloading";
      e.error = undefined;
      await this.persist();
      // Resume state contains only native resume data. Bearer headers are supplied fresh,
      // never serialized with DownloadResumable.savable() into device preferences.
      const url = this.api.download(
        e.fileId,
        e.maxHeight,
        e.manifest.selectedAudioIndex,
      );
      // Android's native resume payload is the byte count. Recover it from the
      // partial file after process death or network failure, not just a clean pause.
      if (!e.maxHeight) {
        const partial = await FS.getInfoAsync(e.uri);
        if (partial.exists && partial.size > 0) {
          e.resumeData = String(partial.size);
          e.bytes = partial.size;
        }
      }
      if (!e.maxHeight) {
        try {
          const info = await this.api.request<{ etag: string; size: number }>(
            `/api/download/${e.fileId}/info`,
          );
          if (!info.etag || !(info.size > 0))
            throw new Error(
              "Update Plexy Server to support safe native downloads.",
            );
          if (e.resumeData && info.etag !== e.etag) {
            await FS.deleteAsync(e.uri, { idempotent: true });
            e.resumeData = undefined;
            e.bytes = 0;
          }
          e.etag = info.etag;
          e.expected = info.size;
        } catch (error) {
          e.state = "failed";
          e.error =
            error instanceof Error
              ? error.message
              : "Could not check the source.";
          await this.persist();
          return;
        }
      }
      if (this.stopped || (e.state as DownloadState) !== "downloading") {
        e.state = "paused";
        await this.persist();
        return;
      }
      const resumeAt = e.maxHeight ? 0 : Number(e.resumeData) || 0;
      let lastPersist = 0;
      let lastStorageCheck = 0;
      const task = FS.createDownloadResumable(
        url,
        e.uri,
        {
          headers: {
            ...this.api.headers(),
            ...(e.etag ? { "If-Range": e.etag } : {}),
          },
        },
        (p) => {
          e.bytes = p.totalBytesWritten;
          e.expected =
            p.totalBytesExpectedToWrite > 0
              ? p.totalBytesExpectedToWrite
              : e.expected;
          const persist = Date.now() - lastPersist > 1500;
          if (persist) lastPersist = Date.now();
          this.publish(persist);
          if (Date.now() - lastStorageCheck > 8000) {
            lastStorageCheck = Date.now();
            void FS.getFreeDiskStorageAsync()
              .then((free) => {
                const cap = this.preferences().downloadCapGb;
                const used = this.entries.reduce(
                  (total, entry) => total + entry.bytes,
                  0,
                );
                if (
                  this.active?.id === e.id &&
                  (free < 128 * 1024 ** 2 ||
                    (cap > 0 && used > cap * 1024 ** 3))
                ) {
                  e.error =
                    "Download paused because device storage or your download limit is nearly full.";
                  void this.pause(e.id).catch(() => {});
                }
              })
              .catch(() => {});
          }
        },
        e.maxHeight ? undefined : e.resumeData,
      );
      let finish!: () => void;
      const finished = new Promise<void>((resolve) => {
        finish = resolve;
      });
      this.active = { id: e.id, task, finished, finish };
      try {
        const result =
          e.resumeData && !e.maxHeight
            ? await task.resumeAsync()
            : await task.downloadAsync();
        if ((e.state as DownloadState) === "paused") return;
        if (!result) throw new Error("Download stopped. Retry to continue.");
        const info = await FS.getInfoAsync(e.uri);
        const invalid = validateTransfer(
          resumeAt,
          result.status,
          result.headers,
          info.exists ? info.size : 0,
        );
        if (invalid) {
          // Failed HTTP responses can append JSON into the partial media. Remove
          // the file before retry rather than retaining a corrupt resume point.
          await FS.deleteAsync(e.uri, { idempotent: true });
          e.resumeData = undefined;
          e.bytes = 0;
          throw new Error(invalid);
        }
        if (!info.exists) throw new Error("The downloaded file is missing.");
        e.bytes = info.size;
        e.expected = info.size;
        e.resumeData = undefined;
        e.state = "completed";
        await this.persist();
        e.subtitles = {};
        for (const track of e.manifest.tracks || []) {
          if (this.stopped || !this.entries.includes(e)) break;
          try {
            const cues = parseVtt(
              await this.api.text(
                `/api/subtitles/${e.fileId}/${encodeURIComponent(track.track)}`,
              ),
            );
            e.subtitles = { ...e.subtitles, [track.track]: cues };
          } catch {
            /* Media remains playable if an optional subtitle is unavailable. */
          }
        }
        e.skips = await this.api
          .skips(e.fileId)
          .catch(() => ({ intro: null, recap: null, outro: null }));
        e.state = "completed";
      } catch (error) {
        if ((e.state as DownloadState) !== "paused") {
          e.state = "failed";
          e.error =
            error instanceof Error
              ? error.message
              : "Download failed. Retry to continue.";
        }
      } finally {
        this.active = undefined;
        finish();
        await this.persist();
      }
    } finally {
      this.busy = false;
      if (
        transferred &&
        !this.stopped &&
        this.entries.some((e) => e.state === "queued")
      )
        setTimeout(() => void this.pump(), 100);
    }
  }
}
