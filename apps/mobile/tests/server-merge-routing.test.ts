import { expect, test } from "bun:test";
import type {
  HomePayload,
  ItemCard,
  Playability,
  TitleDetail,
} from "@/core/library/catalog-api";
import type { LocalCatalog } from "@/core/library/catalog-api";
import { MergedCatalog } from "@/core/server/merged-catalog";
import { SERVER_ID_OFFSET, serverFileId, serverItemId } from "@/core/server/ids";
import type { ServerCatalog } from "@/core/server/server-catalog";

function card(overrides: Partial<ItemCard> = {}): ItemCard {
  return {
    id: 1,
    publicId: "local-1",
    kind: "movie",
    name: "Title",
    year: 2020,
    poster: null,
    backdrop: null,
    overview: null,
    rating: null,
    runtime: null,
    genres: [],
    matchStatus: "matched",
    watch: null,
    ...overrides,
  };
}

function detail(item: ItemCard): TitleDetail {
  return {
    item,
    logo: null,
    metadata: null,
    cast: [],
    seasons: null,
    episodes: null,
    file: null,
  } as unknown as TitleDetail;
}

const deviceItem = card({ id: 1, publicId: "local-1" });
const serverItem = card({
  id: serverItemId(1),
  publicId: "server-1",
  source: "server",
  fileId: serverFileId(1),
  tmdbId: 40,
});

function deviceCatalog(calls: string[]) {
  return {
    image: (path: string | null) => {
      calls.push(`device-image:${path}`);
      return path ? { uri: `device:${path}` } : undefined;
    },
    home: async (): Promise<HomePayload> => ({
      featured: null,
      rows: [{ key: "shared", title: "Shared", items: [deviceItem] }],
    }),
    items: async (kind: string, _offset?: number, sort?: string) => {
      calls.push(`device-items:${kind}:${sort}`);
      return { items: [deviceItem] };
    },
    readDetail: (id: string | number) => {
      calls.push(`device-read:${id}`);
      return detail(deviceItem);
    },
    detail: async (id: string | number) => {
      calls.push(`device-detail:${id}`);
      return detail(deviceItem);
    },
    deleteItem: async (id: string | number) => {
      calls.push(`device-delete:${id}`);
      return { ok: true };
    },
    search: async (query: string) => {
      calls.push(`device-search:${query}`);
      return { titles: [deviceItem], episodes: [] };
    },
    skips: async (fileId: number) => {
      calls.push(`device-skips:${fileId}`);
      return { intro: null, recap: null, outro: null };
    },
    progress: async (id: number, position: number) => {
      calls.push(`device-progress:${id}:${position}`);
      return { ok: true };
    },
    watched: async (id: number, played: boolean) => {
      calls.push(`device-watched:${id}:${played}`);
      return { ok: true };
    },
    setEpisodesWatched: async (ids: readonly number[], played: boolean) => {
      calls.push(`device-episodes-watched:${ids.join(",")}:${played}`);
    },
    clearWatch: async (id: number) => {
      calls.push(`device-clear:${id}`);
      return { ok: true };
    },
    setWatchlist: async (id: number, watchlisted: boolean) => {
      calls.push(`device-watchlist:${id}:${watchlisted}`);
      return { ok: true };
    },
    watchlist: async () => [deviceItem],
    play: async (fileId: number) => {
      calls.push(`device-play:${fileId}`);
      return { fileId } as unknown as Playability;
    },
    stream: (fileId: number) => {
      calls.push(`device-stream:${fileId}`);
      return `device-stream:${fileId}`;
    },
    streamHeaders: (fileId: number) => {
      calls.push(`device-stream-headers:${fileId}`);
      return { "X-Device": String(fileId) };
    },
    subtitle: async (fileId: number, uri: string) => {
      calls.push(`device-subtitle:${fileId}:${uri}`);
      return `device-subtitle:${fileId}:${uri}`;
    },
    titlesByPerson: () => new Map([["Actor", [deviceItem]]]),
    titlesByTmdb: () => new Map([["movie:40", deviceItem]]),
    collections: () => [{ id: 1, name: "Local collection", count: 1, poster: null }],
    counts: () => ({ movie: 1, series: 2 }),
    collectionItems: (id: number) => {
      calls.push(`device-collection:${id}`);
      return [deviceItem];
    },
    episodes: (id: number) => {
      calls.push(`device-episodes:${id}`);
      return [deviceItem];
    },
    report: (filter: string) => {
      calls.push(`device-report:${filter}`);
      return [deviceItem];
    },
    titleFile: (id: number) => {
      calls.push(`device-title-file:${id}`);
      return { name: "local-file", seasonNumber: 1, episodeNumber: 2 };
    },
    libraryStatus: () => ({ fileCount: 1, reviewCount: 2, markerCount: 3 }),
    fileVersion: (id: number) => {
      calls.push(`device-version:${id}`);
      return `device-version:${id}`;
    },
    identify: async (id: number) => {
      calls.push(`device-identify:${id}`);
    },
    removeTitle: async (id: number) => {
      calls.push(`device-remove:${id}`);
    },
  };
}

interface ServerOptions {
  failHome?: boolean;
  failItems?: boolean;
  failSearch?: boolean;
  failWatchlist?: boolean;
  failDetail?: boolean;
}

function serverCatalog(calls: string[], options: ServerOptions = {}) {
  const item = serverItem;
  return {
    session: { address: "https://server.test" },
    image: (path: string | null) => {
      calls.push(`server-image:${path}`);
      return path ? { uri: `server:${path}` } : undefined;
    },
    home: async (): Promise<HomePayload> => {
      calls.push("server-home");
      if (options.failHome) throw new Error("home failed");
      return {
        featured: item,
        rows: [
          { key: "shared", title: "Shared", items: [item] },
          { key: "server-row", title: "Server row", items: [item] },
          { key: "empty", title: "Empty", items: [] },
        ],
      };
    },
    items: async (kind: string, _offset?: number, sort?: string) => {
      calls.push(`server-items:${kind}:${sort}`);
      if (options.failItems) throw new Error("items failed");
      return { items: [item] };
    },
    readDetail: (id: string | number) => {
      calls.push(`server-read:${id}`);
      return String(id).includes("cached") ? detail(item) : null;
    },
    detail: async (id: string | number, signal?: AbortSignal) => {
      calls.push(`server-detail:${id}`);
      if (signal?.aborted) throw new Error("aborted");
      if (options.failDetail) throw new Error("detail failed");
      return detail(item);
    },
    deleteItem: async (id: string | number) => {
      calls.push(`server-delete:${id}`);
      return { ok: false };
    },
    search: async (query: string) => {
      calls.push(`server-search:${query}`);
      if (options.failSearch) throw new Error("search failed");
      return { titles: [item], episodes: [item] };
    },
    skips: async (fileId: number) => {
      calls.push(`server-skips:${fileId}`);
      return { intro: { start: 0, end: 5 }, recap: null, outro: null };
    },
    progress: async (id: number, position: number) => {
      calls.push(`server-progress:${id}:${position}`);
      return { ok: true };
    },
    watched: async (id: number, played: boolean) => {
      calls.push(`server-watched:${id}:${played}`);
      return { ok: true };
    },
    setEpisodesWatched: async (ids: readonly number[], played: boolean) => {
      calls.push(`server-episodes-watched:${ids.join(",")}:${played}`);
    },
    clearWatch: async (id: number) => {
      calls.push(`server-clear:${id}`);
      return { ok: true };
    },
    setWatchlist: async (id: number, watchlisted: boolean) => {
      calls.push(`server-watchlist:${id}:${watchlisted}`);
      return { ok: true };
    },
    watchlist: async () => {
      calls.push("server-watchlist-list");
      if (options.failWatchlist) throw new Error("watchlist failed");
      return [item];
    },
    play: async (fileId: number) => {
      calls.push(`server-play:${fileId}`);
      return { fileId } as unknown as Playability;
    },
    stream: (fileId: number) => {
      calls.push(`server-stream:${fileId}`);
      return `server-stream:${fileId}`;
    },
    streamHeaders: (fileId: number) => {
      calls.push(`server-stream-headers:${fileId}`);
      return { Authorization: `Bearer ${fileId}` };
    },
    subtitle: async (fileId: number, uri: string) => {
      calls.push(`server-subtitle:${fileId}:${uri}`);
      return `server-subtitle:${fileId}:${uri}`;
    },
    titlesByPerson: () => new Map([["Actor", [item]], ["Server actor", [item]]]),
    titlesByTmdb: () => new Map([["movie:40", item], ["movie:50", item]]),
    collections: () => [{ id: 9, name: "Server collection", count: 1, poster: null }],
    counts: () => ({ movie: 3, series: 4 }),
    collectionItems: (id: number) => {
      calls.push(`server-collection:${id}`);
      return [item];
    },
    episodes: (id: number) => {
      calls.push(`server-episodes:${id}`);
      return [item];
    },
    report: (filter: string) => {
      calls.push(`server-report:${filter}`);
      return [item];
    },
    titleFile: (id: number) => {
      calls.push(`server-title-file:${id}`);
      return { name: "server-file", seasonNumber: null, episodeNumber: null };
    },
    libraryStatus: () => ({ fileCount: 9, reviewCount: 8, markerCount: 7 }),
    fileVersion: (id: number) => {
      calls.push(`server-version:${id}`);
      return `server-version:${id}`;
    },
    identify: async (id: number) => {
      calls.push(`server-identify:${id}`);
    },
    removeTitle: async (id: number) => {
      calls.push(`server-remove:${id}`);
    },
  };
}

test("delegates everything to the device without a server", async () => {
  const calls: string[] = [];
  const device = deviceCatalog(calls);
  const merged = new MergedCatalog(
    device as unknown as LocalCatalog,
    null,
  );
  expect(merged.image(null)).toBeUndefined();
  expect(merged.image("poster.jpg")).toEqual({ uri: "device:poster.jpg" });
  expect((await merged.home()).rows).toHaveLength(1);
  expect((await merged.items("movie", 0, "year")).items[0]?.publicId).toBe(
    "local-1",
  );
  expect(merged.readDetail("local-1")?.item.publicId).toBe("local-1");
  expect((await merged.detail("local-1")).item.publicId).toBe("local-1");
  expect(await merged.deleteItem("local-1")).toEqual({ ok: true });
  expect((await merged.search("query")).titles[0]?.publicId).toBe("local-1");
  expect(await merged.skips(2)).toEqual({ intro: null, recap: null, outro: null });
  expect(await merged.progress(2, 9)).toEqual({ ok: true });
  expect(await merged.watched(2, true)).toEqual({ ok: true });
  await merged.setEpisodesWatched([2, 3], true);
  expect(await merged.clearWatch(2)).toEqual({ ok: true });
  expect(await merged.setWatchlist(2, true)).toEqual({ ok: true });
  expect((await merged.watchlist())[0]?.publicId).toBe("local-1");
  expect((await merged.play(2)).fileId).toBe(2);
  expect(merged.stream(2)).toBe("device-stream:2");
  expect(merged.streamHeaders(2)).toEqual({ "X-Device": "2" });
  expect(await merged.subtitle(2, "en.vtt")).toBe("device-subtitle:2:en.vtt");
  expect(merged.titlesByPerson().get("Actor")?.[0]?.publicId).toBe("local-1");
  expect(merged.titlesByTmdb().get("movie:40")?.publicId).toBe("local-1");
  expect(merged.alternateSource(deviceItem)).toBeNull();
  expect(merged.alternateSource(card({ tmdbId: null }))).toBeNull();
  expect(merged.collections()[0]?.name).toBe("Local collection");
  expect(merged.counts()).toEqual({ movie: 1, series: 2 });
  expect(merged.collectionItems(1)[0]?.publicId).toBe("local-1");
  expect(merged.episodes(1)[0]?.publicId).toBe("local-1");
  expect(merged.report("files")[0]?.publicId).toBe("local-1");
  expect(merged.titleFile(1)?.name).toBe("local-file");
  expect(merged.libraryStatus()).toEqual({
    fileCount: 1,
    reviewCount: 2,
    markerCount: 3,
  });
  expect(merged.fileVersion(1)).toBe("device-version:1");
  await merged.identify(1, { kind: "movies", title: "Title" });
  await merged.removeTitle(1);
  expect(calls).toEqual([
    "device-image:poster.jpg",
    "device-items:movie:year",
    "device-read:local-1",
    "device-detail:local-1",
    "device-delete:local-1",
    "device-search:query",
    "device-skips:2",
    "device-progress:2:9",
    "device-watched:2:true",
    "device-episodes-watched:2,3:true",
    "device-clear:2",
    "device-watchlist:2:true",
    "device-play:2",
    "device-stream:2",
    "device-stream-headers:2",
    "device-subtitle:2:en.vtt",
    "device-collection:1",
    "device-episodes:1",
    "device-report:files",
    "device-title-file:1",
    "device-version:1",
    "device-identify:1",
    "device-remove:1",
  ]);
});

test("routes server ids to the server and device ids to the device", async () => {
  const calls: string[] = [];
  const device = deviceCatalog(calls);
  const server = serverCatalog(calls);
  const merged = new MergedCatalog(
    device as unknown as LocalCatalog,
    server as unknown as ServerCatalog,
  );
  const serverId = serverItemId(1);
  const serverFile = serverFileId(1);

  expect(merged.image("/api/poster.jpg")).toEqual({
    uri: "server:/api/poster.jpg",
  });
  expect(merged.image("https://server.test/api/logo.png")).toEqual({
    uri: "server:https://server.test/api/logo.png",
  });
  expect(merged.image("local.jpg")).toEqual({ uri: "device:local.jpg" });
  expect((await merged.home()).featured?.publicId).toBe("server-1");
  expect((await merged.items("all")).items).toHaveLength(2);
  expect(merged.readDetail("server-cached")?.item.publicId).toBe("server-1");
  expect(merged.readDetail("local-1")?.item.publicId).toBe("local-1");
  expect((await merged.detail("server-1")).item.publicId).toBe("server-1");
  expect((await merged.detail(serverId)).item.publicId).toBe("server-1");
  expect((await merged.detail("local-1")).item.publicId).toBe("local-1");
  expect(await merged.deleteItem(serverId)).toEqual({ ok: false });
  expect(await merged.deleteItem("local-1")).toEqual({ ok: true });
  expect((await merged.search("query")).titles).toHaveLength(2);
  expect((await merged.search("query")).episodes).toHaveLength(1);
  expect(await merged.skips(serverFile)).toEqual({
    intro: { start: 0, end: 5 },
    recap: null,
    outro: null,
  });
  expect(await merged.skips(2)).toEqual({ intro: null, recap: null, outro: null });
  expect(await merged.progress(serverId, 15)).toEqual({ ok: true });
  expect(await merged.progress(2, 15)).toEqual({ ok: true });
  expect(await merged.watched(serverId, true)).toEqual({ ok: true });
  expect(await merged.watched(2, false)).toEqual({ ok: true });
  await merged.setEpisodesWatched([serverId, 2, 3], true);
  expect(await merged.clearWatch(serverId)).toEqual({ ok: true });
  expect(await merged.clearWatch(2)).toEqual({ ok: true });
  expect(await merged.setWatchlist(serverId, false)).toEqual({ ok: true });
  expect(await merged.setWatchlist(2, true)).toEqual({ ok: true });
  expect(await merged.watchlist()).toHaveLength(2);
  expect((await merged.play(serverFile)).fileId).toBe(serverFile);
  expect((await merged.play(2)).fileId).toBe(2);
  expect(merged.stream(serverFile)).toBe(`server-stream:${serverFile}`);
  expect(merged.stream(2)).toBe("device-stream:2");
  expect(merged.streamHeaders(serverFile)).toEqual({
    Authorization: `Bearer ${serverFile}`,
  });
  expect(merged.streamHeaders(2)).toEqual({ "X-Device": "2" });
  expect(await merged.subtitle(serverFile, "en.vtt")).toBe(
    `server-subtitle:${serverFile}:en.vtt`,
  );
  expect(await merged.subtitle(2, "en.vtt")).toBe("device-subtitle:2:en.vtt");
  expect(merged.titlesByPerson().get("Actor")?.[0]?.publicId).toBe("local-1");
  expect(merged.titlesByPerson().get("Server actor")).toHaveLength(1);
  expect(merged.titlesByTmdb().get("movie:40")?.publicId).toBe("local-1");
  expect(merged.titlesByTmdb().get("movie:50")?.publicId).toBe("server-1");
  expect(
    merged.alternateSource(card({ tmdbId: 40, source: "server" }))?.publicId,
  ).toBe("local-1");
  expect(
    merged.alternateSource(card({ tmdbId: 40, source: "device" }))?.publicId,
  ).toBe("server-1");
  expect(merged.counts()).toEqual({ movie: 4, series: 6 });
  expect(merged.collections()[0]?.name).toBe("Local collection");
  expect(merged.collectionItems(1)[0]?.publicId).toBe("local-1");
  expect(merged.episodes(serverId)[0]?.publicId).toBe("server-1");
  expect(merged.episodes(1)[0]?.publicId).toBe("local-1");
  expect(merged.report("all")[0]?.publicId).toBe("local-1");
  expect(merged.titleFile(serverId)?.name).toBe("server-file");
  expect(merged.titleFile(1)?.name).toBe("local-file");
  expect(merged.libraryStatus()).toEqual({
    fileCount: 1,
    reviewCount: 2,
    markerCount: 3,
  });
  expect(merged.fileVersion(serverFile)).toBe(
    `server-version:${serverFile}`,
  );
  expect(merged.fileVersion(1)).toBe("device-version:1");
  await merged.identify(serverId, { kind: "movies", title: "Title" });
  await merged.identify(1, { kind: "movies", title: "Title" });
  await merged.removeTitle(serverId);
  await merged.removeTitle(1);

  expect(calls).toContain("server-image:/api/poster.jpg");
  expect(calls).toContain("server-image:https://server.test/api/logo.png");
  expect(calls).toContain("device-image:local.jpg");
  expect(calls).toContain("server-search:query");
  expect(calls).toContain(`server-episodes-watched:${serverId}:true`);
  expect(calls).toContain("device-episodes-watched:2,3:true");
  expect(calls).toContain(`server-clear:${serverId}`);
  expect(calls).toContain(`server-watchlist:${serverId}:false`);
  expect(calls).toContain(`server-version:${serverFile}`);
  expect(calls).toContain(`server-identify:${serverId}`);
  expect(calls).toContain(`server-remove:${serverId}`);
});

test("falls back to the device when server calls fail", async () => {
  const calls: string[] = [];
  const device = deviceCatalog(calls);
  const server = serverCatalog(calls, {
    failHome: true,
    failItems: true,
    failSearch: true,
    failWatchlist: true,
    failDetail: true,
  });
  const merged = new MergedCatalog(
    device as unknown as LocalCatalog,
    server as unknown as ServerCatalog,
  );
  const home = await merged.home();
  expect(home.featured).toBeNull();
  expect(home.rows[0]?.items[0]?.publicId).toBe("local-1");
  expect((await merged.items("all")).items[0]?.publicId).toBe("local-1");
  expect((await merged.search("query")).titles[0]?.publicId).toBe("local-1");
  expect((await merged.watchlist())[0]?.publicId).toBe("local-1");
  expect((await merged.detail("server-1")).item.publicId).toBe("local-1");

  const controller = new AbortController();
  controller.abort();
  await expect(merged.detail("server-1", controller.signal)).rejects.toThrow(
    "aborted",
  );
});

test("merges duplicate and untagged titles across both sources", async () => {
  const calls: string[] = [];
  const device = deviceCatalog(calls);
  const server = serverCatalog(calls);
  const merged = new MergedCatalog(
    device as unknown as LocalCatalog,
    server as unknown as ServerCatalog,
  );
  const deviceAlpha = card({ id: 2, publicId: "local-alpha", name: "Alpha", year: 2020 });
  const serverAlpha = card({
    id: serverItemId(2),
    publicId: "server-alpha",
    name: "Alpha",
    year: 2020,
    source: "server",
  });
  const deviceEpisode = card({
    id: 3,
    publicId: "local-episode",
    kind: "episode",
    name: "Pilot",
    parentTitle: "Show",
    seasonNumber: 1,
    episodeNumber: 1,
  });
  const serverEpisode = card({
    id: serverItemId(3),
    publicId: "server-episode",
    kind: "episode",
    name: "Pilot",
    parentTitle: "Show",
    seasonNumber: 1,
    episodeNumber: 1,
    source: "server",
  });
  const serverSeries = card({
    id: serverItemId(4),
    publicId: "server-series",
    kind: "series",
    name: "Show",
    tmdbId: 77,
    source: "server",
  });
  device.items = async () => ({ items: [deviceAlpha, deviceEpisode] });
  server.items = async () => ({
    items: [serverAlpha, serverEpisode, serverSeries],
  });
  (device as unknown as { titlesByTmdb: () => Map<string, ItemCard> }).titlesByTmdb =
    () => new Map([["movie:40", deviceItem]]);
  const items = await merged.items("all");
  expect(items.items.map((item) => item.publicId)).toEqual([
    "local-alpha",
    "local-episode",
    "server-series",
  ]);
  server.items = async () => ({
    items: [
      card({ id: serverItemId(5), publicId: "s1", name: "B", year: 2001, rating: 2, source: "server" }),
      card({ id: serverItemId(6), publicId: "s2", name: "A", year: 2022, rating: 8, source: "server" }),
    ],
  });
  device.items = async () => ({ items: [] });
  expect((await merged.items("all", 0, "year")).items.map((item) => item.publicId)).toEqual([
    "s2",
    "s1",
  ]);
  expect((await merged.items("all", 0, "rating")).items.map((item) => item.publicId)).toEqual([
    "s2",
    "s1",
  ]);
  expect((await merged.items("all", 0, "name")).items.map((item) => item.publicId)).toEqual([
    "s2",
    "s1",
  ]);
  expect(merged.titlesByPerson().get("Server actor")).toHaveLength(1);
  expect(merged.alternateSource(card({ tmdbId: 99, source: "device" }))).toBeNull();
});
