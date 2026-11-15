import type { RemoteMediaType } from "./tmdb";

export function vidyEmbedUrl(input: {
  mediaType: RemoteMediaType;
  tmdbId: number;
  season?: number | null;
  episode?: number | null;
}, autoNext = false): string {
  if (!Number.isSafeInteger(input.tmdbId) || input.tmdbId <= 0) throw new Error("Invalid title");
  const positive = (n: number | null | undefined) => n && Number.isSafeInteger(n) && n > 0 ? n : 1;
  const path = input.mediaType === "tv"
    ? `/tv/${input.tmdbId}/${positive(input.season)}/${positive(input.episode)}`
    : `/movie/${input.tmdbId}`;
  const query = new URLSearchParams({ autoplay: "true", color: "DC2626" });
  if (input.mediaType === "tv") {
    query.set("nextEpisode", "true");
    query.set("episodeSelector", "true");
    query.set("autoplayNextEpisode", String(autoNext));
  }
  return `https://www.vidy.st${path}?${query}`;
}

export function vidyEmbedHtml(url: string): string {
  const safeUrl = url.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");
  return `<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1"><style>html,body{margin:0;width:100%;height:100%;background:#000;overflow:hidden}iframe{display:block;width:100%;height:100%;border:0}</style></head><body><iframe title="Vidy video player" src="${safeUrl}" allow="encrypted-media; autoplay *; fullscreen *" allowfullscreen></iframe></body></html>`;
}
