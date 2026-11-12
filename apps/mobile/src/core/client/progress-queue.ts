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
export interface ProgressStorage {
  load(): Promise<Progress[]>;
  save(values: Progress[]): Promise<void>;
}
export class ProgressQueue {
  private pending = new Map<number, Progress>();
  private history = new Map<number, Progress>();
  private flushing?: Promise<void>;
  private writes: Promise<void> = Promise.resolve();
  constructor(private storage: ProgressStorage) {}
  async restore() {
    for (const p of await this.storage.load()) {
      this.history.set(p.itemId, p);
      if (!p.synced) this.pending.set(p.itemId, p);
    }
  }
  private persist() {
    const values = [...this.history.values()];
    this.writes = this.writes
      .catch(() => {})
      .then(() => this.storage.save(values));
    return this.writes;
  }
  latest(itemId: number) {
    return this.history.get(itemId);
  }
  async forget(itemId: number) {
    this.pending.delete(itemId);
    this.history.delete(itemId);
    await this.persist();
  }
  async record(progress: Progress) {
    const next = mergeProgress(this.history.get(progress.itemId), {
      ...progress,
      synced: false,
    });
    this.pending.set(progress.itemId, next);
    this.history.set(progress.itemId, next);
    await this.persist();
  }
  flush(api: LocalCatalog): Promise<void> {
    if (this.flushing) return this.flushing;
    this.flushing = (async () => {
      for (const p of [...this.pending.values()]) {
        await api.progress(p.itemId, p.position, p.duration, p.played);
        if (this.pending.get(p.itemId) === p) {
          this.pending.delete(p.itemId);
          this.history.set(p.itemId, { ...p, synced: true });
        }
        await this.persist();
      }
    })().finally(() => {
      this.flushing = undefined;
    });
    return this.flushing;
  }
}
