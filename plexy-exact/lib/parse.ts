export interface ParsedName {
  title: string; year: number | null; season: number | null; episode: number | null; explicitId: number | null;
}
export function parseName(path: string): ParsedName {
  const parts = path.split('/');
  const stem = parts.at(-1)!.replace(/\.[^.]+$/, '');
  const episode = stem.match(/(?:^|[ ._-])s(\d{1,2})[ ._-]*e(\d{1,3})/i)
    || stem.match(/(?:^|[ ._-])(\d{1,2})x(\d{1,3})/i)
    || stem.match(/season\s*(\d+)\s*episode\s*(\d+)/i);
  const raw = episode ? stem.slice(0, episode.index).trim() || parts.at(-3) || stem : stem;
  const explicitId = Number(path.match(/[[{]tmdb(?:id)?[=: -]*(\d+)[\]}]/i)?.[1]) || null;
  const plain = raw.replace(/[[{]tmdb(?:id)?[=: -]*\d+[\]}]/gi, '').replace(/[._]/g, ' ');
  const localYear = [...plain.matchAll(/\b(?:19|20)\d{2}\b/g)].filter(match => match.index! > 0).at(-1);
  const parents = parts.slice(0, -1).join('/').replace(/[._]/g, ' ');
  const parentYear = [...parents.matchAll(/\b(?:19|20)\d{2}\b/g)].at(-1);
  const year = localYear ? Number(localYear[0]) : parentYear ? Number(parentYear[0]) : null;
  const withoutYear = localYear ? plain.slice(0, localYear.index) + plain.slice(localYear.index! + 4) : plain;
  const title = withoutYear.replace(/\(\s*\)/g, '')
    .replace(/\b(?:2160p|1080[pi]|720p|480p|4k|uhd|blu-?ray|webrip|web-dl|webdl|bdrip|dv|atmos|ddp\d|x26[45]|hevc|h26[45]|aac|dts|hdr|remux)\b.*$/i, '')
    .replace(/\s+-\s*[^-]+$/, '').replace(/\s+/g, ' ').replace(/[- ]+$/, '').trim() || stem;
  return { title, year, season: episode ? Number(episode[1]) : null,
    episode: episode ? Number(episode[2]) : null, explicitId };
}
export function childPath(parent: string, name: string) {
  if (!name || name === '.' || name === '..' || /[/\\\0]/.test(name)) throw new Error('Invalid path component');
  return `${parent.replace(/\/$/, '')}/${name}`;
}
