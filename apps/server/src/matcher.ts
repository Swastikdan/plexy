/// Matching engine (PRD 5.4).
///
/// Pipeline per title: explicit-id shortcut → TMDB search → score → decide.
/// Thresholds: ≥ 0.85 auto-match, 0.60–0.85 review, < 0.60 unmatched.
/// A score ranks candidates; it is never treated as a calibrated probability.
import { search, detail } from "./tmdb";
import type { TmdbSearchResult } from "./tmdb";
import { normalizeTitle } from "./parse";

export type TmdbKind = "movie" | "tv";

export interface Candidate {
  tmdbId: number;
  tmdbType: TmdbKind;
  title: string;
  year: number | null;
  posterPath: string | null;
  score: number;
  reason: string;
  /** Normalized parsed title equals the candidate title exactly. */
  exactTitle: boolean;
}

export interface MatchResult {
  status: "matched" | "review" | "unmatched";
  matchedBy: "id-tag" | "nfo" | "search" | "manual";
  best: Candidate | null;
  candidates: Candidate[];
}

const AUTO_THRESHOLD = 0.85;
const REVIEW_THRESHOLD = 0.60;
const MAX_CANDIDATES = 3; // kept for the review queue (PRD 5.4 step 6)

// --- similarity --------------------------------------------------------------

/**
 * Jaro-Winkler (PRD 5.4 step 5). Runs on normalised strings (lowercase,
 * no punctuation, leading articles dropped).
 */
export function jaroWinkler(a: string, b: string): number {
  const s1 = normalizeTitle(a);
  const s2 = normalizeTitle(b);
  if (!s1 || !s2) return 0;
  if (s1 === s2) return 1;

  const matchWindow = Math.max(s1.length, s2.length) / 2 - 1;
  const s1Flags = new Uint8Array(s1.length);
  const s2Flags = new Uint8Array(s2.length);
  let matches = 0;
  for (let i = 0; i < s1.length; i++) {
    const start = Math.max(0, i - matchWindow);
    const end = Math.min(i + matchWindow + 1, s2.length);
    for (let j = start; j < end; j++) {
      if (!s2Flags[j] && s1[i] === s2[j]) { s1Flags[i] = s2Flags[j] = 1; matches++; break; }
    }
  }
  if (matches === 0) return 0;

  // Transpositions
  let transpositions = 0;
  for (let i = 0, j = 0; i < s1.length; i++) {
    if (s1Flags[i]) {
      while (!s2Flags[j]) j++;
      if (s1[i] !== s2[j]) transpositions++;
      j++;
    }
  }
  transpositions /= 2;

  const jaro = (matches / s1.length + matches / s2.length + (matches - transpositions) / matches) / 3;

  // Winkler prefix bonus (scaled 0.1, 4 chars max)
  let prefix = 0;
  for (let i = 0; i < Math.min(4, s1.length, s2.length); i++) {
    if (s1[i] === s2[i]) prefix++;
    else break;
  }
  return jaro + prefix * 0.1 * (1 - jaro);
}

// --- scoring -----------------------------------------------------------------

/**
 * Season/episode helper for TV: candidates are series-level, so an episode
 * file shares its parent's identity. Runtime is unavailable for episodes, per
 * PRD the runtime component is omitted for TV and when unknown.
 */
interface ScoreInput {
  parsedTitle: string;
  parsedYear: number | null;
  kind: TmdbKind;
  candidate: TmdbSearchResult;
}

export function scoreCandidate(input: ScoreInput): Candidate {
  const c = input.candidate;
  const candidateTitle = c.title ?? c.name ?? "";
  const originalTitle = c.original_title ?? c.original_name ?? candidateTitle;
  const candidateYear = Number(
    (c.release_date ?? c.first_air_date ?? "").slice(0, 4)) || null;

  const reasons: string[] = [];
  let score = 0;

  // Title, 0.50 max
  const sim = Math.max(jaroWinkler(input.parsedTitle, candidateTitle),
    jaroWinkler(input.parsedTitle, originalTitle) * 0.95);
  score += sim * 0.50;
  reasons.push(`title ${sim.toFixed(2)}`);

  // Year, 0.20 exact / 0.10 ±1 / 0 max otherwise
  if (input.parsedYear && candidateYear) {
    const delta = Math.abs(input.parsedYear - candidateYear);
    if (delta === 0) { score += 0.20; reasons.push("year exact"); }
    else if (delta === 1) { score += 0.10; reasons.push(`year ±1 (${candidateYear})`); }
    else reasons.push(`year off by ${delta} (${candidateYear})`);
  } else {
    score += 0.06; // unknown year on either side: mild neutral prior
    reasons.push("year unknown");
  }

  // Runtime for movies only, 0.15 within 5%. Fetched lazily by
  // refineWithRuntime on the top candidates so search stays at one TMDB round.

  // Popularity prior, 0.10 max, used only to break close ties (PRD 5.4).
  const pop = Math.min(1, Math.log10(1 + (c.popularity ?? 0)) / 3);
  score += pop * 0.10;

  return {
    tmdbId: c.id,
    tmdbType: input.kind,
    title: candidateTitle,
    year: candidateYear,
    posterPath: c.poster_path ?? null,
    score: Math.min(1, Number(score.toFixed(4))),
    reason: reasons.join(", ") + (pop > 0.3 ? ", popular" : ""),
    exactTitle: sim === 1,
  };
}

/**
 * Runtime refinement (PRD 5.4 step 5): when a file duration is known and the
 * candidate runtime is within 5%, add the missing 0.15 component. Called only
 * for the top candidates so search stays at one TMDB round.
 */
export async function refineWithRuntime(
  candidates: Candidate[],
  fileRuntimeMinutes: number | null,
): Promise<Candidate[]> {
  if (!fileRuntimeMinutes) return candidates;
  const out: Candidate[] = [];
  for (const candidate of candidates) {
    try {
      const full = await detail(candidate.tmdbType, candidate.tmdbId);
      const runtime = full.runtime ?? null;
      if (runtime && Math.abs(runtime - fileRuntimeMinutes) / runtime <= 0.05) {
        out.push({
          ...candidate,
          score: Math.min(1, candidate.score + 0.15),
          reason: `${candidate.reason}, runtime ${runtime}m ≈ file ${Math.round(fileRuntimeMinutes)}m`,
        });
        continue;
      }
      if (runtime) out.push({ ...candidate, reason: `${candidate.reason}, runtime ${runtime}m vs file ${Math.round(fileRuntimeMinutes)}m` });
      else out.push(candidate);
    } catch {
      out.push(candidate);
    }
  }
  return out.sort((a, b) => b.score - a.score);
}

// --- decision ----------------------------------------------------------------

export interface MatchInput {
  parsedTitle: string;
  parsedYear: number | null;
  kind: TmdbKind;
  fileRuntimeMinutes?: number | null;
  /** True when the title came from an explicit id tag or NFO file. */
  explicitId?: number | null;
}

/**
 * Full match pass. Throws `TmdbError` subclasses up to the scan service, which
 * records them in the item's reason field.
 */
export async function match(input: MatchInput): Promise<MatchResult> {
  // Shortcut: explicit id verifies existence then stops searching (PRD 5.4.3).
  if (input.explicitId) {
    try {
      const full = await detail(input.kind, input.explicitId);
      const title = full.title ?? full.name ?? "";
      return {
        status: "matched",
        matchedBy: "id-tag",
        best: {
          tmdbId: full.id,
          tmdbType: input.kind,
          title,
          year: Number((full.release_date ?? full.first_air_date ?? "").slice(0, 4)) || null,
          posterPath: full.poster_path ?? null,
          score: 1,
          reason: "explicit tmdb tag",
          exactTitle: true,
        },
        candidates: [],
      };
    } catch {
      // Bad tag: fall through to search rather than hard-failing the file.
    }
  }

  const results = await search(input.kind, input.parsedTitle, input.parsedYear);
  let candidates = results
    .map((c) => scoreCandidate({
      parsedTitle: input.parsedTitle,
      parsedYear: input.parsedYear,
      kind: input.kind,
      candidate: c,
    }))
    .sort((a, b) => b.score - a.score)
    .slice(0, 5);

  // Runtime refinement only matters near the auto threshold.
  if (input.kind === "movie" && input.fileRuntimeMinutes) {
    candidates = await refineWithRuntime(candidates, input.fileRuntimeMinutes);
  }

  candidates = candidates.slice(0, MAX_CANDIDATES);
  const best = candidates[0] ?? null;
  if (best && best.score >= AUTO_THRESHOLD) {
    return { status: "matched", matchedBy: "search", best, candidates: [] };
  }
  // Exact-title shortcut (PRD 5.4): an identical normalised title is a stronger
  // signal than any fuzzy agreement, but title's 0.50 weight alone can never
  // reach the 0.85 threshold when the year is unknown and runtime is TV-only.
  // Mirrors the explicit-id shortcut: equality verifies the match. Only when
  // the parsed and candidate years are absent or within ±2 do we trust it —
  // a big year gap means disagrees-with-evidence, not confirmation.
  // Exact-title shortcut (PRD 5.4): an identical normalised title is a stronger
  // signal than any fuzzy agreement, but title's 0.50 weight alone can never
  // reach the 0.85 threshold when the year is unknown and runtime is TV-only.
  // Mirrors the explicit-id shortcut: equality verifies the match. It applies
  // when the parsed year is unknown, or the candidate's year agrees (±2). A
  // big year gap means disagrees-with-evidence, not confirmation — those
  // candidates land in the review queue instead of silently matching.
  if (best && best.exactTitle) {
    const yearAgrees = !input.parsedYear || (best.year != null && Math.abs(input.parsedYear - best.year) <= 2);
    if (yearAgrees) {
      return {
        status: "matched", matchedBy: "search",
        best: { ...best, score: Math.max(best.score, AUTO_THRESHOLD), reason: `${best.reason}, exact title` },
        candidates: [],
      };
    }
    return { status: "review", matchedBy: "search", best: null, candidates };
  }
  if (best && best.score >= REVIEW_THRESHOLD) {
    return { status: "review", matchedBy: "search", best: null, candidates };
  }
  return { status: "unmatched", matchedBy: "search", best: null, candidates };
}
