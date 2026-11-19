import type { ItemCard, SubtitleTrack, TitleDetail, Watch, SkipSegments } from "@plexy/api-client/types";

export interface LocalFile {
  uri: string;
  name: string;
  relativePath: string;
  directoryUri?: string;
  size: number;
  modified: number;
}
export interface LocalRoot { uri: string; name: string; kind: "movies" | "tv" | "anime" | "auto"; singleFile?: boolean; unavailable?: boolean }
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
  externalSubtitles?: SubtitleTrack[];
  isAnime?: boolean;
  watchlist?: boolean;
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
  missingFiles?: LocalRecord[];
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
function seriesLocation(path: string) {
  const folders = path.split("/").slice(0, -1);
  for (let index = folders.length - 1; index >= 0; index--) {
    const folder = folders[index]!;
    const season = folder.match(/^(?:(.*?)[ ._-]+)?(?:season|part|series|s)[ ._-]*(\d{1,2})$/i);
    if (season || /^specials$/i.test(folder)) {
      const directory = folders.slice(0, index).join("/") || season?.[1]?.trim() || "";
      return { directory, season: season ? Number(season[2]) : 0 };
    }
  }
  return { directory: folders.join("/"), season: null };
}

export function parseLocalName(path: string, kind: LocalRoot["kind"]) {
  const parts = path.split("/");
  let stem = parts.at(-1)!.replace(/\.[^.]+$/, "");
  // Strip release groups and CRC32 checksum hashes common in anime
  const cleanStem = stem.replace(/^[\[\(][^\]\)]+[\]\)]\s*/, "").replace(/\s*\[[0-9a-fA-F]{8}\]/, "");
  const standardEpisode = cleanStem.match(/(?:^|[ ._-])s(\d{1,2})[ ._-]*e(\d{1,3})/i)
    || cleanStem.match(/(?:^|[ ._-])(\d{1,2})x(\d{1,3})/i);
  const animeEpisode = !standardEpisode ? cleanStem.match(/(?:^|[ ._-])(?:e|ep|episode|\s-\s|[-_ ])(\d{1,3})(?:v\d+)?(?:\b|[ ._(\[])/i) : null;
  // Auto roots only accept an unambiguous episode marker: "E05", " - 05",
  // "_05" or "[05]". A plain space before a number is a movie title, not an
  // episode, so "The 100" stays a movie.
  const autoEpisode = !standardEpisode && (kind === "auto" || kind === "tv")
    ? cleanStem.match(/(?:^|[ ._-])(?:e|ep|episode)[ ._-]?(\d{1,3})(?:v\d+)?(?:\b|[ ._(\[])/i)
      || cleanStem.match(/(?:\s-\s|_)(\d{1,3})(?:v\d+)?(?:\b|[ ._(\[])/)
      || cleanStem.match(/[\[(](\d{1,3})[\])]/)
    : null;
  const location = seriesLocation(path);
  const seasonFolderEpisode = !standardEpisode && location.season != null
    ? cleanStem.match(/(?:^|[ ._-])(?:episode|ep|e)[ ._-]*(\d{1,3})(?:v\d+)?\b/i)
      || cleanStem.match(/^(\d{1,3})(?=$|\s+-)/)
    : null;
  const autoNumberEpisode = kind === "auto" && !standardEpisode && !autoEpisode && parts.length > 1 ? cleanStem.match(/^(\d{1,3})$/) : null;
  const episode = standardEpisode || (kind === "anime" ? animeEpisode : null) || autoEpisode || seasonFolderEpisode || autoNumberEpisode;
  // An auto root is a series when the file or its folder structure says so;
  // everything else is treated as a movie.
  const autoShow = kind === "auto" && (episode != null || location.season != null);
  const showKind = kind === "tv" || kind === "anime" || autoShow;

  const seriesFolder = location.directory.split("/").at(-1);
  const rawTarget = episode && !seasonFolderEpisode && !autoNumberEpisode
    ? cleanStem.slice(0, episode.index ?? cleanStem.length)
    : cleanStem;
  const raw = (showKind ? seriesFolder : parts.at(-2)) || rawTarget;

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
    : showKind ? location.season ?? 1 : null;

  const epNumber = standardEpisode
    ? Number(standardEpisode[2])
    : seasonFolderEpisode
      ? Number(seasonFolderEpisode[1])
      : animeEpisode
        ? Number(animeEpisode[1])
        : autoEpisode
          ? Number(autoEpisode[1])
          : autoNumberEpisode
            ? Number(autoNumberEpisode[1])
            : (kind === "tv" || autoShow)
              ? 1
              : null;

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
  /**
   * Details, grids and person lookups all walk the same records. Rebuilding the
   * card clones on every screen render pins the JS thread on a large library,
   * so one snapshot is shared until a mutation invalidates it.
   */
  private revision = 0;
  private snapshot: {
    cards?: ItemCard[];
    byId?: Map<number, LocalRecord>;
    children?: Map<number, LocalRecord[]>;
    series?: Map<number, ItemCard>;
  } = {};
  constructor(private io: LocalIO) {}
  async restore() {
    const saved = await this.io.load();
    if (saved) {
      if (saved.version !== 1 || !Array.isArray(saved.records) || !Array.isArray(saved.roots))
        throw new Error("The local library database could not be read.");
      this.state = saved;
      this.revision += 1;
      this.snapshot = {};
    }
  }
  subscribe(fn: () => void) { this.listeners.add(fn); return () => { this.listeners.delete(fn); }; }
  /** Monotonic token for consumers that cache derived catalog views. */
  get version() { return this.revision; }
  private invalidate() {
    this.revision += 1;
    this.snapshot = {};
  }
  private changed() {
    this.invalidate();
    this.publish();
  }
  private publish() {
    for (const fn of this.listeners) fn();
  }
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
    if (removeFromStorage) {
      const ids = this.state.records.filter(r => r.id === id || r.card.parentId === id).map(r => r.id);
      const result = await this.deleteFiles(ids);
      if (result.failed) throw new Error(`${result.failed} video files couldn’t be deleted.`);
      return;
    }
    const records = this.state.records.filter(r => r.id === id || r.card.parentId === id);
    this.forgetFiles(records);
    for (const [key, val] of Object.entries(this.state.series)) {
      if (val === id) delete this.state.series[key];
    }
    await this.persist();
    this.changed();
  }

  private forgetFiles(records: LocalRecord[]) {
    const ids = new Set(records.map(record => record.id));
    this.state.excluded = [...new Set([...(this.state.excluded ?? []), ...records.map(record => record.file.uri)])];
    this.state.records = this.state.records.filter(record => !ids.has(record.id));
  }

  async deleteFiles(ids: readonly number[]) {
    while (this.active) await this.active;
    const deleteFile = this.io.deleteFile;
    if (!deleteFile) throw new Error("This device cannot delete these videos.");
    const requested = new Set(ids);
    const records = this.state.records.filter(record => requested.has(record.id));
    const removed: LocalRecord[] = [];
    let bytes = 0;
    const operation = (async () => {
      for (const record of records) {
        try {
          await deleteFile(record.file.uri);
          removed.push(record);
          bytes += record.file.size;
        } catch {
          // Keep failed file deletions in the library so they can be retried.
        }
      }
      if (removed.length) {
        this.forgetFiles(removed);
        await this.persist();
        this.changed();
      }
    })();
    this.active = operation.finally(() => { this.active = null; });
    await this.active;
    return { deleted: removed.length, failed: requested.size - removed.length, bytes };
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
  async reconnectRoot(uri: string, replacement: Pick<LocalRoot, "uri" | "name">) {
    while (this.active) await this.active;
    const root = this.state.roots.find(entry => entry.uri === uri);
    if (!root) throw new Error("This location is no longer in the library.");
    if (replacement.uri !== uri && this.state.roots.some(entry => entry.uri === replacement.uri))
      throw new Error("That location is already connected.");
    const target = { ...root, ...replacement, unavailable: false };
    const operation = (async () => {
      const files = (await this.io.walk(target)).filter(file => videos.test(file.name));
      const previous = [...this.state.records, ...(this.state.missingFiles ?? [])].filter(record => record.root === uri);
      const byPath = new Map(files.map(file => [file.relativePath, file]));
      const byUri = new Map(files.map(file => [localFileKey(file.uri), file]));
      const matches = new Map<number, LocalFile>();
      for (const record of previous) {
        const exact = byUri.get(localFileKey(record.file.uri));
        const moved = target.singleFile ? files[0] : byPath.get(record.file.relativePath);
        if (exact) matches.set(record.id, exact);
        else if (moved && (target.singleFile || record.file.size === moved.size))
          matches.set(record.id, moved);
      }
      if (previous.length && !matches.size)
        throw new Error("No existing videos match this location. Check the folder and try again.");
      const matchedKeys = new Set([...matches.values()].map(file => localFileKey(file.uri)));
      if (this.state.records.some(record => record.root !== uri && matchedKeys.has(localFileKey(record.file.uri)))) throw new Error("A replacement video is already connected elsewhere in your library.");

      this.state.roots = this.state.roots.map(entry => entry.uri === uri ? target : entry);
      this.state.records = this.state.records.filter(record => record.root !== uri);
      this.state.missingFiles = this.state.missingFiles?.filter(record => record.root !== uri) ?? [];
      for (const record of previous) {
        const file = matches.get(record.id);
        if (file) this.state.records.push({ ...record, root: target.uri, file });
        else this.state.missingFiles.push({ ...record, root: target.uri });
      }
      if (uri !== target.uri) {
        for (const [key, value] of Object.entries(this.state.series)) {
          if (key.startsWith(uri + ":")) this.state.series[target.uri + key.slice(uri.length)] ??= value;
        }
      }
      await this.persist();
      this.changed();
      await this.runScan([target.uri], new Map([[target.uri, files]]));
    })();
    this.active = operation.finally(() => { this.active = null; });
    return this.active;
  }
  async reconnectFile(id: number, uri: string, name: string) {
    while (this.active) await this.active;
    const record = this.state.missingFiles?.find(entry => entry.id === id) ??
      this.state.records.find(entry => entry.id === id);
    if (!record) throw new Error("This video is no longer in the library.");
    const oldRoot = this.state.roots.find(entry => entry.uri === record.root);
    if (oldRoot?.singleFile) return this.reconnectRoot(oldRoot.uri, { uri, name });
    const target: LocalRoot = { uri, name, kind: oldRoot?.kind ?? "auto", singleFile: true };
    const operation = (async () => {
      const key = localFileKey(uri);
      if (this.state.roots.some(root => root.uri === uri) ||
          this.state.records.some(entry => entry.id !== id && localFileKey(entry.file.uri) === key))
        throw new Error("That video is already connected.");
      const [file] = await this.io.walk(target);
      if (!file || !videos.test(file.name)) throw new Error("Pick a video file.");
      this.state.roots.push(target);
      this.state.records = [...this.state.records.filter(entry => entry.id !== id), { ...record, root: uri, file }];
      this.state.missingFiles = this.state.missingFiles?.filter(entry => entry.id !== id);
      this.state.excluded = (this.state.excluded ?? []).filter(entry => localFileKey(entry) !== key);
      if (localFileKey(record.file.uri) !== key) this.state.excluded.push(record.file.uri);
      await this.persist();
      this.changed();
    })();
    this.active = operation.finally(() => { this.active = null; });
    return this.active;
  }
  async removeRoot(uri: string) {
    // A scan operates on a stable root list. Wait before changing it.
    await this.active;
    this.state.roots = this.state.roots.filter(r => r.uri !== uri);
    this.state.records = this.state.records.filter(r => r.root !== uri);
    this.state.missingFiles = this.state.missingFiles?.filter(r => r.root !== uri);
    await this.persist();
    this.changed();
  }
  scan(rootUris?: string[]): Promise<void> {
    if (this.active) return this.active;
    this.active = this.runScan(rootUris).finally(() => { this.active = null; });
    return this.active;
  }
  private async runScan(rootUris?: string[], walked?: ReadonlyMap<string, LocalFile[]>) {
    const selected = rootUris ? new Set(rootUris) : null;
    const roots = this.state.roots.filter(root => !selected || selected.has(root.uri));
    this.scanProgress = { phase: "Reading folders", current: "", folders: 0, found: 0, added: 0 };
    this.scanning = true;
    this.issues = [];
    this.publish();
    try {
      for (const root of roots) {
        this.scanProgress.current = root.name;
        this.publish();
        let files: LocalFile[];
        try { files = walked?.get(root.uri) ?? await this.io.walk(root); }
        catch { root.unavailable = true; this.issues.push(`Cannot read ${root.name}. Grant folder access again; its saved library was kept.`); continue; }
        delete root.unavailable;
        this.scanProgress.folders++;
        const seen = new Set(files.map(f => localFileKey(f.uri)));
        const excluded = new Set((this.state.excluded || []).map(localFileKey));
        const recovered = (this.state.missingFiles ?? []).filter(record =>
          record.root === root.uri && seen.has(localFileKey(record.file.uri)) && !excluded.has(localFileKey(record.file.uri))
        );
        if (recovered.length) {
          const ids = new Set(recovered.map(record => record.id));
          this.state.records.push(...recovered);
          this.state.missingFiles = this.state.missingFiles?.filter(record => !ids.has(record.id));
        }
        const recordsByFile = new Map<string, LocalRecord>();
        const seriesByDirectory = new Map<string, LocalRecord[]>();
        for (const record of this.state.records) {
          const fileKey = localFileKey(record.file.uri);
          if (!recordsByFile.has(fileKey)) recordsByFile.set(fileKey, record);
          if (record.root !== root.uri || !record.card.parentId || (!record.tmdbId && !record.manualIdentity)) continue;
          const { directory } = seriesLocation(record.file.relativePath);
          // Loose episodes in a general-purpose root can belong to different shows.
          if (!directory && root.kind !== "tv" && root.kind !== "anime" &&
              !record.file.relativePath.includes("/")) continue;
          const siblings = seriesByDirectory.get(directory) ?? [];
          siblings.push(record);
          seriesByDirectory.set(directory, siblings);
        }
        for (const file of files.filter(f => videos.test(f.name) && !excluded.has(localFileKey(f.uri)))) {
          this.scanProgress.found++;
          this.scanProgress.current = file.name;
          this.publish();
          const fileKey = localFileKey(file.uri);
          let record = recordsByFile.get(fileKey);
          const parsed = !record || (!record.manualIdentity && record.card.kind === "episode")
            ? parseLocalName(file.relativePath, root.kind)
            : null;
          const location = parsed ? seriesLocation(file.relativePath) : null;
          const siblings = location ? seriesByDirectory.get(location.directory) ?? [] : [];
          const sameSeries = siblings.filter(sibling => {
            if (parsed?.explicitId) return sibling.tmdbId === parsed.explicitId;
            return file.relativePath.includes("/") ||
              parseLocalName(sibling.file.relativePath, root.kind).title === parsed?.title;
          });
          // A manual correction wins over earlier automatic matches in this folder.
          const manualMatches = sameSeries.filter(sibling => sibling.manualIdentity);
          const matches = manualMatches.length ? manualMatches : sameSeries;
          const candidate = matches[0];
          const identity = candidate && matches.every(sibling =>
            sibling.card.parentId === candidate.card.parentId && sibling.tmdbId === candidate.tmdbId
          ) ? candidate : null;
          if (!record && parsed) {
            const isAnime = root.kind === "anime";
            const isEpisode = parsed.episode != null || root.kind === "tv" || root.kind === "anime" || /(?:^|[ ._-])(?:s\d{1,2}[ ._-]*e\d{1,3}|\d{1,2}x\d{1,3})/i.test(file.name);
            const kind = isEpisode ? "tv" : "movies";
            const id = this.state.nextId++;
            const title = kind === "tv" && location?.season != null && !location.directory
              ? root.name
              : parsed.title;
            const seriesKey = `${root.uri}:${title.toLowerCase()}:${parsed.year ?? ""}`;
            const parentId = kind === "tv"
              ? identity?.card.parentId ?? (this.state.series[seriesKey] ??= this.state.nextId++)
              : null;
            record = { id, root: root.uri, file, metadataAt: 0, cast: [], isAnime, tmdbId: parentId ? identity?.tmdbId : undefined, card: {
              id, publicId: `local-${id}`, kind: kind === "movies" ? "movie" : "episode",
              name: title, year: parsed.year, seasonNumber: parsed.season, episodeNumber: parsed.episode,
              fileId: id, parentId, parentPublicId: parentId ? `local-${parentId}` : null,
              parentTitle: parentId ? identity?.card.parentTitle ?? title : null, poster: null, backdrop: null, overview: null,
              rating: null, runtime: null, genres: [], matchStatus: "unmatched", watch: null, isAnime,
            }};
            this.state.records.push(record);
            recordsByFile.set(fileKey, record);
            this.scanProgress.added++;
          } else if (record && (record.file.uri !== file.uri || record.file.size !== file.size || record.file.modified !== file.modified)) {
            record.file = file;
          }
          if (record?.card.kind === "episode" && parsed && identity &&
              (!record.tmdbId || identity.manualIdentity) &&
              (record.tmdbId !== identity.tmdbId || record.card.parentId !== identity.card.parentId)) {
            record.tmdbId = identity.tmdbId;
            record.identityRevision = (record.identityRevision || 0) + 1;
            record.metadataAt = 0;
            record.skipsAt = 0;
            record.card = {
              ...record.card,
              parentId: identity.card.parentId,
              parentPublicId: identity.card.parentPublicId,
              parentTitle: identity.card.parentTitle,
              seasonNumber: parsed.season,
              episodeNumber: parsed.episode,
              tmdbId: identity.tmdbId ?? null,
              matchStatus: "unmatched",
            };
          }
        }
        const missing = this.state.records.filter(r => r.root === root.uri && !seen.has(localFileKey(r.file.uri)));
        if (missing.length) {
          const missingIds = new Set(missing.map(record => record.id));
          this.state.missingFiles = [...(this.state.missingFiles ?? []), ...missing];
          this.state.records = this.state.records.filter(record => !missingIds.has(record.id));
        }
      }
      // Make newly discovered files playable before any internet request finishes.
      await this.persist();
      this.changed();
      for (const record of this.state.records.filter(r => !selected || selected.has(r.root))) {
        this.scanProgress.phase = "Matching titles";
        this.scanProgress.current = record.file.name;
        this.publish();
        if (record.metadataVersion === 2 && record.discoveryVersion === 1 && Date.now() - record.metadataAt < 7 * 86400_000) continue;
        await this.hydrate(record);
      }
      if (this.metadataSettings.markersEnabled) for (const record of this.state.records.filter(r => !selected || selected.has(r.root))) {
        this.scanProgress.phase = "Checking episode markers";
        this.scanProgress.current = record.file.name;
        this.publish();
        await this.getMarkers(record.id);
      }
    } finally { this.scanning = false; this.scanProgress.phase = "Finished"; this.scanProgress.current = ""; this.changed(); }
  }
  private indices() {
    let cards = this.snapshot.cards;
    if (cards) {
      return {
        cards,
        byId: this.snapshot.byId!,
        children: this.snapshot.children!,
        series: this.snapshot.series!,
      };
    }
    const movies: ItemCard[] = [];
    const byId = new Map<number, LocalRecord>();
    const children = new Map<number, LocalRecord[]>();
    for (const record of this.state.records) {
      byId.set(record.id, record);
      if (record.card.kind === "movie") {
        movies.push({
          ...record.card,
          tmdbId: record.tmdbId ?? record.card.tmdbId ?? null,
          logo: record.logo || record.card.logo || null,
          isAnime: record.isAnime || record.card.isAnime,
          watchlist: Boolean(record.watchlist),
          certification:
            record.certification ?? record.card.certification ?? null,
        });
      } else if (record.card.parentId != null) {
        const group = children.get(record.card.parentId);
        if (group) group.push(record);
        else children.set(record.card.parentId, [record]);
      }
    }
    const series: ItemCard[] = [];
    const seriesById = new Map<number, ItemCard>();
    for (const [id, records] of children) {
      const first = records[0]!;
      const card: ItemCard = {
        ...first.card,
        ...first.seriesMetadata,
        id,
        publicId: `local-${id}`,
        kind: "series",
        name: first.seriesMetadata?.name || first.card.parentTitle!,
        fileId: null,
        parentId: null,
        parentPublicId: null,
        parentTitle: null,
        seasonNumber: null,
        episodeNumber: null,
        tmdbId: records.find((record) => record.tmdbId != null)?.tmdbId ?? first.card.tmdbId ?? null,
        logo: first.logo || first.card.logo || null,
        isAnime: records.some((record) => record.isAnime || record.card.isAnime),
        watchlist: records.some((record) => Boolean(record.watchlist)),
        certification:
          records.find((record) => record.certification)?.certification ??
          first.seriesMetadata?.certification ??
          null,
        watch: records.every((record) => record.card.watch?.played)
          ? { position: 0, duration: null, played: true, percent: 100 }
          : null,
      };
      series.push(card);
      seriesById.set(id, card);
    }
    cards = [...movies, ...series];
    this.snapshot = { cards, byId, children, series: seriesById };
    return { cards, byId, children, series: seriesById };
  }

  cards(): ItemCard[] {
    return this.indices().cards;
  }
  record(id: number) {
    const record = this.indices().byId.get(id);
    if (!record) throw new Error("This local file is no longer in your library.");
    return record;
  }
  /** Every record that belongs to a title id: the title itself or its episodes. */
  private recordsFor(id: number) {
    const { byId, children } = this.indices();
    const record = byId.get(id);
    if (record) return [record];
    return children.get(id) ?? [];
  }
  detail(id: number): TitleDetail {
    const { byId, children, series } = this.indices();
    const record = byId.get(id) ?? children.get(id)?.[0];
    if (!record) throw new Error("This title is no longer in your library.");
    const isSeries = record.card.parentId === id;
    const episodeRecords = isSeries ? children.get(id) ?? [] : null;
    const episodes = episodeRecords
      ?.map((episode) => episode.card)
      .sort((a, b) => (a.seasonNumber! - b.seasonNumber!) || (a.episodeNumber! - b.episodeNumber!)) ?? null;
    const knownSeasons = new Map(record.seasons?.map((season) => [season.number, season]));
    for (const episode of episodeRecords ?? []) {
      const number = episode.card.seasonNumber ?? 1;
      if (knownSeasons.has(number)) continue;
      const season = episode.seasons?.find((entry) => entry.number === number);
      if (season) knownSeasons.set(number, season);
    }
    const seasons = episodes
      ? [...new Set(episodes.map((episode) => episode.seasonNumber ?? 1))]
          .sort((a, b) => a - b)
          .map((number) => knownSeasons.get(number) ?? {
            id: number,
            number,
            name: number === 0 ? "Specials" : `Season ${number}`,
          })
      : null;
    const card = isSeries
      ? series.get(id)!
      : { ...record.card, tmdbId: record.tmdbId ?? record.card.tmdbId ?? null, watchlist: Boolean(record.watchlist) };
    return { item: card, logo: record.logo || null, metadata: { overview: card.overview, tagline: record.tagline || null,
      runtime: card.runtime, rating: card.rating, certification: record.certification || null, genres: card.genres },
      cast: record.cast, trailer: record.trailer || null,
      seasons,
      episodes, file: isSeries ? null : { fileId: record.id, itemId: record.id, size: record.file.size,
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
    for (const r of this.recordsFor(id)) {
      const total = duration || r.card.watch?.duration || null;
      const watch: Watch = { position, duration: total, played: played || !!(total && position / total >= .95),
        percent: total ? Math.min(100, 100 * position / total) : 0 };
      r.card.watch = watch;
    }
    this.invalidate();
    await this.persist();
    this.changed();
  }
  async clearWatch(id: number) {
    for (const r of this.recordsFor(id)) r.card.watch = null;
    this.invalidate();
    await this.persist();
    this.changed();
  }
  async setWatchlist(id: number, watchlisted: boolean) {
    const records = this.recordsFor(id);
    if (!records.length) throw new Error("This title is no longer in your library.");
    for (const record of records) record.watchlist = watchlisted;
    this.invalidate();
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
