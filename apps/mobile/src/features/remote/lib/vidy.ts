import type { RemoteMediaType } from "./tmdb";

export interface VidyEmbedOptions {
  autoNext?: boolean;
  autoplay?: boolean;
  episodeSelector?: boolean;
  nextEpisode?: boolean;
  /** Resume position in seconds. Vidy starts playback from here. */
  progress?: number;
  /** Six-digit hex without the leading `#`. */
  color?: string;
}

export function vidyColor(value: string | undefined): string {
  const hex = value?.trim().match(/^#?([0-9a-f]{6})$/i);
  if (hex) return hex[1]!.toUpperCase();
  const rgb = value?.match(
    /rgba?\(\s*(\d{1,3})[,\s]+(\d{1,3})[,\s]+(\d{1,3})/i,
  );
  if (rgb) {
    return [rgb[1], rgb[2], rgb[3]]
      .map((part) => Math.min(255, Number(part)).toString(16).padStart(2, "0"))
      .join("")
      .toUpperCase();
  }
  return "DC2626";
}

export function vidyEmbedUrl(
  input: {
    mediaType: RemoteMediaType;
    tmdbId: number;
    season?: number | null;
    episode?: number | null;
  },
  options: boolean | VidyEmbedOptions = {},
): string {
  const config = typeof options === "boolean" ? { autoNext: options } : options;
  if (!Number.isSafeInteger(input.tmdbId) || input.tmdbId <= 0)
    throw new Error("Invalid title");
  const positive = (n: number | null | undefined) =>
    n && Number.isSafeInteger(n) && n > 0 ? n : 1;
  const path =
    input.mediaType === "tv"
      ? `/tv/${input.tmdbId}/${positive(input.season)}/${positive(input.episode)}`
      : `/movie/${input.tmdbId}`;
  const query = new URLSearchParams({
    autoplay: String(config.autoplay ?? true),
    color: vidyColor(config.color),
  });
  if (input.mediaType === "tv") {
    query.set("nextEpisode", String(config.nextEpisode ?? true));
    query.set("episodeSelector", String(config.episodeSelector ?? true));
    query.set(
      "autoplayNextEpisode",
      String(config.autoNext ?? false),
    );
  }
  const progress = Math.max(0, Math.floor(config.progress ?? 0));
  if (progress > 0) query.set("progress", String(progress));
  return `https://www.vidy.st${path}?${query}`;
}

export function vidyEmbedHtml(url: string): string {
  const safeUrl = url
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;");
  return `<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1,viewport-fit=cover"><style>html,body{margin:0;width:100%;height:100%;background:#000;overflow:hidden}iframe{display:block;width:100%;height:100%;border:0}</style></head><body><script>(function(){function forward(value){try{var text=typeof value==="string"?value:JSON.stringify(value);window.ReactNativeWebView&&window.ReactNativeWebView.postMessage(text)}catch(e){}}window.addEventListener("message",function(event){var data=event.data;if(typeof data==="string"){forward(data)}else if(data&&typeof data==="object"){forward(data)}},false);document.addEventListener("fullscreenchange",function(){var active=!!(document.fullscreenElement||document.webkitFullscreenElement);forward({type:"FULLSCREEN",active:active})},false)})();</script><iframe title="Vidy video player" src="${safeUrl}" allow="encrypted-media; autoplay *; fullscreen *" allowfullscreen></iframe></body></html>`;
}

export type VidyBridgeEvent =
  | {
      type: "PLAYER_EVENT";
      event: string;
      currentTime: number;
      duration: number;
      tmdbId: number;
      mediaType: RemoteMediaType;
      season: number | null;
      episode: number | null;
    }
  | { type: "FULLSCREEN"; active: boolean };

function positiveInteger(value: unknown): number | null {
  const number = Number(value);
  return Number.isSafeInteger(number) && number > 0 ? number : null;
}

/**
 * Vidy posts PLAYER_EVENT time updates and a one-second MEDIA_DATA history
 * snapshot to the parent window. The wrapper forwards them here.
 */
export function parseVidyBridgeMessage(raw: string): VidyBridgeEvent | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== "object") return null;
  const value = parsed as Record<string, unknown>;
  if (value.type === "FULLSCREEN") {
    return { type: "FULLSCREEN", active: Boolean(value.active) };
  }
  if (value.type !== "PLAYER_EVENT") return null;
  const data = value.data;
  if (!data || typeof data !== "object") return null;
  const event = data as Record<string, unknown>;
  const mediaType =
    event.mediaType === "tv"
      ? "tv"
      : event.mediaType === "movie"
        ? "movie"
        : null;
  const tmdbId = positiveInteger(event.id);
  if (!mediaType || !tmdbId) return null;
  const currentTime = Number(event.currentTime);
  const duration = Number(event.duration);
  return {
    type: "PLAYER_EVENT",
    event: typeof event.event === "string" ? event.event : "timeupdate",
    currentTime: Number.isFinite(currentTime) ? Math.max(0, currentTime) : 0,
    duration: Number.isFinite(duration) ? Math.max(0, duration) : 0,
    tmdbId,
    mediaType,
    season: positiveInteger(event.season),
    episode: positiveInteger(event.episode),
  };
}
