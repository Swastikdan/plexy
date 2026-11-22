import type { FileFacts } from "./playback";

/// Catalog contracts: home rows, item cards, title detail, people, libraries.
export interface Watch {
  position: number;
  duration: number | null;
  played: boolean;
  percent: number;
}

export interface ItemCard {
  id: number;
  publicId: string;
  kind: string;
  name: string;
  year: number | null;
  seasonNumber?: number | null;
  episodeNumber?: number | null;
  fileId?: number | null;
  parentId?: number | null;
  parentPublicId?: string | null;
  parentTitle?: string | null;
  poster: string | null;
  backdrop: string | null;
  overview: string | null;
  rating: number | null;
  runtime: number | null;
  genres: string[];
  /** TMDB id when the local title has been matched. */
  tmdbId?: number | null;
  matchStatus: string;
  watch: Watch | null;
  /**
   * File a Play button should open for this card. Only set where the client
   * cannot derive it (a series hero card), because it depends on watch state.
   */
  playFileId?: number | null;
  /** "S01E03" for the episode a hero Play button would start. */
  playSubtitle?: string | null;
  /** Watch state of the episode a hero Play button would start. */
  playWatch?: Watch | null;
  isAnime?: boolean;
  logo?: string | null;
  still?: string | null;
  /** The title is in the user's watch list. */
  watchlist?: boolean;
  /** The title is in the user's favorites. */
  favorite?: boolean;
  /** The user hid this title from browse surfaces. */
  hidden?: boolean;
  /** The user's 1–5 star rating, when set. */
  userRating?: number | null;
  /** Age rating from metadata (for example "PG-13" or "TV-14"). */
  certification?: string | null;
  /** TMDB release / first-air date, used to hide unreleased online titles. */
  releaseDate?: string | null;
  /** When the title was last watched, for history rows. */
  watchedAt?: string | null;
}

export interface HomeRow {
  key: string;
  title: string;
  items: ItemCard[];
}

export interface HomePayload {
  featured: ItemCard | null;
  rows: HomeRow[];
}

export interface TitleDetail {
  item: ItemCard;
  logo: string | null;
  metadata: {
    overview: string | null;
    tagline: string | null;
    runtime: number | null;
    rating: number | null;
    certification: string | null;
    genres: string[];
  } | null;
  cast: Array<{ id: number; name: string; character: string | null; photo: string | null }>;
  trailer: { provider: string; key: string; name: string } | null;
  extras?: Array<{ provider: string; key: string; name: string; type: string }>;
  seasons: Array<{ id: number; number: number; name?: string; poster?: string | null }> | null;
  episodes: ItemCard[] | null;
  file: FileFacts | null;
  tmdbType: string | null;
  unmatched: boolean;
  matchReason: string | null;
}

/** A cast member, as shown on a title page and their own person page. */

export interface PersonSummary {
  id: number;
  name: string;
  photo: string | null;
}

/** Local-only person view: the photo plus every title they appear in here. */

export interface PersonDetail {
  person: PersonSummary;
  items: ItemCard[];
}

export interface SearchResponse {
  titles: ItemCard[];
  episodes: ItemCard[];
  people: PersonSummary[];
  total: number;
  query: string;
}

export interface ItemsResponse {
  items: ItemCard[];
  total: number;
}

export interface CollectionSummary {
  id: number;
  name: string;
  description: string | null;
  count: number;
  poster: string | null;
  /** User-created collections are editable; TMDB collections are automatic. */
  source?: "custom" | "tmdb";
  /** Present when the request included `itemId`. */
  contains?: boolean;
}

export interface CollectionDetail {
  collection: CollectionSummary;
  items: ItemCard[];
}

export interface LibraryItem {
  id: number;
  name: string;
  type: "movies" | "tv" | "anime" | string;
  language: string;
  paths: string[];
  counts: { items: number; review: number; unmatched: number };
}
