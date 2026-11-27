export type MovieIdentity = {
  title: string;
  year: number | null;
  tmdbId: number;
};

export type EpisodeIdentity = MovieIdentity & {
  season: number | null;
  episode: number | null;
};

export function safeName(value: string) {
  return value
    .replace(/[\\/:*?"<>|{}]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 120);
}

export function pad(value: number) {
  return String(value).padStart(2, "0");
}

function yearLabel(record: Pick<MovieIdentity, "year">) {
  return record.year ? ` (${record.year})` : "";
}

export function movieFolder(record: MovieIdentity) {
  return `${safeName(record.title)}${yearLabel(record)} {tmdb-${record.tmdbId}}`;
}

export function showFolder(record: MovieIdentity) {
  return `${safeName(record.title)}${yearLabel(record)} {tmdb-${record.tmdbId}}`;
}

export function movieRelativePath(
  record: MovieIdentity,
  extension: string,
) {
  const name = movieFolder(record);
  return `Movies/${name}/${name}.${extension}`;
}

export function episodeRelativePath(
  record: EpisodeIdentity,
  extension: string,
) {
  const show = showFolder(record);
  const season = record.season ?? 1;
  const episode = record.episode ?? 1;
  const file = `${safeName(record.title)} - S${pad(season)}E${pad(episode)}`;
  return `TV Shows/${show}/Season ${pad(season)}/${file}.${extension}`;
}
