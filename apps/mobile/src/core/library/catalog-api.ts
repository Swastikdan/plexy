import type { HomePayload, ItemCard, Playability, SkipSegments, TitleDetail, } from "@plexy/api-client/types";
export type { HomePayload, ItemCard, Playability, SkipSegments, TitleDetail } from "@plexy/api-client/types";
export interface TitleIdentity {
    kind: "movies" | "tv";
    title: string;
    tmdbId?: number;
    season?: number;
    episode?: number;
}
/** In-process catalog contract. Implementations never connect to a Plexy server. */
export abstract class LocalCatalog {
    abstract home(signal?: AbortSignal): Promise<HomePayload>;
    abstract items(kind: "all" | "movie" | "series" | "anime", offset?: number, sort?: string, signal?: AbortSignal, unwatched?: boolean): Promise<{
        items: ItemCard[];
    }>;
    abstract detail(id: string | number, signal?: AbortSignal): Promise<TitleDetail>;
    abstract deleteItem(id: string | number): Promise<{
        ok: boolean;
    }>;
    abstract search(query: string, signal?: AbortSignal): Promise<{
        titles: ItemCard[];
        episodes: ItemCard[];
    }>;
    abstract skips(fileId: number): Promise<SkipSegments>;
    abstract progress(itemId: number, position: number, duration?: number, played?: boolean): Promise<{
        ok: boolean;
    }>;
    abstract watched(itemId: number, played: boolean): Promise<{
        ok: boolean;
    }>;
    abstract clearWatch(itemId: number): Promise<{
        ok: boolean;
    }>;
    abstract play(fileId: number): Promise<Playability>;
    abstract stream(fileId: number): string;
    abstract subtitle(fileId: number, uri: string, signal?: AbortSignal): Promise<string>;
    abstract titlesByPerson(): Map<string, ItemCard[]>;
    abstract collections(): {
        id: number;
        name: string;
        count: number;
        poster: string | null;
    }[];
    abstract collectionItems(id: number): ItemCard[];
    abstract episodes(id: number): ItemCard[];
    abstract report(filter: "all" | "review" | "files"): ItemCard[];
    abstract titleFile(id: number): {
        name: string;
        metadataAt?: number;
        metadataError?: string;
        seasonNumber: number | null | undefined;
        episodeNumber: number | null | undefined;
    } | undefined;
    abstract libraryStatus(): {
        fileCount: number;
        reviewCount: number;
        markerCount: number;
    };
    abstract fileVersion(fileId: number): string;
    abstract identify(id: number, identity: TitleIdentity): Promise<void>;
    abstract removeTitle(id: number): Promise<void>;
    private images = new Map<string, {
        uri: string;
    }>();
    image(path: string | null) {
        if (!path || !/^(file:|content:|https:)/.test(path))
            return undefined;
        let image = this.images.get(path);
        if (!image) {
            image = { uri: path };
            this.images.set(path, image);
        }
        return image;
    }
}
