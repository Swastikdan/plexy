import { afterAll, beforeEach, expect, test } from "bun:test";
import { ServerCatalog, serverFileId, serverItemId } from "@/core/server/server-catalog";
import type { ServerSession } from "@/core/server/transport";

type Handler = (request: Request) => Response | Promise<Response>;
let handler: Handler = () => new Response("not configured", { status: 500 });
const requests: string[] = [];

const server = Bun.serve({
  port: 0,
  fetch(request) {
    const url = new URL(request.url);
    requests.push(`${request.method} ${url.pathname}${url.search}`);
    return handler(request);
  },
});

const session: ServerSession = {
  address: `http://127.0.0.1:${server.port}`,
  serverId: "server-one",
  token: "session-token",
  user: { id: 1, username: "owner", role: "owner" },
  device: { id: "device", name: "Phone" },
  connectedAt: 1_700_000_000_000,
};

function apiCard(id: number, overrides: Record<string, unknown> = {}) {
  return {
    id,
    publicId: `server-${id}`,
    kind: "movie",
    name: `Movie ${id}`,
    year: 2020,
    poster: "/api/poster.jpg",
    backdrop: "/api/backdrop.jpg",
    logo: null,
    still: null,
    overview: null,
    rating: null,
    runtime: 100,
    genres: [],
    matchStatus: "matched",
    watch: null,
    ...overrides,
  };
}

function json(value: unknown, init?: ResponseInit) {
  return Response.json(value, init);
}

beforeEach(() => {
  requests.length = 0;
  handler = () => new Response("not configured", { status: 500 });
});

afterAll(() => {
  server.stop(true);
});

test("maps home, items, search, and watchlist requests", async () => {
  handler = (request) => {
    const url = new URL(request.url);
    switch (url.pathname) {
      case "/api/home":
        return json({
          featured: apiCard(5),
          rows: [{ key: "recent", title: "Recent", items: [apiCard(6)] }],
        });
      case "/api/items":
        if (url.searchParams.get("watchlist") === "true")
          return json({ items: [apiCard(7, { watchlist: true })] });
        return json({ items: [apiCard(8)], total: 12 });
      case "/api/search":
        return json({ titles: [apiCard(9)], episodes: [apiCard(10)] });
      default:
        return new Response("missing", { status: 404 });
    }
  };
  const catalog = new ServerCatalog(session, () => {});
  const home = await catalog.home();
  expect(home.featured?.id).toBe(serverItemId(5));
  expect(home.featured?.poster).toBe(`${session.address}/api/poster.jpg`);
  expect(home.featured?.source).toBe("server");
  expect(home.rows[0]?.items[0]?.id).toBe(serverItemId(6));

  const items = await catalog.items("movie", 60, "recent", undefined, true, {
    genre: "Drama",
    maxRuntime: 120,
  });
  expect(items.items[0]?.id).toBe(serverItemId(8));
  expect(requests).toContain(
    "GET /api/items?kind=movie&offset=60&limit=60&sort=added&unwatched=true&genre=Drama&maxRuntime=120",
  );
  await catalog.items("all", 0, "rating");
  expect(requests).toContain(
    "GET /api/items?offset=0&limit=60&sort=rating",
  );

  const search = await catalog.search("dune");
  expect(search.titles[0]?.id).toBe(serverItemId(9));
  expect(search.episodes[0]?.id).toBe(serverItemId(10));
  expect(requests).toContain("GET /api/search?q=dune");

  const watchlist = await catalog.watchlist();
  expect(watchlist[0]?.watchlist).toBe(true);
});

test("maps skip segments, progress, and watch commands", async () => {
  handler = (request) => {
    const url = new URL(request.url);
    if (url.pathname.startsWith("/api/skip-segments/"))
      return json({ enabled: true, intro: { start: 1, end: 4 }, outro: null });
    if (url.pathname === "/api/progress") {
      return json({ ok: true });
    }
    if (url.pathname.startsWith("/api/watch/")) {
      return json({ ok: true });
    }
    if (url.pathname.endsWith("/flags")) {
      return json({ ok: true });
    }
    return new Response("missing", { status: 404 });
  };
  const catalog = new ServerCatalog(session, () => {});
  expect(await catalog.skips(serverFileId(3))).toEqual({
    intro: { start: 1, end: 4 },
    recap: null,
    outro: null,
  });
  expect(await catalog.progress(serverItemId(3), 12.5, 90, true)).toEqual({
    ok: true,
  });
  expect(await catalog.watched(serverItemId(3), true)).toEqual({ ok: true });
  expect(await catalog.clearWatch(serverItemId(3))).toEqual({ ok: true });
  expect(await catalog.setWatchlist(serverItemId(3), false)).toEqual({
    ok: true,
  });
  await catalog.setEpisodesWatched(
    [serverItemId(3), serverItemId(4)],
    true,
  );
  expect(requests).toContain("POST /api/progress");
  expect(requests).toContain("POST /api/watch/3/played");
  expect(requests).toContain("DELETE /api/watch/3");
  expect(requests.filter((entry) => entry === "POST /api/watch/3/played")).toHaveLength(2);
  expect(requests).toContain("PUT /api/items/3/flags");
});

test("maps details, seasons, files, cast, and cached episodes", async () => {
  handler = (request) => {
    const url = new URL(request.url);
    if (url.pathname === "/api/items/5") {
      return json({
        item: apiCard(5, { kind: "series", tmdbId: 90 }),
        seasons: [{ id: 51, number: 1, name: "Season 1", poster: "/api/season.jpg" }],
        episodes: [apiCard(52, { kind: "episode", parentId: 5, seasonNumber: 1, episodeNumber: 1 })],
        file: { fileId: 55, itemId: 5, duration: 90, size: 100 },
        cast: [{ id: 1, name: "Actor", character: "Role", photo: "/api/actor.jpg" }],
      });
    }
    if (url.pathname === "/api/items/server-public") {
      return json({
        item: apiCard(6),
        seasons: null,
        episodes: null,
        file: null,
        cast: [],
      });
    }
    if (url.pathname === "/api/items") {
      return json({ total: url.searchParams.get("kind") === "movie" ? 4 : 5 });
    }
    return new Response("missing", { status: 404 });
  };
  const catalog = new ServerCatalog(session, () => {});
  const detail = await catalog.detail(serverItemId(5));
  expect(detail.item.id).toBe(serverItemId(5));
  expect(detail.seasons?.[0]?.id).toBe(serverItemId(51));
  expect(detail.episodes?.[0]?.id).toBe(serverItemId(52));
  expect(detail.file?.fileId).toBe(serverFileId(55));
  expect(detail.file?.itemId).toBe(serverItemId(5));
  expect(detail.cast[0]?.photo).toBe(`${session.address}/api/actor.jpg`);
  expect(catalog.readDetail("server-5")?.item.id).toBe(serverItemId(5));
  expect(catalog.episodes(serverItemId(5))[0]?.id).toBe(serverItemId(52));
  expect(catalog.episodes(serverItemId(5))[0]?.id).toBe(serverItemId(52));
  expect(requests.filter((entry) => entry === "GET /api/items/5")).toHaveLength(1);

  const numeric = await catalog.detail(String(serverItemId(5)));
  expect(numeric.item.id).toBe(serverItemId(5));
  const publicDetail = await catalog.detail("server-public");
  expect(publicDetail.item.id).toBe(serverItemId(6));
  expect(requests).toContain("GET /api/items/server-public");

  const counts = await catalog.refreshCounts();
  expect(counts).toEqual({ movie: 4, series: 5 });
});

test("maps play metadata, streams, images, and subtitles", async () => {
  handler = (request) => {
    const url = new URL(request.url);
    if (url.pathname.startsWith("/api/play/")) {
      return json({
        path: "direct",
        reason: "direct-play",
        fileId: 60,
        itemId: 5,
        parentItemId: 4,
        nextFileId: 61,
        next: { fileId: 61, itemId: 6 },
        versions: [{ fileId: 62 }],
        episodes: [apiCard(63)],
        watch: null,
      });
    }
    if (url.pathname.startsWith("/api/subtitles/")) {
      return new Response("WEBVTT", { status: 200 });
    }
    if (url.pathname === "/api/items/5") {
      return json({
        item: apiCard(5, { tmdbId: 90 }),
        seasons: null,
        episodes: null,
        file: null,
        cast: [],
      });
    }
    return new Response("missing", { status: 404 });
  };
  const unauthorized: string[] = [];
  const catalog = new ServerCatalog(session, () => unauthorized.push("called"));
  const play = await catalog.play(serverFileId(60));
  expect(play.fileId).toBe(serverFileId(60));
  expect(play.itemId).toBe(serverItemId(5));
  expect(play.parentItemId).toBe(serverItemId(4));
  expect(play.nextFileId).toBe(serverFileId(61));
  expect(play.next?.itemId).toBe(serverItemId(6));
  expect(play.versions?.[0]?.fileId).toBe(serverFileId(62));
  expect(play.episodes?.[0]?.id).toBe(serverItemId(63));
  expect(catalog.stream(serverFileId(60))).toBe(
    `${session.address}/api/stream/60/original`,
  );
  expect(catalog.streamHeaders(serverFileId(60))).toEqual({
    Authorization: "Bearer session-token",
  });
  expect(catalog.image("/api/poster.jpg")).toEqual({
    uri: `${session.address}/api/poster.jpg`,
    headers: { Authorization: "Bearer session-token" },
  });
  expect(catalog.image(null)).toBeUndefined();
  expect(catalog.image("https://cdn.test/poster.jpg")).toEqual({
    uri: "https://cdn.test/poster.jpg",
  });

  expect(await catalog.subtitle(serverFileId(60), "en track.vtt")).toBe(
    "WEBVTT",
  );
  expect(requests).toContain("GET /api/subtitles/60/en%20track.vtt");
  expect(unauthorized).toEqual([]);

  await catalog.detail(serverItemId(5));
  expect(catalog.titlesByTmdb().get("movie:90")?.id).toBe(serverItemId(5));
  expect(catalog.fileVersion(serverFileId(60))).toBe("server-one:60");
  expect(catalog.counts()).toEqual({ movie: 0, series: 0 });
  expect(catalog.titlesByPerson()).toEqual(new Map());
  expect(catalog.collections()).toEqual([]);
  expect(catalog.collectionItems(1)).toEqual([]);
  expect(catalog.report("all")).toEqual([]);
  expect(catalog.titleFile(serverItemId(5))).toBeUndefined();
  expect(catalog.libraryStatus()).toEqual({
    fileCount: 0,
    reviewCount: 0,
    markerCount: 0,
  });
  await expect(
    catalog.deleteItem(serverItemId(5)),
  ).rejects.toThrow("Server titles are managed on the Plexy Server.");
  await expect(
    catalog.identify(serverItemId(5), { kind: "movies", title: "Title" }),
  ).rejects.toThrow("Matches are managed on the Plexy Server.");
  await expect(
    catalog.removeTitle(serverItemId(5)),
  ).rejects.toThrow("Server titles are managed on the Plexy Server.");
});

test("reports unauthorized requests and subtitle failures", async () => {
  handler = () => new Response("expired", { status: 401 });
  const unauthorized: string[] = [];
  const catalog = new ServerCatalog(session, () => unauthorized.push("called"));
  await expect(catalog.home()).rejects.toThrow();
  expect(unauthorized).toEqual(["called"]);
  await expect(catalog.subtitle(serverFileId(1), "en.vtt")).rejects.toThrow();
  expect(unauthorized).toEqual(["called", "called"]);

  handler = () => new Response("missing", { status: 404 });
  await expect(catalog.subtitle(serverFileId(1), "en.vtt")).rejects.toThrow(
    "Subtitle track could not be loaded.",
  );
});

test("cancels aborted catalog requests", async () => {
  const catalog = new ServerCatalog(session, () => {});
  const controller = new AbortController();
  controller.abort();
  await expect(catalog.home(controller.signal)).rejects.toThrow(
    "Request cancelled",
  );
  await expect(catalog.items("all", 0, "name", controller.signal)).rejects.toThrow(
    "Request cancelled",
  );
  await expect(catalog.detail(1, controller.signal)).rejects.toThrow(
    "Request cancelled",
  );
  await expect(catalog.search("q", controller.signal)).rejects.toThrow(
    "Request cancelled",
  );
  await expect(catalog.watchlist(controller.signal)).rejects.toThrow(
    "Request cancelled",
  );
});
