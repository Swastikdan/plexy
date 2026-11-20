export interface SeasonWatchInfo {
  number: number;
  totalEpisodes: number;
  episodeNumbers?: readonly number[];
  isEpisodeWatched: (episodeNumber: number) => boolean;
}

/**
 * Pick the season to open: the first one with an unwatched episode. If every
 * season is complete, keep the first season. This is what advances a finished
 * Season 1 to Season 2 when the title page opens.
 */
export function defaultSeasonNumber(
  seasons: SeasonWatchInfo[],
  wholeSeriesWatched = false,
): number | null {
  if (!seasons.length) return null;
  if (wholeSeriesWatched) return seasons[0]!.number;
  const regular = seasons.filter((season) => season.number !== 0);
  const candidates = regular.length ? regular : seasons;
  return candidates.find((season) => season.totalEpisodes > 0 && !seasonComplete(season))?.number
    ?? candidates[0]!.number;
}

export function seasonComplete(season: SeasonWatchInfo): boolean {
  if (season.episodeNumbers) return season.episodeNumbers.length > 0
    && season.episodeNumbers.every(season.isEpisodeWatched);
  if (season.totalEpisodes <= 0) return false;
  for (let number = 1; number <= season.totalEpisodes; number++) {
    if (!season.isEpisodeWatched(number)) return false;
  }
  return true;
}

/** Keep the season picker on the browsed season while Play advances. */
export function playbackSeasonNumber(seasons: SeasonWatchInfo[], selected: number | null): number | null {
  const current = seasons.find((season) => season.number === selected);
  return current && !seasonComplete(current) ? current.number : defaultSeasonNumber(seasons) ?? selected;
}
