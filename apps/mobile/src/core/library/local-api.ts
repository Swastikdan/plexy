import { LocalLibrary } from "../../../../../packages/local-library/src/library";
import { LocalCatalog,type Playability } from "./catalog-api";
/** Implements the existing UI contract in process, without a network listener. */
export class LocalApi extends LocalCatalog {
  readonly local = true;
  constructor(
    readonly library: LocalLibrary,
    private readSubtitle: (uri: string) => Promise<string>,
    private subtitles: (
      fileId: number,
    ) => Promise<NonNullable<Playability["tracks"]>>,
  ) {
    super();
  }
  override stream(fileId: number) {
    return this.library.record(fileId).file.uri;
  }
  override async text(path: string) {
    const track = path.match(/^\/api\/subtitles\/\d+\/(.+)$/);
    if (!track)
      throw new Error(
        "Seek previews have not been generated for this local file.",
      );
    const uri = decodeURIComponent(track[1]!);
    const fileId = Number(path.split("/")[3]);
    if (!(await this.subtitles(fileId)).some((t) => t.track === uri))
      throw new Error("Subtitle not found.");
    return this.readSubtitle(uri);
  }
  override async play(fileId: number): Promise<Playability> {
    const r = this.library.record(fileId);
    const siblings = r.card.parentId
      ? this.library.state.records
          .filter((s) => s.card.parentId === r.card.parentId)
          .sort(
            (a, b) =>
              a.card.seasonNumber! - b.card.seasonNumber! ||
              a.card.episodeNumber! - b.card.episodeNumber!,
          )
      : [];
    const next = siblings.length
      ? siblings[siblings.findIndex((s) => s.id === fileId) + 1]
      : null;
    return {
      path: "direct",
      reason: "Original file · on this device",
      fileId,
      itemId: r.id,
      parentItemId: r.card.parentId,
      parentPublicId: r.card.parentPublicId,
      title: r.card.parentTitle || r.card.name,
      subtitle: r.card.kind === "episode" ? r.card.name : null,
      seasonNumber: r.card.seasonNumber,
      episodeNumber: r.card.episodeNumber,
      duration: r.card.watch?.duration,
      watch: r.card.watch,
      audioTracks: [],
      tracks: await this.subtitles(fileId),
      episodes: siblings.map((s) => s.card),
      nextFileId: next?.id ?? null,
      next: next
        ? {
            fileId: next.id,
            itemId: next.id,
            title: next.card.parentTitle || next.card.name,
            subtitle: next.card.name,
            poster: next.card.poster,
            seasonNumber: next.card.seasonNumber ?? null,
            episodeNumber: next.card.episodeNumber ?? null,
          }
        : null,
    };
  }
  override async request<T>(path: string, init: RequestInit = {}): Promise<T> {
    if (init.signal?.aborted) throw new Error("Request cancelled");
    const url = new URL(path, "https://local.invalid");
    const route = url.pathname;
    const body = init.body ? JSON.parse(String(init.body)) : {};
    const all = this.library.cards();
    let result: unknown;
    if (route === "/api/home") {
      const continuing = this.library.state.records
        .map((r) => r.card)
        .filter((c) => c.watch && !c.watch.played && c.watch.position > 0);
      result = {
        featured: all.find((c) => c.backdrop) || all[0] || null,
        rows: [
          { key: "continue", title: "Continue watching", items: continuing },
          {
            key: "movies",
            title: "Movies on this device",
            items: all.filter((c) => c.kind === "movie" && !c.isAnime),
          },
          {
            key: "series",
            title: "Series on this device",
            items: all.filter((c) => c.kind === "series" && !c.isAnime),
          },
          {
            key: "anime",
            title: "Anime on this device",
            items: all.filter((c) => c.isAnime),
          },
        ].filter((r) => r.items.length),
      };
    } else if (route === "/api/items") {
      const requestedKind = url.searchParams.get("kind");
      let items =
        requestedKind === "anime"
          ? all.filter((c) => c.isAnime)
          : all.filter((c) => c.kind === requestedKind && !c.isAnime);
      if (url.searchParams.get("unwatched") === "true")
        items = items.filter((c) => !c.watch?.played);
      const sort = url.searchParams.get("sort");
      items.sort((a, b) =>
        sort === "year"
          ? (b.year || 0) - (a.year || 0)
          : sort === "rating"
            ? (b.rating || 0) - (a.rating || 0)
            : sort === "added" || sort === "recent"
              ? b.id - a.id
              : a.name.localeCompare(b.name),
      );
      const offset = Number(url.searchParams.get("offset")) || 0;
      result = { items: items.slice(offset, offset + 60) };
    } else if (route === "/api/search") {
      const q = (url.searchParams.get("q") || "").toLowerCase();
      result = {
        titles: all.filter((c) => c.name.toLowerCase().includes(q)),
        episodes: this.library.state.records
          .filter(
            (r) =>
              r.card.kind === "episode" &&
              r.card.name.toLowerCase().includes(q),
          )
          .map((r) => r.card),
      };
    } else if (route.startsWith("/api/items/")) {
      const id = Number(
        decodeURIComponent(route.split("/").at(-1)!).replace(/^local-/, ""),
      );
      if (init.method === "DELETE") {
        await this.library.deleteTitle(id, true);
        result = { ok: true };
      } else {
        result = this.library.detail(id);
      }
    } else if (route === "/api/progress") {
      await this.library.progress(
        body.itemId,
        body.position,
        body.duration || null,
        body.played,
      );
      result = { ok: true };
    } else if (/^\/api\/watch\/\d+/.test(route)) {
      const id = Number(route.split("/")[3]);
      if (init.method === "DELETE" || !body?.played)
        await this.library.clearWatch(id);
      else await this.library.progress(id, 0, null, !!body.played);
      result = { ok: true };
    } else if (route.startsWith("/api/skip-segments/"))
      result = await this.library.getMarkers(Number(route.split("/").at(-1)));
    else throw new Error("This feature is unavailable in the local library.");
    return result as T;
  }
}
