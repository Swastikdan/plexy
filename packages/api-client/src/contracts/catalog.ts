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
  matchStatus: string;
  watch: Watch | null;
  isAnime?: boolean;
  logo?: string | null;
  still?: string | null;
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

export interface LibraryItem {
  id: number;
  name: string;
  type: "movies" | "tv" | "anime" | string;
  language: string;
  paths: string[];
  counts: { items: number; review: number; unmatched: number };
}
