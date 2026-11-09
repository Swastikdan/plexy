import type { ItemCard, TitleDetail, Watch, SkipSegments } from "../../api-client/src/types";

export interface LocalFile {
  uri: string;
  name: string;
  relativePath: string;
  directoryUri?: string;
  size: number;
  modified: number;
}
export interface LocalRoot { uri: string; name: string; kind: "movies" | "tv" }
export interface LocalRecord {
  id: number;
  root: string;
  file: LocalFile;
  card: ItemCard;
  metadataAt: number;
  skips?: SkipSegments;
  skipsAt?: number;
  tmdbId?: number;
  cast: TitleDetail["cast"];
}
export interface LocalState {
  version: 1;
  nextId: number;
  roots: LocalRoot[];
  records: LocalRecord[];
  series: Record<string, number>;
}
export interface LocalIO {
  load(): Promise<LocalState | null>;
  save(state: LocalState): Promise<void>;
  /** Reject on any incomplete walk. A missing permission must never erase a library. */
  walk(root: LocalRoot): Promise<LocalFile[]>;
  metadata(record: LocalRecord): Promise<Partial<LocalRecord> | null>;
  markers?(record: LocalRecord): Promise<SkipSegments | null>;
}

const videos = /\.(mkv|mp4|m4v|webm|avi|mov|ts)$/i;
export function parseLocalName(path: string, kind: LocalRoot["kind"]) {
  const parts = path.split("/");
  const stem = parts.at(-1)!.replace(/\.[^.]+$/, "");
  const episode = stem.match(/(?:^|[ ._-])s(\d{1,2})[ ._-]*e(\d{1,3})/i)
    || stem.match(/(?:^|[ ._-])(\d{1,2})x(\d{1,3})/i);
  const seriesFolder = parts.length > 1 ? parts[0]! : null;
  const raw = kind === "tv" ? seriesFolder || stem.slice(0, episode?.index ?? stem.length) : parts.length > 1 ? parts.at(-2)! : stem;
  const year = raw.match(/\b((?:19|20)\d{2})\b/);
  const title = raw.replace(/[[{]tmdb(?:id)?[=: -]*\d+[\]}]/gi, "")
    .replace(/[._]/g, " ").replace(/\(?\b(?:19|20)\d{2}\b\)?/g, "")
    .replace(/\b(?:2160p|1080p|720p|480p|bluray|webrip|web-dl|x264|x265|hevc|h264|h265|aac|dts|hdr|remux)\b.*$/i, "")
    .replace(/\s+/g, " ").trim() || stem;
  return { title, year: year ? Number(year[1]) : null,
    season: episode ? Number(episode[1]) : kind === "tv" ? 1 : null,
    episode: episode ? Number(episode[2]) : kind === "tv" ? 1 : null,
    explicitId: Number(raw.match(/[[{]tmdb(?:id)?[=: -]*(\d+)[\]}]/i)?.[1]) || null };
}

/** The local library owns no network listener and never alters source media. */
export class LocalLibrary {
  state: LocalState = { version: 1, nextId: 1, roots: [], records: [], series: {} };
  issues: string[] = [];
  scanning = false;
  private listeners = new Set<() => void>();
  private writes = Promise.resolve();
  private active: Promise<void> | null = null;
  constructor(private io: LocalIO) {}
  async restore() {
    const saved = await this.io.load();
    if (saved) {
      if (saved.version !== 1 || !Array.isArray(saved.records) || !Array.isArray(saved.roots))
        throw new Error("The local library database could not be read.");
      this.state = saved;
    }
  }
  subscribe(fn: () => void) { this.listeners.add(fn); return () => { this.listeners.delete(fn); }; }
  private changed() { for (const fn of this.listeners) fn(); }
  private persist() {
    // Snapshot before queuing so overlapping progress writes cannot save older state last.
    const snapshot = JSON.parse(JSON.stringify(this.state)) as LocalState;
    this.writes = this.writes.catch(() => {}).then(() => this.io.save(snapshot));
    return this.writes;
  }
  async addRoot(root: LocalRoot) {
    await this.active;
    if (!this.state.roots.some(r => r.uri === root.uri)) {
      this.state.roots.push(root);
      await this.persist();
    }
    await this.scan();
  }
  async removeRoot(uri: string) {
    // A scan operates on a stable root list. Wait before changing it.
    await this.active;
    this.state.roots = this.state.roots.filter(r => r.uri !== uri);
    this.state.records = this.state.records.filter(r => r.root !== uri);
    await this.persist();
    this.changed();
  }
  scan(): Promise<void> {
    if (this.active) return this.active;
    this.active = this.runScan().finally(() => { this.active = null; });
    return this.active;
  }
  private async runScan() {
    this.scanning = true;
    this.issues = [];
    this.changed();
    try {
      for (const root of [...this.state.roots]) {
        let files: LocalFile[];
        try { files = await this.io.walk(root); }
        catch { this.issues.push(`Cannot read ${root.name}. Grant folder access again; its saved library was kept.`); continue; }
        const seen = new Set(files.map(f => f.uri));
        for (const file of files.filter(f => videos.test(f.name))) {
          let record = this.state.records.find(r => r.root === root.uri && r.file.uri === file.uri);
          if (!record) {
            const parsed = parseLocalName(file.relativePath, root.kind);
            const id = this.state.nextId++;
            const seriesKey = `${root.uri}:${parsed.title.toLowerCase()}:${parsed.year ?? ""}`;
            const parentId = root.kind === "tv" ? this.state.series[seriesKey] ??= this.state.nextId++ : null;
            record = { id, root: root.uri, file, metadataAt: 0, cast: [], card: {
              id, publicId: `local-${id}`, kind: root.kind === "movies" ? "movie" : "episode",
              name: parsed.title, year: parsed.year, seasonNumber: parsed.season, episodeNumber: parsed.episode,
              fileId: id, parentId, parentPublicId: parentId ? `local-${parentId}` : null,
              parentTitle: parentId ? parsed.title : null, poster: null, backdrop: null, overview: null,
              rating: null, runtime: null, genres: [], matchStatus: "unmatched", watch: null,
            }};
            this.state.records.push(record);
          } else if (record.file.size !== file.size || record.file.modified !== file.modified) {
            record.file = file;
          }
        }
        this.state.records = this.state.records.filter(r => r.root !== root.uri || seen.has(r.file.uri));
      }
      // Make newly discovered files playable before any internet request finishes.
      await this.persist();
      this.changed();
      for (const record of this.state.records) {
        if (Date.now() - record.metadataAt < 7 * 86400_000) continue;
        try {
          const patch = await this.io.metadata(record);
          if (patch) {
            // Progress may have changed while the TMDB request was in flight.
            const watch = record.card.watch;
            Object.assign(record, patch);
            record.card.watch = watch;
            await this.persist();
            this.changed();
          }
        } catch { /* Offline: retain all existing metadata and retry on reconnect. */ }
      }
      if (this.io.markers) for (const record of this.state.records) {
        if (!record.tmdbId || Date.now() - (record.skipsAt || 0) < 7 * 86400_000) continue;
        try {
          const skips = await this.io.markers(record);
          if (skips) { record.skips = skips; record.skipsAt = Date.now(); await this.persist(); }
        } catch { /* Keep cached markers and retry when connectivity returns. */ }
      }
    } finally { this.scanning = false; this.changed(); }
  }
  cards(): ItemCard[] {
    const movies = this.state.records.filter(r => r.card.kind === "movie").map(r => r.card);
    const groups = new Map<number, LocalRecord[]>();
    for (const r of this.state.records.filter(r => r.card.parentId)) {
      const id = r.card.parentId!;
      groups.set(id, [...(groups.get(id) || []), r]);
    }
    const series = [...groups].map(([id, records]) => ({ ...records[0]!.card, id, publicId: `local-${id}`,
      kind: "series", name: records[0]!.card.parentTitle!, fileId: null, parentId: null,
      watch: records.every(r => r.card.watch?.played) ? { position: 0, duration: null, played: true, percent: 100 } : null }));
    return [...movies, ...series];
  }
  record(id: number) {
    const record = this.state.records.find(r => r.id === id);
    if (!record) throw new Error("This local file is no longer in your library.");
    return record;
  }
  detail(id: number): TitleDetail {
    const record = this.state.records.find(r => r.id === id || r.card.parentId === id);
    if (!record) throw new Error("This title is no longer in your library.");
    const series = record.card.parentId === id;
    const episodes = series ? this.state.records.filter(r => r.card.parentId === id).map(r => r.card)
      .sort((a,b) => (a.seasonNumber! - b.seasonNumber!) || (a.episodeNumber! - b.episodeNumber!)) : null;
    const card = series ? this.cards().find(c => c.id === id)! : record.card;
    return { item: card, logo: null, metadata: { overview: card.overview, tagline: null,
      runtime: card.runtime, rating: card.rating, certification: null, genres: card.genres },
      cast: record.cast, trailer: null,
      seasons: episodes ? [...new Set(episodes.map(e => e.seasonNumber || 1))].map(n => ({ id: n, number: n })) : null,
      episodes, file: series ? null : { fileId: record.id, itemId: record.id, size: record.file.size,
        container: record.file.name.split(".").at(-1)!, duration: card.watch?.duration || null,
        width: null, height: null, videoCodec: null, videoProfile: null, fps: null, hdr: null,
        audio: [], subtitleCount: 0, analysisStatus: "local", analysisError: null,
        likelyPlayPath: "direct", likelyPlayReason: "Plays the original file on this device" },
      tmdbType: record.card.kind === "episode" ? "tv" : "movie", unmatched: card.matchStatus !== "matched", matchReason: null };
  }
  async progress(id: number, position: number, duration: number | null, played = false) {
    for (const r of this.state.records.filter(r => r.id === id || r.card.parentId === id)) {
      const total = duration || r.card.watch?.duration || null;
      const watch: Watch = { position, duration: total, played: played || !!(total && position / total >= .95),
        percent: total ? Math.min(100, 100 * position / total) : 0 };
      r.card.watch = watch;
    }
    await this.persist();
    this.changed();
  }
  async clearWatch(id: number) {
    for (const r of this.state.records.filter(r => r.id === id || r.card.parentId === id)) r.card.watch = null;
    await this.persist();
    this.changed();
  }
}

/** Validate community markers against their kind and the actual local runtime. */
export function localSegments(data: Record<string, any>, duration: number | null = null): SkipSegments {
  const result: SkipSegments = { intro: null, recap: null, outro: null };
  for (const kind of ["intro", "recap", "outro"] as const) {
    const value = data[kind];
    if (!value) continue;
    const start = typeof value.start === "number" ? value.start : typeof value.start_sec === "number" ? value.start_sec : typeof value.start_ms === "number" ? value.start_ms / 1000 : NaN;
    let end = typeof value.end === "number" ? value.end : typeof value.end_sec === "number" ? value.end_sec : typeof value.end_ms === "number" ? value.end_ms / 1000 : NaN;
    if (!Number.isFinite(start) || !Number.isFinite(end) || start < 0 || end <= start) continue;
    if (duration && (start >= duration || end > duration + 15)) continue;
    if (duration) end = Math.min(end, duration);
    const length = end - start;
    if (length < 5 || length > (kind === "outro" ? 1800 : 600)) continue;
    if (kind === "intro" && start > 1200 || kind === "recap" && start > 900
      || kind === "outro" && start < (duration ? Math.min(duration / 2, 600) : 600)) continue;
    result[kind] = { start, end };
  }
  return result;
}
