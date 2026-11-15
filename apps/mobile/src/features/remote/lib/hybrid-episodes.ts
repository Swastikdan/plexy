import type { ItemCard } from "@/core/library/catalog-api";
import type { RemoteEpisode, RemoteSeason } from "./tmdb";

export interface HybridSeason {
  number: number;
  label: string;
}

export interface HybridEpisode {
  key: string;
  number: number;
  seasonNumber: number;
  title: string;
  overview: string | null;
  artwork: string | null;
  runtime: number | null;
  airDate: string | null;
  local: ItemCard | null;
  remote: RemoteEpisode | null;
}

function cleanEpisodeTitle(name: string | null | undefined, number: number | null) {
  const raw = String(name ?? "").trim();
  const cleaned = raw
    .replace(
      /^(?:S\d+[\s._-]*E\d+|Season\s*\d+\s*Episode\s*\d+|Episode\s*\d+)\s*[:·._-]?\s*/i,
      "",
    )
    .trim();
  return cleaned || (number != null ? `Episode ${number}` : raw || "Episode");
}

export function mergeSeasons(
  local: { number: number; name?: string | null }[],
  remote: RemoteSeason[],
): HybridSeason[] {
  const byNumber = new Map<number, HybridSeason>();
  for (const season of local) {
    byNumber.set(season.number, {
      number: season.number,
      label:
        season.number === 0
          ? "Specials"
          : season.name || `Season ${season.number}`,
    });
  }
  for (const season of remote) {
    if (byNumber.has(season.number)) continue;
    byNumber.set(season.number, {
      number: season.number,
      label:
        season.number === 0
          ? "Specials"
          : season.name || `Season ${season.number}`,
    });
  }
  return [...byNumber.values()].sort((a, b) => a.number - b.number);
}

export function mergeEpisodes({
  local,
  remote,
  season,
  fallbackArtwork,
}: {
  local: ItemCard[];
  remote: RemoteEpisode[];
  season: number;
  fallbackArtwork: string | null;
}): HybridEpisode[] {
  const byNumber = new Map<number, HybridEpisode>();
  for (const episode of local) {
    const number = episode.episodeNumber ?? 0;
    byNumber.set(number, {
      key: `local-${episode.id}`,
      number,
      seasonNumber: season,
      title: cleanEpisodeTitle(episode.name, number),
      overview: episode.overview || null,
      artwork:
        episode.backdrop ||
        episode.poster ||
        fallbackArtwork,
      runtime: episode.runtime ?? null,
      airDate: null,
      local: episode,
      remote: null,
    });
  }
  for (const episode of remote) {
    if (byNumber.has(episode.number)) continue;
    byNumber.set(episode.number, {
      key: `remote-${season}-${episode.number}`,
      number: episode.number,
      seasonNumber: season,
      title: episode.title || `Episode ${episode.number}`,
      overview: episode.overview || episode.airDate,
      artwork: episode.still || fallbackArtwork,
      runtime: episode.runtime ?? null,
      airDate: episode.airDate,
      local: null,
      remote: episode,
    });
  }
  return [...byNumber.values()].sort((a, b) => a.number - b.number);
}
