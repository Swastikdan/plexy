import type { LibraryFilters } from "@/core/library/library-filters";
import {
  LocalCatalog,
  type HomePayload,
  type ItemCard,
  type Playability,
  type SkipSegments,
  type TitleIdentity,
} from "@/core/library/catalog-api";
import { isServerId } from "./ids";
import type { ServerCatalog } from "./server-catalog";

function titleKey(item: ItemCard) {
  if (item.tmdbId != null)
    return `${item.kind === "series" || item.kind === "episode" ? "tv" : "movie"}:${item.tmdbId}`;
  const name = (item.kind === "episode" ? item.parentTitle : item.name)
    ?.trim()
    .toLowerCase();
  return `${item.kind}:${name ?? ""}:${item.year ?? ""}`;
}

function itemKey(item: ItemCard) {
  if (
    item.kind === "episode" &&
    item.seasonNumber != null &&
    item.episodeNumber != null
  ) {
    const series =
      item.tmdbId != null
        ? `tv:${item.tmdbId}`
        : `name:${(item.parentTitle ?? "").trim().toLowerCase()}`;
    return `episode:${series}:${item.seasonNumber}:${item.episodeNumber}`;
  }
  return `title:${titleKey(item)}`;
}

function mergeItems(device: ItemCard[], server: ItemCard[]) {
  const seen = new Set(device.map(itemKey));
  const merged = [...device];
  for (const item of server) {
    const key = itemKey(item);
    if (seen.has(key)) continue;
    seen.add(key);
    merged.push(item);
  }
  return merged;
}

function sortItems(items: ItemCard[], sort: string) {
  if (sort === "name") return items.sort((a, b) => a.name.localeCompare(b.name));
  if (sort === "year") return items.sort((a, b) => (b.year ?? 0) - (a.year ?? 0));
  if (sort === "rating")
    return items.sort((a, b) => (b.rating ?? 0) - (a.rating ?? 0));
  return items;
}

/** Presents device and Plexy Server titles as one catalog, device copy first. */
export class MergedCatalog extends LocalCatalog {
  constructor(
    private readonly device: LocalCatalog,
    private readonly server: ServerCatalog | null,
  ) {
    super();
  }

  private route(id: number) {
    return isServerId(id) ? this.server : null;
  }

  private isServerDetail(id: string | number) {
    if (!this.server) return false;
    if (typeof id === "number") return isServerId(id);
    return !/^local-/.test(id);
  }

  override image(path: string | null) {
    if (!path) return undefined;
    if (
      this.server &&
      (path.startsWith("/api/") ||
        path.startsWith(`${this.server.session.address}/api/`))
    )
      return this.server.image(path);
    return this.device.image(path);
  }

  override async home(signal?: AbortSignal): Promise<HomePayload> {
    if (!this.server) return this.device.home(signal);
    const [device, server] = await Promise.all([
      this.device.home(signal),
      this.server.home(signal).catch(() => null),
    ]);
    if (!server) return device;
    const deviceKeys = new Set([
      ...device.rows.flatMap((row) => row.items.map(itemKey)),
      ...(device.featured ? [itemKey(device.featured)] : []),
    ]);
    const rows = new Map(
      device.rows.map((row) => [
        row.key,
        { ...row, items: [...row.items] } as { key: string; title: string; items: ItemCard[] },
      ]),
    );
    for (const row of server.rows) {
      const items = row.items.filter((item) => !deviceKeys.has(itemKey(item)));
      if (!items.length) continue;
      const existing = rows.get(row.key);
      if (existing) existing.items = mergeItems(existing.items, items);
      else rows.set(row.key, { ...row, items });
    }
    return {
      featured: device.featured ?? server.featured,
      rows: [...rows.values()].filter((row) => row.items.length > 0),
    };
  }

  override async items(
    kind: "all" | "movie" | "series",
    offset = 0,
    sort = "name",
    signal?: AbortSignal,
    unwatched = false,
    filters?: LibraryFilters,
  ) {
    if (!this.server) return this.device.items(kind, offset, sort, signal, unwatched, filters);
    const [device, server] = await Promise.all([
      this.device.items(kind, offset, sort, signal, unwatched, filters),
      this.server.items(kind, offset, sort, signal, unwatched, filters).catch(() => ({ items: [] })),
    ]);
    const merged = sortItems(mergeItems(device.items, server.items), sort);
    return { items: merged.slice(0, 60) };
  }

  override readDetail(id: string | number) {
    if (this.isServerDetail(id)) {
      const cached = this.server?.readDetail(id);
      if (cached) return cached;
    }
    return this.device.readDetail?.(id) ?? null;
  }

  override async detail(id: string | number, signal?: AbortSignal) {
    if (this.isServerDetail(id) && this.server) {
      try {
        return await this.server.detail(id, signal);
      } catch (error) {
        if (signal?.aborted) throw error;
      }
    }
    return this.device.detail(id, signal);
  }

  override async deleteItem(id: string | number): Promise<{ ok: boolean }> {
    if (this.isServerDetail(id) && this.server)
      return this.server.deleteItem(id);
    return this.device.deleteItem(id);
  }

  override async search(query: string, signal?: AbortSignal) {
    if (!this.server) return this.device.search(query, signal);
    const [device, server] = await Promise.all([
      this.device.search(query, signal),
      this.server.search(query, signal).catch(() => ({ titles: [], episodes: [] })),
    ]);
    return {
      titles: mergeItems(device.titles, server.titles),
      episodes: mergeItems(device.episodes, server.episodes),
    };
  }

  override async skips(fileId: number): Promise<SkipSegments> {
    return this.route(fileId)?.skips(fileId) ?? this.device.skips(fileId);
  }

  override async progress(
    itemId: number,
    position: number,
    duration?: number,
    played = false,
  ) {
    return (
      this.route(itemId)?.progress(itemId, position, duration, played) ??
      this.device.progress(itemId, position, duration, played)
    );
  }

  override async watched(itemId: number, played: boolean) {
    return this.route(itemId)?.watched(itemId, played) ?? this.device.watched(itemId, played);
  }

  override async setEpisodesWatched(ids: readonly number[], played: boolean) {
    const serverIds = ids.filter(isServerId);
    const deviceIds = ids.filter((id) => !isServerId(id));
    await Promise.all([
      this.server && serverIds.length
        ? this.server.setEpisodesWatched(serverIds, played)
        : Promise.resolve(),
      deviceIds.length ? this.device.setEpisodesWatched(deviceIds, played) : Promise.resolve(),
    ]);
  }

  override async clearWatch(itemId: number) {
    return this.route(itemId)?.clearWatch(itemId) ?? this.device.clearWatch(itemId);
  }

  override async setWatchlist(itemId: number, watchlisted: boolean) {
    return (
      this.route(itemId)?.setWatchlist(itemId, watchlisted) ??
      this.device.setWatchlist(itemId, watchlisted)
    );
  }

  override async watchlist(signal?: AbortSignal) {
    if (!this.server) return this.device.watchlist(signal);
    const [device, server] = await Promise.all([
      this.device.watchlist(signal),
      this.server.watchlist(signal).catch(() => []),
    ]);
    return mergeItems(device, server);
  }

  override async play(fileId: number): Promise<Playability> {
    return this.route(fileId)?.play(fileId) ?? this.device.play(fileId);
  }

  override stream(fileId: number) {
    return this.route(fileId)?.stream(fileId) ?? this.device.stream(fileId);
  }

  override streamHeaders(fileId: number) {
    return this.route(fileId)?.streamHeaders(fileId) ?? this.device.streamHeaders(fileId);
  }

  override async subtitle(
    fileId: number,
    uri: string,
    signal?: AbortSignal,
  ) {
    return (
      this.route(fileId)?.subtitle(fileId, uri, signal) ??
      this.device.subtitle(fileId, uri, signal)
    );
  }

  override titlesByPerson() {
    const merged = new Map(this.device.titlesByPerson());
    for (const [name, items] of this.server?.titlesByPerson() ?? []) {
      if (!merged.has(name)) merged.set(name, items);
    }
    return merged;
  }

  override titlesByTmdb() {
    const merged = new Map(this.server?.titlesByTmdb() ?? []);
    for (const [key, item] of this.device.titlesByTmdb()) merged.set(key, item);
    return merged;
  }

  override alternateSource(item: ItemCard) {
    if (item.tmdbId == null) return null;
    const key = `${item.kind === "movie" ? "movie" : "tv"}:${item.tmdbId}`;
    if (item.source === "server") {
      const device = this.device.titlesByTmdb().get(key);
      return device ? { ...device, source: "device" as const } : null;
    }
    const server = this.server?.titlesByTmdb().get(key);
    return server ?? null;
  }

  override collections() {
    return this.device.collections();
  }

  override counts() {
    const device = this.device.counts();
    const server = this.server?.counts() ?? { movie: 0, series: 0 };
    return {
      movie: device.movie + server.movie,
      series: device.series + server.series,
    };
  }

  override collectionItems(id: number) {
    return this.device.collectionItems(id);
  }

  override episodes(id: number) {
    return this.route(id)?.episodes(id) ?? this.device.episodes(id);
  }

  override report(filter: "all" | "review" | "files") {
    return this.device.report(filter);
  }

  override titleFile(id: number) {
    return this.route(id)?.titleFile(id) ?? this.device.titleFile(id);
  }

  override libraryStatus() {
    return this.device.libraryStatus();
  }

  override fileVersion(fileId: number) {
    return this.route(fileId)?.fileVersion(fileId) ?? this.device.fileVersion(fileId);
  }

  override async identify(id: number, identity: TitleIdentity) {
    return this.route(id)?.identify(id, identity) ?? this.device.identify(id, identity);
  }

  override async removeTitle(id: number) {
    return this.route(id)?.removeTitle(id) ?? this.device.removeTitle(id);
  }
}
