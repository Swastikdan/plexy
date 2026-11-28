import type {
  ItemCard as ApiItemCard,
  Playability as ApiPlayability,
  TitleDetail as ApiTitleDetail,
} from "@plexy/api-client/types";
import type { LibraryFilters } from "@/core/library/library-filters";
import {
  LocalCatalog,
  type HomePayload,
  type ItemCard,
  type Playability,
  type SkipSegments,
  type TitleDetail,
  type TitleIdentity,
} from "@/core/library/catalog-api";
import { SERVER_ID_OFFSET, isServerId, serverFileId, serverItemId } from "./ids";
import {
  serverAuthHeaders,
  serverJson,
  serverMediaUrl,
  serverResponse,
  ServerUnauthorizedError,
  type ServerSession,
} from "./transport";

export {
  SERVER_ID_OFFSET,
  isServerId,
  serverFileId,
  serverItemId,
  serverSourceId,
} from "./ids";

function localId(id: number) {
  if (id < SERVER_ID_OFFSET) throw new Error("Not a Plexy Server item.");
  return id - SERVER_ID_OFFSET;
}

function detailId(id: string | number) {
  if (typeof id === "number") return localId(id);
  if (/^\d+$/.test(id)) {
    const number = Number(id);
    return isServerId(number) ? localId(number) : number;
  }
  return id;
}

/** A description page fetched from the server, cached for repeat visits. */
interface CachedDetail {
  detail: TitleDetail;
  serverItemId: number;
}

export class ServerCatalog extends LocalCatalog {
  private details = new Map<string, CachedDetail>();
  private detailOrder: string[] = [];
  private tmdb = new Map<string, ItemCard>();
  private episodeCache = new Map<number, ItemCard[]>();
  private countsCache = { movie: 0, series: 0 };

  constructor(
    readonly session: ServerSession,
    private readonly onUnauthorized: () => void,
  ) {
    super();
  }

  private auth() {
    return serverAuthHeaders(this.session);
  }

  private media(path: string | null | undefined) {
    if (!path) return null;
    return path.startsWith("/api/") ? serverMediaUrl(this.session, path) : path;
  }

  private card(card: ApiItemCard): ItemCard {
    const mapped: ItemCard = {
      ...card,
      id: serverItemId(card.id),
      fileId: card.fileId == null ? null : serverFileId(card.fileId),
      parentId: card.parentId == null ? null : serverItemId(card.parentId),
      playFileId:
        card.playFileId == null ? null : serverFileId(card.playFileId),
      poster: this.media(card.poster),
      backdrop: this.media(card.backdrop),
      logo: this.media(card.logo),
      still: this.media(card.still),
      source: "server",
    };
    if (mapped.tmdbId != null) {
      this.tmdb.set(
        `${mapped.kind === "series" ? "tv" : "movie"}:${mapped.tmdbId}`,
        mapped,
      );
    }
    return mapped;
  }

  private mapDetail(raw: ApiTitleDetail): TitleDetail {
    const item = this.card(raw.item);
    const episodes =
      raw.episodes?.map((episode) => this.card(episode)) ?? null;
    if (episodes) this.episodeCache.set(raw.item.id, episodes);
    const detail: TitleDetail = {
      ...raw,
      item,
      episodes,
      seasons:
        raw.seasons?.map((season) => ({
          ...season,
          id: serverItemId(season.id),
        })) ?? null,
      file: raw.file
        ? {
            ...raw.file,
            fileId: serverFileId(raw.file.fileId),
            itemId:
              raw.file.itemId == null ? null : serverItemId(raw.file.itemId),
          }
        : null,
      cast: raw.cast.map((person) => ({
        ...person,
        photo: this.media(person.photo),
      })),
    };
    this.rememberDetail(String(item.publicId), {
      detail,
      serverItemId: raw.item.id,
    });
    return detail;
  }

  private rememberDetail(key: string, value: CachedDetail) {
    this.details.delete(key);
    const index = this.detailOrder.indexOf(key);
    if (index >= 0) this.detailOrder.splice(index, 1);
    this.details.set(key, value);
    this.detailOrder.push(key);
    if (this.detailOrder.length > 64) {
      const stale = this.detailOrder.shift();
      if (stale) this.details.delete(stale);
    }
  }

  private async request<T>(path: string, init?: RequestInit): Promise<T> {
    try {
      return await serverJson<T>(this.session, path, init);
    } catch (error) {
      if (error instanceof ServerUnauthorizedError) this.onUnauthorized();
      throw error;
    }
  }

  override image(path: string | null) {
    if (!path) return undefined;
    const absolute = this.media(path);
    if (!absolute) return undefined;
    if (absolute.startsWith(`${this.session.address}/api/`))
      return { uri: absolute, headers: this.auth() };
    return super.image(absolute);
  }

  override async home(signal?: AbortSignal): Promise<HomePayload> {
    if (signal?.aborted) throw new Error("Request cancelled");
    const payload = await this.request<{
      featured: ApiItemCard | null;
      rows: { key: string; title: string; items: ApiItemCard[] }[];
    }>("/api/home");
    return {
      featured: payload.featured ? this.card(payload.featured) : null,
      rows: payload.rows.map((row) => ({
        ...row,
        items: row.items.map((item) => this.card(item)),
      })),
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
    if (signal?.aborted) throw new Error("Request cancelled");
    const query = new URLSearchParams();
    if (kind !== "all") query.set("kind", kind);
    query.set("offset", String(offset));
    query.set("limit", "60");
    query.set(
      "sort",
      sort === "recent" ? "added" : sort === "name" ? "name" : sort,
    );
    if (unwatched) query.set("unwatched", "true");
    if (filters?.genre) query.set("genre", filters.genre);
    if (filters?.maxRuntime)
      query.set("maxRuntime", String(filters.maxRuntime));
    const payload = await this.request<{ items: ApiItemCard[] }>(
      `/api/items?${query.toString()}`,
    );
    return { items: payload.items.map((item) => this.card(item)) };
  }

  override readDetail(id: string | number) {
    return this.details.get(String(id))?.detail ?? null;
  }

  override async detail(id: string | number, signal?: AbortSignal) {
    if (signal?.aborted) throw new Error("Request cancelled");
    const key = String(id);
    const cached = this.details.get(key);
    if (cached) return cached.detail;
    const raw = await this.request<ApiTitleDetail>(
      `/api/items/${encodeURIComponent(String(detailId(id)))}`,
    );
    return this.mapDetail(raw);
  }

  override async deleteItem(_id: string | number): Promise<{ ok: boolean }> {
    throw new Error("Server titles are managed on the Plexy Server.");
  }

  override async search(query: string, signal?: AbortSignal) {
    if (signal?.aborted) throw new Error("Request cancelled");
    const payload = await this.request<{
      titles: ApiItemCard[];
      episodes: ApiItemCard[];
    }>(`/api/search?q=${encodeURIComponent(query)}`);
    return {
      titles: payload.titles.map((item) => this.card(item)),
      episodes: payload.episodes.map((item) => this.card(item)),
    };
  }

  override async skips(fileId: number): Promise<SkipSegments> {
    const value = await this.request<SkipSegments & { enabled?: boolean }>(
      `/api/skip-segments/${localId(fileId)}`,
    );
    return {
      intro: value.intro ?? null,
      recap: value.recap ?? null,
      outro: value.outro ?? null,
    };
  }

  override async progress(
    itemId: number,
    position: number,
    duration?: number,
    played = false,
  ) {
    await this.request<{ ok: boolean }>("/api/progress", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        itemId: localId(itemId),
        position,
        duration,
        played,
      }),
    });
    return { ok: true };
  }

  override async watched(itemId: number, played: boolean) {
    await this.request<{ ok: boolean }>(`/api/watch/${localId(itemId)}/played`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ played }),
    });
    return { ok: true };
  }

  override async setEpisodesWatched(ids: readonly number[], played: boolean) {
    for (const id of ids) await this.watched(id, played);
  }

  override async clearWatch(itemId: number) {
    await this.request<{ ok: boolean }>(`/api/watch/${localId(itemId)}`, {
      method: "DELETE",
    });
    return { ok: true };
  }

  override async setWatchlist(itemId: number, watchlisted: boolean) {
    await this.request<{ ok: boolean }>(
      `/api/items/${localId(itemId)}/flags`,
      {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ watchlist: watchlisted }),
      },
    );
    return { ok: true };
  }

  override async watchlist(signal?: AbortSignal) {
    if (signal?.aborted) throw new Error("Request cancelled");
    const payload = await this.request<{ items: ApiItemCard[] }>(
      "/api/items?watchlist=true&limit=60",
    );
    return payload.items.map((item) => this.card(item));
  }

  override async play(fileId: number): Promise<Playability> {
    const raw = await this.request<ApiPlayability>(
      `/api/play/${localId(fileId)}?native=1`,
    );
    return {
      ...raw,
      fileId: serverFileId(raw.fileId),
      itemId: raw.itemId == null ? null : serverItemId(raw.itemId),
      parentItemId:
        raw.parentItemId == null ? null : serverItemId(raw.parentItemId),
      nextFileId:
        raw.nextFileId == null ? null : serverFileId(raw.nextFileId),
      next: raw.next
        ? {
            ...raw.next,
            fileId: serverFileId(raw.next.fileId),
            itemId: serverItemId(raw.next.itemId),
          }
        : null,
      versions: raw.versions?.map((version) => ({
        ...version,
        fileId: serverFileId(version.fileId),
      })),
      episodes: raw.episodes?.map((item) => this.card(item)),
    };
  }

  override stream(fileId: number) {
    return serverMediaUrl(
      this.session,
      `/api/stream/${localId(fileId)}/original`,
    );
  }

  override streamHeaders(_fileId: number) {
    return this.auth();
  }

  override async subtitle(
    fileId: number,
    uri: string,
    signal?: AbortSignal,
  ): Promise<string> {
    try {
      const response = await serverResponse(
        this.session,
        `/api/subtitles/${localId(fileId)}/${encodeURIComponent(uri)}`,
        { signal },
      );
      if (!response.ok) throw new Error("Subtitle track could not be loaded.");
      return await response.text();
    } catch (error) {
      if (error instanceof ServerUnauthorizedError) this.onUnauthorized();
      throw error;
    }
  }

  override titlesByPerson() {
    return new Map<string, ItemCard[]>();
  }

  override titlesByTmdb() {
    return this.tmdb;
  }

  override collections() {
    return [];
  }

  override counts() {
    return this.countsCache;
  }

  /** Refresh the totals that the merged library tabs display. */
  async refreshCounts() {
    const [movies, series] = await Promise.all([
      this.request<{ total: number }>("/api/items?kind=movie&limit=1"),
      this.request<{ total: number }>("/api/items?kind=series&limit=1"),
    ]);
    this.countsCache = {
      movie: Number(movies.total) || 0,
      series: Number(series.total) || 0,
    };
    return this.countsCache;
  }

  override collectionItems(_id: number) {
    return [];
  }

  override episodes(id: number) {
    return this.episodeCache.get(localId(id)) ?? [];
  }

  override report(_filter: "all" | "review" | "files") {
    return [];
  }

  override titleFile(_id: number) {
    return undefined;
  }

  override libraryStatus() {
    return { fileCount: 0, reviewCount: 0, markerCount: 0 };
  }

  override fileVersion(fileId: number) {
    return `${this.session.serverId}:${localId(fileId)}`;
  }

  override async identify(_id: number, _identity: TitleIdentity) {
    throw new Error("Matches are managed on the Plexy Server.");
  }

  override async removeTitle(_id: number) {
    throw new Error("Server titles are managed on the Plexy Server.");
  }
}
