import { Image } from "expo-image";
import type { LocalCatalog,ItemCard,TitleDetail } from "./catalog-api";

/**
 * The card the user tapped, kept only long enough to paint its hero on the
 * first frame. Details itself still comes from the catalog cache below.
 */
const previews = new Map<string, ItemCard>();
const PREVIEW_LIMIT = 48;

export function rememberTitlePreview(item: ItemCard) {
    const id = String(item.publicId);
    previews.delete(id);
    previews.set(id, item);
    if (previews.size > PREVIEW_LIMIT)
        previews.delete(previews.keys().next().value!);
    // Give the tapped hero a head start outside the background image queue.
    const artwork = item.backdrop || item.poster;
    if (artwork)
        void Image.prefetch(artwork, { cachePolicy: "memory-disk" }).catch(() => {});
    if (item.logo)
        void Image.prefetch(item.logo, { cachePolicy: "memory-disk" }).catch(() => {});
}

export function peekTitlePreview(id: string | number) {
    return previews.get(String(id)) ?? null;
}

/**
 * Local details are cheap once the library index is warm, but they still walk
 * the record store. Warm the cards the user is scrolling past so opening one
 * renders real content immediately, and keep the last opened pages warm.
 */
const details = new Map<string, TitleDetail>();
const detailOrder: string[] = [];
const pending = new Set<string>();
const queue: string[] = [];
const DETAIL_LIMIT = 64;
let scheduled = false;
let generation = 0;

function remember(id: string, detail: TitleDetail) {
    if (details.has(id)) return;
    details.set(id, detail);
    detailOrder.push(id);
    if (detailOrder.length > DETAIL_LIMIT) {
        const stale = detailOrder.shift();
        if (stale) details.delete(stale);
    }
}

export function peekLocalDetail(id: string | number) {
    return details.get(String(id)) ?? null;
}

/** Keep a detail page opened without a prefetch warm for the next visit. */
export function rememberLocalDetail(id: string | number, detail: TitleDetail) {
    const key = String(id);
    details.delete(key);
    const index = detailOrder.indexOf(key);
    if (index >= 0) detailOrder.splice(index, 1);
    remember(key, detail);
}

export function clearLocalDetailCache() {
    details.clear();
    detailOrder.length = 0;
    pending.clear();
    queue.length = 0;
    generation += 1;
}

function drain(api: Pick<LocalCatalog, "detail">) {
    const id = queue.shift();
    if (!id) {
        scheduled = false;
        return;
    }
    const requestGeneration = generation;
    void api
        .detail(id)
        .then((detail) => {
            if (requestGeneration === generation)
                remember(id, detail);
        })
        .catch(() => {})
        .finally(() => {
            pending.delete(id);
            scheduled = false;
            if (queue.length) schedule(api);
        });
}

function schedule(api: Pick<LocalCatalog, "detail">) {
    if (scheduled) return;
    scheduled = true;
    const run = () => drain(api);
    if (typeof requestIdleCallback === "function") {
        requestIdleCallback(run, { timeout: 900 });
    } else {
        setTimeout(run, 0);
    }
}

/**
 * Queue a background detail read for cards entering the viewport. One read per
 * idle window keeps scrolling smooth even when a whole grid mounts at once.
 */
export function prefetchLocalDetails(
    api: Pick<LocalCatalog, "detail">,
    ids: (string | number)[],
) {
    for (const raw of ids) {
        const id = String(raw);
        if (details.has(id) || pending.has(id)) continue;
        pending.add(id);
        queue.push(id);
    }
    if (queue.length) schedule(api);
}
