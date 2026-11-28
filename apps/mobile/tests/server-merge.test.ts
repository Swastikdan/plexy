import { expect, test } from "bun:test";
import type { LocalCatalog } from "@/core/library/catalog-api";
import { MergedCatalog } from "@/core/server/merged-catalog";
import { SERVER_ID_OFFSET, serverFileId, serverItemId } from "@/core/server/ids";
import type { ServerCatalog } from "@/core/server/server-catalog";

function card(overrides: Record<string, unknown>) {
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

function fakeDevice(items: ReturnType<typeof card>[]) {
  return {
    home: async () => ({
      featured: items[0] ?? null,
      rows: [{ key: "recent-movies", title: "Recently added movies", items }],
    }),
    items: async () => ({ items }),
    detail: async (id: string | number) => ({ item: items[0], id }),
    readDetail: () => null,
    progress: async () => ({ ok: true }),
    deleteItem: async () => ({ ok: true }),
    watchlist: async () => items,
    search: async () => ({ titles: items, episodes: [] }),
    titlesByPerson: () => new Map(),
    titlesByTmdb: () => new Map(),
    collections: () => [],
    counts: () => ({ movie: items.length, series: 0 }),
    collectionItems: () => [],
    episodes: () => [],
    report: () => [],
    titleFile: () => undefined,
    libraryStatus: () => ({ fileCount: 0, reviewCount: 0, markerCount: 0 }),
    fileVersion: (id: number) => `device:${id}`,
    identify: async () => {},
    removeTitle: async () => {},
  };
}

test("merged home prefers the device copy and adds server-only rows", async () => {
  const shared = card({ id: 1, publicId: "local-1", tmdbId: 10, name: "Shared" });
  const serverShared = card({
    id: serverItemId(1),
    publicId: "server-shared",
    tmdbId: 10,
    name: "Shared",
    source: "server",
    fileId: serverFileId(1),
  });
  const serverOnly = card({
    id: serverItemId(2),
    publicId: "server-only",
    tmdbId: 20,
    name: "Zulu",
    source: "server",
    fileId: serverFileId(2),
  });
  const server = {
    session: { address: "https://server.test" },
    home: async () => ({
      featured: serverOnly,
      rows: [{ key: "recent-movies", title: "Recently added movies", items: [serverShared, serverOnly] }],
    }),
    items: async () => ({ items: [serverShared, serverOnly] }),
    detail: async () => ({ item: serverOnly }),
    progress: async () => ({ ok: true }),
    titlesByTmdb: () => new Map(),
    counts: () => ({ movie: 2, series: 0 }),
  };
  const device = fakeDevice([shared]);
  device.titlesByTmdb = () => new Map([["movie:10", shared]]);
  server.titlesByTmdb = () => new Map([["movie:10", serverShared], ["movie:20", serverOnly]]);
  const merged = new MergedCatalog(
    device as unknown as LocalCatalog,
    server as unknown as ServerCatalog,
  );
  const home = await merged.home();
  expect(home.featured?.publicId).toBe("local-1");
  expect(home.rows[0]?.items.map((item) => item.publicId)).toEqual([
    "local-1",
    "server-only",
  ]);
  const items = await merged.items("all", 0, "name");
  expect(items.items.map((item) => item.publicId)).toEqual([
    "local-1",
    "server-only",
  ]);
  expect(items.items[1]?.source).toBe("server");
  expect(merged.counts()).toEqual({ movie: 3, series: 0 });
  expect(merged.alternateSource(shared)?.publicId).toBe("server-shared");
  expect(merged.alternateSource(serverShared)?.publicId).toBe("local-1");
});

test("merged detail and progress route by the source id", async () => {
  const calls: string[] = [];
  const device = {
    ...fakeDevice([card({ id: 1, publicId: "local-1" })]),
    detail: async () => {
      calls.push("device-detail");
      return { item: card({ publicId: "local-1" }) };
    },
    progress: async (id: number) => {
      calls.push(`device-progress:${id}`);
      return { ok: true };
    },
  };
  const server = {
    session: { address: "https://server.test" },
    detail: async () => {
      calls.push("server-detail");
      return { item: card({ publicId: "server-1", source: "server" }) };
    },
    progress: async (id: number) => {
      calls.push(`server-progress:${id}`);
      return { ok: true };
    },
    readDetail: () => null,
  };
  const merged = new MergedCatalog(
    device as unknown as LocalCatalog,
    server as unknown as ServerCatalog,
  );
  expect((await merged.detail("server-1")).item.publicId).toBe("server-1");
  expect((await merged.detail("local-1")).item.publicId).toBe("local-1");
  await merged.progress(serverItemId(9), 12);
  await merged.progress(3, 4);
  expect(calls).toEqual([
    "server-detail",
    "device-detail",
    `server-progress:${SERVER_ID_OFFSET + 9}`,
    "device-progress:3",
  ]);
});
