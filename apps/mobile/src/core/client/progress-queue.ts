import type { LocalCatalog } from "@/core/library/catalog-api";
export interface Progress {
  itemId: number;
  position: number;
  duration?: number;
  played: boolean;
  updatedAt: number;
  synced?: boolean;
}
export function mergeProgress(
  previous: Progress | undefined,
  next: Progress,
): Progress {
  // Latest position wins even for restart/backward seeks. Completion remains monotonic.
  return { ...next, played: Boolean(previous?.played || next.played) };
}
/**
 * Playback can report noisy values (a seek before duration is known, a stale
 * tick after the end). Keep the stored shape safe without discarding the
 * user's real position.
 */
export function normalizeProgress(progress: Progress): Progress {
  const rawDuration = progress.duration;
  const duration =
    typeof rawDuration === "number" && Number.isFinite(rawDuration) && rawDuration > 0
      ? rawDuration
      : undefined;
  const rawPosition = Number.isFinite(progress.position) ? progress.position : 0;
  let position = Math.max(0, rawPosition);
  if (duration) position = Math.min(position, duration);
  return {
    ...progress,
    position,
    duration,
    played:
      Boolean(progress.played) ||
      (duration != null && duration > 0 && position >= duration * 0.95),
  };
}
export interface ProgressStorage {
  load(): Promise<Progress[]>;
  save(values: Progress[]): Promise<void>;
}
export interface ProgressQueueOptions {
  /** Wait for playback to settle before writing the device copy. */
  persistDelayMs?: number;
  /** Never postpone a write longer than this while playback keeps ticking. */
  maxPersistDelayMs?: number;
}
const DEFAULT_PERSIST_DELAY = 2_000;
const DEFAULT_MAX_PERSIST_DELAY = 5_000;
export class ProgressQueue {
  private pending = new Map<number, Progress>();
  private history = new Map<number, Progress>();
  private flushing?: Promise<void>;
  private writes: Promise<void> = Promise.resolve();
  private persistTimer: ReturnType<typeof setTimeout> | null = null;
  private dirtySince = 0;
  private readonly persistDelay: number;
  private readonly maxPersistDelay: number;
  constructor(
    private storage: ProgressStorage,
    options: ProgressQueueOptions = {},
  ) {
    this.persistDelay = Math.max(0, options.persistDelayMs ?? DEFAULT_PERSIST_DELAY);
    this.maxPersistDelay = Math.max(
      this.persistDelay,
      options.maxPersistDelayMs ?? DEFAULT_MAX_PERSIST_DELAY,
    );
  }
  async restore() {
    for (const raw of await this.storage.load()) {
      if (!raw || !Number.isSafeInteger(raw.itemId)) continue;
      const p = normalizeProgress(raw);
      this.history.set(p.itemId, p);
      if (!p.synced) this.pending.set(p.itemId, p);
    }
  }
  private persistNow() {
    if (this.persistTimer) {
      clearTimeout(this.persistTimer);
      this.persistTimer = null;
    }
    this.dirtySince = 0;
    const values = [...this.history.values()];
    this.writes = this.writes
      .catch(() => {})
      .then(() => this.storage.save(values));
    return this.writes;
  }
  /**
   * Buffer frequent playback ticks in one write. A trailing debounce keeps
   * churn low, while maxPersistDelay guarantees the position reaches disk
   * during long uninterrupted playback.
   */
  private schedulePersist() {
    const now = Date.now();
    if (!this.dirtySince) this.dirtySince = now;
    if (this.persistTimer) clearTimeout(this.persistTimer);
    const remaining = this.maxPersistDelay - (now - this.dirtySince);
    const wait = Math.max(0, Math.min(this.persistDelay, remaining));
    this.persistTimer = setTimeout(() => {
      this.persistTimer = null;
      void this.persistNow().catch(() => {});
    }, wait);
  }
  /** Force the device copy to disk, e.g. on exit or app background. */
  async flushLocal() {
    if (!this.dirtySince && !this.persistTimer) {
      await this.writes.catch(() => {});
      return;
    }
    await this.persistNow().catch(() => {});
  }
  latest(itemId: number) {
    return this.history.get(itemId);
  }
  async forget(itemId: number) {
    this.pending.delete(itemId);
    this.history.delete(itemId);
    await this.persistNow().catch(() => {});
  }
  async record(progress: Progress) {
    const next = mergeProgress(
      this.history.get(progress.itemId),
      normalizeProgress({ ...progress, synced: false }),
    );
    this.pending.set(progress.itemId, next);
    this.history.set(progress.itemId, next);
    this.schedulePersist();
  }
  flush(api: LocalCatalog): Promise<void> {
    if (this.flushing) return this.flushing;
    this.flushing = (async () => {
      // Snapshot before the local write so a tick that lands while the device
      // copy is being written stays pending for the next network pass.
      const snapshot = [...this.pending.values()];
      await this.flushLocal();
      for (const p of snapshot) {
        await api.progress(p.itemId, p.position, p.duration, p.played);
        if (this.pending.get(p.itemId) === p) {
          this.pending.delete(p.itemId);
          this.history.set(p.itemId, { ...p, synced: true });
        }
        await this.persistNow();
      }
    })().finally(() => {
      this.flushing = undefined;
    });
    return this.flushing;
  }
}
