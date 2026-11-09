import { PlexyApi, type Playability, type Session } from "./api";
import { LocalLibrary, localSegments } from "../../local-library/src/library";

export const localSession: Session = {
  profile: { id: "this-device", serverId: "this-device", url: "http://127.0.0.1",
    name: "On this device", username: "My library", userId: 1 }, token: "",
};

/** Implements the existing UI contract in process, without a network listener. */
export class LocalApi extends PlexyApi {
  readonly local = true;
  constructor(readonly library: LocalLibrary, private readSubtitle: (uri: string) => Promise<string>,
    private subtitles: (fileId: number) => Promise<NonNullable<Playability["tracks"]>>) {
    super(localSession.profile.url);
  }
  override headers() { return {}; }
  override stream(fileId: number) { return this.library.record(fileId).file.uri; }
  override download(fileId: number) { return this.stream(fileId); }
  override async text(path: string) {
    const track = path.match(/^\/api\/subtitles\/\d+\/(.+)$/);
    if (!track) throw new Error("Seek previews have not been generated for this local file.");
    const uri = decodeURIComponent(track[1]!);
    const fileId = Number(path.split("/")[3]);
    if (!(await this.subtitles(fileId)).some(t => t.track === uri)) throw new Error("Subtitle not found.");
    return this.readSubtitle(uri);
  }
  override async play(fileId: number): Promise<Playability> {
    const r = this.library.record(fileId);
    const siblings = r.card.parentId ? this.library.state.records.filter(s => s.card.parentId === r.card.parentId)
      .sort((a,b) => (a.card.seasonNumber! - b.card.seasonNumber!) || (a.card.episodeNumber! - b.card.episodeNumber!)) : [];
    const next = siblings.length ? siblings[siblings.findIndex(s => s.id === fileId) + 1] : null;
    return { path: "direct", reason: "Original file · on this device", fileId, itemId: r.id,
      parentItemId: r.card.parentId, parentPublicId: r.card.parentPublicId,
      title: r.card.parentTitle || r.card.name, subtitle: r.card.kind === "episode" ? r.card.name : null,
      seasonNumber: r.card.seasonNumber, episodeNumber: r.card.episodeNumber,
      duration: r.card.watch?.duration, watch: r.card.watch, audioTracks: [], tracks: await this.subtitles(fileId),
      nextFileId: next?.id ?? null, next: next ? { fileId: next.id, itemId: next.id,
        title: next.card.parentTitle || next.card.name, subtitle: next.card.name, poster: next.card.poster,
        seasonNumber: next.card.seasonNumber ?? null, episodeNumber: next.card.episodeNumber ?? null } : null };
  }
  override async request<T>(path: string, init: RequestInit = {}): Promise<T> {
    if (init.signal?.aborted) throw new Error("Request cancelled");
    const url = new URL(path, this.base);
    const route = url.pathname;
    const body = init.body ? JSON.parse(String(init.body)) : {};
    const all = this.library.cards();
    let result: unknown;
    if (route === "/api/server/status") result = { version: "local", serverId: "this-device", setupComplete: true,
      hasLibraries: this.library.state.roots.length > 0, adminAvailable: false };
    else if (route === "/api/home") {
      const continuing = this.library.state.records.map(r => r.card).filter(c => c.watch && !c.watch.played && c.watch.position > 0);
      result = { featured: all.find(c => c.backdrop) || all[0] || null, rows: [
        { key: "continue", title: "Continue watching", items: continuing },
        { key: "movies", title: "Movies on this device", items: all.filter(c => c.kind === "movie") },
        { key: "series", title: "Series on this device", items: all.filter(c => c.kind === "series") },
      ].filter(r => r.items.length) };
    } else if (route === "/api/items") {
      let items = all.filter(c => c.kind === url.searchParams.get("kind"));
      if (url.searchParams.get("unwatched") === "true") items = items.filter(c => !c.watch?.played);
      const sort = url.searchParams.get("sort");
      items.sort((a,b) => sort === "year" ? (b.year || 0) - (a.year || 0) : sort === "rating" ? (b.rating || 0) - (a.rating || 0)
        : sort === "added" || sort === "recent" ? b.id - a.id : a.name.localeCompare(b.name));
      const offset = Number(url.searchParams.get("offset")) || 0;
      result = { items: items.slice(offset, offset + 60) };
    } else if (route === "/api/search") {
      const q = (url.searchParams.get("q") || "").toLowerCase();
      result = { titles: all.filter(c => c.name.toLowerCase().includes(q)),
        episodes: this.library.state.records.filter(r => r.card.kind === "episode" && r.card.name.toLowerCase().includes(q)).map(r => r.card) };
    } else if (route.startsWith("/api/items/")) {
      result = this.library.detail(Number(decodeURIComponent(route.split("/").at(-1)!).replace(/^local-/, "")));
    } else if (route === "/api/progress") {
      await this.library.progress(body.itemId, body.position, body.duration || null, body.played);
      result = { ok: true };
    } else if (/^\/api\/watch\/\d+/.test(route)) {
      const id = Number(route.split("/")[3]);
      if (init.method === "DELETE") await this.library.clearWatch(id);
      else await this.library.progress(id, 0, null, !!body.played);
      result = { ok: true };
    } else if (route.startsWith("/api/skip-segments/")) result = localSegments(this.library.record(Number(route.split("/").at(-1))).skips || {}, this.library.record(Number(route.split("/").at(-1))).card.watch?.duration);
    else if (route === "/api/auth/logout") result = { ok: true };
    else throw new Error("This feature is unavailable in the local library.");
    return result as T;
  }
}
