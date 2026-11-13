/// Matching contracts: the review queue and TMDB match search.
export interface ReviewEntry {
  id: number;
  kind: string;
  parentTitle: string | null;
  name: string;
  year: number | null;
  seasonNumber?: number | null;
  episodeNumber?: number | null;
  matchStatus: string;
  score: number | null;
  matchedBy: string | null;
  tmdbId: number | null;
  fileName: string | null;
  originalName: string | null;
  poster: string | null;
  reason: string | null;
  candidates: Array<{
    tmdbId: number;
    tmdbType: string;
    title: string;
    year: number | null;
    score: number;
    reason: string;
    poster: string | null;
  }>;
}

export interface ReviewCounts {
  all: number;
  attention: number;
  matched: number;
  review: number;
  unmatched: number;
}

export interface ReviewPayload {
  items: ReviewEntry[];
  counts: ReviewCounts;
  filter: string;
  query: string;
}

export interface TmdbMatchResult {
  tmdbId: number;
  type: string;
  title: string;
  year: number | null;
  overview: string | null;
  poster: string | null;
}

/** `POST /api/match/search` */

export interface TmdbMatchSearchResponse {
  results: TmdbMatchResult[];
}

/** One folder entry from `GET /api/local-folders`. */
