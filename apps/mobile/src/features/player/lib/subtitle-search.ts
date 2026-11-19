import type { Playability } from "@/core/library/catalog-api";
import { fetchDetail } from "@/features/remote/lib/tmdb";
import { parseVtt } from "./subtitles";

export interface SubtitleResult {
  id: string;
  url: string;
  language: string;
  name: string;
}

function subtitleUrl(value: unknown): value is string {
  return typeof value === "string" && /^https:\/\/subs\d*\.strem\.io\//i.test(value);
}

export async function searchSubtitles(file: Playability, signal: AbortSignal): Promise<SubtitleResult[]> {
  if (!file.tmdbId || !file.mediaType) {
    throw new Error("Identify this title in Library Report before searching for subtitles.");
  }
  const detail = await fetchDetail(file.mediaType, file.tmdbId, signal);
  if (!detail.imdbId || !/^tt\d+$/.test(detail.imdbId)) {
    throw new Error("No IMDb match was found for this title.");
  }
  const series = file.mediaType === "tv";
  if (series && (file.seasonNumber == null || file.episodeNumber == null)) {
    throw new Error("Identify the season and episode before searching for subtitles.");
  }
  const id = series ? `${detail.imdbId}:${file.seasonNumber}:${file.episodeNumber}` : detail.imdbId;
  const response = await fetch(`https://opensubtitles-v3.strem.io/subtitles/${series ? "series" : "movie"}/${id}.json`, { signal });
  if (!response.ok) throw new Error("Couldn’t reach OpenSubtitles. Try again.");
  const data: { subtitles?: unknown } = await response.json();
  if (!Array.isArray(data.subtitles)) throw new Error("Unexpected response from OpenSubtitles.");
  const results = new Map<string, SubtitleResult>();
  for (const entry of data.subtitles) {
    if (typeof entry?.id !== "string" || !subtitleUrl(entry.url) || typeof entry.lang !== "string") continue;
    const name = typeof entry.subtitleFileName === "string" && entry.subtitleFileName
      ? entry.subtitleFileName
      : `Subtitle ${entry.id}`;
    results.set(entry.id, { id: entry.id, url: entry.url, language: entry.lang, name });
  }
  return [...results.values()];
}

export async function downloadSubtitle(result: SubtitleResult, signal: AbortSignal) {
  if (!subtitleUrl(result.url)) throw new Error("Invalid subtitle download link.");
  const response = await fetch(result.url, { signal });
  const maximum = 2 * 1024 * 1024;
  if (!response.ok || Number(response.headers.get("content-length")) > maximum) {
    throw new Error("Couldn’t download this subtitle.");
  }
  const text = await response.text();
  if (text.length > maximum || !parseVtt(text).length) throw new Error("This result isn’t a readable subtitle file.");
  return text;
}
