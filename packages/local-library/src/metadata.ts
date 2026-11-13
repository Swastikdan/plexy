import { parseLocalName, type LocalRecord } from "./library";
import type { ItemCard } from "../../api-client/src/types";
export interface MetadataIO {
  settings?: { language: string; region: string; posterSize: string };
  request(path: string): Promise<any>;
  artwork(path: string | null | undefined, size: string): Promise<string | null>;
}
export const normalizedTitle = (s: string) => s.toLowerCase().replace(/[^\p{L}\p{N}]/gu, "");
export async function fetchMetadata(record: LocalRecord, io: MetadataIO): Promise<Partial<LocalRecord>> {
  const settings = io.settings || { language: "en-US", region: "US", posterSize: "w780" };
  const request = (path: string) => io.request(`${path}${path.includes("?") ? "&" : "?"}language=${encodeURIComponent(settings.language)}&region=${encodeURIComponent(settings.region)}`);
  const tv = record.card.kind === "episode";
  const kind = tv ? "tv" : "movie";
  const parsed = parseLocalName(record.file.relativePath, tv ? "tv" : "movies");
  const title = record.manualIdentity ? record.card.parentTitle || record.card.name : parsed.title;
  let id = record.tmdbId || (!record.manualIdentity ? parsed.explicitId : null);
  if (!id) {
    const query = new URLSearchParams({ query: title, include_adult: "false" });
    if (parsed.year) query.set(tv ? "first_air_date_year" : "year", String(parsed.year));
    const result = await request(`/search/${kind}?${query}`);
    const matches = (result.results || []).filter((r: any) => [r.title, r.name, r.original_title, r.original_name].some(t => t && normalizedTitle(t) === normalizedTitle(title)));
    if (matches.length !== 1) return { metadataAt: Date.now(), metadataVersion: 2, discoveryVersion: 1, card: { ...record.card, matchStatus: "review" } };
    id = matches[0].id;
  }
  const data = await request(`/${kind}/${id}?append_to_response=credits,videos,images,${tv ? "content_ratings" : "release_dates"}&include_image_language=${settings.language.split("-")[0]},en,null`);
  let missing = false;
  const image = async (path: string | null | undefined, size: string, previous?: string | null) => {
    if (!path) return previous || null;
    try { return await io.artwork(path, size); } catch { missing = true; return previous || null; }
  };
  const poster = await image(data.poster_path || data.images?.posters?.[0]?.file_path, settings.posterSize, record.seriesMetadata?.poster || record.card.poster);
  const backdrop = await image(data.backdrop_path || data.images?.backdrops?.[0]?.file_path, "w1280", record.seriesMetadata?.backdrop || record.card.backdrop);
  const seriesMetadata: Partial<ItemCard> = { name: data.title || data.name || title,
    poster, backdrop, overview: data.overview || null, year: Number((data.release_date || data.first_air_date || "").slice(0,4)) || parsed.year,
    rating: data.vote_average || null, runtime: data.runtime || null, genres: (data.genres || []).map((g: any) => g.name) };
  let episode: any = null;
  const seasons = [];
  if (tv) {
    const sn = record.card.seasonNumber ?? parsed.season ?? 1;
    const en = record.card.episodeNumber ?? parsed.episode ?? 1;
    const season = await request(`/tv/${id}/season/${sn}`);
    episode = (season.episodes || []).find((e: any) => e.episode_number === en);
    if (!episode) throw new Error(`TMDB has no episode ${en} in season ${sn}. Identify this title in Library report.`);
    const seasonData = data.seasons?.find((s: any) => s.season_number === sn);
    seasons.push({ id: seasonData?.id || sn, number: sn, name: seasonData?.name || season.name,
      poster: await image(seasonData?.poster_path || season.poster_path, "w500") });
  }
  const cast = [];
  const people = [...(data.credits?.cast || []).slice(0,12), ...(data.credits?.crew || []).filter((p: any) => ["Director", "Writer", "Screenplay", "Creator"].includes(p.job)).slice(0,6)];
  for (let offset = 0; offset < people.length; offset += 3) {
    cast.push(...await Promise.all(people.slice(offset, offset + 3).map(async (person: any) => ({
      id: Number(person.id), name: person.name,
      character: person.character || person.job || null, photo: await image(person.profile_path, "h632"),
    }))));
  }
  const trailer = (data.videos?.results || []).filter((v: any) => v.site === "YouTube" && ["Trailer", "Teaser"].includes(v.type))
    .sort((a: any,b: any) => Number(b.type === "Trailer") - Number(a.type === "Trailer") || Number(!!b.official)-Number(!!a.official) || (b.published_at || "").localeCompare(a.published_at || ""))[0];
  const logoPath = (data.images?.logos || []).find((l: any) => l.iso_639_1 === settings.language.split("-")[0])?.file_path || data.images?.logos?.[0]?.file_path;
  const logo = await image(logoPath, "w500", record.logo);
  const still = episode?.still_path ? await image(episode.still_path, "w780", record.card.kind === "episode" && record.metadataVersion === 2 ? record.card.backdrop : null) : null;
  const certification = tv ? data.content_ratings?.results?.find((r: any) => r.iso_3166_1 === settings.region)?.rating
    : data.release_dates?.results?.find((r: any) => r.iso_3166_1 === settings.region)?.release_dates?.find((r: any) => r.certification)?.certification;
  return { card: { ...record.card, ...seriesMetadata,
    name: episode?.name || seriesMetadata.name!, parentTitle: tv ? data.name : null,
    overview: episode?.overview || data.overview || null, rating: episode?.vote_average ?? data.vote_average ?? null,
    runtime: episode?.runtime ?? data.runtime ?? null, poster: still || poster, backdrop: still || backdrop, matchStatus: "matched" },
    collection: data.belongs_to_collection ? { id: data.belongs_to_collection.id, name: data.belongs_to_collection.name } : null,
    seriesMetadata: tv ? seriesMetadata : undefined, cast, tmdbId: id!, logo, seasons,
    tagline: data.tagline || null, certification: certification || null,
    trailer: trailer ? { provider: "youtube", key: trailer.key, name: trailer.name } : null,
    metadataAt: missing ? 0 : Date.now(), metadataVersion: 2, discoveryVersion: 1 };
}
