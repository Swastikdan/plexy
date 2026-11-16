import type { Chapter } from "@plexy/api-client/types";
import { LocalLibrary } from "@plexy/local-library/library";
import { LocalCatalog, type Playability, type TitleIdentity } from "./catalog-api";
/** Implements the existing UI contract in process, without a network listener. */
export class LocalApi extends LocalCatalog {
    /** Derived catalog views shared by Home, Library, Search and title pages. */
    private cardsRef: import("./catalog-api").ItemCard[] | null = null;
    private byTmdb = new Map<string, import("./catalog-api").ItemCard>();
    private people = new Map<string, import("./catalog-api").ItemCard[]>();
    private peopleSource: import("./catalog-api").ItemCard[] | null = null;
    private countsCache = { movie: 0, series: 0 };
    private collectionsCache: ReturnType<LocalApi["buildCollections"]> = [];
    private itemsCache = new Map<string, import("./catalog-api").ItemCard[]>();
    constructor(private readonly library: LocalLibrary, private readSubtitle: (uri: string) => Promise<string>, private subtitles: (fileId: number) => Promise<NonNullable<Playability["tracks"]>>, private chapters: (fileId: number) => Promise<Chapter[]> = async () => []) {
        super();
    }
    /** Rebuild only when the library snapshot changed; `cards()` is stable. */
    private ensureCatalog() {
        const cards = this.library.cards();
        if (cards === this.cardsRef) return cards;
        this.cardsRef = cards;
        this.byTmdb.clear();
        this.people.clear();
        this.peopleSource = null;
        this.countsCache = { movie: 0, series: 0 };
        this.itemsCache.clear();
        for (const card of cards) {
            if (card.kind === "movie") this.countsCache.movie++;
            else if (card.kind === "series") this.countsCache.series++;
            if (card.tmdbId != null) {
                this.byTmdb.set(`${card.kind === "series" ? "tv" : "movie"}:${card.tmdbId}`, card);
            }
        }
        this.collectionsCache = this.buildCollections();
        return cards;
    }
    private ensurePeople() {
        const cards = this.ensureCatalog();
        if (this.peopleSource === cards) return;
        this.peopleSource = cards;
        this.people.clear();
        const byId = new Map(cards.map((card) => [card.id, card]));
        const groups = new Map<string, Map<number, import("./catalog-api").ItemCard>>();
        for (const record of this.library.state.records) {
            const card = byId.get(record.card.parentId ?? record.id);
            if (!card) continue;
            for (const person of record.cast) {
                const titles = groups.get(person.name) ?? new Map();
                titles.set(card.id, card);
                groups.set(person.name, titles);
            }
        }
        for (const [name, titles] of groups) this.people.set(name, [...titles.values()]);
    }
    private buildCollections() {
        const groups = new Map<number, {
            id: number;
            name: string;
            count: number;
            poster: string | null;
        }>();
        for (const record of this.library.state.records) {
            if (record.card.kind !== "movie" || !record.collection)
                continue;
            const entry = groups.get(record.collection.id) ?? { ...record.collection, count: 0, poster: null };
            entry.count++;
            entry.poster ||= record.card.poster || null;
            groups.set(record.collection.id, entry);
        }
        return [...groups.values()].sort((a, b) => a.name.localeCompare(b.name));
    }
    override stream(fileId: number) {
        return this.library.record(fileId).file.uri;
    }
    override async subtitle(fileId: number, uri: string, signal?: AbortSignal) {
        this.checkSignal(signal);
        if (!(await this.subtitles(fileId)).some((track) => track.track === uri))
            throw new Error("Subtitle not found.");
        this.checkSignal(signal);
        const text = await this.readSubtitle(uri);
        this.checkSignal(signal);
        return text;
    }
    override async play(fileId: number): Promise<Playability> {
        const r = this.library.record(fileId);
        const siblings = r.card.parentId
            ? this.library.state.records
                .filter((s) => s.card.parentId === r.card.parentId)
                .sort((a, b) => a.card.seasonNumber! - b.card.seasonNumber! ||
                a.card.episodeNumber! - b.card.episodeNumber!)
            : [];
        const next = siblings.length
            ? siblings[siblings.findIndex((s) => s.id === fileId) + 1]
            : null;
        const [tracks, chapters] = await Promise.all([
            this.subtitles(fileId),
            this.chapters(fileId),
        ]);
        return {
            path: "direct",
            reason: "Original file · on this device",
            fileId,
            itemId: r.id,
            parentItemId: r.card.parentId,
            parentPublicId: r.card.parentPublicId,
            tmdbId: r.tmdbId ?? r.card.tmdbId ?? null,
            mediaType: r.card.kind === "episode" ? "tv" : "movie",
            title: r.card.parentTitle || r.card.name,
            subtitle: r.card.kind === "episode" ? r.card.name : null,
            seasonNumber: r.card.seasonNumber,
            episodeNumber: r.card.episodeNumber,
            duration: r.card.watch?.duration,
            watch: r.card.watch,
            audioTracks: [],
            tracks,
            chapters,
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
    private checkSignal(signal?: AbortSignal) {
        if (signal?.aborted)
            throw new Error("Request cancelled");
    }
    private titleId(id: string | number) {
        return Number(String(id).replace(/^local-/, ""));
    }
    override async home(signal?: AbortSignal) {
        this.checkSignal(signal);
        const all = this.ensureCatalog();
        const continuing = this.library.state.records.map((r) => r.card)
            .filter((c) => c.watch && !c.watch.played && c.watch.position > 0);
        return {
            featured: all.find((c) => c.backdrop) || all[0] || null,
            rows: [
                { key: "continue", title: "Continue Watching", items: continuing },
                { key: "titles", title: "Movies & Shows", items: all },
            ].filter((r) => r.items.length),
        };
    }
    override async items(kind: "all" | "movie" | "series", offset = 0, sort = "name", signal?: AbortSignal, unwatched = false) {
        this.checkSignal(signal);
        const cards = this.ensureCatalog();
        const key = `${kind}|${sort}|${unwatched}`;
        let items = this.itemsCache.get(key);
        if (!items) {
            items = cards.filter((c) => kind === "all" ? true : c.kind === kind);
            if (unwatched)
                items = items.filter((c) => !c.watch?.played);
            items = [...items].sort((a, b) => sort === "year" ? (b.year || 0) - (a.year || 0)
                : sort === "rating" ? (b.rating || 0) - (a.rating || 0)
                    : sort === "added" || sort === "recent" ? b.id - a.id : a.name.localeCompare(b.name));
            this.itemsCache.set(key, items);
        }
        return { items: items.slice(offset, offset + 60) };
    }
    override async search(query: string, signal?: AbortSignal) {
        this.checkSignal(signal);
        const q = query.toLowerCase();
        return {
            titles: this.ensureCatalog().filter((c) => c.name.toLowerCase().includes(q)),
            episodes: this.library.state.records.filter((r) => r.card.kind === "episode" && r.card.name.toLowerCase().includes(q)).map((r) => r.card),
        };
    }
    override async detail(id: string | number, signal?: AbortSignal) {
        this.checkSignal(signal);
        return this.library.detail(this.titleId(id));
    }
    override async deleteItem(id: string | number) {
        await this.library.deleteTitle(this.titleId(id), true);
        return { ok: true };
    }
    override async progress(itemId: number, position: number, duration?: number, played = false) {
        await this.library.progress(itemId, position, duration || null, played);
        return { ok: true };
    }
    override async watched(itemId: number, played: boolean) {
        if (played)
            await this.library.progress(itemId, 0, null, true);
        else
            await this.library.clearWatch(itemId);
        return { ok: true };
    }
    override async clearWatch(itemId: number) {
        await this.library.clearWatch(itemId);
        return { ok: true };
    }
    override async setWatchlist(itemId: number, watchlisted: boolean) {
        await this.library.setWatchlist(itemId, watchlisted);
        return { ok: true };
    }
    override skips(fileId: number) {
        return this.library.getMarkers(fileId);
    }
    override titlesByPerson() {
        this.ensurePeople();
        return this.people;
    }
    override titlesByTmdb() {
        this.ensureCatalog();
        return this.byTmdb;
    }
    override counts() {
        this.ensureCatalog();
        return this.countsCache;
    }
    override collections() {
        this.ensureCatalog();
        return this.collectionsCache;
    }
    override collectionItems(id: number) {
        return this.library.state.records.filter((r) => r.card.kind === "movie" && r.collection?.id === id).map((r) => r.card);
    }
    override episodes(id: number) {
        return this.library.state.records.filter((r) => r.card.parentId === id).map((r) => r.card);
    }
    override report(filter: "all" | "review" | "files") {
        if (filter === "files")
            return this.library.state.records.map((r) => r.card);
        const cards = this.library.cards();
        return filter === "all" ? cards : cards.filter((c) => c.matchStatus !== "matched" || this.library.state.records.some((r) => (r.id === c.id || r.card.parentId === c.id) && r.metadataError));
    }
    override titleFile(id: number) {
        const record = this.library.state.records.find((r) => r.id === id || r.card.parentId === id);
        return record && { name: record.file.name, metadataAt: record.metadataAt, metadataError: record.metadataError, seasonNumber: record.card.seasonNumber, episodeNumber: record.card.episodeNumber };
    }
    override libraryStatus() {
        const records = this.library.state.records;
        return {
            fileCount: records.length,
            reviewCount: records.filter((r) => r.card.matchStatus !== "matched" || !!r.metadataError).length,
            markerCount: records.filter((r) => Object.values(r.skips || {}).some(Boolean)).length,
        };
    }
    override fileVersion(fileId: number) {
        const record = this.library.record(fileId);
        return `${fileId}-${record.file.size}-${record.file.modified}`;
    }
    override identify(id: number, identity: TitleIdentity) {
        return this.library.identify(id, identity);
    }
    override removeTitle(id: number) {
        return this.library.removeTitle(id);
    }
}
