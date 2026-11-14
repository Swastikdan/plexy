import { LocalLibrary } from "@plexy/local-library/library";
import { LocalCatalog, type Playability, type TitleIdentity } from "./catalog-api";
/** Implements the existing UI contract in process, without a network listener. */
export class LocalApi extends LocalCatalog {
    constructor(private readonly library: LocalLibrary, private readSubtitle: (uri: string) => Promise<string>, private subtitles: (fileId: number) => Promise<NonNullable<Playability["tracks"]>>) {
        super();
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
    private checkSignal(signal?: AbortSignal) {
        if (signal?.aborted)
            throw new Error("Request cancelled");
    }
    private titleId(id: string | number) {
        return Number(String(id).replace(/^local-/, ""));
    }
    override async home(signal?: AbortSignal) {
        this.checkSignal(signal);
        const all = this.library.cards();
        const continuing = this.library.state.records.map((r) => r.card)
            .filter((c) => c.watch && !c.watch.played && c.watch.position > 0);
        return {
            featured: all.find((c) => c.backdrop) || all[0] || null,
            rows: [
                { key: "continue", title: "Continue watching", items: continuing },
                { key: "movies", title: "Movies", items: all.filter((c) => c.kind === "movie" && !c.isAnime) },
                { key: "series", title: "Series", items: all.filter((c) => c.kind === "series" && !c.isAnime) },
                { key: "anime", title: "Anime", items: all.filter((c) => c.isAnime) },
            ].filter((r) => r.items.length),
        };
    }
    override async items(kind: "all" | "movie" | "series" | "anime", offset = 0, sort = "name", signal?: AbortSignal, unwatched = false) {
        this.checkSignal(signal);
        let items = this.library.cards().filter((c) => kind === "all" ? true : kind === "anime" ? c.isAnime : c.kind === kind && !c.isAnime);
        if (unwatched)
            items = items.filter((c) => !c.watch?.played);
        items.sort((a, b) => sort === "year" ? (b.year || 0) - (a.year || 0)
            : sort === "rating" ? (b.rating || 0) - (a.rating || 0)
                : sort === "added" || sort === "recent" ? b.id - a.id : a.name.localeCompare(b.name));
        return { items: items.slice(offset, offset + 60) };
    }
    override async search(query: string, signal?: AbortSignal) {
        this.checkSignal(signal);
        const q = query.toLowerCase();
        return {
            titles: this.library.cards().filter((c) => c.name.toLowerCase().includes(q)),
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
    override skips(fileId: number) {
        return this.library.getMarkers(fileId);
    }
    override titlesByPerson() {
        const cards = new Map(this.library.cards().map((card) => [card.id, card]));
        const groups = new Map<string, Map<number, import("./catalog-api").ItemCard>>();
        for (const record of this.library.state.records) {
            const card = cards.get(record.card.parentId ?? record.id);
            if (!card)
                continue;
            for (const person of record.cast) {
                const titles = groups.get(person.name) ?? new Map();
                titles.set(card.id, card);
                groups.set(person.name, titles);
            }
        }
        return new Map([...groups].map(([name, titles]) => [name, [...titles.values()]]));
    }
    override counts() {
        let movie = 0;
        let series = 0;
        let anime = 0;
        for (const card of this.library.cards()) {
            if (card.isAnime)
                anime++;
            else if (card.kind === "movie")
                movie++;
            else if (card.kind === "series")
                series++;
        }
        return { movie, series, anime };
    }
    override collections() {
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
