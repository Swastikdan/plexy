/**
 * True when the next local file is the very next episode: the following
 * episode in the same season, or the first episode of the following season.
 * A false result means the local player should ask TMDB for the missing
 * episode instead of jumping past it.
 */
export function localNextIsImmediate(input: {
  nextFileId?: number | null;
  seasonNumber?: number | null;
  episodeNumber?: number | null;
  next?: {
    seasonNumber?: number | null;
    episodeNumber?: number | null;
  } | null;
}): boolean {
  if (!input.nextFileId || !input.next) return false;
  const currentSeason = input.seasonNumber ?? 1;
  const currentEpisode = input.episodeNumber;
  const nextSeason = input.next.seasonNumber;
  const nextEpisode = input.next.episodeNumber;
  if (currentEpisode == null || nextSeason == null || nextEpisode == null) {
    return false;
  }
  if (nextSeason === currentSeason) {
    return nextEpisode === currentEpisode + 1;
  }
  if (nextSeason === currentSeason + 1) {
    return nextEpisode === 1;
  }
  return false;
}
