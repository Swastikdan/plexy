import { expect, test } from 'bun:test';
import { childPath, parseName } from '../lib/parse';
const movies = [
  ['The Matrix', 1999], ['Heat', 1995], ['Arrival', 2016], ['Interstellar', 2014], ['Inception', 2010],
  ['The Godfather', 1972], ['Alien', 1979], ['Blade Runner', 1982], ['Parasite', 2019], ['Dune', 2021],
] as const;
for (const [title, year] of movies) for (const suffix of ['1080p.BluRay.x264-GROUP', '2160p.UHD.HDR.HEVC', '720p.WEB-DL.AAC', '1080p.WEBRip.x265']) {
  const file = `${title.replaceAll(' ', '.')}.${year}.${suffix}.mkv`;
  test(file, () => { const result = parseName(file); expect(result.title).toBe(title); expect(result.year).toBe(year); });
}
test('series seasons, alternate episode naming, parent years, and explicit IDs', () => {
  expect(parseName('Severance (2022)/Season 01/Severance - S01E02.mkv')).toEqual({ title: 'Severance', year: 2022, season: 1, episode: 2, explicitId: null });
  expect(parseName('Show.1x03.mkv').episode).toBe(3);
  expect(parseName('Show Season 2 Episode 10.mkv').season).toBe(2);
  expect(parseName('Movie (2000) [tmdbid-123].mkv').explicitId).toBe(123);
});
test('rejects path traversal components', () => {
  for (const component of ['..', '.', '../media', 'a/b', 'a\\b', '']) expect(() => childPath('home:/Plexy', component)).toThrow();
});

test('numeric titles are retained separately from the release year', () => {
  expect(parseName('2001.A.Space.Odyssey.1968.1080p.mkv')).toMatchObject({ title: '2001 A Space Odyssey', year: 1968 });
  expect(parseName('1917 (2019)/1917.mkv')).toMatchObject({ title: '1917', year: 2019 });
  expect(parseName('1917.mkv')).toMatchObject({ title: '1917', year: null });
});
