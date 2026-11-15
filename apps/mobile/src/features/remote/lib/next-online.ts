import { fetchSeason } from "./tmdb";

export interface OnlineNextEpisode {
  season: number;
  episode: number;
  title: string;
}

/**
 * The next episode available from TMDB after the given one. Used when the
 * local player reaches the end of the downloaded episodes or finds a gap.
 */
export async function findNextOnlineEpisode(
  tmdbId: number,
  season: number,
  episode: number,
  signal?: AbortSignal,
): Promise<OnlineNextEpisode | null> {
  const current = await fetchSeason(tmdbId, season, signal);
  const next = current
    .filter((entry) => entry.number > episode)
    .sort((a, b) => a.number - b.number)[0];
  if (next) {
    return { season, episode: next.number, title: next.title };
  }
  const following = await fetchSeason(tmdbId, season + 1, signal).catch(
    () => [],
  );
  const first = following.sort((a, b) => a.number - b.number)[0];
  if (first) {
    return { season: season + 1, episode: first.number, title: first.title };
  }
  return null;
}
