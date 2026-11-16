export interface SeasonWatchInfo {
  number: number;
  totalEpisodes: number;
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
  for (const season of seasons) {
    if (season.totalEpisodes <= 0) continue;
    let complete = true;
    for (let number = 1; number <= season.totalEpisodes; number += 1) {
      if (!season.isEpisodeWatched(number)) {
        complete = false;
        break;
      }
    }
    if (!complete) return season.number;
  }
  return seasons[0]!.number;
}
