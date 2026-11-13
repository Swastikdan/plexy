import type { ItemCard, TitleDetail, Watch, SkipSegments } from "../../api-client/src/types";

export interface LocalFile {
  uri: string;
  name: string;
  relativePath: string;
  directoryUri?: string;
  size: number;
  modified: number;
}
export interface LocalRoot { uri: string; name: string; kind: "movies" | "tv" | "anime"; singleFile?: boolean }
export interface LocalRecord {
  id: number;
  root: string;
  file: LocalFile;
  card: ItemCard;
  metadataAt: number;
  skips?: SkipSegments;
  skipsAt?: number;
  tmdbId?: number;
  discoveryVersion?: number;
  collection?: { id: number; name: string } | null;
  cast: TitleDetail["cast"];
  metadataVersion?: number;
  metadataError?: string;
  logo?: string | null;
  tagline?: string | null;
  certification?: string | null;
  trailer?: TitleDetail["trailer"];
  seasons?: NonNullable<TitleDetail["seasons"]>;
  seriesMetadata?: Partial<ItemCard>;
  manualIdentity?: boolean;
  identityRevision?: number;
  externalSubtitles?: import("../../api-client/src/types").SubtitleTrack[];
  isAnime?: boolean;
}
export interface MetadataSettings {
  language: string; region: string; posterSize: string; markersEnabled: boolean;
}
export const defaultMetadataSettings: MetadataSettings = { language: "en-US", region: "US", posterSize: "w780", markersEnabled: true };
export interface LocalState {
  version: 1;
  nextId: number;
  roots: LocalRoot[];
  records: LocalRecord[];
  series: Record<string, number>;
  excluded?: string[];
  metadataSettings?: MetadataSettings;
}
export interface LocalIO {
  load(): Promise<LocalState | null>;
  save(state: LocalState): Promise<void>;
  /** Reject on any incomplete walk. A missing permission must never erase a library. */
  walk(root: LocalRoot): Promise<LocalFile[]>;
  metadata(record: LocalRecord): Promise<Partial<LocalRecord> | null>;
  markers?(record: LocalRecord): Promise<SkipSegments | null>;
  deleteFile?(uri: string): Promise<void>;
}

/** SAF can expose the same document through a picked file or a picked tree. */
export function localFileKey(uri: string) {
  const document = uri.match(/^content:\/\/([^/]+)\/(?:tree\/[^/]+\/)?document\/([^/?]+)/);
  if (!document) return uri;
  try { return `${document[1]}/${decodeURIComponent(document[2]!)}`; } catch { return uri; }
}

const videos = /\.(mkv|mp4|m4v|webm|avi|mov|ts)$/i;
export function parseLocalName(path: string, kind: LocalRoot["kind"]) {
  const parts = path.split("/");
  let stem = parts.at(-1)!.replace(/\.[^.]+$/, "");
  // Strip release groups and CRC32 checksum hashes common in anime
  const cleanStem = stem.replace(/^[\[\(][^\]\)]+[\]\)]\s*/, "").replace(/\s*\[[0-9a-fA-F]{8}\]/, "");
  const standardEpisode = cleanStem.match(/(?:^|[ ._-])s(\d{1,2})[ ._-]*e(\d{1,3})/i)
    || cleanStem.match(/(?:^|[ ._-])(\d{1,2})x(\d{1,3})/i);
  const animeEpisode = !standardEpisode ? cleanStem.match(/(?:^|[ ._-])(?:e|ep|episode|\s-\s|[-_ ])(\d{1,3})(?:v\d+)?(?:\b|[ ._(\[])/i) : null;
  const seasonFolderMatch = parts.length > 1 ? parts.find(p => /^(?:season[ ._-]*|s)(\d{1,2})$/i.test(p))?.match(/^(?:season[ ._-]*|s)(\d{1,2})$/i) : null;
  const rawNumberEpisode = (!standardEpisode && !animeEpisode && seasonFolderMatch) ? cleanStem.match(/^(\d{1,3})$/) : null;
  const episode = standardEpisode || (kind === "anime" ? animeEpisode : null) || rawNumberEpisode;

  const seriesFolder = parts.length > 1 && !/^(season[ ._-]*\d+|s\d+|specials)$/i.test(parts[0]!) ? parts[0]! : null;
  const rawTarget = episode && !rawNumberEpisode ? cleanStem.slice(0, episode.index ?? cleanStem.length) : cleanStem;
  const raw = kind === "tv" || kind === "anime" ? seriesFolder || rawTarget : parts.length > 1 && !/^(season[ ._-]*\d+|s\d+|specials)$/i.test(parts.at(-2)!) ? parts.at(-2)! : rawTarget;

  const explicitId = Number(path.match(/[[{]tmdb(?:id)?[=: -]*(\d+)[\]}]/i)?.[1])
    || Number(cleanStem.match(/[[{]tmdb(?:id)?[=: -]*(\d+)[\]}]/i)?.[1]) || null;

  let year: number | null = null;
  const parenYear = raw.match(/\(((?:19|20)\d{2})\)/);
  if (parenYear) {
    year = Number(parenYear[1]);
  } else {
    const allYears = Array.from(raw.matchAll(/(?:\b|\.|\_)((?:19|20)\d{2})(?:\b|\.|\_)/g));
    if (allYears.length > 0) {
      const last = allYears[allYears.length - 1]!;
      if (allYears.length > 1 || last.index! > 0) {
        year = Number(last[1]);
      }
    }
  }

  let title = raw.replace(/[[{]tmdb(?:id)?[=: -]*\d+[\]}]/gi, "")
    .replace(/\b(?:2160p|1080p|720p|480p|bluray|webrip|web-dl|x264|x265|hevc|h264|h265|aac|dts|hdr|remux)\b.*$/i, "");
  if (year) {
    title = title.replace(new RegExp(`\\(?\\b${year}\\b\\)?`, "g"), "");
  }
  title = title.replace(/[._]/g, " ").replace(/\s*-\s*$/, "").replace(/^\s*-\s*/, "").replace(/\s+/g, " ").trim();
  if (!title) title = cleanStem;

  const season = standardEpisode
    ? Number(standardEpisode[1])
    : seasonFolderMatch
      ? Number(seasonFolderMatch[1])
      : episode
        ? 1
        : (kind === "tv" || kind === "anime" ? 1 : null);

  const epNumber = standardEpisode
    ? Number(standardEpisode[2])
    : animeEpisode
      ? Number(animeEpisode[1])
      : rawNumberEpisode
        ? Number(rawNumberEpisode[1])
        : (kind === "tv" ? 1 : null);

  return {
    title,
    year,
    season,
    episode: epNumber,
    explicitId,
  };
}

/** The local library owns no network listener and never alters source media. */
export class LocalLibrary {
  state: LocalState = { version: 1, nextId: 1, roots: [], records: [], series: {} };
  issues: string[] = [];
  scanning = false;
  scanProgress = { phase: "idle", current: "", folders: 0, found: 0, added: 0 };
  private listeners = new Set<() => void>();
  private active: Promise<void> | null = null;
  private saveTimer: ReturnType<typeof setTimeout> | null = null;
  private pendingSave: Promise<void> = Promise.resolve();
  private currentDurable: Promise<void> = Promise.resolve();
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
  private persist(): Promise<void> {
    // Coalesce bursts of writes. A scan hydrates records one after another,
    // each calling persist; serializing and rewriting the whole database for
    // every record pins the JS thread and freezes the UI. One snapshot per
    // short window keeps the UI responsive — but `await persist()` still
    // only resolves once that window's write has actually landed, so
    // durability is never lost.
    if (this.saveTimer == null) {
      let durableResolve!: () => void;
      const durable = new Promise<void>((resolve) => {
        durableResolve = resolve;
      });
      this.currentDurable = durable;
      this.saveTimer = setTimeout(() => {
        this.saveTimer = null;
        // Snapshot at fire time so the write includes every mutation so far.
        this.pendingSave = this.pendingSave
          .catch(() => {})
          .then(async () => {
            const snapshot = JSON.parse(JSON.stringify(this.state)) as LocalState;
            await this.io.save(snapshot);
          })
          .then(() => durableResolve(), () => durableResolve());
      }, 250);
    }
    return this.currentDurable;
  }
  get metadataSettings(): MetadataSettings { return { ...defaultMetadataSettings, ...this.state.metadataSettings }; }
  async updateMetadataSettings(patch: Partial<MetadataSettings>) {
    this.state.metadataSettings = { ...this.metadataSettings, ...patch };
    await this.persist(); this.changed();
  }
  async refreshMetadata() {
    await this.active;
    for (const record of [...this.state.records]) await this.hydrate(record);
  }
  private markerRequests = new Map<number, Promise<SkipSegments>>();
  getMarkers(id: number, force = false): Promise<SkipSegments> {
    if (!this.metadataSettings.markersEnabled) return Promise.resolve(localSegments({}));
    const pending = this.markerRequests.get(id);
    if (pending) return pending;
    const record = this.record(id);
    const lookup = (async () => {
      const revision = record.identityRevision;
      const ttl = Object.values(record.skips || {}).some(Boolean) ? 30 * 86400_000 : 7 * 86400_000;
      if (this.io.markers && record.tmdbId && (force || Date.now() - (record.skipsAt || 0) >= ttl)) {
        try {
          const skips = await this.io.markers(record);
          if (skips && this.state.records.includes(record) && revision === record.identityRevision) {
            record.skips = skips; record.skipsAt = Date.now(); await this.persist();
          }
        } catch { /* Keep saved markers available offline. Failed lookups remain retryable. */ }
      }
      if (revision !== record.identityRevision || !this.state.records.includes(record) || !this.metadataSettings.markersEnabled) return localSegments({});
      return localSegments(record.skips || {}, record.card.watch?.duration);
    })().finally(() => this.markerRequests.delete(id));
    this.markerRequests.set(id, lookup);
    return lookup;
  }
  async refreshMarkers() {
    let checked = 0, found = 0;
    if (!this.metadataSettings.markersEnabled) return { checked, found };
    for (const record of [...this.state.records]) {
      if (!record.tmdbId) continue;
      const segments = await this.getMarkers(record.id, true);
      checked++;
      if (Object.values(segments).some(Boolean)) found++;
    }
    this.changed();
    return { checked, found };
  }
  async addRoot(root: LocalRoot) {
    await this.active;
    if (root.singleFile) this.state.excluded = this.state.excluded?.filter(uri => localFileKey(uri) !== localFileKey(root.uri));
    if (!this.state.roots.some(r => r.uri === root.uri)) {
      this.state.roots.push(root);
      await this.persist();
    }
    await this.scan();
  }
  async addSubtitle(fileId: number, track: import("../../api-client/src/types").SubtitleTrack) {
    const record = this.record(fileId);
    record.externalSubtitles = [...(record.externalSubtitles || []).filter(t => t.track !== track.track), track];
    await this.persist();
    this.changed();
  }
  async removeTitle(id: number) {
    return this.deleteTitle(id, false);
  }
  async deleteTitle(id: number, removeFromStorage = false) {
    const records = this.state.records.filter(r => r.id === id || r.card.parentId === id);
    if (removeFromStorage && this.io.deleteFile) {
      for (const r of records) {
        try {
          await this.io.deleteFile(r.file.uri);
        } catch (e) {
          console.warn("Failed to delete local file:", r.file.uri, e);
        }
      }
    }
    this.state.excluded = [...new Set([...(this.state.excluded || []), ...records.map(r => r.file.uri)])];
    this.state.records = this.state.records.filter(r => !records.includes(r));
    for (const [key, val] of Object.entries(this.state.series)) {
      if (val === id) delete this.state.series[key];
    }
    await this.persist(); this.changed();
  }
  async identify(id: number, input: { kind: "movies" | "tv"; title: string; tmdbId?: number; season?: number; episode?: number }) {
    const selected = this.state.records.find(r => r.id === id || r.card.parentId === id);
    if (!selected) throw new Error("This title is no longer in the library.");
    const isSeries = selected.card.parentId === id;
    const records = isSeries ? this.state.records.filter(r => r.card.parentId === id) : [selected];
    const differentSeries = !isSeries && selected.card.parentId && (input.tmdbId && selected.tmdbId ? input.tmdbId !== selected.tmdbId : input.title.trim() !== selected.card.parentTitle);
    const parentId = input.kind === "tv" ? (differentSeries ? this.state.nextId++ : selected.card.parentId || this.state.nextId++) : null;
    for (const r of records) {
      r.identityRevision = (r.identityRevision || 0) + 1;
      r.skips = undefined; r.skipsAt = 0;
      r.collection = undefined; r.discoveryVersion = undefined; r.tmdbId = input.tmdbId; r.manualIdentity = true; r.metadataAt = 0; r.metadataVersion = 0;
      r.seriesMetadata = undefined; r.seasons = undefined; r.logo = null; r.trailer = null; r.cast = [];
      r.card = { ...r.card, kind: input.kind === "tv" ? "episode" : "movie", name: input.title.trim() || r.card.name,
        parentId, parentPublicId: parentId ? `local-${parentId}` : null, parentTitle: parentId ? input.title : null,
        seasonNumber: parentId ? (records.length === 1 ? input.season : undefined) ?? r.card.seasonNumber ?? 1 : null,
        episodeNumber: parentId ? (records.length === 1 ? input.episode : undefined) ?? r.card.episodeNumber ?? 1 : null,
        matchStatus: "unmatched", poster: null, backdrop: null, overview: null, rating: null, runtime: null, genres: [] };
      // A new identification is running: the previous failure no longer applies.
      r.metadataError = undefined;
    }
    await this.persist(); this.changed();
    for (const r of records) await this.hydrate(r);
  }
  private async hydrate(record: LocalRecord) {
    const revision = record.identityRevision;
    try {
      const patch = await this.io.metadata(record);
      if (patch && this.state.records.includes(record) && revision === record.identityRevision) {
        const watch = record.card.watch;
        Object.assign(record, patch); record.card.watch = watch; record.metadataError = undefined;
        await this.persist(); this.changed();
      }
    } catch (e) {
      if (!this.state.records.includes(record) || revision !== record.identityRevision) return;
      record.metadataError = e instanceof Error ? e.message : String(e);
      this.changed();
    }
  }
  async removeRoot(uri: string) {
    // A scan operates on a stable root list. Wait before changing it.
    await this.active;
    this.state.roots = this.state.roots.filter(r => r.uri !== uri);
    this.state.records = this.state.records.filter(r => r.root !== uri);
    await this.persist();
    this.changed();
  }
  scan(rootUris?: string[]): Promise<void> {
    if (this.active) return this.active;
    this.active = this.runScan(rootUris).finally(() => { this.active = null; });
    return this.active;
  }
  private async runScan(rootUris?: string[]) {
    const selected = rootUris ? new Set(rootUris) : null;
    const roots = this.state.roots.filter(root => !selected || selected.has(root.uri));
    this.scanProgress = { phase: "Reading folders", current: "", folders: 0, found: 0, added: 0 };
    this.scanning = true;
    this.issues = [];
    this.changed();
    try {
      for (const root of roots) {
        this.scanProgress.current = root.name;
        this.changed();
        let files: LocalFile[];
        try { files = await this.io.walk(root); }
        catch { this.issues.push(`Cannot read ${root.name}. Grant folder access again; its saved library was kept.`); continue; }
        this.scanProgress.folders++;
        const seen = new Set(files.map(f => localFileKey(f.uri)));
        const excluded = new Set((this.state.excluded || []).map(localFileKey));
        for (const file of files.filter(f => videos.test(f.name) && !excluded.has(localFileKey(f.uri)))) {
          this.scanProgress.found++;
          this.scanProgress.current = file.name;
          this.changed();
          let record = this.state.records.find(r => localFileKey(r.file.uri) === localFileKey(file.uri));
          if (!record) {
            const isAnime = root.kind === "anime";
            const parsed = parseLocalName(file.relativePath, root.kind);
            const isEpisode = parsed.episode != null || root.kind === "tv" || /(?:^|[ ._-])(?:s\d{1,2}[ ._-]*e\d{1,3}|\d{1,2}x\d{1,3})/i.test(file.name);
            const kind = isEpisode ? "tv" : "movies";
            const id = this.state.nextId++;
            const seriesKey = `${root.uri}:${parsed.title.toLowerCase()}:${parsed.year ?? ""}`;
            const parentId = kind === "tv" ? this.state.series[seriesKey] ??= this.state.nextId++ : null;
            record = { id, root: root.uri, file, metadataAt: 0, cast: [], isAnime, card: {
              id, publicId: `local-${id}`, kind: kind === "movies" ? "movie" : "episode",
              name: parsed.title, year: parsed.year, seasonNumber: parsed.season, episodeNumber: parsed.episode,
              fileId: id, parentId, parentPublicId: parentId ? `local-${parentId}` : null,
              parentTitle: parentId ? parsed.title : null, poster: null, backdrop: null, overview: null,
              rating: null, runtime: null, genres: [], matchStatus: "unmatched", watch: null, isAnime,
            }};
            this.state.records.push(record);
            this.scanProgress.added++;
          } else if (record.file.size !== file.size || record.file.modified !== file.modified) {
            record.file = file;
          }
        }
        this.state.records = this.state.records.filter(r => r.root !== root.uri || seen.has(localFileKey(r.file.uri)));
      }
      // Make newly discovered files playable before any internet request finishes.
      await this.persist();
      this.changed();
      for (const record of this.state.records.filter(r => !selected || selected.has(r.root))) {
        this.scanProgress.phase = "Matching titles";
        this.scanProgress.current = record.file.name;
        this.changed();
        if (record.metadataVersion === 2 && record.discoveryVersion === 1 && Date.now() - record.metadataAt < 7 * 86400_000) continue;
        await this.hydrate(record);
      }
      if (this.metadataSettings.markersEnabled) for (const record of this.state.records.filter(r => !selected || selected.has(r.root))) {
        this.scanProgress.phase = "Checking episode markers";
        this.scanProgress.current = record.file.name;
        this.changed();
        await this.getMarkers(record.id);
      }
    } finally { this.scanning = false; this.scanProgress.phase = "Finished"; this.scanProgress.current = ""; this.changed(); }
  }
  cards(): ItemCard[] {
    const movies = this.state.records.filter(r => r.card.kind === "movie").map(r => ({
      ...r.card,
      logo: r.logo || r.card.logo || null,
      isAnime: r.isAnime || r.card.isAnime,
    }));
    const groups = new Map<number, LocalRecord[]>();
    for (const r of this.state.records.filter(r => r.card.parentId)) {
      const id = r.card.parentId!;
      groups.set(id, [...(groups.get(id) || []), r]);
    }
    const series = [...groups].map(([id, records]) => ({
      ...records[0]!.card,
      ...records[0]!.seriesMetadata,
      id,
      publicId: `local-${id}`,
      kind: "series" as const,
      name: records[0]!.seriesMetadata?.name || records[0]!.card.parentTitle!,
      fileId: null,
      parentId: null,
      parentPublicId: null,
      parentTitle: null,
      seasonNumber: null,
      episodeNumber: null,
      logo: records[0]!.logo || records[0]!.card.logo || null,
      isAnime: records.some(r => r.isAnime || r.card.isAnime),
      watch: records.every(r => r.card.watch?.played)
        ? { position: 0, duration: null, played: true, percent: 100 }
        : null,
    }));
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
    return { item: card, logo: record.logo || null, metadata: { overview: card.overview, tagline: record.tagline || null,
      runtime: card.runtime, rating: card.rating, certification: record.certification || null, genres: card.genres },
      cast: record.cast, trailer: record.trailer || null,
      seasons: episodes ? [...new Set(episodes.map(e => e.seasonNumber ?? 1))].sort((a,b) => a-b).map(n => record.seasons?.find(s => s.number === n) || this.state.records.find(r => r.card.parentId === id && r.card.seasonNumber === n)?.seasons?.find(s => s.number === n) || { id: n, number: n, name: n === 0 ? "Specials" : `Season ${n}` }) : null,
      episodes, file: series ? null : { fileId: record.id, itemId: record.id, size: record.file.size,
        container: record.file.name.split(".").at(-1)!, duration: card.watch?.duration || null,
        width: null, height: /(?:2160p|4k|uhd)/i.test(record.file.name) ? 2160 : /1080p/i.test(record.file.name) ? 1080 : /720p/i.test(record.file.name) ? 720 : null, videoCodec: null, videoProfile: null, fps: null, hdr: null,
        audio: [], subtitleCount: 0, analysisStatus: "local", analysisError: null,
        likelyPlayPath: "direct", likelyPlayReason: "Plays the original file on this device" },
      tmdbType: record.card.kind === "episode" ? "tv" : "movie", unmatched: card.matchStatus !== "matched", matchReason: record.metadataError || null };
  }
  async progress(id: number, position: number, duration: number | null, played = false) {
    if (!played && position === 0) {
      return this.clearWatch(id);
    }
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
