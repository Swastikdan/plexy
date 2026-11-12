import type {
HomePayload,
ItemCard,
Playability,
SkipSegments,
TitleDetail,
} from "@plexy/api-client/types";
export type {
HomePayload,
ItemCard,
Playability,
SkipSegments,
TitleDetail
} from "@plexy/api-client/types";
/** In-process catalog contract. Implementations never connect to a Plexy server. */
export abstract class LocalCatalog {
  abstract request<T>(path: string, init?: RequestInit): Promise<T>;
  abstract play(fileId: number): Promise<Playability>;
  abstract stream(fileId: number): string;
  abstract text(path: string, signal?: AbortSignal): Promise<string>;
  private images = new Map<
    string,
    {
      uri: string;
    }
  >();
  image(path: string | null) {
    if (!path || !/^(file:|content:|https:)/.test(path)) return undefined;
    let image = this.images.get(path);
    if (!image) {
      image = { uri: path };
      this.images.set(path, image);
    }
    return image;
  }
  home(signal?: AbortSignal) {
    return this.request<HomePayload>("/api/home", { signal });
  }
  items(
    kind: "movie" | "series" | "anime",
    offset = 0,
    sort = "name",
    signal?: AbortSignal,
    unwatched = false,
  ) {
    return this.request<{
      items: ItemCard[];
    }>(
      `/api/items?kind=${kind}&offset=${offset}&sort=${encodeURIComponent(sort)}&unwatched=${unwatched}`,
      { signal },
    );
  }
  detail(id: string | number, signal?: AbortSignal) {
    return this.request<TitleDetail>(`/api/items/${encodeURIComponent(id)}`, {
      signal,
    });
  }
  deleteItem(id: string | number) {
    return this.request<{
      ok: boolean;
    }>(`/api/items/${encodeURIComponent(id)}`, { method: "DELETE" });
  }
  search(q: string, signal?: AbortSignal) {
    return this.request<{
      titles: ItemCard[];
      episodes: ItemCard[];
    }>(`/api/search?q=${encodeURIComponent(q)}`, { signal });
  }
  skips(fileId: number) {
    return this.request<SkipSegments>(`/api/skip-segments/${fileId}`);
  }
  progress(
    itemId: number,
    position: number,
    duration?: number,
    played = false,
  ) {
    return this.request("/api/progress", {
      method: "POST",
      body: JSON.stringify({ itemId, position, duration, played }),
    });
  }
  watched(itemId: number, played: boolean) {
    return this.request(`/api/watch/${itemId}/played`, {
      method: "POST",
      body: JSON.stringify({ played }),
    });
  }
  clearWatch(itemId: number) {
    return this.request(`/api/watch/${itemId}`, { method: "DELETE" });
  }
}
